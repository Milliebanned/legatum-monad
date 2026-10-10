// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

/// @dev Test-only beneficiary contract for MON payouts. It can refuse MON
///      outright or burn all the gas it is given, to prove one such
///      beneficiary neither blocks nor starves everyone else's payout, and it
///      can collect what a vault holds for it afterwards.
contract StubbornReceiver {
    enum Mode {
        Accept,
        Refuse,
        BurnGas
    }

    Mode public mode;

    function setMode(Mode m) external {
        mode = m;
    }

    function collect(address vault, address token) external {
        (bool ok, bytes memory ret) = vault.call(abi.encodeWithSignature("withdrawOwed(address)", token));
        if (!ok) {
            assembly {
                revert(add(ret, 32), mload(ret))
            }
        }
    }

    receive() external payable {
        if (mode == Mode.Refuse) revert("No MON");
        if (mode == Mode.BurnGas) {
            while (true) {}
        }
    }
}
