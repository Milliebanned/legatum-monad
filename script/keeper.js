// Command-line payout keeper: runs the same pass as the Vercel cron function
// (frontend/api/keeper.js), either once or on a loop. Handy for testing a
// short-timer vault on testnet without waiting for the daily cron.
//
// Usage:
//   node script/keeper.js --network testnet            # polls forever
//   node script/keeper.js --network testnet --once     # one pass, then exit
//   node script/keeper.js --network mainnet
//
// Env (.env): KEEPER_PRIVATE_KEY, optional KEEPER_INTERVAL_SECONDS (default
// 30). FACTORY_ADDRESS overrides the recorded factory for either network.
require("dotenv").config();
const fs = require("fs");
const path = require("path");

function arg(name) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

function factoryAddress(network) {
  if (process.env.FACTORY_ADDRESS) return process.env.FACTORY_ADDRESS;
  // Written by script/deploy.js.
  const file = path.join(__dirname, "..", "frontend", "src", network === "mainnet" ? "deployedMainnet.js" : "deployedTestnet.js");
  const match = fs.readFileSync(file, "utf8").match(/factory:\s*"(0x[0-9a-fA-F]{40})"/);
  if (match && !/^0x0{40}$/.test(match[1])) return match[1];
  throw new Error(`No factory address for ${network}. Set FACTORY_ADDRESS in .env.`);
}

const log = (...parts) => console.log(new Date().toISOString(), ...parts);

async function main() {
  const { keeperWallet, runKeeperPass } = await import("../frontend/lib/keeper.js");
  const network = arg("network");
  if (!network) throw new Error("Pass --network testnet or --network mainnet.");
  const once = process.argv.includes("--once");
  const wallet = keeperWallet({
    network,
    privateKey: process.env.KEEPER_PRIVATE_KEY,
    rpcUrl: network === "mainnet" ? process.env.MONAD_RPC_URL : undefined,
  });
  const factory = factoryAddress(network);
  const intervalMs = Number(process.env.KEEPER_INTERVAL_SECONDS || 30) * 1000;

  log(`keeper on ${network}, factory ${factory}, wallet ${wallet.address}`);

  do {
    try {
      // No serverless time limit here, so every pass walks the whole list.
      const result = await runKeeperPass({ wallet, factoryAddress: factory, log, budgetMs: Infinity });
      if (result.distributed.length > 0 || once) {
        log(
          `checked ${result.checked} vaults, distributed ${result.distributed.length}, ` +
            `skipped ${result.skipped}, wallet ${result.wallet.balance} MON`
        );
      }
    } catch (err) {
      log(`pass failed: ${err.shortMessage ?? err.message}`);
    }
    if (once) break;
    await new Promise((resolve) => setTimeout(resolve, intervalMs));
  } while (true);
}

main().catch((err) => {
  console.error(err);
  process.exitCode = 1;
});
