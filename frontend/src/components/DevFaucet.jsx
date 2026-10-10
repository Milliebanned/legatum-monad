import { useState } from "react";
import { Contract, parseUnits } from "ethers";
import { useWeb3 } from "../Web3Context.jsx";
import { CHAIN_CONFIG } from "../config.js";
import { MOCK_ERC20_ABI } from "../abis/ERC20.js";

// Mints the test stablecoins to the connected wallet. Only the local node and
// testnet have mintable tokens in their config, so on mainnet this renders
// nothing and never touches a real token.
const MINTABLE = CHAIN_CONFIG.tokens.filter((t) => t.mintable);
export default function DevFaucet() {
  const { signer, address, refreshBalance } = useWeb3();
  const [busy, setBusy] = useState(false);

  if (MINTABLE.length === 0 || !address) return null;

  async function mint() {
    setBusy(true);
    try {
      for (const token of MINTABLE) {
        const contract = new Contract(token.address, MOCK_ERC20_ABI, signer);
        await (await contract.mint(address, parseUnits("1000", token.decimals))).wait();
      }
      await refreshBalance();
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="kv">
      <span className="hint">Test network only</span>
      <button type="button" className="btn" onClick={mint} disabled={busy}>
        {busy ? "Minting…" : `Mint 1,000 test ${MINTABLE.map((t) => t.symbol).join(" and ")}`}
      </button>
    </div>
  );
}
