import { NATIVE } from "../../config.js";
import {
  DAY,
  formatAgo,
  formatAmount,
  formatAsset,
  formatAssets,
  formatDeadline,
  formatDollars,
  formatSpan,
  shortAddress,
  stableCents,
} from "./format.js";

// Turns loaded vaults (see useVaults.js) into what the dashboard renders.
// Kept free of React and chain calls so it can be fed fixtures.

// Stored state, advanced to Due once the deadline has passed (the same rule
// as Vault.getVaultState()).
export function liveState(v, now) {
  if (v.storedState === "Active" && now > v.lastCheckIn + v.interval + v.grace) return "Due";
  return v.storedState;
}

export const isOpen = (v, now) => ["Active", "Due"].includes(liveState(v, now));
export const vaultName = (v) => v.name || "Untitled vault";

// Seconds until the check-in window closes; negative once it has.
const windowLeft = (v, now) => v.lastCheckIn + v.interval - now;

// "Check in soon" starts 14 days out, the first reminder mark. Windows too
// short for that (test builds) use their last quarter.
const soonAt = (v) => (v.interval >= 28 * DAY ? 14 * DAY : v.interval / 4);

// ok -> warn -> grace -> due -> released, or closed if the owner cancelled.
export function phase(v, now) {
  const state = liveState(v, now);
  if (state === "Distributed") return "released";
  if (state === "Cancelled") return "closed";
  if (state === "Due") return "due";
  const left = windowLeft(v, now);
  return left <= 0 ? "grace" : left <= soonAt(v) ? "warn" : "ok";
}

// Tone class and pill text for each phase.
const STATUS = {
  ok: ["ok", "Armed"],
  warn: ["warn", "Check in soon"],
  grace: ["alert", "Grace period"],
  due: ["alert", "Payout due"],
  released: ["ok", "Released"],
  closed: ["off", "Closed"],
};

const people = (n) => `${n} ${n === 1 ? "person" : "people"}`;

// Everything the ring, the facts beside it and a vault row need.
export function vaultView(v, now) {
  const p = phase(v, now);
  // Clock skew can put a fresh check-in a few seconds past the full window.
  const left = Math.min(windowLeft(v, now), v.interval);
  const graceLeft = left + v.grace;
  // "62 days" -> the ring's 62 over "days left"; the unit drops to hours or
  // minutes by itself once less than a day remains.
  const split = (seconds) => formatSpan(seconds).split(" ");
  const [windowCount, windowUnit] = split(v.interval);

  let [big, unit] = split(left);
  let caption = `${unit} left`;
  let fill = Math.max(0, left) / v.interval;
  let meter =
    unit.replace(/s$/, "") === windowUnit.replace(/s$/, "")
      ? `${big} of ${windowCount} ${windowUnit} left`
      : `${big} ${unit} left of ${windowCount} ${windowUnit}`;
  if (p === "grace") {
    [big, unit] = split(graceLeft);
    caption = `${unit} of grace left`;
    fill = v.grace ? graceLeft / v.grace : 0;
    meter = `Window missed · ${formatSpan(graceLeft)} of grace`;
  } else if (p === "due") {
    big = "0";
    caption = "payout due";
    meter = "Timer ended · paying out";
  } else if (p === "released") {
    big = "✓";
    caption = `released to ${people(v.beneficiaries.length)}`;
    fill = 1;
    meter = "Paid to beneficiaries";
  } else if (p === "closed") {
    big = "–";
    caption = "vault closed";
    fill = 0;
    meter = "Closed by you";
  }

  const live = p === "ok" || p === "warn" || p === "grace";
  return {
    address: v.address,
    name: vaultName(v),
    phase: p,
    tone: STATUS[p][0],
    state: STATUS[p][1],
    big,
    caption,
    fill: Math.max(0, Math.min(1, fill)),
    meter,
    amount: formatAssets(v.assets, "Empty"),
    due: live ? formatDeadline(v.lastCheckIn + v.interval + (p === "grace" ? v.grace : 0), now) : "–",
    window: formatSpan(v.interval),
    grace: v.grace > 0 ? formatSpan(v.grace) : "None",
  };
}

