import { useState } from "react";
import Incoming from "./Incoming.jsx";
import { Activity, Everyone, People, Reminders, Schedule, Stats, VaultDetails, VaultList } from "./Panels.jsx";
import Pulse, { EmptyPulse } from "./Pulse.jsx";
import { activityItems, isOpen, totals, vaultName, vaultView } from "./viewModel.js";

// One component per destination in the rail. Each gets the same `app` object
// from AppScreen: the loaded vaults, the selected one, and what can be done.

export const PAGES = {
  overview: { title: null, blurb: null },
  vaults: { title: "Vaults", blurb: "Check in, move funds in or out, and close a vault." },
  people: { title: "Beneficiaries", blurb: "Who each vault pays, and the vaults that pay you." },
  wallet: { title: "Wallet", blurb: "What you hold outside your vaults, and how to add to it." },
  swap: { title: "Swap", blurb: "Trade one Monad asset for another before you lock it away." },
  send: { title: "Send", blurb: "Pay someone now, in MON or a stablecoin, without waiting for a vault." },
  activity: { title: "Activity", blurb: "Everything recorded on-chain across your vaults." },
  reminders: { title: "Reminders", blurb: "The next deadline for every open vault, ready for your calendar." },
};

// What is happening across every vault, at a glance. Changing anything
// happens on the page each box leads to.
export function Overview({ app }) {
  const { list, views, vault, now, labels } = app;
  return (
    <div className="grid">
      {vault ? (
        <Pulse
          key={vault.address}
          vault={vault}
          view={vaultView(vault, now)}
          onDone={app.done}
          onError={app.showError}
          onManage={() => app.go("vaults")}
        />
      ) : (
        <EmptyPulse loading={app.loading} onCreate={() => app.open("new")} />
      )}
      <Stats totals={totals(list, now)} />
      <VaultList views={views} selected={vault?.address} onSelect={app.select} loading={app.loading} />
      <People vault={vault} labels={labels} onViewAll={() => app.go("people")} />
      <Activity items={activityItems(list, now, labels)} now={now} limit={6} onViewAll={() => app.go("activity")} />
      <Reminders vault={vault} onDone={app.showToast} onViewAll={() => app.go("reminders")} />
      <Incoming onDone={app.done} onError={app.showError} />
    </div>
  );
}

// Pick a vault from the list; everything below it is that vault.
export function Vaults({ app }) {
  const { list, views, vault, now, labels } = app;
  if (!vault) {
    return (
      <div className="grid">
        <EmptyPulse loading={app.loading} onCreate={() => app.open("new")} />
      </div>
    );
  }
  return (
    <div className="grid">
      <VaultList views={views} selected={vault.address} onSelect={app.select} wide />
      <Pulse
        key={vault.address}
        vault={vault}
        view={vaultView(vault, now)}
        onDone={app.done}
        onError={app.showError}
        onDeposit={() => app.open("deposit")}
        onWithdraw={() => app.open("withdraw")}
        onCloseVault={() => app.open("close")}
      />
      <VaultDetails vault={vault} />
      <Activity items={activityItems([vault], now, labels)} now={now} heading="History" />
      <People vault={vault} labels={labels} onEdit={() => app.open("people")} />
    </div>
  );
}

export function Beneficiaries({ app }) {
  const { list, now, labels } = app;
  const open = list.filter((v) => isOpen(v, now));
  return (
    <div className="grid">
      <Everyone vaults={list} now={now} labels={labels} />
      {open.map((v) => (
        <People
          key={v.address}
          vault={v}
          labels={labels}
          heading={vaultName(v)}
          onEdit={() => {
            app.select(v.address);
            app.open("people");
          }}
        />
      ))}
      <Incoming onDone={app.done} onError={app.showError} always />
    </div>
  );
}

export function ActivityLog({ app }) {
  const { list, now, labels } = app;
  const [only, setOnly] = useState("");
  const shown = only ? list.filter((v) => v.address === only) : list;
  return (
    <div className="grid">
      <Activity
        items={activityItems(shown, now, labels)}
        now={now}
        heading="On-chain history"
        wide
        aside={
          <select className="pick" aria-label="Show activity for" value={only} onChange={(e) => setOnly(e.target.value)}>
            <option value="">All vaults</option>
            {list.map((v) => (
              <option key={v.address} value={v.address}>
                {vaultName(v)}
              </option>
            ))}
          </select>
        }
      />
    </div>
  );
}

export function RemindersPage({ app }) {
  const { list, views, now } = app;
  return (
    <div className="grid">
      <Schedule vaults={list} views={views} now={now} onDone={app.showToast} />
      <Reminders />
    </div>
  );
}
