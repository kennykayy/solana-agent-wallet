/**
 * solana-agent-wallet
 * Public API — import what you need
 */

export { AgentWallet } from "./AgentWallet";
export type { SpendingPolicy, WalletMetadata, TransactionRecord, AgentWalletState } from "./AgentWallet";

export { WalletManager } from "./WalletManager";
export type { FleetSummary } from "./WalletManager";

export {
  BaseAgent,
  LiquidityProviderAgent,
  TreasuryManagerAgent,
  PaymentRelayAgent,
  simulateMarket,
} from "./AgentLogic";
export type { AgentRole, MarketSnapshot, AgentDecision } from "./AgentLogic";
