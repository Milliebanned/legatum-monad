import { useEffect, useRef } from "react";
import { PrivyProvider, getAccessToken, usePrivy, useSendTransaction, useWallets } from "@privy-io/react-auth";
import { defineChain } from "viem";
import { useWeb3 } from "./Web3Context.jsx";
import { CHAIN_CONFIG, IS_LOCAL_DEV, IS_TESTNET_BUILD } from "./config.js";

// Sign-in with Privy: an email, a social account or a passkey gets a wallet
// made for it, so nobody needs a browser extension or a seed phrase. People
// who already have a wallet can still connect it through the same dialog.
//
// Privy is used whenever an app ID is configured, except against the local
// Hardhat node, which is driven by a plain injected wallet (see
// ConnectModal.jsx).
const APP_ID = import.meta.env.VITE_PRIVY_APP_ID;
export const PRIVY_APP_ID = APP_ID;
export const PRIVY_ENABLED = Boolean(APP_ID) && !IS_LOCAL_DEV;

// When on, the app pays the gas for wallets Privy made, so someone who signs
// in with an email never needs MON. Needs "Sponsor gas fees" switched on for
// this chain in the Privy dashboard. Wallets people bring themselves always
// pay their own gas.
const SPONSOR_GAS = import.meta.env.VITE_PRIVY_SPONSOR === "1";

export const looksLikeEmail = (text) => /^[^\s@]+@[^\s@]+\.[^\s@]{2,}$/.test(text.trim());

// The wallet address behind an email address (see api/beneficiary.js). Someone
// who has never signed in gets a wallet made for them, which is theirs the
// first time they sign in with that email. Null when Privy isn't in use, in
// which case people can only be named by wallet address.
export const resolveEmail = PRIVY_ENABLED
  ? async (email) => {
      const res = await fetch("/api/beneficiary", {
        method: "POST",
        headers: { "content-type": "application/json", authorization: `Bearer ${await getAccessToken()}` },
        body: JSON.stringify({ email }),
      });
      const data = await res.json().catch(() => ({}));
      if (!res.ok) throw new Error(data.error ?? "Couldn't look up that email.");
      return data;
    }
  : null;

// One call to the swap endpoint (see api/swap.js), as the signed-in user.
export async function swapApi(action, body) {
  const res = await fetch("/api/swap", {
    method: "POST",
    headers: { "content-type": "application/json", authorization: `Bearer ${await getAccessToken()}` },
    body: JSON.stringify({ action, ...body }),
  });
  const data = await res.json().catch(() => ({}));
  if (!res.ok) throw new Error(data.error ?? "Swap service unavailable.");
  return data;
}

// Asks the server for starter gas (see api/gas.js). True if some was sent.
async function requestStarterGas() {
  if (!IS_TESTNET_BUILD) return false;
  try {
    const res = await fetch("/api/gas", {
      method: "POST",
      headers: { "content-type": "application/json", authorization: `Bearer ${await getAccessToken()}` },
      body: "{}",
    });
    return res.ok && (await res.json()).sent === true;
  } catch {
    return false;
  }
}

// The one chain this build runs on, described the way Privy wants it.
const chain = defineChain({
  id: CHAIN_CONFIG.chainId,
  name: CHAIN_CONFIG.label,
  nativeCurrency: CHAIN_CONFIG.nativeCurrency,
  rpcUrls: { default: { http: [CHAIN_CONFIG.rpcUrl] } },
  blockExplorers: CHAIN_CONFIG.blockExplorerUrl
    ? { default: { name: "MonadVision", url: CHAIN_CONFIG.blockExplorerUrl } }
    : undefined,
  testnet: CHAIN_CONFIG.chainId !== 143,
});

// Which ways of signing in are offered is set in the Privy dashboard, so a
// method can be switched on there without a new build.
const CONFIG = {
  defaultChain: chain,
  supportedChains: [chain],
  // The app's own dialogs say what is about to be signed, so Privy doesn't
  // ask a second time.
  embeddedWallets: { ethereum: { createOnLogin: "users-without-wallets" }, showWalletUIs: false },
  appearance: {
    theme: "dark",
    accentColor: "#836ef9",
    landingHeader: "Open your vault",
    loginMessage: "Sign in with your email. No wallet or seed phrase needed.",
    walletChainType: "ethereum-only",
  },
};

