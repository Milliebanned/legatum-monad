import { CHAIN_CONFIG } from "../../config.js";
import { formatAssets, formatDeadline, formatDollars, shareOfAssets, shortAddress, stableCents } from "./format.js";
import { isOpen, vaultName } from "./viewModel.js";

// The boxes the dashboard's pages are assembled from (see Pages.jsx). They
// only render what they're given.

export function Stats({ totals }) {
  return (
    <section className="box stats" style={{ "--d": ".08s" }} aria-label="Totals">
      <div className="stat">
        <span className="label">Total protected</span>
        <span className="v" id="sTotal">
          {totals.total}
        </span>
        <small>
          in stablecoins, plus {totals.native} MON, across <span id="sCount">{totals.count}</span>{" "}
          {totals.count === 1 ? "vault" : "vaults"}
        </small>
      </div>
      <hr />
      <div className="stat">
        <span className="label">Next deadline</span>
        <span className="v" id="sNext">
          {totals.next}
        </span>
        <small id="sNextName">{totals.nextName}</small>
      </div>
      <hr />
      <div className="stat">
        <span className="label">People named</span>
        <span className="v" id="sPeople">
          {totals.people}
        </span>
        <small>Paid automatically if a vault releases</small>
      </div>
    </section>
  );
}

export function VaultList({ views, selected, onSelect, loading, wide }) {
  return (
    <section className={wide ? "box full" : "box span2"} style={{ "--d": ".14s" }}>
      <header>
        <h2>Your vaults</h2>
        <span className="label">Select one to manage it</span>
      </header>
      <div id="vaultList">
        {views.length === 0 && <p className="empty">{loading ? "Loading…" : "No vaults yet."}</p>}
        {views.map((x) => (
          <button
            key={x.address}
            type="button"
            className={x.address === selected ? "vault sel" : "vault"}
            aria-pressed={x.address === selected}
            onClick={() => onSelect(x.address)}
          >
            <span>
              <span className="nm">{x.name}</span>
              <br />
              <span className="ad mono">{shortAddress(x.address)}</span>
            </span>
            <span className="mono">{x.amount}</span>
            <span className={`meter ${x.tone}`}>
              <span style={{ color: "var(--mute)" }}>{x.meter}</span>
              <span className="track">
                <i style={{ width: `${100 * x.fill}%` }}></i>
              </span>
            </span>
            <span className={`pill ${x.tone}`}>{x.state}</span>
          </button>
        ))}
      </div>
    </section>
  );
}

// Per beneficiary: what was actually sent to them, asset by asset, and
// whether a failed transfer is still being held for them.
function payouts(history) {
  const out = new Map();
  for (const e of history) {
    if (e.action !== "Payout" && e.action !== "PayoutFailed") continue;
    const entry = out.get(e.actor) ?? { paid: new Map(), held: new Set() };
    if (e.action === "Payout") {
      entry.paid.set(e.token, (entry.paid.get(e.token) ?? 0n) + e.amount);
      entry.held.delete(e.token);
    } else {
      entry.held.add(e.token);
    }
    out.set(e.actor, entry);
  }
  return out;
}

const asAssets = (map) => [...(map ?? [])].map(([token, raw]) => ({ token, raw }));

// One vault's split. `onEdit` and `onViewAll` add the matching button.
export function People({ vault, labels, heading = "Beneficiaries", onEdit, onViewAll }) {
  const released = vault?.storedState === "Distributed";
  const paid = vault ? payouts(vault.history) : null;

  return (
    <section className="box" style={{ "--d": ".2s" }}>
      <header>
        <h2>{heading}</h2>
        <span className="label" id="pFor">
          {!vault ? "" : heading === "Beneficiaries" ? vaultName(vault) : `${vault.beneficiaries.length} named`}
        </span>
      </header>
      {!vault && <p className="empty">The people a vault pays appear here.</p>}
      {vault && (
        <>
          <div className="split" id="split">
            {vault.beneficiaries.map((p) => (
              <i key={p.address} style={{ flex: `0 0 calc(${p.bps / 100}% - 2px)` }}></i>
            ))}
          </div>
          <ul className="people" id="peopleList">
            {vault.beneficiaries.map((p) => {
              const name = labels[p.address.toLowerCase()];
              const share = released ? asAssets(paid.get(p.address)?.paid) : shareOfAssets(vault.assets, p.bps);
              return (
                <li key={p.address}>
                  <span className="av">{(name ?? p.address.slice(2)).charAt(0).toUpperCase()}</span>
                  <span>
                    <b style={{ fontWeight: 500 }}>{name ?? shortAddress(p.address)}</b>
                    <br />
                    <span className="ad mono" title={p.address}>
                      {paid.get(p.address)?.held.size ? "Payout held for them" : shortAddress(p.address)}
                    </span>
                  </span>
                  <span className="mono" style={{ textAlign: "right" }}>
                    {p.bps / 100}%
                    <br />
                    <span className="ad">{formatAssets(share, "–")}</span>
                  </span>
                </li>
              );
            })}
          </ul>
        </>
      )}
      {(onEdit || onViewAll) && (
        <div className="foot">
          {onEdit && vault && (
            <button className="btn" type="button" onClick={onEdit} disabled={vault.storedState !== "Active"}>
              Edit beneficiaries
            </button>
          )}
          {onViewAll && (
            <button className="btn" type="button" onClick={onViewAll}>
              All beneficiaries
            </button>
          )}
        </div>
      )}
    </section>
  );
}

