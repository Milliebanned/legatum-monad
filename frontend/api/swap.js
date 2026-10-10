// Token swaps on Monad through Privy's swap service, for the signed-in user's
// own Privy wallet only.
//
//   { action: "quote", from, to, amount }   what `amount` (base units) of
//                                           `from` buys of `to`, plus the
//                                           wallet id and the exact request
//                                           the user must sign to go ahead
//   { action: "execute", request, signature }   runs a request this endpoint
//                                           produced, signed in the browser
//                                           with the user's own key
//   { action: "status", id }                where a swap has got to
//
// The app secret alone can't move a user's funds: Privy only accepts a swap
// carrying the wallet owner's signature over that exact request.
//
// Environment: VITE_PRIVY_APP_ID, PRIVY_APP_SECRET.
import { verifyCaller, walletApi, walletRecordOfUser } from "../lib/privy.js";

// Swaps run on Monad mainnet, where the liquidity is.
const CAIP2 = "eip155:143";
// What can be swapped: MON and the tokens on the app's list (src/config.js).
const TOKENS = new Set(
  [
    "native",
    "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", // USDC
    "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", // AUSD
    "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", // USDT0
    "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", // WMON
    "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", // WETH
    "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", // WBTC
  ].map((t) => t.toLowerCase())
);
const known = (token) => typeof token === "string" && TOKENS.has(token.toLowerCase());

function swapRequest({ from, to, amount, slippageBps }) {
  if (!known(from) || !known(to) || from.toLowerCase() === to.toLowerCase()) throw new Error("Unsupported pair.");
  if (!/^[1-9]\d{0,77}$/.test(String(amount))) throw new Error("Enter an amount.");
  const request = {
    source: { caip2: CAIP2, asset_address: from },
    destination: { asset_address: to },
    base_amount: String(amount),
    amount_type: "exact_input",
  };
  if (Number.isInteger(slippageBps) && slippageBps >= 1 && slippageBps <= 500) request.slippage_bps = slippageBps;
  return request;
}

export default async function handler(req, res) {
  if (req.method !== "POST") return res.status(405).json({ error: "POST only" });
  let wallet;
  try {
    wallet = await walletRecordOfUser(await verifyCaller(req));
  } catch {
    return res.status(401).json({ error: "Sign in to swap." });
  }
  if (!wallet) return res.status(400).json({ error: "Swaps need a wallet made by signing in with an email." });

  const { action } = req.body ?? {};
  try {
    if (action === "quote") {
      const request = swapRequest(req.body);
      const quote = await walletApi(wallet.id, "/swap/quote", { body: request });
      if (quote.status !== 200) return res.status(502).json({ error: quote.data?.error ?? "No quote available." });
      return res.status(200).json({
        walletId: wallet.id,
        request,
        out: quote.data.est_output_amount,
        minOut: quote.data.minimum_output_amount,
        gas: quote.data.gas_estimate,
      });
    }
    if (action === "execute") {
      // Rebuilt from its own fields, so only a request this endpoint could
      // have produced is ever forwarded.
      const r = req.body.request ?? {};
      const request = swapRequest({
        from: r.source?.asset_address,
        to: r.destination?.asset_address,
        amount: r.base_amount,
        slippageBps: r.slippage_bps,
      });
      if (typeof req.body.signature !== "string") return res.status(400).json({ error: "Missing signature." });
      const sent = await walletApi(wallet.id, "/swap", { body: request, signature: req.body.signature });
      if (sent.status >= 300) return res.status(502).json({ error: sent.data?.error ?? "Swap was not accepted." });
      return res.status(200).json({ id: sent.data.id, status: sent.data.status });
    }
    if (action === "status") {
      if (!/^[\w-]{1,64}$/.test(String(req.body.id))) return res.status(400).json({ error: "Bad id." });
      const found = await walletApi(wallet.id, `/actions/${req.body.id}`);
      if (found.status !== 200) return res.status(502).json({ error: found.data?.error ?? "Couldn't check the swap." });
      return res.status(200).json({
        status: found.data.status,
        out: found.data.output_amount ?? null,
        hash: found.data.steps?.find((s) => s.transaction_hash)?.transaction_hash ?? null,
      });
    }
    return res.status(400).json({ error: "Unknown action." });
  } catch (err) {
    return res.status(400).json({ error: err.message });
  }
}
