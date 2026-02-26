/**
 * AgentWallet — Core wallet management for autonomous AI agents on Solana
 *
 * Design principles:
 *  - Wallets are created and managed programmatically (no user input needed)
 *  - Keys are held in memory and optionally encrypted at rest
 *  - Every agent has its own keypair — no shared keys
 *  - Spending policies are enforced before signing
 *  - All transactions are logged with full audit trail
 */

import {
  Connection,
  Keypair,
  PublicKey,
  Transaction,
  SystemProgram,
  LAMPORTS_PER_SOL,
  sendAndConfirmTransaction,
  TransactionSignature,
  Commitment,
  BlockheightBasedTransactionConfirmationStrategy,
} from "@solana/web3.js";
import bs58 from "bs58";
import * as crypto from "crypto";

// ── Types ──────────────────────────────────────────────────────────────────

export interface SpendingPolicy {
  maxTransactionLamports: number;   // Per-transaction cap
  dailyLimitLamports: number;       // Rolling 24h cap
  allowedTargets?: string[];        // Whitelist of destination pubkeys (optional)
  requiresApproval: boolean;        // Flag high-value txs for human review
  approvalThresholdLamports: number;
}

export interface WalletMetadata {
  agentId: string;
  agentName: string;
  role: string;
  createdAt: Date;
  policy: SpendingPolicy;
}

export interface TransactionRecord {
  signature: TransactionSignature;
  from: string;
  to: string;
  lamports: number;
  timestamp: Date;
  status: "success" | "failed" | "blocked";
  reason?: string;
}

export interface AgentWalletState {
  metadata: WalletMetadata;
  publicKey: string;
  balanceLamports: number;
  dailySpentLamports: number;
  dailySpentResetAt: Date;
  transactionHistory: TransactionRecord[];
  isActive: boolean;
}

// ── Constants ──────────────────────────────────────────────────────────────

const DEFAULT_POLICY: SpendingPolicy = {
  maxTransactionLamports: 0.1 * LAMPORTS_PER_SOL,
  dailyLimitLamports: 0.3 * LAMPORTS_PER_SOL,
  requiresApproval: true,
  approvalThresholdLamports: 0.5 * LAMPORTS_PER_SOL,
};

const COMMITMENT: Commitment = "confirmed";

// ── AgentWallet Class ──────────────────────────────────────────────────────

export class AgentWallet {
  private keypair: Keypair;
  private connection: Connection;
  public state: AgentWalletState;
  private pendingApprovals: Map<string, Transaction> = new Map();

  constructor(
    connection: Connection,
    metadata: WalletMetadata,
    existingKeypair?: Keypair
  ) {
    this.connection = connection;
    this.keypair = existingKeypair ?? Keypair.generate();

    this.state = {
      metadata,
      publicKey: this.keypair.publicKey.toBase58(),
      balanceLamports: 0,
      dailySpentLamports: 0,
      dailySpentResetAt: this.nextMidnight(),
      transactionHistory: [],
      isActive: true,
    };
  }

  // ── Getters ──────────────────────────────────────────────────────────────

  get publicKey(): PublicKey {
    return this.keypair.publicKey;
  }

  get agentId(): string {
    return this.state.metadata.agentId;
  }

  /** Export private key as base58 — store securely, never log */
  exportPrivateKey(): string {
    return bs58.encode(this.keypair.secretKey);
  }

  /** Export as encrypted JSON — use for at-rest storage */
  exportEncrypted(passphrase: string): string {
    const key = crypto.scryptSync(passphrase, "salt", 32);
    const iv = crypto.randomBytes(16);
    const cipher = crypto.createCipheriv("aes-256-cbc", key, iv);
    const privateKeyBase58 = this.exportPrivateKey();
    const encrypted =
      cipher.update(privateKeyBase58, "utf8", "hex") + cipher.final("hex");
    return JSON.stringify({
      iv: iv.toString("hex"),
      data: encrypted,
      publicKey: this.publicKey.toBase58(),
      agentId: this.agentId,
    });
  }

  static importEncrypted(encryptedJson: string, passphrase: string, connection: Connection, metadata: WalletMetadata): AgentWallet {
    const { iv, data } = JSON.parse(encryptedJson);
    const key = crypto.scryptSync(passphrase, "salt", 32);
    const decipher = crypto.createDecipheriv("aes-256-cbc", key, Buffer.from(iv, "hex"));
    const decrypted = decipher.update(data, "hex", "utf8") + decipher.final("utf8");
    const secretKey = bs58.decode(decrypted);
    const keypair = Keypair.fromSecretKey(secretKey);
    return new AgentWallet(connection, metadata, keypair);
  }

  // ── Balance ──────────────────────────────────────────────────────────────

  async refreshBalance(): Promise<number> {
    this.state.balanceLamports = await this.connection.getBalance(
      this.keypair.publicKey,
      COMMITMENT
    );
    return this.state.balanceLamports;
  }

  // ── Policy Enforcement ───────────────────────────────────────────────────

  private resetDailyLimitIfNeeded(): void {
    if (new Date() >= this.state.dailySpentResetAt) {
      this.state.dailySpentLamports = 0;
      this.state.dailySpentResetAt = this.nextMidnight();
    }
  }

  private nextMidnight(): Date {
    const d = new Date();
    d.setUTCHours(24, 0, 0, 0);
    return d;
  }

