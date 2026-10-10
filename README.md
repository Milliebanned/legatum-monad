# Legatum Arca

A non-custodial dead man's switch for MON and stablecoins on Monad. You deposit into a vault, name the people who should receive it, and check in on a schedule you choose. If you stop checking in, the vault pays them automatically.

## Why

Self-custody has no inheritance. If you die or lose access to your wallet, the money is stuck: there is no bank to call and nobody your family can ask. Legatum Arca gives a wallet a succession plan that needs no custodian, lawyer or middleman, only a contract that enforces the dates.

## How it works

1. **Create a vault.** Give it a name, pick a check-in window (30 days to a year) and an optional grace period, and name 1 to 10 beneficiaries with a percentage each.
2. **Deposit.** A vault holds MON and up to 8 tokens (USDC, AUSD or any other ERC-20). It all stays yours: you can withdraw part of it or close the vault at any time while it is active. Withdrawing the last of everything closes the vault automatically.
3. **Check in.** One transaction before the window ends resets the clock.
4. **If you go silent,** the window and then the grace period run out, and the vault sends every beneficiary their share of every asset, straight to their wallet. Nobody has to claim anything.
5. **Safety net.** Checking in after the deadline still works, as long as the payout has not been sent yet.

You can have any number of vaults, each with its own people, shares and timer, and you can change a vault's beneficiaries while it is active.

The app also has a **Send** page for paying the same people right away from your wallet, in MON, USDC or AUSD.

## Deployment

Not deployed yet. `npm run deploy:testnet` and `npm run deploy:monad` write the addresses to `frontend/src/deployedTestnet.js` and `frontend/src/deployedMainnet.js`.

| | Mainnet | Testnet |
|---|---|---|
| Chain ID | 143 | 10143 |
| RPC | `https://rpc.monad.xyz` | `https://testnet-rpc.monad.xyz` |
| USDC | `0x754704Bc059F8C67012fEd69BC8A327a5aafb603` | test token deployed with the factory |
| AUSD | `0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a` | test token deployed with the factory |

## Contracts

- `src/VaultFactory.sol` deploys one `Vault` implementation and creates each vault as a minimal-proxy clone of it. It indexes vaults by owner and by beneficiary, and reports which vaults are due.
- `src/Vault.sol` holds one vault's assets, beneficiaries, timer and history.
- `src/KeeperReceiver.sol` pays out a batch of due vaults in one transaction. It accepts the list as a Chainlink CRE report or as a plain call.

Things worth knowing before you rely on it:

- **No admin.** There is no owner role on the factory, no upgrade path, no pause and no fee. After deployment nobody but a vault's owner can move its funds, and only the contract's rules decide when beneficiaries are paid.
- **Payout is permissionless.** Once a vault's deadline has passed, anyone can call `distribute()`, and it can only send each beneficiary their fixed share. A keeper does this automatically, and beneficiaries can do it themselves from the app, so payout never depends on one service.
- **One bad address can't block the rest.** If a transfer to a beneficiary fails (a blacklisted address, or a contract that refuses MON), that share is held in the vault for them to collect later and everyone else is still paid. A MON payout gives each recipient a fixed gas allowance, so one recipient can't use up the gas the others need.
- **Only the owner adds assets to the payout.** Tokens a stranger sends to a vault are ignored until someone calls `distributeToken()` for them after the payout, so junk tokens can't make a payout too expensive to run.
- **Limits.** The check-in window is 1 day to 10 years, the grace period up to 1 year. A beneficiary can't be the owner, the vault or the factory. Shares are basis points and must total 100%.
- **History on-chain.** Each vault records its own actions, so the app needs no indexer.
- **Monad only.** The contracts refuse to deploy on any chain other than Monad mainnet (143) or testnet (10143).

## Security

Legatum Arca has **not been audited**, and a vault is **not a legal will**. Use amounts you could afford to lose.

What has been done: 84 Hardhat tests covering the full lifecycle, including re-entrancy, failed transfers, recipients that refuse MON or burn gas, and gas-starved payout attempts; re-entrancy guards on every function that moves funds.

Risks the contract can't remove:

- Anyone holding the owner's key can withdraw everything.
- A beneficiary who loses their key loses their share. Check every address before you fund a vault.
- If you forget to check in, the vault pays out. The app can add each deadline to your calendar; there are no email or message reminders yet.
- A token that changes its own rules (fees on transfer, pausing, blacklists) can change what beneficiaries receive of that token.
- The hosted keeper runs once a day, so an automatic payout can arrive up to about a day after the deadline.

## Run it locally

Requires Node.js 18 or newer.

```bash
npm install
npm test                # contract tests

# full stack against a local chain
npm run node            # terminal 1: Hardhat node on chain ID 10143
npm run deploy:local    # terminal 2: factory, keeper receiver and two test stablecoins
cd frontend && npm install && npm run dev:local
```

Open http://localhost:5173 and connect a wallet pointed at `http://127.0.0.1:8545` (chain ID 10143). The local chain reuses Monad testnet's chain ID so the contracts' chain check runs unchanged, which means your wallet can't tell the two apart: check its RPC before signing. The account dialog has a button that mints test USDC and AUSD.

`npm run dev` in `frontend/` targets Monad testnet instead. A production build (`npm run build`) targets mainnet.

## Deploy

Copy `.env.example` to `.env`, fill in `PRIVATE_KEY`, and fund that wallet with MON. Then:

```bash
npm run deploy:testnet   # or: npm run deploy:monad
```

The script deploys the factory and the keeper receiver, writes their addresses where the app and keeper read them, and publishes the sources through Sourcify (`script/verify-sourcify.js`). On testnet it also deploys the two test stablecoins.

### Keeper

`frontend/api/keeper.js` is a Vercel cron function that pays out vaults whose timer has run out. Its wallet only pays gas and has no special rights. It needs `KEEPER_NETWORK` (`mainnet` or `testnet`), `KEEPER_PRIVATE_KEY` and `CRON_SECRET` in the Vercel project. The same pass can be run by hand:

```bash
npm run keeper:mainnet -- --once
```

It skips vaults holding less than 0.1 MON and less than 1 unit of every token, and pays at most 25 vaults per pass, so that spam vaults can't drain its gas.

## Layout

```
src/                 Vault.sol, VaultFactory.sol, KeeperReceiver.sol, test-only mocks
test/                Hardhat tests
script/              deploy.js (mainnet and testnet), deploy-local.js, keeper.js
frontend/
  src/components/    landing page and dashboard (React + ethers.js)
  api/keeper.js      daily payout cron
  lib/keeper.js      keeper logic shared with script/keeper.js
docs/                original planning notes
```

The files in `docs/` are the planning notes the project started from. They describe an earlier design and have not been kept up to date; the contracts and this README are the reference.

## License

MIT
