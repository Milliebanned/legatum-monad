import { useCallback, useEffect, useRef, useState } from "react";
import { useWeb3 } from "../../Web3Context.jsx";
import { CHAIN_CONFIG } from "../../config.js";
import {
  AccountDialog,
  BeneficiariesDialog,
  CloseVaultDialog,
  DepositDialog,
  NewVaultDialog,
  WithdrawDialog,
} from "./Dialogs.jsx";
import { ActivityLog, Beneficiaries, Overview, PAGES, RemindersPage, Vaults } from "./Pages.jsx";
import { shortAddress } from "./format.js";
import Send from "./Send.jsx";
import Swap from "./Swap.jsx";
import Wallet from "./Wallet.jsx";
import { useDisplayName, usePeople } from "./people.js";
import { useNow, useOwnerVaults } from "./useVaults.js";
import { headline, sortVaults, vaultView } from "./viewModel.js";
import "../../Dashboard.css";

const ICON = { viewBox: "0 0 24 24", fill: "none", stroke: "currentColor", strokeWidth: "1.6" };

const NAV = [
  {
    id: "overview",
    label: "Overview",
    icon: (
      <>
        <rect x="3" y="3" width="8" height="8" rx="2" />
        <rect x="13" y="3" width="8" height="8" rx="2" />
        <rect x="3" y="13" width="8" height="8" rx="2" />
        <rect x="13" y="13" width="8" height="8" rx="2" />
      </>
    ),
  },
  {
    id: "vaults",
    label: "Vaults",
    icon: (
      <>
        <rect x="4" y="10" width="16" height="11" rx="2" />
        <path d="M8 10V7a4 4 0 0 1 8 0v3" />
      </>
    ),
  },
  {
    id: "people",
    label: "Beneficiaries",
    icon: (
      <>
        <circle cx="9" cy="8" r="3.5" />
        <path d="M2.500 20a6.500 6.500 0 0 1 13 0M16 4.500a3.500 3.500 0 0 1 0 7M18 14.500a6 6 0 0 1 3.500 5.500" />
      </>
    ),
  },
  {
    id: "wallet",
    label: "Wallet",
    icon: (
      <>
        <rect x="3" y="6" width="18" height="13" rx="2.5" />
        <path d="M16 12.500h2M3 10h18" />
      </>
    ),
  },
  { id: "swap", label: "Swap", icon: <path d="M7 4v15M7 4 3.500 7.500M7 4l3.500 3.500M17 20V5M17 20l-3.500-3.500M17 20l3.500-3.500" /> },
  { id: "send", label: "Send", icon: <path d="M4 12h15M13 6l6 6-6 6" /> },
  { id: "activity", label: "Activity", icon: <path d="M3 12h4l3-8 4 16 3-8h4" /> },
  {
    id: "reminders",
    label: "Reminders",
    icon: (
      <>
        <path d="M6 9a6 6 0 0 1 12 0c0 6 2 7 2 7H4s2-1 2-7Z" />
        <path d="M10 20a2 2 0 0 0 4 0" />
      </>
    ),
  },
];

function greeting() {
  const hour = new Date().getHours();
  return hour < 12 ? "Good morning" : hour < 18 ? "Good afternoon" : "Good evening";
}

// Which page is showing, kept in the URL hash so reload and the back button
// behave. Following a rail link changes the hash; this turns that into a page.
function usePage() {
  const read = () => (location.hash.slice(1) in PAGES ? location.hash.slice(1) : "overview");
  const [page, setPage] = useState(read);
  useEffect(() => {
    const onHash = () => {
      setPage(read());
      window.scrollTo(0, 0);
    };
    addEventListener("hashchange", onHash);
    return () => removeEventListener("hashchange", onHash);
  }, []);
  const go = useCallback((id) => {
    location.hash = id;
  }, []);
  return [page, go];
}

const VIEW = {
  overview: Overview,
  vaults: Vaults,
  people: Beneficiaries,
  wallet: Wallet,
  swap: Swap,
  send: Send,
  activity: ActivityLog,
  reminders: RemindersPage,
};

// One message at a time, slid up from the bottom edge, gone after a moment.
function useToast() {
  const [toast, setToast] = useState({ message: "", bad: false, show: false });
  const timer = useRef(0);
  const show = useCallback((message, bad = false) => {
    setToast({ message, bad, show: true });
    clearTimeout(timer.current);
    timer.current = setTimeout(() => setToast((t) => ({ ...t, show: false })), bad ? 5000 : 2600);
  }, []);
  useEffect(() => () => clearTimeout(timer.current), []);
  return [toast, show];
}

