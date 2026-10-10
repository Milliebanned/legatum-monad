// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

import "@openzeppelin/contracts/token/ERC20/ERC20.sol";

/// @dev Stand-in stablecoin for the local node and Monad testnet, where the
///      real tokens aren't available to hand out. Anyone can mint a little at
///      a time. Never deployed to mainnet.
contract TestToken is ERC20 {
    uint8 private immutable _decimals;
    uint256 public immutable maxMint;

    constructor(string memory name_, string memory symbol_, uint8 decimals_) ERC20(name_, symbol_) {
        _decimals = decimals_;
        maxMint = 10_000 * 10 ** decimals_;
    }

    function decimals() public view override returns (uint8) {
        return _decimals;
    }

    function mint(address to, uint256 amount) external {
        require(amount <= maxMint, "Too much at once");
        _mint(to, amount);
    }
}
