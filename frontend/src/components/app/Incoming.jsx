import { useCallback, useEffect, useState } from "react";
import { Contract } from "ethers";
import { useWeb3 } from "../../Web3Context.jsx";
import { CHAIN_CONFIG } from "../../config.js";
import { VAULT_FACTORY_ABI } from "../../abis/VaultFactory.js";
import { VAULT_ABI, VAULT_STATE, VAULT_ACTION } from "../../abis/Vault.js";
import { formatAssets, formatSpan, shortAddress, txError } from "./format.js";

// Vaults that name the connected wallet. Payouts arrive in the wallet
// automatically when a vault's timer runs out, so there's nothing to claim;
// this shows what's coming, what arrived, and offers the two manual actions
// that exist: triggering a due payout early and retrying a held one.

const MAX_LISTED = 100;

function useIncomingVaults() {
  const { provider, address } = useWeb3();
  const [vaults, setVaults] = useState(null);

  const load = useCallback(async () => {
    if (!provider || !address) return;
    const factory = new Contract(CHAIN_CONFIG.factoryAddress, VAULT_FACTORY_ABI, provider);
    const listed = await factory.getVaultsByBeneficiary(address);
    // Anyone can name this wallet in as many vaults as they like, so only the
    // newest are read. Payouts never depend on this list: they arrive in the
    // wallet whether or not a vault is shown here.
    const addrs = listed.slice(-MAX_LISTED);

    // Anyone can create a vault naming this wallet, so each one loads on its
    // own: a vault that fails to load (or was built to) just drops out.
    const settled = await Promise.allSettled(
      addrs.map(async (vAddr) => {
        const vault = new Contract(vAddr, VAULT_ABI, provider);
        const [name, owner, state, share, [tokens], timeLeft, historyLength] = await Promise.all([
          vault.name(),
          vault.owner(),
          vault.getVaultState(),
          vault.shareOf(address),
          vault.getBalances(),
          vault.timeUntilDeadline(),
          vault.historyLength(),
        ]);
        // Per asset: this wallet's share today, and anything held for it.
        const perToken = await Promise.all(
          tokens.map(async (token) => {
            const [value, owed] = await Promise.all([vault.shareValue(token, address), vault.owed(token, address)]);
            return { token, value, owed };
          })
        );
        const some = (field) => perToken.filter((t) => t[field] > 0n).map((t) => ({ token: t.token, raw: t[field] }));
        // Recent history is enough to find this wallet's payouts, and keeps a
        // vault with an enormous history from stalling the page.
        const from = historyLength > 50n ? historyLength - 50n : 0n;
        const history = await vault.getHistory(from, 50);
        const mine = history.filter(
          (e) => VAULT_ACTION[Number(e.action)] === "Payout" && e.actor.toLowerCase() === address.toLowerCase()
        );
        const received = new Map();
        for (const e of mine) received.set(e.token, (received.get(e.token) ?? 0n) + e.amount);
        return {
          vAddr,
          name,
          owner,
          state: VAULT_STATE[Number(state)],
          bps: Number(share),
          value: some("value"),
          owed: some("owed"),
          timeLeft: Number(timeLeft),
          received: [...received].map(([token, raw]) => ({ token, raw })),
        };
      })
    );
    const results = settled.filter((r) => r.status === "fulfilled").map((r) => r.value);
    // Only show vaults that hold something for this wallet or already paid
    // or owe it. That drops vaults whose owner later removed it (the factory
    // keeps listing those) and empty vaults anyone could create naming it,
    // so a stranger can't fill this list, or push a misleading vault name
    // at a beneficiary, without depositing real funds.
    setVaults(
      results.filter((v) => (v.bps > 0 && v.value.length > 0) || v.received.length > 0 || v.owed.length > 0).reverse()
    );
  }, [provider, address]);

  useEffect(() => {
    load().catch(() => {});
    const interval = setInterval(() => load().catch(() => {}), 30000);
    return () => clearInterval(interval);
  }, [load]);

  return [vaults, load];
}

const PILL = {
  Active: ["ok", "Armed"],
  Due: ["alert", "Payout due"],
  Distributed: ["ok", "Released"],
  Cancelled: ["off", "Closed"],
};

function line(v) {
  const share = `${v.bps / 100}%`;
  if (v.owed.length > 0) return `${formatAssets(v.owed)} couldn't be sent to this address and is being held for you.`;
  if (v.state === "Active")
    return `Your share is ${share}: ${formatAssets(v.value)} today. Sent to you in ${formatSpan(v.timeLeft)} unless the owner checks in.`;
  if (v.state === "Due")
    return `The timer has run out. Your ${share} (${formatAssets(v.value)}) is sent within about a day, or pay out now.`;
  if (v.received.length > 0) return `${formatAssets(v.received)} was sent to your wallet.`;
  return "Closed by its owner.";
}

// On the overview it renders nothing for a wallet no vault names; `always`
// (the Beneficiaries page) keeps the box and says so instead.
export default function Incoming({ onDone, onError, always }) {
  const { signer } = useWeb3();
  const [vaults, load] = useIncomingVaults();
  const [busy, setBusy] = useState(null);

  if (!vaults?.length && !always) return null;

  // `calls` builds one transaction per entry, sent one after another.
  async function act(vAddr, calls, message) {
    setBusy(vAddr);
    try {
      const contract = new Contract(vAddr, VAULT_ABI, signer);
      for (const call of calls) await (await call(contract)).wait();
      await load();
      await onDone({ message });
    } catch (err) {
      onError(txError(err, "Transaction failed"));
    } finally {
      setBusy(null);
    }
  }

  return (
    <section className="box full" style={{ "--d": ".38s" }}>
      <header>
        <h2>Vaults naming you</h2>
        <span className="label">Paid to this wallet automatically</span>
      </header>
      {!vaults?.length && <p className="empty">{vaults ? "No vault names this wallet." : "Loading…"}</p>}
      <ul className="incoming">
        {(vaults ?? []).map((v) => (
          <li key={v.vAddr}>
            <span>
              <b style={{ fontWeight: 500 }}>{v.name || "Untitled vault"}</b>{" "}
              <span className="ad mono" title={v.owner}>
                from {shortAddress(v.owner)}
              </span>
              <br />
              <span style={{ color: "var(--mute)" }}>{line(v)}</span>
            </span>
            <span className={`pill ${PILL[v.state][0]}`}>{PILL[v.state][1]}</span>
            {v.state === "Due" && (
              <button
                className="btn"
                type="button"
                disabled={busy === v.vAddr}
                onClick={() => act(v.vAddr, [(c) => c.distribute()], `${v.name || "Vault"} paid out to every beneficiary.`)}
              >
                {busy === v.vAddr ? "Paying out…" : "Pay out now"}
              </button>
            )}
            {v.owed.length > 0 && (
              <button
                className="btn"
                type="button"
                disabled={busy === v.vAddr}
                onClick={() =>
                  act(
                    v.vAddr,
                    v.owed.map((o) => (c) => c.withdrawOwed(o.token)),
                    "Held payout sent to your wallet."
                  )
                }
              >
                {busy === v.vAddr ? "Retrying…" : "Retry payout"}
              </button>
            )}
          </li>
        ))}
      </ul>
    </section>
  );
}
