import { useCallback, useEffect, useState } from "react";
import { Contract } from "ethers";
import { useWeb3 } from "../../Web3Context.jsx";
import { CHAIN_CONFIG } from "../../config.js";
import { VAULT_FACTORY_ABI } from "../../abis/VaultFactory.js";
import { VAULT_ABI, VAULT_STATE, VAULT_ACTION } from "../../abis/Vault.js";

// Everything the owner-side screens need about one vault, read in one pass.
export async function loadVault(address, provider) {
  const vault = new Contract(address, VAULT_ABI, provider);
  const [name, state, [beneficiaries, shares], [tokens, balances], interval, grace, lastCheckIn, historyLength] =
    await Promise.all([
      vault.name(),
      vault.state(),
      vault.getBeneficiaries(),
      vault.getBalances(),
      vault.checkInInterval(),
      vault.gracePeriod(),
      vault.lastCheckInTime(),
      vault.historyLength(),
    ]);
  const history = await vault.getHistory(0, historyLength);
  return {
    address,
    name,
    storedState: VAULT_STATE[Number(state)],
    // MON first, then each token the owner has deposited.
    assets: tokens.map((token, i) => ({ token, raw: balances[i] })),
    beneficiaries: beneficiaries.map((b, i) => ({ address: b, bps: Number(shares[i]) })),
    interval: Number(interval),
    grace: Number(grace),
    lastCheckIn: Number(lastCheckIn),
    history: history.map((e, index) => ({
      action: VAULT_ACTION[Number(e.action)],
      timestamp: Number(e.timestamp),
      actor: e.actor,
      token: e.token,
      amount: e.amount,
      index,
    })),
  };
}

// The connected wallet's vaults, oldest first, refreshed every 15 seconds.
export function useOwnerVaults() {
  const { provider, address } = useWeb3();
  const [vaults, setVaults] = useState(null);
  const [error, setError] = useState(null);

  const reload = useCallback(async () => {
    if (!provider || !address) return;
    try {
      const factory = new Contract(CHAIN_CONFIG.factoryAddress, VAULT_FACTORY_ABI, provider);
      const addresses = await factory.getVaultsByOwner(address);
      // One vault that fails to load drops out rather than blanking the page.
      const results = await Promise.allSettled(addresses.map((a) => loadVault(a, provider)));
      setVaults(results.filter((r) => r.status === "fulfilled").map((r) => r.value));
      setError(null);
    } catch (err) {
      setError(err?.shortMessage ?? err?.message ?? "Couldn't load vaults");
    }
  }, [provider, address]);

  useEffect(() => {
    setVaults(null);
    reload();
    const id = setInterval(reload, 15000);
    return () => clearInterval(id);
  }, [reload]);

  return { vaults, error, reload };
}

// The chain's clock in seconds, ticking once a second, for live countdowns.
// Deadlines are judged by block time, so this device's clock is only used to
// count forward from the newest block seen: a wrong clock or time zone can't
// make a deadline look further away than it is.
export function useNow() {
  const { provider } = useWeb3();
  const [offset, setOffset] = useState(-Infinity);
  const [now, setNow] = useState(() => Math.floor(Date.now() / 1000));

  useEffect(() => {
    if (!provider) return undefined;
    let cancelled = false;
    const sync = async () => {
      try {
        const block = await provider.getBlock("latest");
        // Chain time never runs backwards, and an old block can only
        // understate it, so the furthest-ahead reading is the best one.
        if (!cancelled) setOffset((prev) => Math.max(prev, block.timestamp - Math.floor(Date.now() / 1000)));
      } catch {
        // Keep the last reading; the device clock carries on from it.
      }
    };
    setOffset(-Infinity);
    sync();
    const id = setInterval(sync, 60000);
    return () => {
      cancelled = true;
      clearInterval(id);
    };
  }, [provider]);

  useEffect(() => {
    const id = setInterval(() => setNow(Math.floor(Date.now() / 1000)), 1000);
    return () => clearInterval(id);
  }, []);

  return now + (Number.isFinite(offset) ? offset : 0);
}
