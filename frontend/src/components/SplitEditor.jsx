import { useState } from "react";
import { isAddress } from "ethers";
import { looksLikeEmail, resolveEmail } from "../privy.jsx";
import { TOTAL_SHARES, MAX_BENEFICIARIES } from "../abis/Vault.js";

// Beneficiary rows (name, wallet or email, percentage) with the contract's
// rules checked client-side. A row given an email keeps it in `email` and gets
// its `address` from Privy once the field is left. Used when creating a vault and when editing its
// beneficiaries. One person always gets 100%, so the share column only
// appears once there are two.

export const emptyRow = () => ({ name: "", address: "", percent: "100" });

// Rows pre-filled from a vault's current beneficiaries and their saved names.
export const rowsFrom = (beneficiaries, labels = {}) =>
  beneficiaries.map((b) => ({
    name: labels[b.address.toLowerCase()] ?? "",
    address: b.address,
    percent: String(b.bps / 100),
  }));

// "33.33" -> 3333 basis points. NaN for anything that isn't a positive
// number with at most two decimals.
export function toBps(percent) {
  if (!/^\d+(\.\d{1,2})?$/.test(percent.trim())) return NaN;
  return Math.round(Number(percent) * 100);
}

// Equal shares; the remainder goes to the first row so the total is exactly 100%.
function evenly(rows) {
  const base = Math.floor(TOTAL_SHARES / rows.length);
  const extra = TOTAL_SHARES - base * rows.length;
  return rows.map((r, i) => ({ ...r, percent: String((i === 0 ? base + extra : base) / 100) }));
}

export function validateSplit(rows, ownerAddress) {
  const errors = rows.map((r, i) => {
    if (!r.address) return null;
    if (!isAddress(r.address)) return "Not a valid address.";
    if (ownerAddress && r.address.toLowerCase() === ownerAddress.toLowerCase()) return "Can't be your own address.";
    if (rows.findIndex((o) => o.address.toLowerCase() === r.address.toLowerCase()) !== i) return "Listed twice.";
    if (r.percent && !(toBps(r.percent) > 0)) return "Share must be above 0, with at most two decimals.";
    return null;
  });
  const totalBps = rows.reduce((sum, r) => sum + (toBps(r.percent) || 0), 0);
  const complete = rows.length > 0 && rows.every((r) => r.address && r.percent);
  return {
    errors,
    totalBps,
    valid: complete && errors.every((e) => !e) && totalBps === TOTAL_SHARES,
    addresses: rows.map((r) => r.address),
    shares: rows.map((r) => toBps(r.percent)),
  };
}

// What to remember each row's address as: the name given, or failing that
// the email it was found by.
export const labelRows = (rows) => rows.map((r) => ({ address: r.address, name: r.name || r.email || "" }));

export default function SplitEditor({ rows, onChange, ownerAddress }) {
  const { errors, totalBps } = validateSplit(rows, ownerAddress);
  const many = rows.length > 1;
  // Row index -> "Looking up…" or what went wrong, while an email is resolved.
  const [lookup, setLookup] = useState({});

  const update = (i, field, value) => onChange(rows.map((r, j) => (j === i ? { ...r, [field]: value } : r)));

  // Typing an email clears the address until it has been looked up.
  const setWho = (i, value) => {
    const text = value.trim();
    const email = resolveEmail && text.includes("@");
    onChange(rows.map((r, j) => (j === i ? { ...r, email: email ? text : undefined, address: email ? "" : text } : r)));
    setLookup((prev) => ({ ...prev, [i]: undefined }));
  };

  const resolve = async (i) => {
    const email = rows[i].email;
    if (!email || rows[i].address) return;
    if (!looksLikeEmail(email)) return setLookup((prev) => ({ ...prev, [i]: "Not a valid email address." }));
    setLookup((prev) => ({ ...prev, [i]: "Looking up…" }));
    try {
      const found = await resolveEmail(email);
      // The rows may have changed while this was in flight.
      onChange((current) => current.map((r) => (r.email === email ? { ...r, address: found.address, isNew: found.isNew } : r)));
      setLookup((prev) => ({ ...prev, [i]: undefined }));
    } catch (err) {
      setLookup((prev) => ({ ...prev, [i]: err.message }));
    }
  };
  const add = () => onChange(evenly([...rows, emptyRow()]));
  const remove = (i) => {
    const next = rows.filter((_, j) => j !== i);
    onChange(next.length === 1 ? [{ ...next[0], percent: "100" }] : next);
  };

  return (
    <div className="split-rows">
      {rows.map((r, i) => (
        <div key={i} className="f">
          <div className={many ? "prow" : "two"}>
            <div className="f">
              <label className="label" htmlFor={`ben-name-${i}`}>
                Beneficiary name
              </label>
              <input
                id={`ben-name-${i}`}
                maxLength={20}
                placeholder="e.g. Amara"
                value={r.name}
                onChange={(e) => update(i, "name", e.target.value)}
              />
            </div>
            <div className="f">
              <label className="label" htmlFor={`ben-addr-${i}`}>
                {resolveEmail ? "Their email or wallet" : "Their wallet"}
              </label>
              <input
                id={`ben-addr-${i}`}
                className={r.email ? undefined : "mono"}
                required
                placeholder={resolveEmail ? "amara@example.com or 0x…" : "0x…"}
                value={r.email ?? r.address}
                onChange={(e) => setWho(i, e.target.value)}
                onBlur={() => resolve(i)}
              />
            </div>
            {many && (
              <>
                <div className="f">
                  <label className="label" htmlFor={`ben-share-${i}`}>
                    Share %
                  </label>
                  <input
                    id={`ben-share-${i}`}
                    className="mono"
                    inputMode="decimal"
                    placeholder="0"
                    value={r.percent}
                    onChange={(e) => update(i, "percent", e.target.value)}
                  />
                </div>
                <button type="button" className="x" onClick={() => remove(i)} aria-label={`Remove beneficiary ${i + 1}`}>
                  ✕
                </button>
              </>
            )}
          </div>
          {errors[i] && <p className="err">{errors[i]}</p>}
          {lookup[i] && <p className={lookup[i] === "Looking up…" ? "hint" : "err"}>{lookup[i]}</p>}
          {r.email && r.address && (
            <p className="hint">
              {r.isNew
                ? `A wallet has been made for ${r.email}. It's theirs when they sign in with that email.`
                : `${r.email} already has a wallet here.`}{" "}
              <span className="mono" title={r.address}>
                {r.address.slice(0, 6)}…{r.address.slice(-4)}
              </span>
            </p>
          )}
        </div>
      ))}
      <div className="split-foot">
        {rows.length < MAX_BENEFICIARIES ? (
          <button type="button" className="link" onClick={add}>
            + Add another person
          </button>
        ) : (
          <span className="hint">Maximum of {MAX_BENEFICIARIES} people.</span>
        )}
        {many && (
          <>
            <button type="button" className="link" onClick={() => onChange(evenly(rows))}>
              Split evenly
            </button>
            <span className={`mono ${totalBps === TOTAL_SHARES ? "ok" : "alert"}`}>
              Total {(totalBps / 100).toFixed(2).replace(/\.00$/, "")}%
            </span>
          </>
        )}
      </div>
    </div>
  );
}
