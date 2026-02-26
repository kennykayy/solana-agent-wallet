# SKILLS.md
## Agent Capability Manifest — solana-agent-wallet

This file describes the capabilities, interfaces, and operational constraints
of the `solana-agent-wallet` system for consumption by AI agents and orchestrators.

---

## What This System Does

`solana-agent-wallet` provides autonomous wallet infrastructure for AI agents on
Solana devnet. Each agent gets its own keypair, signs transactions independently,
and operates within enforced spending policies — without human intervention.

---

## Available Actions

### Wallet Management
| Action | Method | Parameters | Returns |
|--------|--------|-----------|---------|
| Create wallet | `WalletManager.createAgentWallet()` | `agentId, agentName, role, policy` | `AgentWallet` |
| Create fleet | `WalletManager.createAgentFleet()` | `agentConfigs[]` | `AgentWallet[]` |
| Get wallet | `WalletManager.getWallet()` | `agentId` | `AgentWallet` |
| Fund (devnet) | `WalletManager.airdropToAgent()` | `agentId, solAmount` | `signature` |
| Fund fleet | `WalletManager.airdropToAllAgents()` | `solPerAgent, delayMs` | `void` |

### Transaction Operations
| Action | Method | Parameters | Returns |
|--------|--------|-----------|---------|
| Transfer SOL | `AgentWallet.transferSOL()` | `destination: PublicKey, lamports: number` | `TransactionRecord` |
| Check balance | `AgentWallet.refreshBalance()` | — | `number (lamports)` |
| Validate tx | `AgentWallet.validateTransfer()` | `lamports, targetPubkey` | `{allowed, reason?}` |
| Export key | `AgentWallet.exportPrivateKey()` | — | `string (base58)` |
| Encrypt key | `AgentWallet.exportEncrypted()` | `passphrase` | `JSON string` |

### Agent Control
| Action | Method | Parameters | Returns |
|--------|--------|-----------|---------|
| Pause agent | `AgentWallet.deactivate()` | — | `void` |
| Resume agent | `AgentWallet.reactivate()` | — | `void` |
| Update policy | `AgentWallet.updatePolicy()` | `Partial<SpendingPolicy>` | `void` |
| Get audit log | `AgentWallet.getAuditLog()` | — | `TransactionRecord[]` |
| Get summary | `AgentWallet.getSummary()` | — | `AgentSummary` |

---

## Spending Policy Schema

Agents operate within a `SpendingPolicy` that is enforced before every transaction:

```typescript
interface SpendingPolicy {
  maxTransactionLamports: number;    // Hard cap per transaction
  dailyLimitLamports: number;        // Rolling 24h spend cap
  allowedTargets?: string[];         // Optional destination whitelist
  requiresApproval: boolean;         // Flag for human-in-the-loop
  approvalThresholdLamports: number; // Above this → requiresApproval check
}
```

**Policy is enforced atomically before signing** — a transaction that fails
policy validation is never constructed or broadcast.

---

## Transaction Record Schema

Every attempted transaction produces a `TransactionRecord`:

```typescript
interface TransactionRecord {
  signature: string;         // Solana tx signature, "BLOCKED", or "FAILED"
  from: string;              // Sender public key (base58)
  to: string;                // Destination public key (base58)
  lamports: number;          // Amount transferred
  timestamp: Date;           // UTC timestamp
  status: "success" | "failed" | "blocked";
  reason?: string;           // Present on non-success records
}
```

---

## Agent Roles

| Role | Class | Behaviour |
|------|-------|-----------|
| `treasury-manager` | `TreasuryManagerAgent` | Manages capital allocation across the fleet |
| `liquidity-provider` | `LiquidityProviderAgent` | Maintains target balance ratios |
| `payment-relay` | `PaymentRelayAgent` | Executes queued payment instructions |
| `monitor` | (extend BaseAgent) | Read-only observation role |

---

## Security Constraints

1. **Private keys never leave the process memory** unless explicitly exported via `exportPrivateKey()` or `exportEncrypted()`. No key material appears in logs.
2. **Devnet only** — RPC URL defaults to `https://api.devnet.solana.com`. Change `SOLANA_RPC_URL` in `.env` to switch networks (only do this intentionally).
3. **Policy enforcement is synchronous** and runs before any network call.
4. **Audit trail is append-only** — blocked and failed transactions are recorded.
5. **Deactivation is immediate** — `deactivate()` prevents all future signing until `reactivate()` is called.

---

## Integration Example

```typescript
import { WalletManager, LiquidityProviderAgent } from "solana-agent-wallet";
import { Connection } from "@solana/web3.js";

const connection = new Connection("https://api.devnet.solana.com", "confirmed");
const manager = new WalletManager(connection);

// Create a wallet with a conservative policy
const wallet = manager.createAgentWallet("my-agent", "MyAgent", "liquidity-provider", {
  maxTransactionLamports: 50_000_000,   // 0.05 SOL
  dailyLimitLamports: 200_000_000,      // 0.2 SOL
  requiresApproval: false,
  approvalThresholdLamports: 1_000_000_000,
});

// Fund it (devnet)
await manager.airdropToAgent("my-agent", 1);

// Attach agent logic
const agent = new LiquidityProviderAgent(wallet, 0.4, 0.2);

// Observe + act
const market = { solPriceUSD: 150, networkCongestion: "low", timestamp: new Date() };
const decision = agent.observe(market);
const result = await agent.act(decision, manager.getAllWallets());
console.log(result);
```

---

## Fleet Management

The `WalletManager` supports fleets of up to `MAX_AGENTS` (default 5, configurable):

```typescript
const fleet = manager.createAgentFleet([
  { agentId: "treasury-01", agentName: "Treasury", role: "treasury-manager" },
  { agentId: "lp-01",       agentName: "LP1",      role: "liquidity-provider" },
  { agentId: "relay-01",    agentName: "Relay",    role: "payment-relay" },
]);

// Pause all on emergency
manager.pauseAllAgents();

// Resume individual
manager.resumeAgent("relay-01");
```

---

## Limitations (Devnet Context)

- Devnet airdrop: max 2 SOL per request, rate-limited
- No mainnet deployment without security audit
- SPL token transfers: extend via `@solana/spl-token` (see docs/extending.md)
- No persistent key storage by default — implement your own encrypted store

---

## File Structure

```
solana-agent-wallet/
├── src/
│   ├── AgentWallet.ts      # Core wallet: create, sign, policy
│   ├── WalletManager.ts    # Fleet management
│   ├── AgentLogic.ts       # AI agent decision engines
│   ├── demo.ts             # Single agent demo
│   ├── multiAgent.ts       # Multi-agent fleet demo
│   └── index.ts            # Public API exports
├── tests/
│   └── wallet.test.ts      # Unit tests (policy, structure, manager)
├── scripts/
│   └── generateWallet.ts   # Keypair generation utility
├── docs/
│   └── deep-dive.md        # Architecture + security writeup
├── SKILLS.md               # This file — agent capability manifest
├── README.md               # Setup and usage instructions
├── .env.example            # Environment template
├── package.json
└── tsconfig.json
```

---

*Version: 1.0.0 | Network: Solana Devnet | License: MIT*
