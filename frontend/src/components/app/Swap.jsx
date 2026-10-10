import { useEffect, useRef, useState } from "react";
import { formatUnits, parseUnits } from "ethers";
import { useAuthorizationSignature } from "@privy-io/react-auth";
import { useWeb3 } from "../../Web3Context.jsx";
import { CHAIN_CONFIG, SWAPS_LIVE, SWAP_TOKENS } from "../../config.js";
import { PRIVY_APP_ID, PRIVY_ENABLED, swapApi } from "../../privy.jsx";
import { formatAmount } from "./format.js";

// Trade one Monad asset for another without leaving the app: MON into a
// stablecoin before locking it away, say, so a vault's value doesn't move with
// the market. Quotes and execution go through Privy's swap service (see
// api/swap.js); the swap is signed in the browser with the user's own key.

const token = (id) => SWAP_TOKENS.find((t) => t.id === id);
const show = (raw, t) => formatAmount(BigInt(raw), t.decimals);

// "1 MON ≈ 0.0245 AUSD"
function rate(amountIn, from, out, to) {
  const perOne = Number(formatUnits(out, to.decimals)) / Number(formatUnits(amountIn, from.decimals));
  return `1 ${from.symbol} ≈ ${perOne.toLocaleString("en-US", { maximumSignificantDigits: 4 })} ${to.symbol}`;
}

function TokenSelect({ id, label, value, onChange }) {
  return (
    <div className="f">
      <label className="label" htmlFor={id}>
        {label}
      </label>
      <select id={id} value={value} onChange={(e) => onChange(e.target.value)}>
        {SWAP_TOKENS.map((t) => (
          <option key={t.id} value={t.id}>
            {t.symbol}
          </option>
        ))}
      </select>
    </div>
  );
}