// The connected app: a fixed rail, and beside it the page the rail selects.
export default function AppScreen({ onDisconnect, email }) {
  const { address, refreshBalance } = useWeb3();
  const { vaults, error, reload } = useOwnerVaults();
  const now = useNow();
  const [page, go] = usePage();
  const [selected, setSelected] = useState(null);
  const [dialog, setDialog] = useState(null);
  const [displayName, setDisplayName] = useDisplayName(address);
  const [labels, saveLabels] = usePeople(address);
  const [toast, showToast] = useToast();

  const loading = vaults === null;
  const list = sortVaults(vaults ?? [], now);
  const vault = list.find((v) => v.address === selected) ?? list[0];
  const views = list.map((v) => vaultView(v, now));

  const close = () => setDialog(null);
  const showError = (message) => showToast(message, true);
  // A transaction went through: refresh what it changed, then say so.
  const done = async ({ message, select }) => {
    await reload();
    refreshBalance();
    if (select) setSelected(select);
    setDialog(null);
    showToast(message);
  };

  const dialogProps = { vault, labels, saveLabels, onClose: close, onDone: done };
  const Page = VIEW[page];
  const app = {
    list,
    views,
    vault,
    now,
    labels,
    email,
    loading: loading && !error,
    select: setSelected,
    open: setDialog,
    go,
    done,
    showError,
    showToast,
  };

  return (
    <div className="app">
      <div className="shell">
        <aside className="rail">
          <a className="brand" href="#overview">
            <svg viewBox="0 0 64 64">
              <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
                <path d="M28 10A18 18 0 0 0 28 46" />
                <path d="M36 54A18 18 0 0 0 36 18" />
              </g>
              <circle cx="32" cy="32" r="4.5" fill="currentColor" />
            </svg>
            Legatum Arca
          </a>
          <nav className="nav" aria-label="Dashboard">
            {NAV.map((item) => (
              <a
                key={item.id}
                className={page === item.id ? "on" : undefined}
                aria-current={page === item.id ? "page" : undefined}
                href={`#${item.id}`}
              >
                <svg {...ICON}>{item.icon}</svg>
                {item.label}
              </a>
            ))}
            <a
              className="acct"
              href="#account"
              onClick={(e) => {
                e.preventDefault();
                setDialog("account");
              }}
            >
              Account
            </a>
          </nav>
          <button className="wallet" type="button" onClick={() => setDialog("account")} aria-label="Account">
            <span className="label">{email ? "Signed in" : "Connected wallet"}</span>
            <b className={email ? undefined : "mono"} title={address}>
              {email ?? shortAddress(address)}
            </b>
            <span className="net">
              <i className="dot"></i>
              {CHAIN_CONFIG.label}
            </span>
          </button>
        </aside>

        <main className="main">
          <div className="top">
            <div>
              <h1>{PAGES[page].title ?? `${greeting()}, ${displayName || shortAddress(address)}`}</h1>
              <p id="headline">
                {error ?? PAGES[page].blurb ?? (loading ? "Reading your vaults…" : headline(list, now))}
              </p>
            </div>
            <button className="btn" id="newBtn" type="button" onClick={() => setDialog("new")}>
              + New vault
            </button>
          </div>

          {/* Keyed so each page's boxes rise in when it opens. */}
          <Page key={page} app={app} />
        </main>
      </div>

      {dialog === "new" && <NewVaultDialog {...dialogProps} />}
      {dialog === "deposit" && <DepositDialog {...dialogProps} />}
      {dialog === "withdraw" && <WithdrawDialog {...dialogProps} />}
      {dialog === "people" && <BeneficiariesDialog {...dialogProps} />}
      {dialog === "close" && <CloseVaultDialog {...dialogProps} />}
      {dialog === "account" && (
        <AccountDialog
          displayName={displayName}
          onDisplayName={setDisplayName}
          onDisconnect={onDisconnect}
          email={email}
          onClose={close}
        />
      )}
      <div id="toast" role="status" className={`${toast.show ? "show" : ""} ${toast.bad ? "bad" : ""}`}>
        {toast.message}
      </div>
    </div>
  );
}
