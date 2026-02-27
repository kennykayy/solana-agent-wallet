import { Connection, LAMPORTS_PER_SOL, Keypair } from "@solana/web3.js";
import dotenv from "dotenv";
import chalk from "chalk";
import bs58 from "bs58";
import { AgentWallet, SpendingPolicy } from "./AgentWallet";
import { WalletManager } from "./WalletManager";
import * as fs from "fs";

dotenv.config();

const RPC_URL = process.env.SOLANA_RPC_URL ?? "https://api.devnet.solana.com";
const WALLET_FILE = ".demo-wallet.json";

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

// Save keypair to disk so same wallet is reused between runs
function saveKeypair(keypair: Keypair) {
  fs.writeFileSync(WALLET_FILE, JSON.stringify({ key: bs58.encode(keypair.secretKey) }));
}

// Load existing keypair if it exists
function loadKeypair(): Keypair | null {
  try {
    if (fs.existsSync(WALLET_FILE)) {
      const data = JSON.parse(fs.readFileSync(WALLET_FILE, "utf8"));
      return Keypair.fromSecretKey(bs58.decode(data.key));
    }
  } catch {}
  return null;
}

async function main() {
  console.log(chalk.bold.white("\n🤖 Solana Agent Wallet — Single Agent Demo"));
  console.log(chalk.dim("   Network: devnet | No real funds at risk\n"));

  const connection = new Connection(RPC_URL, "confirmed");
  const manager = new WalletManager(connection);

  // ── Step 1: Create or reuse agent wallet ─────────────────────────────────
  separator("Step 1: Create Agent Wallet Programmatically");

  const policy: SpendingPolicy = {
    maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 0.2 * LAMPORTS_PER_SOL,
    requiresApproval: true,
    approvalThresholdLamports: 0.5 * LAMPORTS_PER_SOL,
  };

  // Reuse existing keypair if available so funded wallet persists
  const existingKeypair = loadKeypair();
  const agent = manager.createAgentWallet("demo-agent-001", "DemoTrader", "payment-relay", policy, existingKeypair ?? undefined);

  if (!existingKeypair) {
    saveKeypair((agent as any).keypair);
    console.log(`  ✓ New wallet created and saved for reuse`);
  } else {
    console.log(`  ✓ Reusing existing wallet`);
  }

  console.log(`  📬 Public Key  : ${chalk.cyan(agent.publicKey.toBase58())}`);
  console.log(`  🔐 Private Key : ${chalk.dim("[encrypted in memory — never logged]")}`);
  console.log(`  📋 Policy      : max ${policy.maxTransactionLamports / LAMPORTS_PER_SOL} SOL/tx, ${policy.dailyLimitLamports / LAMPORTS_PER_SOL} SOL/day`);

  // ── Step 2: Check balance ─────────────────────────────────────────────────
  separator("Step 2: Check Wallet Balance");

  const balance = await agent.refreshBalance();

  if (balance === 0) {
    console.log(chalk.yellow(`\n  ⚠  Wallet has 0 SOL — needs funding before demo can continue\n`));
    console.log(chalk.bold.white("  Follow these steps:\n"));
    console.log(`  1. Go to ${chalk.cyan("https://faucet.solana.com")}`);
    console.log(`  2. Paste this address: ${chalk.cyan(agent.publicKey.toBase58())}`);
    console.log(`  3. Select ${chalk.bold("Devnet")} and click Confirm Airdrop`);
    console.log(`  4. Wait for the green success message`);
    console.log(`  5. Run ${chalk.bold("npm run demo")} again — same wallet will be reused\n`);
    process.exit(0);
  }

  console.log(`  ✅ Wallet has funds`);
  console.log(`  💰 Balance: ${chalk.green((balance / LAMPORTS_PER_SOL).toFixed(4))} SOL`);

  // ── Step 3: Autonomous transfer (within policy) ───────────────────────────
  separator("Step 3: Autonomous Transfer — Within Policy");

  const receiver = manager.createAgentWallet("receiver-001", "Receiver", "passive", policy);
  console.log(`  📬 Receiver wallet: ${receiver.publicKey.toBase58()}`);

  const tx1Amount = 0.02 * LAMPORTS_PER_SOL;
  console.log(`\n  🤖 Agent autonomously signing transfer of ${tx1Amount / LAMPORTS_PER_SOL} SOL...`);
  const tx1 = await agent.transferSOL(receiver.publicKey, tx1Amount);
  printTxResult("Transfer 0.02 SOL (within limit)", tx1);

  // ── Step 4: Policy enforcement ────────────────────────────────────────────
  separator("Step 4: Policy Enforcement — Transaction Blocked");

  const tx2Amount = 0.1 * LAMPORTS_PER_SOL;
  console.log(`  🤖 Attempting transfer of ${tx2Amount / LAMPORTS_PER_SOL} SOL (limit: ${policy.maxTransactionLamports / LAMPORTS_PER_SOL} SOL)...`);
  const tx2 = await agent.transferSOL(receiver.publicKey, tx2Amount);
  printTxResult("Transfer 0.1 SOL (over limit)", tx2);

  // ── Step 5: Deactivate and verify ─────────────────────────────────────────
  separator("Step 5: Emergency Deactivation");

  agent.deactivate();
  console.log("  🔴 Agent deactivated");
  const tx3 = await agent.transferSOL(receiver.publicKey, 0.01 * LAMPORTS_PER_SOL);
  printTxResult("Transfer attempt on deactivated wallet", tx3);
  agent.reactivate();
  console.log("  🟢 Agent reactivated");

  // ── Step 6: Audit log ──────────────────────────────────────────────────────
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

  // ── Summary ────────────────────────────────────────────────────────────────
  separator("Summary");
  const summary = agent.getSummary();
  console.log(`  Agent      : ${summary.name} (${summary.agentId})`);
  console.log(`  Public Key : ${summary.publicKey}`);
  console.log(`  Balance    : ${chalk.green(summary.balanceSOL.toFixed(4))} SOL`);
  console.log(`  Total Tx   : ${summary.totalTx} (${summary.successTx} success, ${summary.blockedTx} blocked)`);
  console.log(chalk.bold.green("\n  ✓ Demo complete.\n"));
}

main().catch((err) => {
  console.error(chalk.red("\n  ✗ Demo failed:"), err.message);
  process.exit(1);
});