export function PrivyRoot({ children }) {
  return (
    <PrivyProvider appId={APP_ID} config={CONFIG}>
      {children}
    </PrivyProvider>
  );
}

// The same provider, except that sending a transaction first tries Privy
// with the gas paid by the app. If Privy turns that down, the transaction is
// sent the ordinary way and the wallet pays its own gas, so sponsorship being
// unavailable never stops anyone. Everything else in the app keeps using its
// ethers signer and never knows the difference.
function withSponsoredGas(provider, address, sendRef) {
  return {
    request: async (args) => {
      if (args.method !== "eth_sendTransaction") return provider.request(args);
      const [tx] = args.params;
      try {
        const { hash } = await sendRef.current(
          { to: tx.to, data: tx.data, value: tx.value, chainId: CHAIN_CONFIG.chainId },
          { sponsor: true, address }
        );
        return hash;
      } catch (err) {
        console.warn("Sponsored gas unavailable, sending with the wallet's own gas:", err?.message ?? err);
        return provider.request(args);
      }
    },
    on: (...a) => provider.on?.(...a),
    removeListener: (...a) => provider.removeListener?.(...a),
  };
}

const describe = (wallet, user) =>
  wallet.walletClientType === "privy" ? (user?.email?.address ?? "Legatum Arca wallet") : (wallet.meta?.name ?? "Wallet");

// Keeps Web3Context in step with the Privy session: once someone is signed
// in and their wallet is ready, the rest of the app gets its provider exactly
// as it would from a browser extension. Returns what the shell needs to
// start and end a session.
export function usePrivySession() {
  const { ready, authenticated, login, logout, user } = usePrivy();
  const { wallets, ready: walletsReady } = useWallets();
  const { connect, disconnect, address } = useWeb3();
  // Kept in a ref so the provider handed to Web3Context always calls the
  // current one.
  const { sendTransaction } = useSendTransaction();
  const sendRef = useRef(sendTransaction);
  sendRef.current = sendTransaction;

  // The wallet made for this account if there is one, otherwise whichever
  // wallet the person signed in with.
  const wallet = wallets.find((w) => w.walletClientType === "privy") ?? wallets[0];

  useEffect(() => {
    if (!authenticated || !walletsReady || !wallet) return undefined;
    let cancelled = false;
    (async () => {
      // An extension wallet may be on another network; the embedded one
      // starts on ours. Web3Context asks again if this is declined.
      await wallet.switchChain(CHAIN_CONFIG.chainId).catch(() => {});
      const provider = await wallet.getEthereumProvider();
      const sponsored = SPONSOR_GAS && wallet.walletClientType === "privy";
      if (cancelled) return;
      const source = sponsored ? withSponsoredGas(provider, wallet.address, sendRef) : provider;
      connect(source, describe(wallet, user));
      // A wallet made for an email starts with nothing to pay gas with. On
      // the test network the app tops it up once; connecting again afterwards
      // picks up the new balance.
      if (wallet.walletClientType === "privy" && (await requestStarterGas()) && !cancelled) {
        connect(source, describe(wallet, user));
      }
    })();
    return () => {
      cancelled = true;
    };
    // `connect` is stable; the wallet's address is what identifies a change.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [authenticated, walletsReady, wallet?.address]);

  // Signed out elsewhere (another tab, an expired session): drop the wallet here too.
  useEffect(() => {
    if (ready && !authenticated && address) disconnect();
  }, [ready, authenticated, address, disconnect]);

  return {
    ready,
    // Signed in, but the wallet is still being fetched or created.
    opening: ready && authenticated && !address,
    signIn: login,
    signOut: async () => {
      await logout();
      disconnect();
    },
    email: user?.email?.address ?? null,
  };
}
