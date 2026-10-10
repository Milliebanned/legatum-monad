// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/proxy/Clones.sol";
import "./Vault.sol";

/// @title VaultFactory
/// @notice Deploys the single Vault implementation and mints minimal-proxy
///         clones of it. An owner can hold any number of vaults, each with its
///         own beneficiaries, shares and check-in timer. Monad only — the
///         constructor reverts on any other chain, with no override.
contract VaultFactory is IVaultRegistry {
    address public immutable vaultImplementation;

    mapping(address => address[]) internal ownerVaults;
    mapping(address => address[]) internal beneficiaryVaults;
    mapping(address => mapping(address => bool)) internal isIndexed; // beneficiary => vault => listed
    mapping(address => bool) public isVault;
    address[] public allVaults;

    event VaultCreated(
        address indexed owner,
        address indexed vault,
        string name,
        address[] beneficiaries,
        uint256[] shares,
        uint256 checkInInterval,
        uint256 gracePeriod
    );

    constructor() {
        // Vault's own constructor refuses any chain but Monad.
        vaultImplementation = address(new Vault());
    }

    /// @dev Creates a new vault owned by the caller. Beneficiary and share
    ///      validation lives in Vault.initialize, which reverts the whole call.
    ///      Any MON sent along goes into the vault as its first deposit.
    /// @param name Owner-chosen label (e.g. "Family"), at most 64 bytes.
    /// @param beneficiaries Addresses paid if the owner goes inactive.
    /// @param shares Basis points per beneficiary (same order); must total 10_000.
    /// @param checkInInterval Seconds between required check-ins.
    /// @param gracePeriod Additional seconds of buffer before the payout.
    function createVault(
        string calldata name,
        address[] calldata beneficiaries,
        uint256[] calldata shares,
        uint256 checkInInterval,
        uint256 gracePeriod
    ) external payable returns (address) {
        address vault = Clones.clone(vaultImplementation);
        Vault(payable(vault)).initialize{value: msg.value}(
            msg.sender,
            name,
            beneficiaries,
            shares,
            checkInInterval,
            gracePeriod
        );

        isVault[vault] = true;
        ownerVaults[msg.sender].push(vault);
        _index(vault, beneficiaries);
        allVaults.push(vault);

        emit VaultCreated(msg.sender, vault, name, beneficiaries, shares, checkInInterval, gracePeriod);
        return vault;
    }

    /// @dev Called by a vault after its owner changes beneficiaries, so newly
    ///      added people can find it. Removed beneficiaries stay listed; check
    ///      Vault.shareOf before treating an indexed vault as theirs.
    function registerBeneficiaries(address[] calldata beneficiaries) external {
        require(isVault[msg.sender], "Only vaults");
        _index(msg.sender, beneficiaries);
    }

    function _index(address vault, address[] calldata beneficiaries) internal {
        for (uint256 i = 0; i < beneficiaries.length; i++) {
            address b = beneficiaries[i];
            if (!isIndexed[b][vault]) {
                isIndexed[b][vault] = true;
                beneficiaryVaults[b].push(vault);
            }
        }
    }

    /// @dev Every vault `owner` has created, in creation order.
    function getVaultsByOwner(address owner) external view returns (address[] memory) {
        return ownerVaults[owner];
    }

    /// @dev Every vault that names or has named `beneficiary`, in the order
    ///      they were first named.
    function getVaultsByBeneficiary(address beneficiary) external view returns (address[] memory) {
        return beneficiaryVaults[beneficiary];
    }

    /// @dev Total number of vaults created.
    function vaultCount() external view returns (uint256) {
        return allVaults.length;
    }

    /// @dev Vaults [from, from + count) in creation order, clamped to the end.
    ///      Anyone can create vaults, so callers that walk the whole list
    ///      (payout keepers) should page through it rather than trust
    ///      getAllVaults() to stay small enough to return.
    function getVaults(uint256 from, uint256 count) external view returns (address[] memory page) {
        uint256 end = from + count;
        if (end > allVaults.length) end = allVaults.length;
        if (from >= end) return new address[](0);
        page = new address[](end - from);
        for (uint256 i = from; i < end; i++) {
            page[i - from] = allVaults[i];
        }
    }

    /// @dev The vaults among [from, from + count) whose timer has run out and
    ///      that haven't been paid yet, so a keeper finds its work in one call
    ///      per page.
    function getDueVaults(uint256 from, uint256 count) external view returns (address[] memory due) {
        uint256 end = from + count;
        if (end > allVaults.length) end = allVaults.length;
        if (from >= end) return new address[](0);

        address[] memory found = new address[](end - from);
        uint256 n;
        for (uint256 i = from; i < end; i++) {
            if (Vault(payable(allVaults[i])).isDue()) {
                found[n++] = allVaults[i];
            }
        }
        due = new address[](n);
        for (uint256 i = 0; i < n; i++) {
            due[i] = found[i];
        }
    }

    /// @dev All vault addresses ever created, in creation order.
    function getAllVaults() external view returns (address[] memory) {
        return allVaults;
    }
}