function SwapForm({ app }) {
  const { refreshBalance } = useWeb3();
  const { generateAuthorizationSignature } = useAuthorizationSignature();
  const [fromId, setFromId] = useState("native");
  const [toId, setToId] = useState(SWAP_TOKENS[2].id);
  const [amount, setAmount] = useState("");
  // null, { pending }, { error }, or the server's quote for the current input.
  const [quote, setQuote] = useState(null);
  const [busy, setBusy] = useState(null);
  const latest = useRef(0);

  const from = token(fromId);
  const to = token(toId);

  let amountIn = 0n;
  try {
    if (Number(amount) > 0) amountIn = parseUnits(amount, from.decimals);
  } catch {
    amountIn = 0n;
  }

  // A fresh quote a moment after the input settles; a slow answer to an
  // earlier input is dropped.
  useEffect(() => {
    setQuote(null);
    if (amountIn === 0n || fromId === toId) return undefined;
    const run = ++latest.current;
    setQuote({ pending: true });
    const timer = setTimeout(async () => {
      try {
        const found = await swapApi("quote", { from: fromId, to: toId, amount: amountIn.toString() });
        if (run === latest.current) setQuote(found);
      } catch (err) {
        if (run === latest.current) setQuote({ error: err.message });
      }
    }, 450);
    return () => clearTimeout(timer);
    // amountIn is derived from amount and the pair.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [amount, fromId, toId]);

  const flip = () => {
    setFromId(toId);
    setToId(fromId);
    setAmount("");
  };

  const swap = async () => {
    setBusy("Confirming…");
    try {
      // The user's own key signs this exact request; without that signature
      // Privy won't move anything, whoever asks.
      const { signature } = await generateAuthorizationSignature({
        version: 1,
        method: "POST",
        url: `https://api.privy.io/v1/wallets/${quote.walletId}/swap`,
        body: quote.request,
        headers: { "privy-app-id": PRIVY_APP_ID },
      });
      setBusy("Swapping…");
      let { id, status } = await swapApi("execute", { request: quote.request, signature });
      let out = null;
      for (let i = 0; status === "pending" && i < 40; i++) {
        await new Promise((resolve) => setTimeout(resolve, 1500));
        ({ status, out } = await swapApi("status", { id }));
      }
      if (status === "succeeded") {
        app.showToast(`Swapped ${amount} ${from.symbol} for ${out ? show(out, to) : "about " + show(quote.out, to)} ${to.symbol}.`);
        setAmount("");
        refreshBalance();
      } else if (status === "pending") {
        app.showToast("The swap is still going through. Your balance will update when it lands.");
      } else {
        app.showError("The swap didn't go through. Nothing was taken.");
      }
    } catch (err) {
      app.showError(err.message ?? "Couldn't swap");
    } finally {
      setBusy(null);
    }
  };

  const ready = SWAPS_LIVE && quote?.out && !busy;

  return (
    <div className="grid">
      <section className="box span2">
        <header>
          <h2>Swap</h2>
          <span className="label">On Monad, through Privy</span>
        </header>
        <form
          className="sendform"
          onSubmit={(e) => {
            e.preventDefault();
            if (ready) swap();
          }}
        >
          <div className="two">
            <div className="f">
              <label className="label" htmlFor="swAmt">
                You pay
              </label>
              <input id="swAmt" type="number" min="0" step="any" placeholder="0" value={amount} onChange={(e) => setAmount(e.target.value)} />
            </div>
            <TokenSelect id="swFrom" label="Asset" value={fromId} onChange={setFromId} />
          </div>
          <div>
            <button type="button" className="link" onClick={flip}>
              ⇅ Swap direction
            </button>
          </div>
          <div className="two">
            <div className="f">
              <label className="label" htmlFor="swOut">
                You receive (estimate)
              </label>
              <input id="swOut" readOnly placeholder="0" value={quote?.out ? show(quote.out, to) : quote?.pending ? "…" : ""} />
            </div>
            <TokenSelect id="swTo" label="Asset" value={toId} onChange={setToId} />
          </div>
          {fromId === toId && <p className="err">Choose two different assets.</p>}
          {quote?.error && <p className="err">{quote.error}</p>}
          {quote?.out && (
            <div>
              <div className="kv">
                <span className="label">Rate</span>
                <span className="mono">{rate(amountIn, from, quote.out, to)}</span>
              </div>
              <div className="kv">
                <span className="label">At least</span>
                <span className="mono">
                  {show(quote.minOut, to)} {to.symbol}
                </span>
              </div>
              <div className="kv">
                <span className="label">Network fee (estimate)</span>
                <span className="mono">{formatAmount(BigInt(quote.gas), 18)} MON</span>
              </div>
            </div>
          )}
          <p className="hint">
            Prices come from Uniswap pools on Monad and move with the market. The estimate already takes off the pool's
            fee and Privy's fee of up to 0.25%. If the price moves past the "at least" amount, the swap is cancelled and
            nothing is taken.
          </p>
          {!SWAPS_LIVE && (
            <p className="hint">
              Swaps run on Monad mainnet, where the liquidity is. This build is on {CHAIN_CONFIG.label}, so you can see
              live mainnet prices here but not trade.
            </p>
          )}
          <div className="acts2">
            <button className="btn solid" type="submit" disabled={!ready}>
              {busy ?? (SWAPS_LIVE ? "Swap" : "Swap (mainnet only)")}
            </button>
          </div>
        </form>
      </section>

      <section className="box">
        <header>
          <h2>Why swap here</h2>
        </header>
        <p style={{ color: "var(--mute)" }}>
          A vault can sit for months. MON's price can move a lot in that time; a stablecoin's shouldn't. Swap first, then
          lock the stablecoin, and your beneficiaries receive what you meant them to.
        </p>
        <div className="foot">
          <button className="btn" type="button" onClick={() => app.go("wallet")}>
            Your balances
          </button>
        </div>
      </section>
    </div>
  );
}

// Swaps need the wallet Privy made for an email sign-in: that is the wallet
// its swap service can act for.
export default function Swap({ app }) {
  if (PRIVY_ENABLED && app.email) return <SwapForm app={app} />;
  return (
    <div className="grid">
      <section className="box span2">
        <header>
          <h2>Swap</h2>
        </header>
        <p className="empty">
          Swapping is available when you sign in with an email. A wallet you connected yourself can swap in its own app.
        </p>
      </section>
    </div>
  );
}
