import { useState } from "react";
import { useWeb3 } from "../../Web3Context.jsx";
import { CHAIN_CONFIG } from "../../config.js";
import DevFaucet from "../DevFaucet.jsx";
import { formatAmount, formatDollars, shortAddress, stableCents } from "./format.js";
import { isOpen } from "./viewModel.js";

// What the signed-in wallet holds right now, apart from what is locked in
// vaults, and the ways to move it: send, swap, or into a vault.
export default function Wallet({ app }) {
  const { address, balances, walletName } = useWeb3();
  const [copied, setCopied] = useState(false);
  const explorer = CHAIN_CONFIG.blockExplorerUrl;

  const held = CHAIN_CONFIG.tokens.map((t) => ({ ...t, raw: balances?.[t.address.toLowerCase()] ?? 0n }));
  const dollars = stableCents(held.map((t) => ({ token: t.address, raw: t.raw })));
  const inVaults = app.list.filter((v) => isOpen(v, app.now)).reduce((sum, v) => sum + stableCents(v.assets), 0n);

  const copy = async () => {
    await navigator.clipboard?.writeText(address);
    setCopied(true);
    setTimeout(() => setCopied(false), 1600);
  };

  return (
    <div className="grid">
      <section className="box span2">
        <header>
          <h2>Balances</h2>
          <span className="label">{CHAIN_CONFIG.label}</span>
        </header>
        <ul className="people">
          {held.map((t) => (
            <li key={t.address}>
              <span className="av">{t.symbol.charAt(0)}</span>
              <span>
                <b style={{ fontWeight: 500 }}>{t.symbol}</b>
                <br />
                <span className="ad">{t.stable ? "Stablecoin" : "Monad's native coin, also pays for gas"}</span>
              </span>
              <span className="mono" style={{ textAlign: "right" }}>
                {balances ? formatAmount(t.raw, t.decimals) : "…"}
              </span>
            </li>
          ))}
        </ul>
        <div className="foot">
          <button className="btn solid" type="button" onClick={() => app.go("swap")}>
            Swap
          </button>
          <button className="btn" type="button" onClick={() => app.go("send")}>
            Send
          </button>
          <button className="btn" type="button" onClick={() => app.open(app.vault ? "deposit" : "new")}>
            {app.vault ? "Deposit into a vault" : "Create a vault"}
          </button>
        </div>
      </section>

      <section className="box stats" aria-label="Wallet totals">
        <div className="stat">
          <span className="label">In your wallet</span>
          <span className="v">{formatDollars(dollars)}</span>
          <small>in stablecoins, free to spend</small>
        </div>
        <hr />
        <div className="stat">
          <span className="label">Locked in vaults</span>
          <span className="v">{formatDollars(inVaults)}</span>
          <small>in stablecoins, still yours while you check in</small>
        </div>
      </section>

      <section className="box span2">
        <header>
          <h2>Receive</h2>
          <span className="label">Your address on {CHAIN_CONFIG.label}</span>
        </header>
        <p className="mono" style={{ wordBreak: "break-all" }}>
          {address}
        </p>
        <p className="hint">
          Send MON or tokens on {CHAIN_CONFIG.label} to this address to add funds. Anything sent on another network
          won't arrive here.
        </p>
        <div className="foot">
          <button className="btn" type="button" onClick={copy}>
            {copied ? "Copied" : "Copy address"}
          </button>
          {explorer && (
            <a className="btn" href={`${explorer}/address/${address}`} target="_blank" rel="noreferrer">
              View on explorer
            </a>
          )}
        </div>
      </section>

      <section className="box">
        <header>
          <h2>Account</h2>
        </header>
        <div className="kv">
          <span className="label">{app.email ? "Signed in as" : "Wallet"}</span>
          <span>{app.email ?? walletName ?? "Browser wallet"}</span>
        </div>
        <div className="kv">
          <span className="label">Address</span>
          <span className="mono" title={address}>
            {shortAddress(address)}
          </span>
        </div>
        <DevFaucet />
        <div className="foot">
          <button className="btn" type="button" onClick={() => app.open("account")}>
            Account settings
          </button>
        </div>
      </section>
    </div>
  );
}
