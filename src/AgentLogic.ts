/**
 * AgentLogic — Simulated AI decision-making engine
 *
 * Clean separation between wallet operations (AgentWallet)
 * and agent behaviour (this module). The agent observes
 * market conditions, makes decisions, and instructs the wallet.
 *
 * In production: replace the decision functions with LLM tool calls,
 * reinforcement learning outputs, or any other AI model.
 */

import { PublicKey, LAMPORTS_PER_SOL } from "@solana/web3.js";
import { AgentWallet, TransactionRecord } from "./AgentWallet";

// ── Agent Role Definitions ────────────────────────────────────────────────

export type AgentRole =
  | "liquidity-provider"
  | "treasury-manager"
  | "arbitrage-bot"
  | "payment-relay"
  | "monitor";

export interface MarketSnapshot {
  solPriceUSD: number;
  networkCongestion: "low" | "medium" | "high";
  timestamp: Date;
}

export interface AgentDecision {
  action: "transfer" | "hold" | "rebalance" | "alert";
  lamounts?: number;
  targetPubkey?: string;
  reasoning: string;
  confidence: number; // 0-1
}

// ── Base Agent Class ──────────────────────────────────────────────────────

export abstract class BaseAgent {
  protected wallet: AgentWallet;
  protected role: AgentRole;
  public actionLog: string[] = [];

  constructor(wallet: AgentWallet, role: AgentRole) {
    this.wallet = wallet;
    this.role = role;
  }

  protected log(message: string): void {
    const entry = `[${new Date().toISOString()}] [${this.wallet.agentId}] ${message}`;
    this.actionLog.push(entry);
    console.log(entry);
  }

  abstract observe(market: MarketSnapshot): AgentDecision;
  abstract act(decision: AgentDecision, peers: AgentWallet[]): Promise<TransactionRecord | null>;
}

// ── Liquidity Provider Agent ──────────────────────────────────────────────

export class LiquidityProviderAgent extends BaseAgent {
  private targetBalanceSOL: number;
  private rebalanceThreshold: number; // % deviation before rebalancing

  constructor(
    wallet: AgentWallet,
    targetBalanceSOL: number = 0.4,
    rebalanceThreshold: number = 0.2
  ) {
    super(wallet, "liquidity-provider");
    this.targetBalanceSOL = targetBalanceSOL;
    this.rebalanceThreshold = rebalanceThreshold;
  }

  observe(market: MarketSnapshot): AgentDecision {
    const balanceSOL = this.wallet.state.balanceLamports / LAMPORTS_PER_SOL;
    const deviation = Math.abs(balanceSOL - this.targetBalanceSOL) / this.targetBalanceSOL;

    if (deviation > this.rebalanceThreshold && market.networkCongestion !== "high") {
      const excessSOL = balanceSOL - this.targetBalanceSOL;
      if (excessSOL > 0.01) {
        return {
          action: "rebalance",
          lamounts: Math.floor(excessSOL * 0.5 * LAMPORTS_PER_SOL),
          reasoning: `Balance deviation ${(deviation * 100).toFixed(1)}% exceeds threshold. Redistributing excess liquidity.`,
          confidence: 0.82,
        };
      }
    }

    return {
      action: "hold",
      reasoning: `Balance within ${(this.rebalanceThreshold * 100).toFixed(0)}% of target. Network: ${market.networkCongestion}. Holding.`,
      confidence: 0.95,
    };
  }

  async act(decision: AgentDecision, peers: AgentWallet[]): Promise<TransactionRecord | null> {
    this.log(`Decision: ${decision.action} — ${decision.reasoning}`);

    if (decision.action === "rebalance" && decision.lamounts && peers.length > 0) {
      // Send to the peer with lowest balance (simplified redistribution logic)
      const lowestPeer = peers
        .filter((p) => p.agentId !== this.wallet.agentId && p.state.isActive)
        .sort((a, b) => a.state.balanceLamports - b.state.balanceLamports)[0];

      if (!lowestPeer) {
        this.log("No available peers for rebalancing");
        return null;
      }

      this.log(`Rebalancing ${decision.lamounts / LAMPORTS_PER_SOL} SOL → ${lowestPeer.agentId}`);
      const record = await this.wallet.transferSOL(lowestPeer.publicKey, decision.lamounts);
      this.log(`Result: ${record.status} | sig: ${record.signature.slice(0, 20)}...`);
      return record;
    }

    return null;
  }
}

// ── Treasury Manager Agent ────────────────────────────────────────────────

export class TreasuryManagerAgent extends BaseAgent {
  private reserveRatio: number; // Fraction of funds to keep as reserve

