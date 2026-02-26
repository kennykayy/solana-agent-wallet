/**
 * demo.ts — Single Agent Wallet Demo
 *
 * Demonstrates:
 *  1. Programmatic wallet creation
 *  2. Devnet airdrop funding
 *  3. Autonomous transaction signing
 *  4. Policy enforcement (block + allow)
 *  5. Full audit log output
 *
 * Run: npm run demo
 */

import { Connection, LAMPORTS_PER_SOL, PublicKey, Keypair } from "@solana/web3.js";
import dotenv from "dotenv";
import chalk from "chalk";
import { AgentWallet, SpendingPolicy } from "./AgentWallet";
import { WalletManager } from "./WalletManager";

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";

function separator(label: string) {
  console.log("\n" + chalk.dim("─".repeat(60)));
  console.log(chalk.bold.cyan(`  ${label}`));
  console.log(chalk.dim("─".repeat(60)));
}

function printTxResult(label: string, record: any) {
  const icon = record.status === "success" ? "✅" : record.status === "blocked" ? "🚫" : "❌";
  console.log(`  ${icon} ${chalk.bold(label)}`);
  console.log(`     Status : ${chalk.yellow(record.status)}`);
  if (record.status === "success") {
    console.log(`     Sig    : ${chalk.green(record.signature.slice(0, 44) + "...")}`);
    console.log(`     Solscan: https://solscan.io/tx/${record.signature}?cluster=devnet`);
  } else {
    console.log(`     Reason : ${chalk.red(record.reason)}`);
  }
}

async function main() {
  console.log(chalk.bold.white("\n🤖 Solana Agent Wallet — Single Agent Demo"));
  console.log(chalk.dim("   Network: devnet | No real funds at risk\n"));

  const connection = new Connection(RPC_URL, "confirmed");
  const manager = new WalletManager(connection);

  // ── Step 1: Create agent wallet ──────────────────────────────────────────
  separator("Step 1: Create Agent Wallet Programmatically");

  const policy: SpendingPolicy = {
    maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL, // 0.05 SOL per tx
    dailyLimitLamports: 0.2 * LAMPORTS_PER_SOL,      // 0.2 SOL per day
    requiresApproval: true,
    approvalThresholdLamports: 0.5 * LAMPORTS_PER_SOL,
  };

  const agent = manager.createAgentWallet(
    "demo-agent-001",
    "DemoTrader",
    "payment-relay",
    policy
  );

  console.log(`  ✓ Wallet created`);
  console.log(`  📬 Public Key  : ${chalk.cyan(agent.publicKey.toBase58())}`);
  console.log(`  🔐 Private Key : ${chalk.dim("[encrypted in memory — never logged]")}`);
  console.log(`  📋 Policy      : max ${policy.maxTransactionLamports / LAMPORTS_PER_SOL} SOL/tx, ${policy.dailyLimitLamports / LAMPORTS_PER_SOL} SOL/day`);

  // ── Step 2: Fund via devnet airdrop ──────────────────────────────────────
  separator("Step 2: Fund Wallet via Devnet Airdrop");

  console.log("  ⏳ Requesting 1 SOL from devnet faucet...");
  try {
    const airdropSig = await manager.airdropToAgent("demo-agent-001", 1);
    const balance = await agent.refreshBalance();
    console.log(`  ✅ Airdrop confirmed`);
    console.log(`  💰 Balance: ${chalk.green((balance / LAMPORTS_PER_SOL).toFixed(4))} SOL`);
    console.log(`  🔗 ${chalk.dim("https://solscan.io/tx/" + airdropSig + "?cluster=devnet")}`);
  } catch (err: any) {
    console.log(chalk.yellow(`  ⚠ Airdrop failed (devnet faucet may be rate-limited): ${err.message}`));
    console.log(chalk.yellow(`  ℹ Manually fund: solana airdrop 1 ${agent.publicKey.toBase58()} --url devnet`));
    console.log(chalk.yellow(`  ℹ Then re-run: npm run demo\n`));
    process.exit(0);
  }

  // ── Step 3: Autonomous transfer (within policy) ──────────────────────────
  separator("Step 3: Autonomous Transfer — Within Policy");

  // Create a second wallet to receive funds
  const receiver = manager.createAgentWallet("receiver-001", "Receiver", "passive", policy);
  console.log(`  📬 Receiver wallet: ${receiver.publicKey.toBase58()}`);

  const tx1Amount = 0.02 * LAMPORTS_PER_SOL;
  console.log(`\n  🤖 Agent autonomously signing transfer of ${tx1Amount / LAMPORTS_PER_SOL} SOL...`);
  const tx1 = await agent.transferSOL(receiver.publicKey, tx1Amount);
  printTxResult("Transfer 0.02 SOL (within limit)", tx1);

  // ── Step 4: Policy enforcement — over per-tx limit ────────────────────────
  separator("Step 4: Policy Enforcement — Transaction Blocked");

  const tx2Amount = 0.1 * LAMPORTS_PER_SOL; // Exceeds 0.05 SOL limit
  console.log(`  🤖 Attempting transfer of ${tx2Amount / LAMPORTS_PER_SOL} SOL (limit: ${policy.maxTransactionLamports / LAMPORTS_PER_SOL} SOL)...`);
  const tx2 = await agent.transferSOL(receiver.publicKey, tx2Amount);
  printTxResult("Transfer 0.1 SOL (over limit)", tx2);

  // ── Step 5: Deactivate and verify ────────────────────────────────────────
  separator("Step 5: Emergency Deactivation");

  agent.deactivate();
  console.log("  🔴 Agent deactivated (simulating emergency pause)");
  const tx3 = await agent.transferSOL(receiver.publicKey, 0.01 * LAMPORTS_PER_SOL);
  printTxResult("Transfer attempt on deactivated wallet", tx3);

  agent.reactivate();
  console.log("  🟢 Agent reactivated");

  // ── Step 6: Audit log ─────────────────────────────────────────────────────
  separator("Step 6: Full Audit Log");

  const log = agent.getAuditLog();
  console.log(`  📋 ${log.length} transaction records:\n`);
  log.forEach((r, i) => {
    const icon = r.status === "success" ? "✅" : r.status === "blocked" ? "🚫" : "❌";
    console.log(`  ${i + 1}. ${icon} ${r.status.toUpperCase()} | ${r.lamports / LAMPORTS_PER_SOL} SOL`);
    if (r.status !== "success" && r.reason) {
      console.log(`     Reason: ${chalk.dim(r.reason)}`);
    }
  });

  // ── Summary ───────────────────────────────────────────────────────────────
  separator("Summary");
  const summary = agent.getSummary();
  console.log(`  Agent      : ${summary.name} (${summary.agentId})`);
  console.log(`  Public Key : ${summary.publicKey}`);
  console.log(`  Balance    : ${chalk.green(summary.balanceSOL.toFixed(4))} SOL`);
  console.log(`  Daily Spent: ${summary.dailySpentSOL.toFixed(4)} / ${summary.dailyLimitSOL} SOL`);
  console.log(`  Total Tx   : ${summary.totalTx} (${summary.successTx} success, ${summary.blockedTx} blocked)`);
  console.log(`  Active     : ${summary.isActive ? chalk.green("Yes") : chalk.red("No")}`);

  console.log(chalk.bold.green("\n  ✓ Demo complete. All transactions visible on Solana devnet explorer.\n"));
}

main().catch((err) => {
  console.error(chalk.red("\n  ✗ Demo failed:"), err.message);
  process.exit(1);
});
