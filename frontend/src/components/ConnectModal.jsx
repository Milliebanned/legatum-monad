import { useEffect, useRef } from "react";
import { useWeb3 } from "../Web3Context.jsx";
import { useEip6963Providers } from "../eip6963.js";
import { CHAIN_CONFIG, IS_LOCAL_DEV } from "../config.js";
import "../ConnectModal.css";

function Mark() {
  return (
    <svg viewBox="0 0 64 64" aria-hidden="true">
      <g fill="none" stroke="currentColor" strokeWidth="7" strokeLinecap="round">
        <path d="M28 10A18 18 0 0 0 28 46" />
        <path d="M36 54A18 18 0 0 0 36 18" />
      </g>
      <circle cx="32" cy="32" r="4.5" fill="currentColor" />
    </svg>
  );
}

function ChevronRight() {
  return (
    <svg width="16" height="16" viewBox="0 0 24 24" aria-hidden="true" className="cm-chevron">
      <path d="M9 5.5 L16 12 L9 18.5" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
}

export default function ConnectModal({ onClose }) {
  const { address, chainId, wrongChain, contractsMissing, error, connect, switchNetwork } = useWeb3();
  const wallets = useEip6963Providers();
  const dialogRef = useRef(null);

  // Escape to close, focus into the dialog, and hold the page still behind it.
  useEffect(() => {
    const onKeyDown = (event) => {
      if (event.key === "Escape") onClose();
    };
    document.addEventListener("keydown", onKeyDown);
    const previousOverflow = document.body.style.overflow;
    document.body.style.overflow = "hidden";
    dialogRef.current?.focus();
    return () => {
      document.removeEventListener("keydown", onKeyDown);
      document.body.style.overflow = previousOverflow;
    };
  }, [onClose]);

  const needsNetwork = Boolean(address) && wrongChain;
  const wrongNode = Boolean(address) && !wrongChain && contractsMissing;

  let title = "Connect your wallet";
  let blurb = `Choose a wallet to open your vault on ${CHAIN_CONFIG.label}.`;
  if (needsNetwork) {
    title = "Wrong network";
    blurb = `Legatum Arca runs on ${CHAIN_CONFIG.label} (chain ${CHAIN_CONFIG.chainId}). Your wallet is on chain ${chainId}.`;
  } else if (wrongNode) {
    title = "Contracts not found";
    blurb = `Your wallet is on chain ${CHAIN_CONFIG.chainId}, but no Legatum Arca factory exists at the configured address.`;
  }

  return (
    <div className="cm-overlay" onMouseDown={(event) => event.target === event.currentTarget && onClose()}>
      <div className="cm-dialog" role="dialog" aria-modal="true" aria-labelledby="cm-title" tabIndex={-1} ref={dialogRef}>
        <button type="button" className="cm-close" onClick={onClose} aria-label="Close">
          <svg width="15" height="15" viewBox="0 0 24 24" aria-hidden="true">
            <path d="M6 6 L18 18 M18 6 L6 18" fill="none" stroke="currentColor" strokeWidth="1.8" strokeLinecap="round" />
          </svg>
        </button>

        <div className="cm-brand">
          <Mark />
          Legatum Arca
        </div>

        <h2 className="cm-title" id="cm-title">
          {title}
        </h2>
        <p className="cm-blurb">{blurb}</p>

        {wrongNode && (
          <div className="cm-warning">
            {IS_LOCAL_DEV ? (
              <>
                Chain {CHAIN_CONFIG.chainId} is Monad testnet's chain ID, and the local Hardhat node reuses it. Your
                wallet's network for {CHAIN_CONFIG.chainId} is pointing at Monad testnet instead of{" "}
                <code>{CHAIN_CONFIG.rpcUrl}</code>. Repoint it before signing anything.
              </>
            ) : (
              <>The factory address in this build has no contract deployed at it. Nothing can be signed safely yet.</>
            )}
          </div>
        )}

        {needsNetwork && (
          <button type="button" className="cm-primary" onClick={switchNetwork}>
            Switch to {CHAIN_CONFIG.label}
          </button>
        )}

        {!address && (
          <>
            {wallets.length > 0 ? (
              <div className="cm-wallets">
                {wallets.map((wallet) => (
                  <button
                    key={wallet.info.uuid}
                    type="button"
                    className="cm-wallet"
                    onClick={() => connect(wallet.provider, wallet.info.name)}
                  >
                    {wallet.info.icon ? (
                      <img className="cm-wallet-icon" src={wallet.info.icon} alt="" width={26} height={26} />
                    ) : (
                      <span className="cm-wallet-icon cm-wallet-icon-fallback" aria-hidden="true" />
                    )}
                    <span className="cm-wallet-name">{wallet.info.name}</span>
                    <ChevronRight />
                  </button>
                ))}
              </div>
            ) : (
              <button type="button" className="cm-primary" onClick={() => connect()}>
                Connect Wallet
              </button>
            )}

            {wallets.length === 0 && (
              <p className="cm-note">
                No wallet extension announced itself via EIP-6963. If you have one installed, the button above falls back
                to it directly.
              </p>
            )}
          </>
        )}

        {error && <p className="cm-error">{error}</p>}

        <p className="cm-footnote">
          Non-custodial. Legatum Arca never holds your keys and has no admin backdoor.
        </p>
      </div>
    </div>
  );
}