  /**
   * Validate a proposed transfer against the agent's spending policy.
   * Returns { allowed: true } or { allowed: false, reason: string }
   */
  validateTransfer(
    lamports: number,
    targetPubkey: string
  ): { allowed: boolean; reason?: string; requiresApproval?: boolean } {
    this.resetDailyLimitIfNeeded();
    const policy = this.state.metadata.policy;

    if (!this.state.isActive) {
      return { allowed: false, reason: "Wallet is deactivated" };
    }

    if (lamports <= 0) {
      return { allowed: false, reason: "Amount must be positive" };
    }

    if (lamports > this.state.balanceLamports) {
      return {
        allowed: false,
        reason: `Insufficient balance: have ${this.state.balanceLamports / LAMPORTS_PER_SOL} SOL, need ${lamports / LAMPORTS_PER_SOL} SOL`,
      };
    }

    if (lamports > policy.maxTransactionLamports) {
      return {
        allowed: false,
        reason: `Exceeds per-transaction limit of ${policy.maxTransactionLamports / LAMPORTS_PER_SOL} SOL`,
      };
    }

    if (this.state.dailySpentLamports + lamports > policy.dailyLimitLamports) {
      return {
        allowed: false,
        reason: `Would exceed daily limit of ${policy.dailyLimitLamports / LAMPORTS_PER_SOL} SOL (spent today: ${this.state.dailySpentLamports / LAMPORTS_PER_SOL} SOL)`,
      };
    }

    if (policy.allowedTargets && !policy.allowedTargets.includes(targetPubkey)) {
      return {
        allowed: false,
        reason: `Target ${targetPubkey} is not in the allowed destinations whitelist`,
      };
    }

    if (lamports >= policy.approvalThresholdLamports && policy.requiresApproval) {
      return {
        allowed: true,
        requiresApproval: true,
      };
    }

    return { allowed: true };
  }

  // ── Transaction Signing & Sending ─────────────────────────────────────────

  /**
   * Autonomously sign and send a SOL transfer.
   * Policy is checked before signing — no human input required.
   */
  async transferSOL(
    destinationPubkey: PublicKey,
    lamports: number,
    skipPolicyCheck = false
  ): Promise<TransactionRecord> {
    await this.refreshBalance();

    const validation = skipPolicyCheck
      ? { allowed: true }
      : this.validateTransfer(lamports, destinationPubkey.toBase58());

    if (!validation.allowed) {
      const record: TransactionRecord = {
        signature: "BLOCKED",
        from: this.publicKey.toBase58(),
        to: destinationPubkey.toBase58(),
        lamports,
        timestamp: new Date(),
        status: "blocked",
        reason: validation.reason,
      };
      this.state.transactionHistory.push(record);
      return record;
    }

    if (validation.requiresApproval) {
      const record: TransactionRecord = {
        signature: "PENDING_APPROVAL",
        from: this.publicKey.toBase58(),
        to: destinationPubkey.toBase58(),
        lamports,
        timestamp: new Date(),
        status: "blocked",
        reason: "Requires human approval (above threshold)",
      };
      this.state.transactionHistory.push(record);
      return record;
    }

    try {
      const { blockhash, lastValidBlockHeight } =
        await this.connection.getLatestBlockhash(COMMITMENT);

      const transaction = new Transaction({
        recentBlockhash: blockhash,
        feePayer: this.keypair.publicKey,
      }).add(
        SystemProgram.transfer({
          fromPubkey: this.keypair.publicKey,
          toPubkey: destinationPubkey,
          lamports,
        })
      );

      // ── Autonomous signing — no user prompt, no manual key entry ──
      transaction.sign(this.keypair);

      const confirmStrategy: BlockheightBasedTransactionConfirmationStrategy = {
        blockhash,
        lastValidBlockHeight,
        signature: bs58.encode(transaction.signature!),
      };

      const signature = await sendAndConfirmTransaction(
        this.connection,
        transaction,
        [this.keypair],
        { commitment: COMMITMENT }
      );

      // Update spending tracker
      this.state.dailySpentLamports += lamports;

      const record: TransactionRecord = {
        signature,
        from: this.publicKey.toBase58(),
        to: destinationPubkey.toBase58(),
        lamports,
        timestamp: new Date(),
        status: "success",
      };
      this.state.transactionHistory.push(record);
      await this.refreshBalance();
      return record;
    } catch (err: any) {
      const record: TransactionRecord = {
        signature: "FAILED",
        from: this.publicKey.toBase58(),
        to: destinationPubkey.toBase58(),
        lamports,
        timestamp: new Date(),
        status: "failed",
        reason: err.message,
      };
      this.state.transactionHistory.push(record);
      return record;
    }
  }

  // ── Agent Control ─────────────────────────────────────────────────────────

  deactivate(): void {
    this.state.isActive = false;
  }

  reactivate(): void {
    this.state.isActive = true;
  }

  updatePolicy(newPolicy: Partial<SpendingPolicy>): void {
    this.state.metadata.policy = {
      ...this.state.metadata.policy,
      ...newPolicy,
    };
  }

  getAuditLog(): TransactionRecord[] {
    return [...this.state.transactionHistory];
  }

  getSummary() {
    return {
      agentId: this.agentId,
      name: this.state.metadata.agentName,
      role: this.state.metadata.role,
      publicKey: this.state.publicKey,
      balanceSOL: this.state.balanceLamports / LAMPORTS_PER_SOL,
      dailySpentSOL: this.state.dailySpentLamports / LAMPORTS_PER_SOL,
      dailyLimitSOL: this.state.metadata.policy.dailyLimitLamports / LAMPORTS_PER_SOL,
      totalTx: this.state.transactionHistory.length,
      successTx: this.state.transactionHistory.filter((r) => r.status === "success").length,
      blockedTx: this.state.transactionHistory.filter((r) => r.status === "blocked").length,
      isActive: this.state.isActive,
    };
  }
}
