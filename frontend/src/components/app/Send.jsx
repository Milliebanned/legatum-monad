import { useState } from "react";
import { Contract, isAddress, parseUnits } from "ethers";
import { useWeb3 } from "../../Web3Context.jsx";
import { CHAIN_CONFIG, DEFAULT_TOKEN, NATIVE, tokenInfo } from "../../config.js";
import { ERC20_ABI } from "../../abis/ERC20.js";
import { looksLikeEmail, resolveEmail } from "../../privy.jsx";
import { formatAgo, formatAmount, shortAddress, txError } from "./format.js";

// Pay someone now, straight from the wallet: the same people a vault names,
// without waiting for one to release. Nothing here touches a vault.

const key = (owner) => `legatumarca:sent:${owner.toLowerCase()}`;
const MAX_KEPT = 20;

// Payments made from this browser, newest first. The chain has the real
// record; this is only so the page can show what was just sent.
function useSent(owner) {
  const [sent, setSent] = useState(() => {
    try {
      return JSON.parse(localStorage.getItem(key(owner))) ?? [];
    } catch {
      return [];
    }
  });
  const add = (entry) =>
    setSent((prev) => {
      const next = [entry, ...prev].slice(0, MAX_KEPT);
      try {
        localStorage.setItem(key(owner), JSON.stringify(next));
      } catch {
        // Storage unavailable: the list just won't persist.
      }
      return next;
    });
  return [sent, add];
}