  constructor(wallet: AgentWallet, reserveRatio: number = 0.3) {
    super(wallet, "treasury-manager");
    this.reserveRatio = reserveRatio;
  }

  observe(market: MarketSnapshot): AgentDecision {
    const balanceSOL = this.wallet.state.balanceLamports / LAMPORTS_PER_SOL;
    const reserveSOL = balanceSOL * this.reserveRatio;

    // In a real system: LLM call here to assess risk conditions
    // Example: "Given SOL price $${market.solPriceUSD} and ${market.networkCongestion}
    //           congestion, should we move funds?"

    if (market.networkCongestion === "low" && balanceSOL > 0.5) {
      return {
        action: "transfer",
        lamounts: Math.floor((balanceSOL - reserveSOL) * 0.3 * LAMPORTS_PER_SOL),
        reasoning: `Network conditions favourable. Deploying ${(30).toFixed(0)}% of deployable treasury.`,
        confidence: 0.75,
      };
    }

    if (market.networkCongestion === "high") {
      return {
        action: "hold",
        reasoning: "High network congestion detected. Preserving treasury until conditions improve.",
        confidence: 0.9,
      };
    }

    return {
      action: "hold",
      reasoning: `Maintaining ${(this.reserveRatio * 100).toFixed(0)}% reserve ratio. No action needed.`,
      confidence: 0.88,
    };
  }

  async act(decision: AgentDecision, peers: AgentWallet[]): Promise<TransactionRecord | null> {
    this.log(`Treasury decision: ${decision.action} (confidence: ${(decision.confidence * 100).toFixed(0)}%) — ${decision.reasoning}`);

    if (decision.action === "transfer" && decision.lamounts) {
      const activePeers = peers.filter(
        (p) => p.agentId !== this.wallet.agentId && p.state.isActive
      );
      if (activePeers.length === 0) return null;

      // Distribute to all active peers equally
      const perPeer = Math.floor(decision.lamounts / activePeers.length);
      let lastRecord: TransactionRecord | null = null;

      for (const peer of activePeers) {
        this.log(`Distributing ${perPeer / LAMPORTS_PER_SOL} SOL → ${peer.agentId}`);
        lastRecord = await this.wallet.transferSOL(peer.publicKey, perPeer);
        if (lastRecord.status !== "success") {
          this.log(`Distribution to ${peer.agentId} failed: ${lastRecord.reason}`);
          break;
        }
      }
      return lastRecord;
    }

    return null;
  }
}

// ── Payment Relay Agent ───────────────────────────────────────────────────

export class PaymentRelayAgent extends BaseAgent {
  private paymentQueue: Array<{ to: PublicKey; lamports: number; memo: string }> = [];

  constructor(wallet: AgentWallet) {
    super(wallet, "payment-relay");
  }

  queuePayment(to: PublicKey, lamports: number, memo: string): void {
    this.paymentQueue.push({ to, lamports, memo });
    this.log(`Payment queued: ${lamports / LAMPORTS_PER_SOL} SOL → ${to.toBase58().slice(0, 12)}... (${memo})`);
  }

  observe(_market: MarketSnapshot): AgentDecision {
    if (this.paymentQueue.length > 0) {
      const next = this.paymentQueue[0];
      return {
        action: "transfer",
        lamounts: next.lamports,
        targetPubkey: next.to.toBase58(),
        reasoning: `Processing queued payment: ${next.memo}`,
        confidence: 1.0, // Payment relay always executes queued payments
      };
    }
    return {
      action: "hold",
      reasoning: "Payment queue is empty. Waiting for instructions.",
      confidence: 1.0,
    };
  }

  async act(decision: AgentDecision, _peers: AgentWallet[]): Promise<TransactionRecord | null> {
    if (decision.action === "transfer" && this.paymentQueue.length > 0) {
      const payment = this.paymentQueue.shift()!;
      this.log(`Executing payment: ${payment.memo}`);
      const record = await this.wallet.transferSOL(payment.to, payment.lamports);
      this.log(`Payment result: ${record.status}`);
      return record;
    }
    return null;
  }
}

// ── Market Simulator ──────────────────────────────────────────────────────
// Generates realistic-ish market data for the demo — replace with real oracle

export function simulateMarket(): MarketSnapshot {
  const congestionOptions: ("low" | "medium" | "high")[] = ["low", "low", "medium", "high"];
  return {
    solPriceUSD: 140 + Math.random() * 30,
    networkCongestion: congestionOptions[Math.floor(Math.random() * congestionOptions.length)],
    timestamp: new Date(),
  };
}
