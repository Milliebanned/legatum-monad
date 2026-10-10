export const ERC20_ABI = [
  "function balanceOf(address account) view returns (uint256)",
  "function decimals() view returns (uint8)",
  "function symbol() view returns (string)",
  "function allowance(address owner, address spender) view returns (uint256)",
  "function approve(address spender, uint256 amount) external returns (bool)",
  "function transfer(address to, uint256 amount) external returns (bool)",
];

// Test tokens on the local node and testnet have a public mint(); never called
// against a real token.
export const MOCK_ERC20_ABI = [...ERC20_ABI, "function mint(address to, uint256 amount) external"];
