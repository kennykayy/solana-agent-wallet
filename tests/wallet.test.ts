/**
 * wallet.test.ts — Unit tests for AgentWallet policy enforcement
 *
 * Tests run without network connectivity (pure unit tests).
 * Integration tests require devnet access.
 *
 * Run: npm test
 */

import { Connection, Keypair, LAMPORTS_PER_SOL, PublicKey } from "@solana/web3.js";
import { AgentWallet, SpendingPolicy, WalletMetadata } from "../src/AgentWallet";
import { WalletManager } from "../src/WalletManager";
import chalk from "chalk";

// ── Test harness ──────────────────────────────────────────────────────────

let passed = 0;
let failed = 0;

function test(name: string, fn: () => void) {
  try {
    fn();
    console.log(chalk.green(`  ✓ ${name}`));
    passed++;
  } catch (err: any) {
    console.log(chalk.red(`  ✗ ${name}`));
    console.log(chalk.dim(`    ${err.message}`));
    failed++;
  }
}

function expect(value: any) {
  return {
    toBe: (expected: any) => {
      if (value !== expected) throw new Error(`Expected ${expected}, got ${value}`);
    },
    toContain: (str: string) => {
      if (!String(value).includes(str)) throw new Error(`Expected "${value}" to contain "${str}"`);
    },
    toBeDefined: () => {
      if (value === undefined || value === null) throw new Error(`Expected value to be defined`);
    },
    toBeGreaterThan: (n: number) => {
      if (!(value > n)) throw new Error(`Expected ${value} > ${n}`);
    },
  };
}

// ── Test Setup ────────────────────────────────────────────────────────────

function makeWallet(policyOverrides: Partial<SpendingPolicy> = {}): AgentWallet {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const policy: SpendingPolicy = {
    maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 0.2 * LAMPORTS_PER_SOL,
    requiresApproval: true,
    approvalThresholdLamports: 0.5 * LAMPORTS_PER_SOL,
    ...policyOverrides,
  };
  const metadata: WalletMetadata = {
    agentId: "test-agent-001",
    agentName: "TestAgent",
    role: "test",
    createdAt: new Date(),
    policy,
  };
  const wallet = new AgentWallet(connection, metadata);
  // Manually set balance for testing
  wallet.state.balanceLamports = 1 * LAMPORTS_PER_SOL;
  return wallet;
}

// ── Tests ─────────────────────────────────────────────────────────────────

console.log(chalk.bold("\n🧪 AgentWallet — Unit Test Suite\n"));

// Policy validation tests
console.log(chalk.bold("  Policy Enforcement:"));

test("allows transfer within limits", () => {
  const wallet = makeWallet();
  const dest = Keypair.generate().publicKey.toBase58();
  const result = wallet.validateTransfer(0.02 * LAMPORTS_PER_SOL, dest);
  expect(result.allowed).toBe(true);
});

test("blocks transfer exceeding per-tx limit", () => {
  const wallet = makeWallet();
  const dest = Keypair.generate().publicKey.toBase58();
  const result = wallet.validateTransfer(0.1 * LAMPORTS_PER_SOL, dest); // Exceeds 0.05
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("per-transaction limit");
});

test("blocks transfer when daily limit would be exceeded", () => {
  const wallet = makeWallet();
  wallet.state.dailySpentLamports = 0.18 * LAMPORTS_PER_SOL; // Already spent 0.18 of 0.2 limit
  const dest = Keypair.generate().publicKey.toBase58();
  const result = wallet.validateTransfer(0.04 * LAMPORTS_PER_SOL, dest); // Would push to 0.22
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("daily limit");
});

test("blocks transfer when balance insufficient", () => {
  const wallet = makeWallet();
  wallet.state.balanceLamports = 0.01 * LAMPORTS_PER_SOL; // Only 0.01 SOL
  const dest = Keypair.generate().publicKey.toBase58();
  const result = wallet.validateTransfer(0.05 * LAMPORTS_PER_SOL, dest);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("Insufficient balance");
});

test("blocks transfer to non-whitelisted address", () => {
  const allowedAddr = Keypair.generate().publicKey.toBase58();
  const blockedAddr = Keypair.generate().publicKey.toBase58();
  const wallet = makeWallet({ allowedTargets: [allowedAddr] });
  const result = wallet.validateTransfer(0.01 * LAMPORTS_PER_SOL, blockedAddr);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("whitelist");
});

test("allows transfer to whitelisted address", () => {
  const allowedAddr = Keypair.generate().publicKey.toBase58();
  const wallet = makeWallet({ allowedTargets: [allowedAddr] });
  const result = wallet.validateTransfer(0.01 * LAMPORTS_PER_SOL, allowedAddr);
  expect(result.allowed).toBe(true);
});

test("flags transfer for approval above threshold", () => {
  const wallet = makeWallet({
    maxTransactionLamports: 2 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 5 * LAMPORTS_PER_SOL,
    approvalThresholdLamports: 0.5 * LAMPORTS_PER_SOL,
    requiresApproval: true,
  });
  wallet.state.balanceLamports = 3 * LAMPORTS_PER_SOL;
  const dest = Keypair.generate().publicKey.toBase58();
  const result = wallet.validateTransfer(0.6 * LAMPORTS_PER_SOL, dest);
  expect(result.allowed).toBe(true);
  expect(result.requiresApproval).toBe(true);
});

