# Legatum Arca

**On-chain inheritance. If something happens to you, your family still receives your crypto.**

Legatum Arca is a non-custodial dead man's switch on Monad. You put funds in a vault, name the people who should receive them, and confirm you're still alive on a schedule you choose. If one day you can't, the vault pays them automatically.

## Why it exists

Crypto has no next of kin. A bank account passes to your family when you die; a wallet doesn't. If you are the only person with the key and something happens to you, everything in that wallet stays on-chain forever, visible to everyone and movable by no one. Millions of bitcoin are believed to be lost this way already.

Nobody plans for it, which is the problem:

- **Someone who travels constantly** boards a flight that doesn't land.
- **A reporter or aid worker in a conflict zone**, paid in crypto because banks don't reach, doesn't come home.
- **A soldier on deployment** holds their savings in a wallet only they can open.
- **Someone who did well in crypto** dies suddenly with everything in one wallet, and their family can see the balance but never touch it.

In each case the money exists and the family is entitled to it, and there is no bank to call and nobody to ask. A will doesn't help, because a court order can't sign a transaction.

Legatum Arca is the instruction you leave behind. It needs no lawyer, no company holding your keys and no trusted friend with your seed phrase, only a contract that waits to hear from you and acts when it doesn't.

## How it works

1. **Sign in and create a vault.** An email is enough; a wallet is made for you. Name the vault, choose how often you'll confirm you're still here (every 30 days to once a year) and an optional grace period.
2. **Name your family.** Add 1 to 10 people by email or wallet address, with a percentage each. Someone named by email who has no wallet gets one made for them, and it is theirs the first time they sign in.
3. **Deposit.** A vault holds MON and up to 8 tokens (USDC, AUSD or any other ERC-20). It all stays yours: you can withdraw or close the vault at any time. Withdrawing the last of everything closes it automatically.
4. **Check in.** One tap before the window ends resets the clock. While you keep doing that, nothing moves and nobody else can touch the vault.
5. **If you go silent,** the window and then the grace period run out, and the vault sends every person their share of every asset, straight to their wallet. They don't have to claim anything, prove anything or know the vault existed.
6. **Safety net.** If you're fine and simply late, checking in still works as long as the payout hasn't been sent.

You can have any number of vaults, each with its own people, shares and timer, and change a vault's beneficiaries whenever you like.

The app also has:

- **Wallet:** what you hold outside your vaults, and your address for receiving funds.
- **Swap:** trade MON for a stablecoin (or back) before locking it away, so what your family receives doesn't move with the market. Runs through Privy's swap service on Monad mainnet.
- **Send:** pay the same people right away, by email or address.

## Deployment

Live on **Monad testnet** (chain ID 10143). Mainnet is not deployed yet.

| | Monad testnet |
|---|---|
| VaultFactory | `0xf99DC9C15c7640454CAa8D535128C81D30d0Eb07` |
| Vault implementation | `0x08D2071Af0C2f49Bb2a6b0F7E11ED5d7f4aFC534` |
| KeeperReceiver | `0x01F519E360Ff24321d4233bD8656418F1c33dE1a` |
| Test USDC | `0xad502D1bd2DdCD1B4E7284b8DBf2b0c442f9721D` |
| Test AUSD | `0xc29955e4bc3284481496992295DE60C407B41822` |

The factory, vault and keeper receiver are source-verified on Sourcify (exact match). Every vault is a minimal-proxy clone of the vault implementation. On mainnet the app uses the real USDC (`0x754704Bc059F8C67012fEd69BC8A327a5aafb603`) and AUSD (`0x00000000eFE302BEAA2b3e6e1b18d08D69a9012a`).

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

Email sign-in, naming people by email and swaps use [Privy](https://privy.io). Put `VITE_PRIVY_APP_ID` and `PRIVY_APP_SECRET` in `frontend/.env.local` to turn them on; without an app ID the app falls back to connecting a browser wallet, and people are named by address only. The local-chain build always uses a browser wallet.

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
