// Starter gas for the test network. A wallet made for an email sign-in holds
// no MON, so its owner couldn't do anything; this sends it a little, once it
// is empty. Test network only: on mainnet gas is covered by Privy's
// sponsorship instead, which costs the app money per transaction rather than
// handing out coins.
//
// Environment: VITE_PRIVY_APP_ID, PRIVY_APP_SECRET, KEEPER_PRIVATE_KEY (the
// wallet the gas comes from), KEEPER_NETWORK (must be "testnet").
import { ethers } from "ethers";
import { NETWORKS, keeperWallet } from "../lib/keeper.js";
import { verifyCaller, walletOfUser } from "../lib/privy.js";

// Below this a wallet is topped up; this much is sent.
const LOW = ethers.parseEther("0.05");
const AMOUNT = ethers.parseEther("0.3");

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  const network = process.env.KEEPER_NETWORK || "testnet";
  if (network !== "testnet" || !(network in NETWORKS)) return res.status(200).json({ sent: false });

  let userId;
  try {
    userId = await verifyCaller(req);
  } catch {
    return res.status(401).json({ error: "Not signed in." });
  }

  try {
    // Only ever the caller's own Privy-made wallet, looked up server-side.
    const address = await walletOfUser(userId);
    if (!address) return res.status(200).json({ sent: false });
    const funder = keeperWallet({ network, privateKey: process.env.KEEPER_PRIVATE_KEY });
    if ((await funder.provider.getBalance(address)) >= LOW) return res.status(200).json({ sent: false });
    const tx = await funder.sendTransaction({ to: address, value: AMOUNT });
    await tx.wait();
    return res.status(200).json({ sent: true, tx: tx.hash });
  } catch (err) {
    console.error(err);
    return res.status(502).json({ error: err.shortMessage ?? err.message });
  }
}
