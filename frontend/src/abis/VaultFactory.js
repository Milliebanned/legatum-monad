export const VAULT_FACTORY_ABI = [
  "function createVault(string name, address[] beneficiaries, uint256[] shares, uint256 checkInInterval, uint256 gracePeriod) external payable returns (address)",
  "function getVaultsByOwner(address owner) view returns (address[])",
  "function getVaultsByBeneficiary(address beneficiary) view returns (address[])",
  "function isVault(address) view returns (bool)",
  "function vaultCount() view returns (uint256)",
  "function getAllVaults() view returns (address[])",
  "function getVaults(uint256 from, uint256 count) view returns (address[])",
  "event VaultCreated(address indexed owner, address indexed vault, string name, address[] beneficiaries, uint256[] shares, uint256 checkInInterval, uint256 gracePeriod)",
];
