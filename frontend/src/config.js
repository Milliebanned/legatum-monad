import localDeployment from "./deployedLocal.js";
import testnetDeployment from "./deployedTestnet.js";
import mainnetDeployment from "./deployedMainnet.js";

// Monad network configuration — hardcoded, not configurable at runtime. No
// chain-selection UI exists in the app; which of these objects gets compiled
// in is decided entirely at build time (see CHAIN_CONFIG below).

// Stands for MON wherever a token address is expected, as in Vault.sol.
export const NATIVE = "0x0000000000000000000000000000000000000000";

const MON = { address: NATIVE, symbol: "MON", decimals: 18 };

// `stable` tokens count as dollars in totals. `mintable` marks the test
// stand-ins anyone can mint, on the local node and testnet only.
const stable = (symbol, address, mintable = false) => ({ address, symbol, decimals: 6, stable: true, mintable });

const MAINNET_CONFIG = {
  chainId: 143,
  rpcUrl: "https://rpc.monad.xyz",
  blockExplorerUrl: "https://monadvision.com",
  label: "Monad",
  nativeCurrency: { name: "Monad", symbol: "MON", decimals: 18 },
  // Written by `npm run deploy:monad` (script/deploy.js).
  factoryAddress: mainnetDeployment.factory,
  // Token addresses from docs.monad.xyz (Tokens and bridges).
  tokens: [
    stable("AUSD", "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a"),
    stable("USDC", "0x754704Bc059F8C67012fEd69BC8A327a5aafb603"),
    MON,
  ],
};

// Testnet and the local node use test stablecoins deployed alongside the
// factory (script/deploy.js, script/deploy-local.js).
const testTokens = (deployment) => [
  ...(deployment.ausd ? [stable("AUSD", deployment.ausd, true)] : []),
  ...(deployment.usdc ? [stable("USDC", deployment.usdc, true)] : []),
  MON,
];

const TESTNET_CONFIG = {
  ...MAINNET_CONFIG,
  chainId: 10143,
  rpcUrl: "https://testnet-rpc.monad.xyz",
  blockExplorerUrl: "https://testnet.monadvision.com",
  label: "Monad Testnet",
  factoryAddress: testnetDeployment.factory,
  tokens: testTokens(testnetDeployment),
};

// Local Hardhat node. hardhat.config.js gives it Monad testnet's chain ID so
// the contracts' "Monad only" check passes, which means a wallet can't tell
// the two apart by chain ID alone: the RPC URL is stated explicitly here so
// the wallet is pointed at the local node.
const LOCAL_CONFIG = {
  ...TESTNET_CONFIG,
  rpcUrl: "http://127.0.0.1:8545",
  blockExplorerUrl: "",
  label: "Local Hardhat",
  factoryAddress: localDeployment.factory,
  tokens: testTokens(localDeployment),
};

// Which network gets compiled in is decided once, at build/serve time, by
// import.meta.env.VITE_TARGET ("local" | "testnet" | "mainnet") — never a
// runtime toggle a user can reach. If unset, the dev server (`npm run dev`)
// targets Monad testnet, and any production build (`npm run build`) targets
// mainnet. The local Hardhat node is opt-in via `npm run dev:local`.
const TARGETS = ["local", "testnet", "mainnet"];
const TARGET = TARGETS.includes(import.meta.env.VITE_TARGET)
  ? import.meta.env.VITE_TARGET
  : import.meta.env.DEV
    ? "testnet"
    : "mainnet";

export const CHAIN_CONFIG =
  TARGET === "local" ? LOCAL_CONFIG : TARGET === "testnet" ? TESTNET_CONFIG : MAINNET_CONFIG;

export const IS_LOCAL_DEV = TARGET === "local";
export const IS_TESTNET_BUILD = TARGET === "testnet";

// What the Swap page trades. Swaps always run on Monad mainnet, where the
// liquidity is, so this is the mainnet list whatever network the rest of the
// build points at. `id` is how Privy's swap service names the asset.
export const SWAP_TOKENS = [
  { id: "native", symbol: "MON", decimals: 18 },
  { id: "0x754704Bc059F8C67012fEd69BC8A327a5aafb603", symbol: "USDC", decimals: 6 },
  { id: "0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a", symbol: "AUSD", decimals: 6 },
  { id: "0xe7cd86e13AC4309349F30B3435a9d337750fC82D", symbol: "USDT0", decimals: 6 },
  { id: "0x3bd359C1119dA7Da1D913D1C4D2B7c461115433A", symbol: "WMON", decimals: 18 },
  { id: "0xEE8c0E9f1BFFb4Eb878d8f15f368A02a35481242", symbol: "WETH", decimals: 18 },
  { id: "0x0555E30da8f98308EdB960aa94C0Db47230d2B9c", symbol: "WBTC", decimals: 8 },
];
// True when this build is on the network swaps run on.
export const SWAPS_LIVE = TARGET === "mainnet";

// The token a new deposit starts on.
export const DEFAULT_TOKEN = CHAIN_CONFIG.tokens[0];

const known = new Map(CHAIN_CONFIG.tokens.map((t) => [t.address.toLowerCase(), t]));

// What the app knows about a token address. Anything not on this network's
// list is shown by its short address, in whole-token units of 18 decimals.
export function tokenInfo(address) {
  return (
    known.get(address.toLowerCase()) ?? {
      address,
      symbol: `${address.slice(0, 6)}…${address.slice(-4)}`,
      decimals: 18,
      unknown: true,
    }
  );
}
