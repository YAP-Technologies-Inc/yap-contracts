// SPDX-License-Identifier: MIT
pragma solidity ^0.8.27;

// —— OpenZeppelin upgradeable modules ——
import {Initializable}              from "@openzeppelin/contracts-upgradeable/proxy/utils/Initializable.sol";
import {ContextUpgradeable}         from "@openzeppelin/contracts-upgradeable/utils/ContextUpgradeable.sol";
import {ERC20Upgradeable}           from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20BurnableUpgradeable}   from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import {ERC20PausableUpgradeable}   from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PausableUpgradeable.sol";
import {ERC20PermitUpgradeable}     from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {AccessControlUpgradeable}   from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";
import {UUPSUpgradeable}            from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";

contract YapToken is
    Initializable,
    ContextUpgradeable,
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    ERC20PausableUpgradeable,
    AccessControlUpgradeable,
    ERC20PermitUpgradeable,
    UUPSUpgradeable
{
    bytes32 public constant PAUSER_ROLE   = keccak256("PAUSER_ROLE");
    bytes32 public constant MINTER_ROLE   = keccak256("MINTER_ROLE");
    bytes32 public constant UPGRADER_ROLE = keccak256("UPGRADER_ROLE");

    /// @notice the relayer/forwarder you trust for meta-tx
    address public trustedForwarder;
    /// @notice where half of every transfer goes
    address public treasury;

    /// @custom:oz-upgrades-unsafe-allow constructor
    constructor() {
        // locks implementation against direct init
        _disableInitializers();
    }

    /// @notice initializer to be called via proxy
    /// @param recipient   gets the 1,000,000 initial YAP
    /// @param admin       DEFAULT_ADMIN_ROLE
    /// @param pauser      PAUSER_ROLE
    /// @param minter      MINTER_ROLE
    /// @param upgrader    UPGRADER_ROLE
    /// @param _forwarder  your deployed MinimalForwarder
    /// @param _treasury   where half of each transfer is sent
    function initialize(
        address recipient,
        address admin,
        address pauser,
        address minter,
        address upgrader,
        address _forwarder,
        address _treasury
    ) public initializer {
        // set up context & ERC20 cores
        __Context_init();
        __ERC20_init("YapToken", "YAP");
        __ERC20Burnable_init();
        __ERC20Pausable_init();
        __AccessControl_init();
        __ERC20Permit_init("YapToken");
        __UUPSUpgradeable_init();

        trustedForwarder = _forwarder;
        treasury         = _treasury;

        // mint initial supply
        _mint(recipient, 1_000_000 * 10 ** decimals());

        // grant roles
        _grantRole(DEFAULT_ADMIN_ROLE, admin);
        _grantRole(PAUSER_ROLE,           pauser);
        _grantRole(MINTER_ROLE,           minter);
        _grantRole(UPGRADER_ROLE,         upgrader);
    }

    // —— ERC-2771 “meta-tx” logic ——
    function isTrustedForwarder(address forwarder) public view returns (bool) {
        return forwarder == trustedForwarder;
    }

    function _msgSender()
        internal view override(ContextUpgradeable)
        returns (address sender)
    {
        if (isTrustedForwarder(msg.sender)) {
            // strip off last 20 bytes
            assembly {
                sender := shr(96, calldataload(sub(calldatasize(), 20)))
            }
        } else {
            sender = msg.sender;
        }
    }

    function _msgData()
        internal view override(ContextUpgradeable)
        returns (bytes calldata)
    {
        if (isTrustedForwarder(msg.sender)) {
            return msg.data[:msg.data.length - 20];
        } else {
            return msg.data;
        }
    }

    // —— Role-guarded functions ——
    function pause()   public onlyRole(PAUSER_ROLE) { _pause();   }
    function unpause() public onlyRole(PAUSER_ROLE) { _unpause(); }

    function mint(address to, uint256 amount)
        public onlyRole(MINTER_ROLE)
    {
        _mint(to, amount);
    }

    // —— UUPS upgrade gate ——
    function _authorizeUpgrade(address)
        internal override onlyRole(UPGRADER_ROLE)
    {}

    // —— 50/50 split-and-burn hook ——  
    function _transfer(
        address from,
        address /* to */,
        uint256 amount
    ) internal override {
        uint256 half      = amount / 2;
        uint256 otherHalf = amount - half;

        super._burn(from, half);
        super._transfer(from, treasury, otherHalf);
    }

    // —— must override _update because both ERC20 & Pausable define it ——  
    function _update(
        address from,
        address to,
        uint256 value
    ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._update(from, to, value);
    }

    // —— must override beforeTransfer hook too ——  
    function _beforeTokenTransfer(
        address from,
        address to,
        uint256 amount
    ) internal override(ERC20Upgradeable, ERC20PausableUpgradeable) {
        super._beforeTokenTransfer(from, to, amount);
    }
}
