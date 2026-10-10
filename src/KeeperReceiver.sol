// SPDX-License-Identifier: MIT
pragma solidity 0.8.24;

import "@openzeppelin/contracts/utils/introspection/IERC165.sol";

interface IDistributable {
    function distribute() external;
}

/// @dev What a Chainlink CRE forwarder calls to deliver a workflow's report.
interface IReceiver is IERC165 {
    function onReport(bytes calldata metadata, bytes calldata report) external;
}

/// @title KeeperReceiver
/// @notice Pays out a batch of due vaults in one transaction. A Chainlink CRE
///         workflow finds the due vaults and delivers the list here through
///         onReport(); any other keeper can call distributeMany() directly.
///         Vault.distribute() is open to anyone and can only send each
///         beneficiary their fixed share, so this contract needs no access
///         control: it holds no funds and has no rights over any vault.
contract KeeperReceiver is IReceiver {
    event Distributed(address indexed vault);
    event Skipped(address indexed vault);

    /// @param report abi.encode(address[] vaults)
    function onReport(bytes calldata, bytes calldata report) external {
        _distribute(abi.decode(report, (address[])));
    }

    function distributeMany(address[] calldata vaults) external {
        _distribute(vaults);
    }

    function _distribute(address[] memory vaults) internal {
        for (uint256 i = 0; i < vaults.length; i++) {
            // A vault paid by someone else in the meantime, or an address
            // that isn't a vault at all, is skipped without losing the rest.
            if (vaults[i].code.length == 0) {
                emit Skipped(vaults[i]);
                continue;
            }
            try IDistributable(vaults[i]).distribute() {
                emit Distributed(vaults[i]);
            } catch {
                emit Skipped(vaults[i]);
            }
        }
    }

    function supportsInterface(bytes4 interfaceId) external pure returns (bool) {
        return interfaceId == type(IReceiver).interfaceId || interfaceId == type(IERC165).interfaceId;
    }
}
