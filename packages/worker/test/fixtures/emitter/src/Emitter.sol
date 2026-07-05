// SPDX-License-Identifier: MIT
pragma solidity ^0.8.24;

contract Emitter {
    event Ping(uint256 indexed n, address who);

    function ping(uint256 n) external {
        emit Ping(n, msg.sender);
    }
}
