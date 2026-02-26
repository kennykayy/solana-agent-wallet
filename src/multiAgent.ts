/**
 * multiAgent.ts — Multi-Agent Fleet Demo
 *
 * Demonstrates:
 *  1. Creating 4 independent agents with different roles
 *  2. Funding all via devnet airdrop
 *  3. Running autonomous decision cycles
 *  4. Agent-to-agent transfers
 *  5. Fleet monitoring dashboard
 *
 * Run: npm run multi-agent
 */

import { Connection, LAMPORTS_PER_SOL } from "@solana/web3.js";
import dotenv from "dotenv";
import chalk from "chalk";
import { WalletManager } from "./WalletManager";
import {
  LiquidityProviderAgent,
  TreasuryManagerAgent,
  PaymentRelayAgent,
  simulateMarket,
  MarketSnapshot,
} from "./AgentLogic";
import { AgentWallet, SpendingPolicy } from "./AgentWallet";

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const CYCLES = 3;
const CYCLE_DELAY_MS = 3000;

function separator(label: string) {
  console.log("\n" + chalk.dim("═".repeat(70)));
  console.log(chalk.bold.magenta(`  ◆ ${label}`));
  console.log(chalk.dim("═".repeat(70)));
}

function printFleetTable(wallets: AgentWallet[]) {
  console.log();
  console.log(
    chalk.bold(
      "  " +
      "Agent ID".padEnd(22) +
      "Role".padEnd(22) +
      "Balance (SOL)".padEnd(16) +
      "Tx Count".padEnd(10) +
      "Status"
    )
  );
  console.log("  " + chalk.dim("─".repeat(82)));
  wallets.forEach((w) => {
    const s = w.getSummary();
    const status = s.isActive ? chalk.green("ACTIVE") : chalk.red("PAUSED");
    console.log(
      "  " +
      s.agentId.padEnd(22) +
      s.role.padEnd(22) +
      (s.balanceSOL.toFixed(4) + " SOL").padEnd(16) +
      String(s.totalTx).padEnd(10) +
      status
    );
  });
  console.log();
}

async function sleep(ms: number) {
  return new Promise((r) => setTimeout(r, ms));
}

