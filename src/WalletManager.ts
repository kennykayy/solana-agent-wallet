import {
  Connection,
  PublicKey,
  LAMPORTS_PER_SOL,
  Keypair,
} from "@solana/web3.js";
import { AgentWallet, SpendingPolicy, WalletMetadata, DEFAULT_POLICY } from "./AgentWallet";

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
  private authorityKeypair?: Keypair;

  constructor(connection: Connection, authorityKeypair?: Keypair) {
    this.connection = connection;
    this.authorityKeypair = authorityKeypair;
  }

  createAgentWallet(
    agentId: string,
    agentName: string,
    role: string,
    policy: SpendingPolicy = DEFAULT_POLICY,
    existingKeypair?: Keypair
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

    const wallet = new AgentWallet(this.connection, metadata, existingKeypair);
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

  getWallet(agentId: string): AgentWallet {
    const wallet = this.wallets.get(agentId);
    if (!wallet) throw new Error(`No wallet found for agent '${agentId}'`);
    return wallet;
  }

  getAllWallets(): AgentWallet[] {
    return Array.from(this.wallets.values());
  }

  async airdropToAgent(agentId: string, solAmount: number = 1): Promise<string> {
    const wallet = this.getWallet(agentId);
    const lamports = Math.min(solAmount * LAMPORTS_PER_SOL, 2 * LAMPORTS_PER_SOL);

    const signature = await this.connection.requestAirdrop(
      wallet.publicKey,
      lamports
    );

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

  pauseAllAgents(): void { this.wallets.forEach((w) => w.deactivate()); }
  resumeAllAgents(): void { this.wallets.forEach((w) => w.reactivate()); }
  pauseAgent(agentId: string): void { this.getWallet(agentId).deactivate(); }
  resumeAgent(agentId: string): void { this.getWallet(agentId).reactivate(); }
}