// Everyone named across the open vaults, with what each would receive today.
export function Everyone({ vaults, now, labels }) {
  const people = new Map();
  for (const v of vaults) {
    if (!isOpen(v, now)) continue;
    for (const b of v.beneficiaries) {
      const entry = people.get(b.address) ?? { address: b.address, assets: new Map(), shares: [] };
      for (const a of shareOfAssets(v.assets, b.bps)) {
        entry.assets.set(a.token, (entry.assets.get(a.token) ?? 0n) + a.raw);
      }
      entry.shares.push(`${b.bps / 100}% of ${vaultName(v)}`);
      people.set(b.address, entry);
    }
  }
  const named = [...people.values()]
    .map((p) => ({ ...p, assets: asAssets(p.assets) }))
    .map((p) => ({ ...p, cents: stableCents(p.assets) }))
    .sort((a, b) => (b.cents > a.cents ? 1 : b.cents < a.cents ? -1 : 0));

  return (
    <section className="box span2">
      <header>
        <h2>People you've named</h2>
        <span className="label">Across open vaults</span>
      </header>
      {named.length === 0 && <p className="empty">None of your open vaults names anyone yet.</p>}
      <ul className="people">
        {named.map((p) => {
          const name = labels[p.address.toLowerCase()];
          return (
            <li key={p.address}>
              <span className="av">{(name ?? p.address.slice(2)).charAt(0).toUpperCase()}</span>
              <span>
                <b style={{ fontWeight: 500 }}>{name ?? shortAddress(p.address)}</b>{" "}
                {name && (
                  <span className="ad mono" title={p.address}>
                    {shortAddress(p.address)}
                  </span>
                )}
                <br />
                <span className="ad">{p.shares.join(" · ")}</span>
              </span>
              <span className="mono" style={{ textAlign: "right" }}>
                {formatAssets(p.assets, "–")}
                <br />
                <span className="ad">today</span>
              </span>
            </li>
          );
        })}
      </ul>
    </section>
  );
}

// The selected vault's own numbers, beside its check-in ring.
export function VaultDetails({ vault }) {
  const created = vault.history.find((e) => e.action === "Created");
  const explorer = CHAIN_CONFIG.blockExplorerUrl;
  const count = vault.beneficiaries.length;
  return (
    <section className="box stats" style={{ "--d": ".08s" }} aria-label="Vault details">
      <div className="stat">
        <span className="label">In this vault</span>
        <span className="v">{formatDollars(stableCents(vault.assets))}</span>
        <small>in stablecoins · holds {formatAssets(vault.assets, "nothing yet")}</small>
      </div>
      <hr />
      <div className="stat">
        <span className="label">Pays</span>
        <span className="v">{count}</span>
        <small>{count === 1 ? "person" : "people"}, by fixed shares</small>
      </div>
      <hr />
      <div className="stat">
        <span className="label">Contract</span>
        <span className="v mono" style={{ fontSize: 20 }}>
          {explorer ? (
            <a href={`${explorer}/address/${vault.address}`} target="_blank" rel="noreferrer" title={vault.address}>
              {shortAddress(vault.address)}
            </a>
          ) : (
            shortAddress(vault.address)
          )}
        </span>
        <small>
          {created
            ? `Opened ${new Date(created.timestamp * 1000).toLocaleDateString("en-GB", { day: "numeric", month: "short", year: "numeric" })}`
            : "On " + CHAIN_CONFIG.label}
        </small>
      </div>
    </section>
  );
}

// `limit` shows only the newest few, with `onViewAll` leading to the rest.
// `aside` replaces the header's right-hand label (the Activity page's filter).
export function Activity({ items, now, heading = "Activity", limit, onViewAll, aside, wide }) {
  const shown = limit ? items.slice(0, limit) : items;

  return (
    <section className={wide ? "box full" : "box span2"} style={{ "--d": ".26s" }}>
      <header>
        <h2>{heading}</h2>
        {aside ?? <span className="label">On-chain history</span>}
      </header>
      {items.length === 0 && <p className="empty">Nothing has happened here yet.</p>}
      <ul className="acts" id="acts">
        {shown.map((a) => (
          <li key={a.key} className={now - a.timestamp < 30 ? "new" : undefined}>
            <i className={a.kind === "c" ? "ic" : `ic ${a.kind}`}></i>
            <span>{a.message}</span>
            <time dateTime={new Date(a.timestamp * 1000).toISOString()}>{a.ago}</time>
          </li>
        ))}
      </ul>
      {onViewAll && items.length > shown.length && (
        <div className="foot">
          <button className="btn" type="button" onClick={onViewAll}>
            View all {items.length}
          </button>
        </div>
      )}
    </section>
  );
}

