import { formatUnits } from "ethers";
import { tokenInfo } from "../../config.js";

// Formatting helpers that turn on-chain values into the strings the dashboard
// shows ("48,250 USDC", "62 of 90 days left", "5 Dec 2026", "0x7A3f…E21c").

export const DAY = 86400;

// 48250000000n at 6 decimals -> "48,250"; 500000n -> "0.5". Amounts under one
// keep four decimals so a little MON doesn't round to nothing.
export function formatAmount(raw, decimals) {
  const value = Number(formatUnits(raw, decimals));
  return value.toLocaleString("en-US", { maximumFractionDigits: value !== 0 && Math.abs(value) < 1 ? 4 : 2 });
}

// 48250000000n of USDC -> "48,250 USDC"
export function formatAsset(raw, tokenAddress) {
  const token = tokenInfo(tokenAddress);
  return `${formatAmount(raw, token.decimals)} ${token.symbol}`;
}

// [{ token, raw }] -> "48,250 USDC · 12 MON", leaving out what's empty.
export function formatAssets(assets, empty = "Nothing yet") {
  const held = assets.filter((a) => a.raw > 0n);
  return held.length ? held.map((a) => formatAsset(a.raw, a.token)).join(" · ") : empty;
}

// The same list with every amount scaled to a share in basis points.
export const shareOfAssets = (assets, bps) => assets.map((a) => ({ token: a.token, raw: (a.raw * BigInt(bps)) / 10000n }));

// Dollar value of the stablecoins in a list, in cents, for sorting and totals.
export function stableCents(assets) {
  return assets.reduce((sum, a) => {
    const token = tokenInfo(a.token);
    return token.stable ? sum + (a.raw * 100n) / 10n ** BigInt(token.decimals) : sum;
  }, 0n);
}

// 4825000n cents -> "$48,250"
export const formatDollars = (cents) =>
  `$${(Number(cents) / 100).toLocaleString("en-US", { maximumFractionDigits: 2 })}`;

const plural = (n, word) => `${n} ${word}${n === 1 ? "" : "s"}`;

// Largest whole unit: 182 days, 5 hours, 3 minutes, 40 seconds.
export function formatSpan(seconds) {
  if (seconds >= DAY) return plural(Math.floor(seconds / DAY), "day");
  if (seconds >= 3600) return plural(Math.floor(seconds / 3600), "hour");
  if (seconds >= 60) return plural(Math.floor(seconds / 60), "minute");
  return plural(Math.max(0, Math.floor(seconds)), "second");
}

// 1796428800 -> "5 Dec 2026". Deadlines less than two days out carry the time.
export function formatDeadline(unixSeconds, now) {
  const date = new Date(unixSeconds * 1000);
  const day = date.toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" });
  if (unixSeconds - now >= 2 * DAY) return day;
  return `${day}, ${date.toLocaleTimeString("en-GB", { hour: "2-digit", minute: "2-digit" })}`;
}

// "28 days ago", "3 hours ago", "Just now"
export function formatAgo(unixSeconds, now) {
  const elapsed = now - unixSeconds;
  return elapsed < 60 ? "Just now" : `${formatSpan(elapsed)} ago`;
}

// "0x7A3f…E21c"
export function shortAddress(address) {
  return address.length > 12 ? `${address.slice(0, 6)}…${address.slice(-4)}` : address;
}

// Monad makes a wallet that runs as a smart account (as the ones made for an
// email sign-in can) keep 10 MON back for gas, and refuses anything that
// would spend into it. The node's own wording for that helps nobody.
const RESERVE =
  "Monad keeps the first 10 MON in this wallet in reserve for gas, so only MON above that can be deposited or sent. " +
  "Use USDC or AUSD instead, or leave the deposit empty and add funds later.";

// ethers reports an error it doesn't recognise as "could not coalesce
// error" and keeps what the wallet actually said underneath; show that.
const rawTxError = (err, fallback) =>
  err?.reason ??
  err?.info?.error?.message ??
  err?.error?.message ??
  (err?.shortMessage === "could not coalesce error" ? null : err?.shortMessage) ??
  err?.message ??
  fallback;

export const txError = (err, fallback) => {
  const text = rawTxError(err, fallback);
  if (/reserve balance violation/i.test(`${text} ${err?.details ?? ""} ${err?.message ?? ""}`)) return RESERVE;
  if (/insufficient (balance|funds)/i.test(String(text))) return "This wallet doesn't hold enough for that amount plus gas.";
  return text;
};
