# 🤖 Solana Agent Wallet

**Autonomous AI agent wallet infrastructure on Solana devnet.**
## Live Demo — Devnet Transactions

| Demo | Transaction | Explorer |
|------|-------------|----------|
| Autonomous agent transfer | 33uQY4TDN... | [View on Solscan](https://solscan.io/tx/33uQY4TDNhD6dZXn96qmoJqFC9e341ZA3froySTic9rZS9BBCvijv7QTPLZ6mxZy1vtEoS3QesMh7mj36FmTNNCm?cluster=devnet) |

**Agent wallet address:** `4ZUhZnjxTANEQDvtKuz1zREQ3R4jB16LwpuFB48NP5QY`

Each agent gets its own keypair, signs transactions independently, and operates
within enforced spending policies — no human intervention required.

[![License: MIT](https://img.shields.io/badge/License-MIT-green.svg)](LICENSE)
[![Network: Devnet](https://img.shields.io/badge/Solana-Devnet-9945FF)](https://explorer.solana.com/?cluster=devnet)
[![TypeScript](https://img.shields.io/badge/TypeScript-5.5-blue)](https://www.typescriptlang.org)

---

## What It Does

| Feature | Detail |
|---------|--------|
| 🔑 Programmatic wallet creation | Each agent gets a unique Ed25519 keypair, generated autonomously |
| ✍️ Autonomous transaction signing | Agents sign and broadcast without any user prompt |
| 💰 SOL holding on devnet | Funded via airdrop, holds real devnet SOL |
| 🛡️ Spending policy enforcement | Per-tx cap, daily limit, destination whitelist — enforced before signing |
| 🤖 AI agent logic layer | Pluggable decision engines (liquidity, treasury, relay) |
| 🏘️ Multi-agent fleet | Manage 5+ independent agents with one `WalletManager` |
| 📋 Full audit log | Every tx attempt (success, blocked, failed) is recorded |
| 🔒 Encrypted key export | AES-256-CBC export for at-rest storage |

---

## Quick Start

### Prerequisites

- Node.js ≥ 18
- npm or yarn
- Internet access (for devnet RPC)

### 1. Clone and install

```bash
git clone https://github.com/your-username/solana-agent-wallet
cd solana-agent-wallet
npm install
```

### 2. Configure environment

```bash
cp .env.example .env
```

The defaults work for devnet — no changes needed for the demo.

### 3. Generate a master wallet (optional)

```bash
npm run generate-wallet
```

Copy the output private key to `.env` as `MASTER_PRIVATE_KEY` if you want
a persistent authority wallet. The demos create ephemeral wallets automatically.

### 4. Run the single-agent demo

```bash
npm run demo
```

This will:
1. Create an agent wallet programmatically
2. Request 1 SOL from the devnet faucet
3. Execute an autonomous transfer (within policy)
4. Attempt a blocked transfer (over limit)
5. Demonstrate emergency deactivation
6. Print the full audit log

### 5. Run the multi-agent fleet demo

```bash
npm run multi-agent
```

This spins up 4 independent agents (Treasury, LP×2, Relay), funds them
via devnet airdrop, and runs 3 autonomous decision cycles with agent-to-agent
transfers.

### 6. Run tests

```bash
npm test
```

17 unit tests covering policy enforcement, wallet structure, and fleet management.
No network connection required for unit tests.

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                      AGENT LAYER                             │
│   TreasuryManagerAgent / LiquidityProviderAgent /           │
│   PaymentRelayAgent  (extend BaseAgent to add your own)     │
│                                                             │
│   observe(market) → AgentDecision                           │
│   act(decision, peers) → TransactionRecord                  │
└────────────────────────────┬────────────────────────────────┘
                              │  transfer(pubkey, lamports)
                              ↓
┌─────────────────────────────────────────────────────────────┐
│                     WALLET LAYER                             │
│   AgentWallet                                               │
│                                                             │
│   validateTransfer() → allowed / blocked                    │
│   sign + broadcast (if allowed)                             │
│   append to auditLog                                        │
└────────────────────────────┬────────────────────────────────┘
                              │
                              ↓
              Solana Devnet (api.devnet.solana.com)
```

---

## Project Structure

```
solana-agent-wallet/
├── src/
│   ├── AgentWallet.ts      # Core wallet: keypair, signing, policy
│   ├── WalletManager.ts    # Fleet creation, funding, monitoring
│   ├── AgentLogic.ts       # AI agent decision engines
│   ├── demo.ts             # Single agent demo
│   ├── multiAgent.ts       # Multi-agent fleet demo
│   └── index.ts            # Public API exports
├── tests/
│   └── wallet.test.ts      # 17 unit tests
├── scripts/
│   └── generateWallet.ts   # Keypair utility
├── docs/
│   └── deep-dive.md        # Full architecture + security writeup
├── SKILLS.md               # Agent capability manifest
├── .env.example            # Environment template
├── package.json
└── tsconfig.json
```

---

## Spending Policy

Every agent wallet has a `SpendingPolicy` enforced before any signature:

```typescript
const policy: SpendingPolicy = {
  maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL,  // 0.05 SOL per tx
  dailyLimitLamports:     0.2  * LAMPORTS_PER_SOL,  // 0.2 SOL per day
  allowedTargets: ["pubkey1", "pubkey2"],             // optional whitelist
  requiresApproval:         true,                    // human-in-the-loop flag
  approvalThresholdLamports: 0.5 * LAMPORTS_PER_SOL, // above → flag for review
};
```

A transaction that violates any constraint is **never signed**. The violation is
recorded in the audit log with the specific reason.

---

## Creating Your Own Agent

Extend `BaseAgent` and implement two methods:

```typescript
import { BaseAgent, MarketSnapshot, AgentDecision } from "./AgentLogic";
import { AgentWallet, TransactionRecord } from "./AgentWallet";

export class MyCustomAgent extends BaseAgent {
  constructor(wallet: AgentWallet) {
    super(wallet, "my-role");
  }

  observe(market: MarketSnapshot): AgentDecision {
    // Your logic here — or call an LLM
    return { action: "hold", reasoning: "Watching for opportunity", confidence: 0.9 };
  }

  async act(decision: AgentDecision, peers: AgentWallet[]): Promise<TransactionRecord | null> {
    if (decision.action === "transfer" && decision.lamounts) {
      return await this.wallet.transferSOL(peers[0].publicKey, decision.lamounts);
    }
    return null;
  }
}
```

---

## Connecting an LLM

Replace the simulated `observe()` logic with any LLM:

```typescript
// Using Claude (Anthropic)
const response = await anthropic.messages.create({
  model: "claude-opus-4-6",
  max_tokens: 256,
  messages: [{
    role: "user",
    content: `Agent state: ${JSON.stringify(this.wallet.getSummary())}
Market: ${JSON.stringify(market)}
Respond with JSON: { action, lamounts?, reasoning, confidence }`
  }]
});
const decision = JSON.parse(response.content[0].text);
```

The wallet policy layer is LLM-agnostic — it enforces constraints regardless
of the instruction source.

---

## Viewing Transactions

All devnet transactions are public. View them at:
- **Solana Explorer**: `https://explorer.solana.com/tx/<signature>?cluster=devnet`
- **Solscan**: `https://solscan.io/tx/<signature>?cluster=devnet`
- **Your agent's public key**: `https://explorer.solana.com/address/<pubkey>?cluster=devnet`

---

## Security Notes

- ⚠️ **Devnet only** — do not use on mainnet without a security audit
- 🔐 Private keys are never logged — only held in process memory
- 🔒 Use `exportEncrypted()` + a secrets manager for persistence
- 🛡️ Policy enforcement is synchronous and runs before every signature
- 👁️ All transaction attempts (including blocked) are in the audit log

For production key management, consider: [Turnkey](https://turnkey.com),
[AWS KMS](https://aws.amazon.com/kms/), or an HSM with Solana signing support.

---

## Resources

- [Solana Web3.js Docs](https://solana-labs.github.io/solana-web3.js/)
- [Solana Devnet Explorer](https://explorer.solana.com/?cluster=devnet)
- [Solana JSON RPC API](https://solana.com/docs/rpc)
- [Deep Dive: Architecture & Security](docs/deep-dive.md)
- [SKILLS.md: Agent Capability Manifest](SKILLS.md)

---

## License

MIT — see [LICENSE](LICENSE)