const LEADS = [14, 7, 1];

const icsStamp = (unixSeconds) => new Date(unixSeconds * 1000).toISOString().replace(/[-:]|\.\d{3}/g, "");
const icsText = (text) => text.replace(/([\\;,])/g, "\\$1");

// A calendar event at the vault's check-in deadline, with an alert at each
// lead time, as a file any calendar app can import.
function downloadCalendar(vault) {
  const deadline = vault.lastCheckIn + vault.interval;
  const lines = [
    "BEGIN:VCALENDAR",
    "VERSION:2.0",
    "PRODID:-//Legatum Arca//Check-in//EN",
    "BEGIN:VEVENT",
    `UID:${vault.address}-${deadline}@legatumarca`,
    `DTSTAMP:${icsStamp(Math.floor(Date.now() / 1000))}`,
    `DTSTART:${icsStamp(deadline)}`,
    `DTEND:${icsStamp(deadline + 900)}`,
    `SUMMARY:${icsText(`Check in to ${vaultName(vault)}`)}`,
    `DESCRIPTION:${icsText("Last day to check in to this Legatum Arca vault before its grace period starts. Checking in earlier moves this date.")}`,
    ...LEADS.flatMap((days) => [
      "BEGIN:VALARM",
      "ACTION:DISPLAY",
      `DESCRIPTION:${icsText(`${days} day${days > 1 ? "s" : ""} left to check in to ${vaultName(vault)}`)}`,
      `TRIGGER:-P${days}D`,
      "END:VALARM",
    ]),
    "END:VEVENT",
    "END:VCALENDAR",
  ];
  const url = URL.createObjectURL(new Blob([lines.join("\r\n")], { type: "text/calendar" }));
  const link = document.createElement("a");
  link.href = url;
  link.download = `${vaultName(vault).replace(/[^\w-]+/g, "-")}-check-in.ics`;
  link.click();
  URL.revokeObjectURL(url);
}

// Nothing here can send a message yet, so every channel sits in the "not set
// up" state. The calendar file is the reminder that works today.
const CHANNELS = [
  { id: "rEmail", name: "Email" },
  { id: "rTg", name: "Telegram" },
  { id: "rSms", name: "Text message" },
];

// The channel switches. `vault` adds a calendar button for that vault;
// `onViewAll` adds a way to the full schedule.
export function Reminders({ vault, onDone, onViewAll }) {
  return (
    <section className="box" style={{ "--d": ".32s" }}>
      <header>
        <h2>{vault || onViewAll ? "Reminders" : "Channels"}</h2>
      </header>
      {CHANNELS.map((c) => (
        <label key={c.id} className="sw" htmlFor={c.id}>
          <span>
            {c.name}
            <small>Not set up</small>
          </span>
          <input type="checkbox" id={c.id} disabled />
        </label>
      ))}
      <div className="lead">
        {LEADS.map((days) => (
          <span key={days}>
            {days} day{days > 1 ? "s" : ""} before
          </span>
        ))}
      </div>
      {(vault || onViewAll) && (
        <div className="foot">
          {vault && <CalendarButton vault={vault} onDone={onDone} />}
          {onViewAll && (
            <button className="btn" type="button" onClick={onViewAll}>
              All reminders
            </button>
          )}
        </div>
      )}
    </section>
  );
}

function CalendarButton({ vault, onDone }) {
  return (
    <button
      className="btn"
      type="button"
      disabled={vault.storedState !== "Active"}
      onClick={() => {
        downloadCalendar(vault);
        onDone(`Calendar reminders for ${vaultName(vault)} downloaded.`);
      }}
    >
      Add to calendar
    </button>
  );
}

// Every open vault's next deadline, each with its calendar file.
export function Schedule({ vaults, views, now, onDone }) {
  const rows = vaults
    .map((v, i) => ({ v, view: views[i] }))
    .filter(({ v }) => isOpen(v, now))
    .sort((a, b) => a.v.lastCheckIn + a.v.interval - (b.v.lastCheckIn + b.v.interval));

  return (
    <section className="box span2">
      <header>
        <h2>Check-in schedule</h2>
        <span className="label">Soonest first</span>
      </header>
      {rows.length === 0 && <p className="empty">No open vault has a deadline.</p>}
      <ul className="incoming">
        {rows.map(({ v, view }) => (
          <li key={v.address}>
            <span>
              <b style={{ fontWeight: 500 }}>{view.name}</b>
              <br />
              <span style={{ color: "var(--mute)" }}>
                Check in by {formatDeadline(v.lastCheckIn + v.interval, now)} · {view.meter}
              </span>
            </span>
            <span className={`pill ${view.tone}`}>{view.state}</span>
            <CalendarButton vault={v} onDone={onDone} />
          </li>
        ))}
      </ul>
    </section>
  );
}
