Test-only contracts. Nothing here is part of the mainnet system and none of
it is referenced by `VaultFactory.sol` or `Vault.sol`. Mainnet deployments use
the real tokens. `TestToken` is the one exception to "tests only":
`script/deploy.js` deploys it to Monad testnet, and `script/deploy-local.js` to
the local node, as stand-in stablecoins.
