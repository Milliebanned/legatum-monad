require("@nomicfoundation/hardhat-toolbox");
require("dotenv").config();

const MONAD_RPC_URL = process.env.MONAD_RPC_URL || "";
const PRIVATE_KEY = process.env.PRIVATE_KEY || "";

module.exports = {
  solidity: { version: "0.8.24", settings: { optimizer: { enabled: true, runs: 200 } } },
  paths: {
    sources: "./src",
  },
  // Sources are published through Sourcify (script/verify-sourcify.js), which
  // Monad's explorers read. The plugin's own Sourcify client still calls an
  // API Sourcify has removed.
  sourcify: { enabled: false },
  networks: {
    // The local network uses Monad testnet's chain ID (10143) so the
    // contracts' "Monad only" check behaves the same in tests as it will
    // once deployed.
    hardhat: {
      chainId: 10143,
    },
    monad: {
      url: MONAD_RPC_URL || "https://rpc.monad.xyz",
      chainId: 143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
    monadTestnet: {
      url: "https://testnet-rpc.monad.xyz",
      chainId: 10143,
      accounts: PRIVATE_KEY ? [PRIVATE_KEY] : [],
    },
  },
};
