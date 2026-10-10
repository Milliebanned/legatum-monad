import { useEffect, useState } from "react";
import { Web3Provider, useWeb3 } from "./Web3Context.jsx";
import Landing from "./components/Landing.jsx";
import ConnectModal from "./components/ConnectModal.jsx";
import AppScreen from "./components/app/AppScreen.jsx";
import { CHAIN_CONFIG, IS_LOCAL_DEV, IS_TESTNET_BUILD } from "./config.js";
import { PRIVY_ENABLED, PrivyRoot, usePrivySession } from "./privy.jsx";
import "./App.css";

const TESTNET_BANNER = (
  <div className="testnet-banner">
    TESTNET — this build runs on Monad Testnet. No real funds are involved.
  </div>
);

// The local Hardhat node reuses Monad testnet's chain ID, so the wallet's
// network picker cannot tell them apart. Say which one this build expects, in
// the open.
const LOCAL_BANNER = (
  <div className="testnet-banner">
    LOCAL DEV — expects a Hardhat node at {CHAIN_CONFIG.rpcUrl} on chain {CHAIN_CONFIG.chainId}. That chain ID is also
    Monad testnet's: check your wallet's RPC before signing.
  </div>
);

const BANNER = IS_TESTNET_BUILD ? TESTNET_BANNER : IS_LOCAL_DEV ? LOCAL_BANNER : null;

// `session` is the Privy sign-in when it is configured: its dialog replaces
// the wallet picker, and signing out ends it. Without one the app falls back
// to connecting a browser wallet directly.
function Shell({ session }) {
  const { address, wrongChain, contractsMissing, disconnect } = useWeb3();
  const [connectOpen, setConnectOpen] = useState(false);
  const leave = session?.signOut ?? disconnect;

  const blocked = Boolean(address) && (wrongChain || contractsMissing);

  // Dismiss the dialog as soon as there's a session that can actually transact.
  useEffect(() => {
    if (address && !blocked) setConnectOpen(false);
  }, [address, blocked]);

  if (!address) {
    return (
      <>
        {BANNER}
        <Landing onLaunch={session ? session.signIn : () => setConnectOpen(true)} />
        {connectOpen && <ConnectModal onClose={() => setConnectOpen(false)} />}
        {session?.opening && (
          <div className="opening" role="status">
            Opening your vault…
          </div>
        )}
      </>
    );
  }

  return (
    <>
      {BANNER}
      {!blocked && <AppScreen key={address} onDisconnect={leave} email={session?.email} />}
      {/* Wrong network, or no factory at the configured address: nothing can
          be signed, so the dialog stays up until that's fixed or the wallet
          is disconnected. */}
      {blocked && <ConnectModal onClose={leave} />}
    </>
  );
}

function PrivyShell() {
  return <Shell session={usePrivySession()} />;
}

export default function App() {
  if (!PRIVY_ENABLED) {
    return (
      <Web3Provider>
        <Shell />
      </Web3Provider>
    );
  }
  return (
    <PrivyRoot>
      <Web3Provider>
        <PrivyShell />
      </Web3Provider>
    </PrivyRoot>
  );
}