async function main() {
  console.log(chalk.bold.white("\n🤖 Solana Agent Wallet — Multi-Agent Fleet Demo"));
  console.log(chalk.dim(`   Network: devnet | ${CYCLES} decision cycles | No real funds\n`));

  const connection = new Connection(RPC_URL, "confirmed");
  const manager = new WalletManager(connection);

  // ── Step 1: Create the fleet ─────────────────────────────────────────────
  separator("Step 1: Creating Agent Fleet");

  const conservativePolicy: SpendingPolicy = {
    maxTransactionLamports: 0.03 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 0.15 * LAMPORTS_PER_SOL,
    requiresApproval: false,
    approvalThresholdLamports: 1 * LAMPORTS_PER_SOL,
  };

  const activePolicy: SpendingPolicy = {
    maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 0.25 * LAMPORTS_PER_SOL,
    requiresApproval: false,
    approvalThresholdLamports: 1 * LAMPORTS_PER_SOL,
  };

  const agentConfigs = [
    { agentId: "treasury-01",   agentName: "TreasuryAlpha", role: "treasury-manager",    policy: activePolicy },
    { agentId: "liquidity-01",  agentName: "LiquidityBot",  role: "liquidity-provider",  policy: conservativePolicy },
    { agentId: "liquidity-02",  agentName: "LiquidityBot2", role: "liquidity-provider",  policy: conservativePolicy },
    { agentId: "relay-01",      agentName: "PaymentRelay",  role: "payment-relay",       policy: activePolicy },
  ];

  manager.createAgentFleet(agentConfigs);
  const allWallets = manager.getAllWallets();

  console.log(`  ✓ Created ${allWallets.length} independent agent wallets\n`);
  allWallets.forEach((w) => {
    console.log(`    • ${chalk.cyan(w.agentId)} → ${w.publicKey.toBase58()}`);
  });

  // ── Step 2: Fund all agents ──────────────────────────────────────────────
  separator("Step 2: Funding All Agents via Devnet Airdrop");

  console.log("  ⏳ Requesting devnet SOL for each agent (this may take ~10s)...\n");
  try {
    await manager.airdropToAllAgents(0.5, 2500);
  } catch (err: any) {
    console.log(chalk.yellow(`  ⚠ Some airdrops failed — devnet rate limits. Continuing with what we have.`));
  }

  await manager.refreshAllBalances();
  printFleetTable(allWallets);

  // ── Step 3: Instantiate AI agents ────────────────────────────────────────
  separator("Step 3: Instantiating Agent Decision Engines");

  const treasury = new TreasuryManagerAgent(manager.getWallet("treasury-01"), 0.3);
  const lp1 = new LiquidityProviderAgent(manager.getWallet("liquidity-01"), 0.3, 0.25);
  const lp2 = new LiquidityProviderAgent(manager.getWallet("liquidity-02"), 0.3, 0.25);
  const relay = new PaymentRelayAgent(manager.getWallet("relay-01"));

  // Queue a payment on the relay agent (simulates external instruction)
  relay.queuePayment(
    manager.getWallet("liquidity-01").publicKey,
    0.02 * LAMPORTS_PER_SOL,
    "Cross-agent payment: LP funding round 1"
  );

  console.log("  ✓ TreasuryManagerAgent instantiated (role: capital allocation)");
  console.log("  ✓ LiquidityProviderAgent × 2 instantiated (role: balance maintenance)");
  console.log("  ✓ PaymentRelayAgent instantiated (role: queued payment execution)");
  console.log("  ✓ 1 payment queued in relay agent");

  // ── Step 4: Run autonomous cycles ────────────────────────────────────────
  separator("Step 4: Running Autonomous Decision Cycles");

  for (let cycle = 1; cycle <= CYCLES; cycle++) {
    const market: MarketSnapshot = simulateMarket();
    console.log(
      `\n  ${chalk.bold.yellow(`Cycle ${cycle}/${CYCLES}`)} | SOL $${market.solPriceUSD.toFixed(2)} | Network: ${market.networkCongestion}`
    );
    console.log(chalk.dim("  " + "─".repeat(60)));

    // Each agent observes and acts
    const agents = [treasury, lp1, lp2, relay];
    for (const agent of agents) {
      const decision = agent.observe(market);
      console.log(
        `  🧠 ${chalk.cyan((agent as any).wallet.agentId)} → ${decision.action.toUpperCase()} (${(decision.confidence * 100).toFixed(0)}% confidence)`
      );
      console.log(`     ${chalk.dim(decision.reasoning)}`);

      if (decision.action !== "hold") {
        const result = await agent.act(decision, allWallets);
        if (result) {
          const icon = result.status === "success" ? "✅" : result.status === "blocked" ? "🚫" : "❌";
          console.log(`     ${icon} ${result.status.toUpperCase()} — ${result.lamports / LAMPORTS_PER_SOL} SOL`);
          if (result.status === "success") {
            console.log(`     🔗 ${chalk.dim(result.signature.slice(0, 44) + "... (devnet)")}`);
          }
        }
      }
    }

    if (cycle < CYCLES) {
      console.log(`\n  ⏳ Waiting ${CYCLE_DELAY_MS / 1000}s before next cycle...`);
      await sleep(CYCLE_DELAY_MS);
    }
  }

  // ── Step 5: Fleet summary ─────────────────────────────────────────────────
  separator("Step 5: Fleet Summary Dashboard");

  await manager.refreshAllBalances();
  printFleetTable(allWallets);

  const fleet = manager.getFleetSummary();
  console.log(`  📊 Fleet Statistics`);
  console.log(`     Total Agents    : ${fleet.totalAgents}`);
  console.log(`     Active          : ${fleet.activeAgents}`);
  console.log(`     Combined Balance: ${chalk.green(fleet.totalBalanceSOL.toFixed(4))} SOL`);
  console.log(`     Total Tx        : ${fleet.totalTransactions}`);
  console.log(`     Success Rate    : ${(fleet.successRate * 100).toFixed(1)}%`);

  // ── Step 6: Audit logs ────────────────────────────────────────────────────
  separator("Step 6: Per-Agent Audit Logs");

  for (const wallet of allWallets) {
    const log = wallet.getAuditLog();
    if (log.length === 0) continue;
    console.log(`\n  ${chalk.bold.cyan(wallet.agentId)} (${log.length} records):`);
    log.forEach((r) => {
      const icon = r.status === "success" ? "✅" : r.status === "blocked" ? "🚫" : "❌";
      console.log(`    ${icon} ${r.status} | ${r.lamports / LAMPORTS_PER_SOL} SOL → ${r.to.slice(0, 12)}...`);
    });
  }

  console.log(chalk.bold.green("\n  ✓ Multi-agent demo complete.\n"));
  console.log(
    chalk.dim(
      "  View all agent wallets on Solana devnet explorer:\n  https://explorer.solana.com/?cluster=devnet\n"
    )
  );
}

main().catch((err) => {
  console.error(chalk.red("\n  ✗ Multi-agent demo failed:"), err.message);
  process.exit(1);
});