// Open vaults first, each group oldest first, so a new vault lands at the
// end of the list.
export function sortVaults(vaults, now) {
  return [...vaults].sort((a, b) => Number(isOpen(b, now)) - Number(isOpen(a, now)));
}

export function headline(vaults, now) {
  if (vaults.length === 0) return "No vaults yet. Create one to name the people you trust.";
  const by = (p) => vaults.find((v) => phase(v, now) === p);
  const due = by("due");
  if (due) return `${vaultName(due)} has run out and is paying out. Checking in first stops it.`;
  const grace = by("grace");
  if (grace) {
    const left = formatSpan(windowLeft(grace, now) + grace.grace);
    return `${vaultName(grace)} missed its check-in. ${left} of grace left.`;
  }
  const soon = by("warn");
  if (soon) return `${vaultName(soon)} needs a check-in within ${formatSpan(windowLeft(soon, now))}.`;
  return vaults.some((v) => isOpen(v, now)) ? "All vaults are armed." : "No open vaults.";
}

export function totals(vaults, now) {
  const open = vaults.filter((v) => isOpen(v, now));
  const timed = open
    .filter((v) => liveState(v, now) === "Active")
    .sort((a, b) => windowLeft(a, now) - windowLeft(b, now));
  const next = timed[0];
  const named = new Set(open.flatMap((v) => v.beneficiaries.map((b) => b.address.toLowerCase())));
  return {
    // Stablecoins count as dollars; MON is reported beside them, not priced.
    total: formatDollars(open.reduce((sum, v) => sum + stableCents(v.assets), 0n)),
    native: formatAmount(
      open.reduce((sum, v) => sum + (v.assets.find((a) => a.token === NATIVE)?.raw ?? 0n), 0n),
      18
    ),
    count: open.length,
    next: !next ? "–" : windowLeft(next, now) > 0 ? formatSpan(windowLeft(next, now)) : "Overdue",
    nextName: next ? vaultName(next) : "No open vaults",
    people: named.size,
  };
}

// One line per history entry, across all vaults, newest first. `kind` picks
// the dot: c = check-in, r = money leaving to beneficiaries, d = the rest.
export function activityItems(vaults, now, labels = {}) {
  const who = (address) => labels[address.toLowerCase()] || shortAddress(address);
  const items = [];
  for (const v of vaults) {
    const name = vaultName(v);
    const first = v.history.find((e) => e.action === "BeneficiariesSet");
    for (const e of v.history) {
      const amount = formatAsset(e.amount, e.token);
      const line = {
        Created: ["d", `Created ${name}`],
        BeneficiariesSet:
          e === first
            ? ["d", `Named ${people(Number(e.amount))} in ${name}`]
            : ["d", `Changed the beneficiaries of ${name}`],
        Deposit: ["d", `Deposited ${amount} into ${name}`],
        Withdraw: ["d", `Withdrew ${amount} from ${name}`],
        CheckIn: ["c", `Checked in to ${name}`],
        Payout: ["r", `${name} paid ${amount} to ${who(e.actor)}`],
        PayoutFailed: ["r", `${name} is holding ${amount} for ${who(e.actor)}`],
        Cancel: ["d", e.amount > 0n ? `Closed ${name}, ${amount} returned` : `Closed ${name}`],
      }[e.action];
      if (!line) continue;
      // Closing a vault records one entry per asset; an empty one says nothing
      // unless it is the only sign the vault was closed.
      if (e.action === "Cancel" && e.amount === 0n && v.history.some((o) => o.action === "Cancel" && o.amount > 0n)) continue;
      items.push({
        key: `${v.address}-${e.index}`,
        timestamp: e.timestamp,
        index: e.index,
        kind: line[0],
        message: line[1],
        ago: formatAgo(e.timestamp, now),
      });
    }
  }
  // Within one block, later entries first.
  return items.sort((a, b) => b.timestamp - a.timestamp || b.index - a.index);
}
