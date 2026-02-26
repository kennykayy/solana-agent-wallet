/**
 * WalletManager — Fleet management for multiple autonomous agent wallets
 *
 * Handles creation, funding, monitoring, and lifecycle management
 * of a collection of AgentWallet instances on Solana devnet.
 */

import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";
import { AgentWallet, SpendingPolicy, WalletMetadata, DEFAULT_POLICY } from "./AgentWallet";

// re-export DEFAULT_POLICY so other modules don't need to reach into AgentWallet
export { DEFAULT_POLICY };

export interface FleetSummary {
  totalAgents: number;
  activeAgents: number;
  totalBalanceSOL: number;
  totalTransactions: number;
  successRate: number;
}

export class WalletManager {
  private wallets: Map<string, AgentWallet> = new Map();
  private connection: Connection;
  private authorityKeypair?: Keypair; // Master funding wallet

  constructor(connection: Connection, authorityKeypair?: Keypair) {
    this.connection = connection;
    this.authorityKeypair = authorityKeypair;
  }

  // ── Wallet Creation ───────────────────────────────────────────────────────

  createAgentWallet(
    agentId: string,
    agentName: string,
    role: string,
    policy: SpendingPolicy = DEFAULT_POLICY
  ): AgentWallet {
    if (this.wallets.has(agentId)) {
      throw new Error(`Agent wallet with ID '${agentId}' already exists`);
    }

    const metadata: WalletMetadata = {
      agentId,
      agentName,
      role,
      createdAt: new Date(),
      policy,
    };

    const wallet = new AgentWallet(this.connection, metadata);
    this.wallets.set(agentId, wallet);
    return wallet;
  }

  createAgentFleet(
    agentConfigs: Array<{
      agentId: string;
      agentName: string;
      role: string;
      policy?: SpendingPolicy;
    }>
  ): AgentWallet[] {
    return agentConfigs.map((cfg) =>
      this.createAgentWallet(cfg.agentId, cfg.agentName, cfg.role, cfg.policy)
    );
  }

  // ── Retrieval ─────────────────────────────────────────────────────────────

  getWallet(agentId: string): AgentWallet {
    const wallet = this.wallets.get(agentId);
    if (!wallet) throw new Error(`No wallet found for agent '${agentId}'`);
    return wallet;
  }

  getAllWallets(): AgentWallet[] {
    return Array.from(this.wallets.values());
  }

  // ── Devnet Funding ────────────────────────────────────────────────────────

  /**
   * Fund a wallet using Solana's devnet airdrop faucet.
   * Rate-limited: max 2 SOL per request per address.
   */
  async airdropToAgent(agentId: string, solAmount: number = 1): Promise<string> {
    const wallet = this.getWallet(agentId);
    const lamports = Math.min(solAmount * LAMPORTS_PER_SOL, 2 * LAMPORTS_PER_SOL);

    const signature = await this.connection.requestAirdrop(
      wallet.publicKey,
      lamports
    );

    // Wait for airdrop confirmation
    const { blockhash, lastValidBlockHeight } =
      await this.connection.getLatestBlockhash();
    await this.connection.confirmTransaction({
      blockhash,
      lastValidBlockHeight,
      signature,
    });

    await wallet.refreshBalance();
    return signature;
  }

  /**
   * Fund multiple agents in sequence (devnet faucet rate limits apply).
   * Adds a delay between requests to avoid 429 errors.
   */
  async airdropToAllAgents(
    solPerAgent: number = 1,
    delayMs: number = 2000
  ): Promise<void> {
    for (const [agentId] of this.wallets) {
      try {
        await this.airdropToAgent(agentId, solPerAgent);
        console.log(`  ✓ Funded agent: ${agentId}`);
      } catch (err: any) {
        console.warn(`  ⚠ Airdrop failed for ${agentId}: ${err.message}`);
      }
      if (delayMs > 0) {
        await new Promise((r) => setTimeout(r, delayMs));
      }
    }
  }

  // ── Monitoring ────────────────────────────────────────────────────────────

  async refreshAllBalances(): Promise<void> {
    await Promise.all(
      Array.from(this.wallets.values()).map((w) => w.refreshBalance())
    );
  }

  getFleetSummary(): FleetSummary {
    const all = this.getAllWallets();
    const active = all.filter((w) => w.state.isActive);
    const allTx = all.flatMap((w) => w.state.transactionHistory);
    const successTx = allTx.filter((t) => t.status === "success");

    return {
      totalAgents: all.length,
      activeAgents: active.length,
      totalBalanceSOL: all.reduce(
        (sum, w) => sum + w.state.balanceLamports / LAMPORTS_PER_SOL,
        0
      ),
      totalTransactions: allTx.length,
      successRate: allTx.length > 0 ? successTx.length / allTx.length : 0,
    };
  }

  // ── Global Controls ───────────────────────────────────────────────────────

  pauseAllAgents(): void {
    this.wallets.forEach((w) => w.deactivate());
  }

  resumeAllAgents(): void {
    this.wallets.forEach((w) => w.reactivate());
  }

  pauseAgent(agentId: string): void {
    this.getWallet(agentId).deactivate();
  }

  resumeAgent(agentId: string): void {
    this.getWallet(agentId).reactivate();
  }
}
