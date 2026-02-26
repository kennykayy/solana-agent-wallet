/**
 * generateWallet.ts — Generate a new Solana keypair for use as master authority
 *
 * Run: npm run generate-wallet
 * Output: public key + private key (base58)
 *
 * ⚠️  IMPORTANT: Never share your private key or commit it to version control.
 *     Add the output to your .env file as MASTER_PRIVATE_KEY=<base58>
 */

import { Keypair } from "@solana/web3.js";
import bs58 from "bs58";
import chalk from "chalk";

const keypair = Keypair.generate();

console.log("\n" + chalk.bold.cyan("🔑 New Solana Keypair Generated\n"));
console.log(chalk.bold("Public Key (share freely):"));
console.log(chalk.green("  " + keypair.publicKey.toBase58()));
console.log();
console.log(chalk.bold("Private Key (KEEP SECRET — never share or commit):"));
console.log(chalk.red("  " + bs58.encode(keypair.secretKey)));
console.log();
console.log(chalk.yellow("Next steps:"));
console.log("  1. Copy the private key above to your .env file:");
console.log(chalk.dim(`     MASTER_PRIVATE_KEY=${bs58.encode(keypair.secretKey)}`));
console.log("  2. Fund on devnet:");
console.log(chalk.dim(`     solana airdrop 2 ${keypair.publicKey.toBase58()} --url devnet`));
console.log("  3. Run the demo:");
console.log(chalk.dim("     npm run demo\n"));