export default function Send({ app }) {
  const { signer, address, balances, refreshBalance } = useWeb3();
  const { labels, now } = app;
  const saved = Object.entries(labels).sort((a, b) => a[1].localeCompare(b[1]));
  const [to, setTo] = useState("");
  // With Privy, the recipient can be typed as an email: `email` holds what was
  // typed and `to` is filled in once it has been looked up.
  const [email, setEmail] = useState(null);
  const [lookup, setLookup] = useState(null);
  const [tokenAddress, setTokenAddress] = useState(DEFAULT_TOKEN.address);
  const [amount, setAmount] = useState("");
  const [busy, setBusy] = useState(false);
  const [sent, addSent] = useSent(address);

  const token = tokenInfo(tokenAddress);
  const balance = balances?.[tokenAddress.toLowerCase()] ?? 0n;
  const who = (addr) => labels[addr.toLowerCase()] ?? shortAddress(addr);

  const setWho = (value) => {
    const text = value.trim();
    const isEmail = Boolean(resolveEmail) && text.includes("@");
    setEmail(isEmail ? text : null);
    setTo(isEmail ? "" : text);
    setLookup(null);
  };

  const resolve = async () => {
    if (!email || to) return;
    if (!looksLikeEmail(email)) return setLookup({ error: "Not a valid email address." });
    setLookup({ pending: true });
    try {
      const found = await resolveEmail(email);
      setTo(found.address);
      setLookup({ isNew: found.isNew });
    } catch (err) {
      setLookup({ error: err.message });
    }
  };

  const recipient = email ?? (to && who(to));

  let problem = null;
  let value = 0n;
  if (to && !isAddress(to)) problem = "Not a valid address.";
  else if (to && to.toLowerCase() === address.toLowerCase()) problem = "That's your own address.";
  if (!problem && Number(amount) > 0) {
    try {
      value = parseUnits(amount, token.decimals);
      if (balances && value > balance) problem = `You have ${formatAmount(balance, token.decimals)} ${token.symbol}.`;
    } catch {
      problem = `${token.symbol} has at most ${token.decimals} decimal places.`;
    }
  }
  const ready = isAddress(to) && value > 0n && !problem;

  const submit = async (e) => {
    e.preventDefault();
    setBusy(true);
    try {
      const tx =
        tokenAddress === NATIVE
          ? await signer.sendTransaction({ to, value })
          : await new Contract(tokenAddress, ERC20_ABI, signer).transfer(to, value);
      const receipt = await tx.wait();
      // Chain time, like every other timestamp on the dashboard.
      addSent({ to, name: email ?? undefined, token: tokenAddress, amount, hash: receipt.hash, at: now });
      refreshBalance();
      app.showToast(`Sent ${amount} ${token.symbol} to ${recipient}.`);
      setAmount("");
    } catch (err) {
      app.showError(txError(err, "Couldn't send"));
    } finally {
      setBusy(false);
    }
  };

  const explorer = CHAIN_CONFIG.blockExplorerUrl;

  return (
    <div className="grid">
      <section className="box span2">
        <header>
          <h2>Send now</h2>
          <span className="label">From your wallet, not a vault</span>
        </header>
        <form className="sendform" onSubmit={submit}>
          {saved.length > 0 && (
            <div className="f">
              <label className="label" htmlFor="sdWho">
                Someone you've named
              </label>
              <select id="sdWho" value={saved.some(([a]) => a === to.toLowerCase()) ? to.toLowerCase() : ""} onChange={(e) => setWho(e.target.value)}>
                <option value="">Choose a person…</option>
                {saved.map(([addr, name]) => (
                  <option key={addr} value={addr}>
                    {name} · {shortAddress(addr)}
                  </option>
                ))}
              </select>
            </div>
          )}
          <div className="f">
            <label className="label" htmlFor="sdTo">
              {resolveEmail ? "Their email or wallet" : "Their wallet"}
            </label>
            <input
              id="sdTo"
              className={email ? undefined : "mono"}
              required
              placeholder={resolveEmail ? "amara@example.com or 0x…" : "0x…"}
              value={email ?? to}
              onChange={(e) => setWho(e.target.value)}
              onBlur={resolve}
            />
            {lookup?.pending && <span className="hint">Looking up…</span>}
            {lookup?.error && <span className="err">{lookup.error}</span>}
            {email && to && (
              <span className="hint">
                {lookup?.isNew
                  ? `A wallet has been made for ${email}. The money is theirs when they sign in with that email.`
                  : `${email} already has a wallet here.`}{" "}
                <span className="mono" title={to}>
                  {shortAddress(to)}
                </span>
              </span>
            )}
          </div>
          <div className="two">
            <div className="f">
              <label className="label" htmlFor="sdAmt">
                Amount
              </label>
              <input id="sdAmt" type="number" min="0" step="any" required value={amount} onChange={(e) => setAmount(e.target.value)} />
              <span className="hint">
                You have {balances ? formatAmount(balance, token.decimals) : "…"} {token.symbol}
              </span>
            </div>
            <div className="f">
              <label className="label" htmlFor="sdTok">
                Asset
              </label>
              <select id="sdTok" value={tokenAddress} onChange={(e) => setTokenAddress(e.target.value)}>
                {CHAIN_CONFIG.tokens.map((t) => (
                  <option key={t.address} value={t.address}>
                    {t.symbol}
                  </option>
                ))}
              </select>
            </div>
          </div>
          {problem && <p className="err">{problem}</p>}
          <p className="hint">Check who you're sending to. A payment to a wrong address or email can't be recovered.</p>
          <div className="acts2">
            <button className="btn solid" type="submit" disabled={busy || !ready}>
              {busy ? "Sending…" : ready ? `Send ${amount} ${token.symbol}` : "Send"}
            </button>
          </div>
        </form>
      </section>

      <section className="box">
        <header>
          <h2>Sent from here</h2>
          <span className="label">This browser</span>
        </header>
        {sent.length === 0 && <p className="empty">Payments you send appear here.</p>}
        <ul className="acts">
          {sent.map((s) => (
            <li key={s.hash}>
              <i className="ic r"></i>
              <span>
                {s.amount} {tokenInfo(s.token).symbol} to{" "}
                {explorer ? (
                  <a href={`${explorer}/tx/${s.hash}`} target="_blank" rel="noreferrer" title={s.to}>
                    {s.name ?? who(s.to)}
                  </a>
                ) : (
                  <span title={s.to}>{s.name ?? who(s.to)}</span>
                )}
              </span>
              <time dateTime={new Date(s.at * 1000).toISOString()}>{formatAgo(s.at, now)}</time>
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}