test("blocks all transfers when wallet is deactivated", () => {
  const wallet = makeWallet();
  wallet.deactivate();
  const dest = Keypair.generate().publicKey.toBase58();
  const result = wallet.validateTransfer(0.01 * LAMPORTS_PER_SOL, dest);
  expect(result.allowed).toBe(false);
  expect(result.reason).toContain("deactivated");
});

test("allows transfers after reactivation", () => {
  const wallet = makeWallet();
  wallet.deactivate();
  wallet.reactivate();
  const dest = Keypair.generate().publicKey.toBase58();
  const result = wallet.validateTransfer(0.01 * LAMPORTS_PER_SOL, dest);
  expect(result.allowed).toBe(true);
});

// Wallet structure tests
console.log(chalk.bold("\n  Wallet Structure:"));

test("generates unique public key on creation", () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const policy: SpendingPolicy = {
    maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 0.2 * LAMPORTS_PER_SOL,
    requiresApproval: false,
    approvalThresholdLamports: 1 * LAMPORTS_PER_SOL,
  };
  const w1 = new AgentWallet(connection, { agentId: "a1", agentName: "A1", role: "test", createdAt: new Date(), policy });
  const w2 = new AgentWallet(connection, { agentId: "a2", agentName: "A2", role: "test", createdAt: new Date(), policy });
  if (w1.publicKey.toBase58() === w2.publicKey.toBase58()) {
    throw new Error("Two wallets generated the same public key — catastrophic failure");
  }
});

test("exports valid base58 private key", () => {
  const wallet = makeWallet();
  const pk = wallet.exportPrivateKey();
  expect(pk.length).toBeGreaterThan(40);
  // Should be valid base58 — can decode without error
  const { decode } = require("bs58");
  const decoded = decode(pk);
  expect(decoded.length).toBe(64); // Solana secret keys are 64 bytes
});

test("encrypted export roundtrip", () => {
  const wallet = makeWallet();
  const original = wallet.exportPrivateKey();
  const encrypted = wallet.exportEncrypted("test-passphrase-123");
  const parsed = JSON.parse(encrypted);
  expect(parsed.publicKey).toBe(wallet.publicKey.toBase58());
  expect(parsed.agentId).toBe("test-agent-001");
});

test("policy update takes effect immediately", () => {
  const wallet = makeWallet();
  const dest = Keypair.generate().publicKey.toBase58();
  // Original limit: 0.05 SOL — a 0.04 transfer should be allowed
  expect(wallet.validateTransfer(0.04 * LAMPORTS_PER_SOL, dest).allowed).toBe(true);
  // Update limit to 0.01 SOL
  wallet.updatePolicy({ maxTransactionLamports: 0.01 * LAMPORTS_PER_SOL });
  // Now 0.04 should be blocked
  expect(wallet.validateTransfer(0.04 * LAMPORTS_PER_SOL, dest).allowed).toBe(false);
});

// Manager tests
console.log(chalk.bold("\n  WalletManager:"));

test("WalletManager creates multiple independent wallets", () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const manager = new WalletManager(connection);
  const policy: SpendingPolicy = {
    maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 0.2 * LAMPORTS_PER_SOL,
    requiresApproval: false,
    approvalThresholdLamports: 1 * LAMPORTS_PER_SOL,
  };
  manager.createAgentWallet("fleet-a", "FleetA", "test", policy);
  manager.createAgentWallet("fleet-b", "FleetB", "test", policy);
  manager.createAgentWallet("fleet-c", "FleetC", "test", policy);
  expect(manager.getAllWallets().length).toBe(3);

  const pubkeys = manager.getAllWallets().map((w) => w.publicKey.toBase58());
  const unique = new Set(pubkeys);
  expect(unique.size).toBe(3); // All unique
});

test("WalletManager throws on duplicate agent ID", () => {
  const connection = new Connection("https://api.devnet.solana.com", "confirmed");
  const manager = new WalletManager(connection);
  const policy: SpendingPolicy = {
    maxTransactionLamports: 0.05 * LAMPORTS_PER_SOL,
    dailyLimitLamports: 0.2 * LAMPORTS_PER_SOL,
    requiresApproval: false,
    approvalThresholdLamports: 1 * LAMPORTS_PER_SOL,
  };
  manager.createAgentWallet("dup-id", "First", "test", policy);
  let threw = false;
  try {
    manager.createAgentWallet("dup-id", "Second", "test", policy);
  } catch {
    threw = true;
  }
  if (!threw) throw new Error("Expected duplicate ID error but none was thrown");
});

// ── Results ───────────────────────────────────────────────────────────────

console.log();
const total = passed + failed;
if (failed === 0) {
  console.log(chalk.bold.green(`  ✓ All ${total} tests passed\n`));
} else {
  console.log(chalk.bold.yellow(`  ${passed}/${total} tests passed, ${failed} failed\n`));
  process.exit(1);
}
