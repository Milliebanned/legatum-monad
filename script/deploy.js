// Deploys VaultFactory (and, inside its constructor, the single Vault
// implementation every vault is a clone of) plus KeeperReceiver to Monad
// mainnet or testnet, then publishes the sources through Sourcify.
//
// On testnet it also deploys two test stablecoins anyone can mint, standing
// in for USDC and AUSD.
//
// Usage:
//   npx hardhat run script/deploy.js --network monadTestnet
//   npx hardhat run script/deploy.js --network monad
const fs = require("fs");
const path = require("path");
const { execFileSync } = require("child_process");
const { ethers, network } = require("hardhat");

const TARGETS = {
  monad: { chainId: 143, file: "deployedMainnet.js", label: "Monad mainnet" },
  monadTestnet: { chainId: 10143, file: "deployedTestnet.js", label: "Monad testnet" },
};

async function deploy(name, ...args) {
  const contract = await (await ethers.getContractFactory(name)).deploy(...args);
  await contract.waitForDeployment();
  return contract;
}

async function main() {
  const target = TARGETS[network.name];
  if (!target) {
    throw new Error(`Refusing to deploy on network "${network.name}". Use --network monad or monadTestnet.`);
  }

  const [deployer] = await ethers.getSigners();
  const balance = await ethers.provider.getBalance(deployer.address);
  console.log(`Deploying to ${target.label} as ${deployer.address} (${ethers.formatEther(balance)} MON)`);
  if (balance === 0n) throw new Error(`${deployer.address} has no MON to pay for gas.`);

  const factory = await deploy("VaultFactory");
  const factoryAddress = await factory.getAddress();
  const implAddress = await factory.vaultImplementation();
  const receipt = await factory.deploymentTransaction().wait();
  console.log("VaultFactory:", factoryAddress);
  console.log("Vault implementation:", implAddress);

  const receiverAddress = await (await deploy("KeeperReceiver")).getAddress();
  console.log("KeeperReceiver:", receiverAddress);

  const tokens = {};
  if (network.name === "monadTestnet") {
    tokens.usdc = await (await deploy("TestToken", "Test USDC", "USDC", 6)).getAddress();
    tokens.ausd = await (await deploy("TestToken", "Test AUSD", "AUSD", 6)).getAddress();
    console.log("Test USDC:", tokens.usdc);
    console.log("Test AUSD:", tokens.ausd);
  }

  // The app (frontend/src/config.js) and the keeper (frontend/api/keeper.js)
  // read the addresses from here.
  const lines = [
    `  factory: "${factoryAddress}",`,
    `  vaultImplementation: "${implAddress}",`,
    `  keeperReceiver: "${receiverAddress}",`,
    ...Object.entries(tokens).map(([key, address]) => `  ${key}: "${address}",`),
  ];
  fs.writeFileSync(
    path.join(__dirname, "..", "frontend", "src", target.file),
    `// Written by script/deploy.js after the ${target.label} deployment
// (tx ${receipt.hash}, block ${receipt.blockNumber}).
export default {
${lines.join("\n")}
};
`
  );
  console.log(`Wrote frontend/src/${target.file}`);

  // Every vault is a clone of the implementation, so verifying it covers
  // them all. A failure here doesn't undo the deployment; the command can
  // simply be run again.
  const verifyArgs = [
    "script/verify-sourcify.js",
    String(target.chainId),
    factoryAddress,
    "VaultFactory",
    implAddress,
    "Vault",
    receiverAddress,
    "KeeperReceiver",
  ];
  try {
    execFileSync("node", verifyArgs, { stdio: "inherit", cwd: path.join(__dirname, "..") });
  } catch {
    console.error(`Verification failed. Retry with: node ${verifyArgs.join(" ")}`);
  }
}

main().catch((error) => {
  console.error(error);
  process.exitCode = 1;
});
