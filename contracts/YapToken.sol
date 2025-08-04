// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import { ERC20Upgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import { ERC20BurnableUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import { ERC20PermitUpgradeable } from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import { UUPSUpgradeable } from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import { AccessControlUpgradeable } from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract YapToken is
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    ERC20PermitUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant SPENDER_ROLE = keccak256("SPENDER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    address public treasury;

    function initialize(address _treasury) public initializer {
        __ERC20_init("YapTokenTestV2", "YAP");
        __ERC20Burnable_init();
        __ERC20Permit_init("YapTokenTestV2");
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);

        treasury = _treasury;
        _mint(msg.sender, 1_000_000 * 10 ** decimals());
    }

    function _authorizeUpgrade(address newImplementation) internal override onlyRole(UPGRADER_ROLE) {}

    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        treasury = _treasury;
    }

    function spendToken(uint256 amount) external onlyRole(SPENDER_ROLE) {
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");

        uint256 half = amount / 2;
        uint256 otherHalf = amount - half;

        _burn(msg.sender, half);
        _transfer(msg.sender, treasury, otherHalf);
    }
}
