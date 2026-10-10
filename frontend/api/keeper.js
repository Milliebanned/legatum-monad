// Vercel cron entry point for the payout keeper (schedule in vercel.json).
// On the Hobby plan Vercel runs it once a day, at some point within the
// scheduled hour; beneficiaries can always trigger a due payout sooner from
// the app.
//
// Environment (Vercel project settings):
//   KEEPER_PRIVATE_KEY  wallet that pays gas for distribute() (holds a little MON)
//   KEEPER_NETWORK      "testnet" or "mainnet". Required: with no default, a
//                       mainnet deployment missing it fails loudly instead
//                       of quietly watching testnet.
//   FACTORY_ADDRESS     optional override; defaults to src/deployedMainnet.js or
//                       src/deployedTestnet.js for the chosen network
//   CRON_SECRET         Vercel sends it as a bearer token on cron calls; any
//                       other caller is refused, so strangers can't spend the
//                       keeper's gas.
import { NETWORKS, keeperWallet, runKeeperPass } from "../lib/keeper.js";
import testnetDeployment from "../src/deployedTestnet.js";
import mainnetDeployment from "../src/deployedMainnet.js";

export const config = { maxDuration: 60 };

// Vaults a pass comfortably gets through; the next day's pass starts this far on.
const SCAN_STRIDE = 2000;
// Below this many MON the keeper wallet needs topping up.
const LOW_BALANCE = 1;

export default async function handler(req, res) {
  const secret = process.env.CRON_SECRET;
  if (!secret || req.headers.authorization !== `Bearer ${secret}`) {
    return res.status(401).json({ error: "Unauthorized" });
  }

  const network = process.env.KEEPER_NETWORK;
  if (!(network in NETWORKS)) {
    return res.status(500).json({ error: 'KEEPER_NETWORK must be set to "testnet" or "mainnet"' });
  }
  const deployed = network === "mainnet" ? mainnetDeployment : testnetDeployment;
  const factoryAddress = process.env.FACTORY_ADDRESS || deployed.factory;
  if (!factoryAddress || /^0x0{40}$/.test(factoryAddress)) {
    return res.status(500).json({ error: `FACTORY_ADDRESS is not set for ${network}` });
  }

  try {
    const wallet = keeperWallet({ network, privateKey: process.env.KEEPER_PRIVATE_KEY });
    // The cron fires once a day, so the day number moves the scan's starting
    // point on by one pass's worth each run (see runKeeperPass).
    const startAt = Math.floor(Date.now() / 86_400_000) * SCAN_STRIDE;
    const result = await runKeeperPass({ wallet, factoryAddress, startAt, log: console.log });
    console.log(
      `keeper ${network}: checked ${result.checked}/${result.total}, distributed ${result.distributed.length}, ` +
        `skipped ${result.skipped}, wallet ${result.wallet.balance} MON`
    );
    const low = result.wallet.balance !== null && Number(result.wallet.balance) < LOW_BALANCE;
    if (low) console.error(`keeper wallet ${result.wallet.address} is low on gas: ${result.wallet.balance} MON`);
    // A low wallet is reported as a failed run so Vercel's cron log flags it.
    return res.status(low ? 500 : 200).json({ network, lowBalance: low, ...result });
  } catch (err) {
    console.error(err);
    return res.status(500).json({ error: err.shortMessage ?? err.message });
  }
}
