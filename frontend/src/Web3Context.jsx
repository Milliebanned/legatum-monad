import { createContext, useCallback, useContext, useEffect, useMemo, useRef, useState } from "react";
import { BrowserProvider, Contract } from "ethers";
import { CHAIN_CONFIG, NATIVE } from "./config.js";
import { ERC20_ABI } from "./abis/ERC20.js";

const Web3Ctx = createContext(null);

export function Web3Provider({ children }) {
  const [provider, setProvider] = useState(null);
  const [signer, setSigner] = useState(null);
  const [address, setAddress] = useState(null);
  const [chainId, setChainId] = useState(null);
  // The wallet's balance of each token on this network's list, as base units
  // keyed by lowercased token address (NATIVE for MON); null while loading.
  const [balances, setBalances] = useState(null);
  const [error, setError] = useState(null);
  const [walletName, setWalletName] = useState(null);
  // True when the wallet reports the right chain ID but the configured factory
  // has no code at that address. Locally that means the wallet's chain 10143 is
  // pointed at Monad testnet rather than the Hardhat node — the two share a
  // chain ID, so this is the only way to tell them apart. On a real build it
  // means the factory hasn't been deployed yet. Either way, signing anything
  // would be a mistake, so the UI blocks on it.
  const [contractsMissing, setContractsMissing] = useState(false);

  // The raw EIP-1193 provider currently in use (an EIP-6963 wallet's own
  // `provider`, or window.ethereum as a legacy fallback) — kept outside
  // React state since it's only used imperatively, for attaching/removing
  // its event listeners.
  const rawProviderRef = useRef(null);
  // True while a switch/add-network request is open in the wallet, so a
  // second one isn't stacked on top of it.
  const switchingRef = useRef(false);

  const wrongChain = chainId !== null && chainId !== CHAIN_CONFIG.chainId;

  const refreshBalance = useCallback(async (prov, addr) => {
    if (!prov || !addr) return;
    // A token that can't be read shows as zero rather than hiding the rest.
    const entries = await Promise.all(
      CHAIN_CONFIG.tokens.map(async (token) => {
        const read =
          token.address === NATIVE
            ? prov.getBalance(addr)
            : new Contract(token.address, ERC20_ABI, prov).balanceOf(addr);
        return [token.address.toLowerCase(), await read.catch(() => 0n)];
      })
    );
    setBalances(Object.fromEntries(entries));
  }, []);

  const verifyContracts = useCallback(async (prov) => {
    try {
      const code = await prov.getCode(CHAIN_CONFIG.factoryAddress);
      setContractsMissing(code === "0x");
    } catch {
      setContractsMissing(false);
    }
  }, []);

  const detachRawListeners = useCallback(() => {
    const raw = rawProviderRef.current;
    if (!raw) return;
    raw.removeListener?.("accountsChanged", raw.__onAccountsChanged);
    raw.removeListener?.("chainChanged", raw.__onChainChanged);
  }, []);

  // Asks the wallet to switch to the configured chain, adding it (EIP-3085)
  // if the wallet doesn't know it yet — not every wallet has
  // Monad pre-configured. The chain parameters come from CHAIN_CONFIG so a
  // local build points the wallet at the local node, never at mainnet.
  const switchChain = useCallback(async (raw) => {
    if (!raw || switchingRef.current) return;
    switchingRef.current = true;
    const hexChainId = "0x" + CHAIN_CONFIG.chainId.toString(16);
    try {
      await raw.request({ method: "wallet_switchEthereumChain", params: [{ chainId: hexChainId }] });
    } catch (switchErr) {
      // 4902: the wallet has no such chain configured yet, so add it.
      if (switchErr?.code !== 4902) {
        setError(switchErr?.code === 4001 ? `Switch your wallet to ${CHAIN_CONFIG.label} to continue.` : (switchErr?.message ?? "Failed to switch network"));
        return;
      }
      const params = {
        chainId: hexChainId,
        chainName: CHAIN_CONFIG.label,
        nativeCurrency: CHAIN_CONFIG.nativeCurrency,
        rpcUrls: [CHAIN_CONFIG.rpcUrl],
      };
      if (CHAIN_CONFIG.blockExplorerUrl) {
        params.blockExplorerUrls = [CHAIN_CONFIG.blockExplorerUrl];
      }
      try {
        await raw.request({ method: "wallet_addEthereumChain", params: [params] });
      } catch (addErr) {
        setError(addErr?.code === 4001 ? `Add ${CHAIN_CONFIG.label} to your wallet to continue.` : (addErr?.message ?? "Failed to add network"));
      }
    } finally {
      switchingRef.current = false;
    }
  }, []);

  // The button in the wrong-network dialog, for a wallet that declined the
  // automatic request.
  const switchNetwork = useCallback(() => switchChain(rawProviderRef.current), [switchChain]);

  // `rawEip1193Provider` is a specific wallet's own provider object, as
  // handed to us by EIP-6963 (see eip6963.js), or window.ethereum as a
  // fallback for a wallet that hasn't adopted EIP-6963 yet.
  const connect = useCallback(
    async (rawEip1193Provider, name) => {
      setError(null);
      const raw = rawEip1193Provider ?? window.ethereum;
      if (!raw) {
        setError("No wallet found. Install a browser wallet extension (or point one at your local Hardhat node).");
        return;
      }
      try {
        const browserProvider = new BrowserProvider(raw);
        await browserProvider.send("eth_requestAccounts", []);
        const network = await browserProvider.getNetwork();
        const walletSigner = await browserProvider.getSigner();
        const addr = await walletSigner.getAddress();

        detachRawListeners();
        const onAccountsChanged = () => connect(raw, name);
        const onChainChanged = () => connect(raw, name);
        raw.__onAccountsChanged = onAccountsChanged;
        raw.__onChainChanged = onChainChanged;
        raw.on?.("accountsChanged", onAccountsChanged);
        raw.on?.("chainChanged", onChainChanged);
        rawProviderRef.current = raw;

        setProvider(browserProvider);
        setSigner(walletSigner);
        setAddress(addr);
        setChainId(Number(network.chainId));
        setWalletName(name ?? null);

        if (Number(network.chainId) === CHAIN_CONFIG.chainId) {
          refreshBalance(browserProvider, addr);
          verifyContracts(browserProvider);
        } else {
          setContractsMissing(false);
          // On any other network, ask the wallet straight away to move to (or
          // add) the right one. Approving it fires chainChanged, which runs
          // connect again on the new chain.
          switchChain(raw);
        }
      } catch (err) {
        setError(err?.message ?? "Failed to connect wallet");
      }
    },
    [refreshBalance, detachRawListeners, verifyContracts, switchChain]
  );

  // Forget the session on this page. Wallets have no standard "disconnect"
  // request, so the extension itself keeps its site permission.
  const disconnect = useCallback(() => {
    detachRawListeners();
    rawProviderRef.current = null;
    setProvider(null);
    setSigner(null);
    setAddress(null);
    setChainId(null);
    setBalances(null);
    setWalletName(null);
    setContractsMissing(false);
    setError(null);
  }, [detachRawListeners]);

  useEffect(() => detachRawListeners, [detachRawListeners]);

  const value = useMemo(
    () => ({
      provider,
      signer,
      address,
      chainId,
      wrongChain,
      balances,
      error,
      walletName,
      contractsMissing,
      connect,
      disconnect,
      switchNetwork,
      refreshBalance: () => refreshBalance(provider, address),
    }),
    [
      provider,
      signer,
      address,
      chainId,
      wrongChain,
      balances,
      error,
      walletName,
      contractsMissing,
      connect,
      disconnect,
      switchNetwork,
      refreshBalance,
    ]
  );

  return <Web3Ctx.Provider value={value}>{children}</Web3Ctx.Provider>;
}

export function useWeb3() {
  const ctx = useContext(Web3Ctx);
  if (!ctx) throw new Error("useWeb3 must be used inside <Web3Provider>");
  return ctx;
}
