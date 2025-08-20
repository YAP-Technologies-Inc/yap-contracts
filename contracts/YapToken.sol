// SPDX-License-Identifier: MIT
pragma solidity ^0.8.20;

import {ERC20Upgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/ERC20Upgradeable.sol";
import {ERC20BurnableUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20BurnableUpgradeable.sol";
import {ERC20PermitUpgradeable} from "@openzeppelin/contracts-upgradeable/token/ERC20/extensions/ERC20PermitUpgradeable.sol";
import {UUPSUpgradeable} from "@openzeppelin/contracts-upgradeable/proxy/utils/UUPSUpgradeable.sol";
import {AccessControlUpgradeable} from "@openzeppelin/contracts-upgradeable/access/AccessControlUpgradeable.sol";

contract YapTokenV4 is
    ERC20Upgradeable,
    ERC20BurnableUpgradeable,
    ERC20PermitUpgradeable,
    AccessControlUpgradeable,
    UUPSUpgradeable
{
    // --- Roles ---
    bytes32 public constant SPENDER_ROLE     = keccak256("SPENDER_ROLE");      // backend relayer
    bytes32 public constant UPGRADER_ROLE    = keccak256("UPGRADER_ROLE");     // timelock/governance later
    bytes32 public constant LOCK_EXEMPT_ROLE = keccak256("LOCK_EXEMPT_ROLE"); // treasury/cold/hot/relayer

    // --- Config ---
    address public treasury;
    address public cold;
    address public hot;      
    address public relayer;   
    uint64  public lockDuration; 

    // --- Locking state ---
    struct Lock { uint128 amount; uint64 release; }
    mapping(address => Lock[]) internal _locks;

    // --- Events ---
    event TokenSpent(address indexed owner, uint256 amount, uint256 burned, uint256 sentToTreasury);
    event TreasuryUpdated(address indexed oldTreasury, address indexed newTreasury);
    event LockDurationUpdated(uint64 oldDuration, uint64 newDuration);
    event HotWalletUpdated(address indexed oldHot, address indexed newHot);         
    event RelayerUpdated(address indexed oldRelayer, address indexed newRelayer);   

    // ---------- initialize ----------

    function initialize(
        address _treasury,
        address _cold,
        address _hot,
        address _relayer,
        uint256 _totalSupply
    ) public initializer {
        require(_treasury != address(0), "treasury=0");
        require(_cold     != address(0), "cold=0");
        require(_hot      != address(0), "hot=0");
        require(_relayer  != address(0), "relayer=0");
        require(_totalSupply > 0, "supply=0");

        __ERC20_init("YapTokenTestV4", "YAPV4");
        __ERC20Burnable_init();
        __ERC20Permit_init("YapTokenTestV4");
        __AccessControl_init();
        __UUPSUpgradeable_init();

        _grantRole(DEFAULT_ADMIN_ROLE, msg.sender);
        _grantRole(UPGRADER_ROLE, msg.sender);

        treasury = _treasury;
        cold     = _cold;
        hot      = _hot;
        relayer  = _relayer;

        // 24h lock by default
        lockDuration = 1 days;

        // Exemptions BEFORE mint → no lock for these on receive
        _grantRole(LOCK_EXEMPT_ROLE, _treasury);
        _grantRole(LOCK_EXEMPT_ROLE, _cold);
        _grantRole(LOCK_EXEMPT_ROLE, _hot);
        _grantRole(LOCK_EXEMPT_ROLE, _relayer);
        _grantRole(LOCK_EXEMPT_ROLE, msg.sender); // deployer (if it ever receives)

        // Relayer needs to spend users’ tokens to burn/split to treasury
        _grantRole(SPENDER_ROLE, _relayer);

        // Mint entire supply to cold wallet (no lock because exempt)
        _mint(_cold, _totalSupply);
    }

    // ---------- Upgrades ----------
    function _authorizeUpgrade(address newImplementation)
        internal override onlyRole(UPGRADER_ROLE)
    {}

    // ---------- Admin setters ----------
    function setTreasury(address _treasury) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_treasury != address(0), "treasury=0");
        address old = treasury;
        treasury = _treasury;
        if (!hasRole(LOCK_EXEMPT_ROLE, _treasury)) {
            _grantRole(LOCK_EXEMPT_ROLE, _treasury);
        }
        emit TreasuryUpdated(old, _treasury);
    }

    function setLockDuration(uint64 newDuration) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(newDuration > 0, "duration=0");
        uint64 old = lockDuration;
        lockDuration = newDuration;
        emit LockDurationUpdated(old, newDuration);
    }

    /// Set/rotate the hot wallet; keeps LOCK_EXEMPT_ROLE correct.
    function setHotWallet(address _hot) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_hot != address(0), "hot=0");
        address old = hot;
        if (old != address(0) && old != _hot && hasRole(LOCK_EXEMPT_ROLE, old)) {
            // optional: keep old exempt if you prefer; here we revoke to avoid stale exemptions
            _revokeRole(LOCK_EXEMPT_ROLE, old);
        }
        hot = _hot;
        if (!hasRole(LOCK_EXEMPT_ROLE, _hot)) {
            _grantRole(LOCK_EXEMPT_ROLE, _hot);
        }
        emit HotWalletUpdated(old, _hot);
    }

    /// Set/rotate the relayer; ensures SPENDER_ROLE + LOCK_EXEMPT_ROLE.
    function setRelayer(address _relayer) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(_relayer != address(0), "relayer=0");
        address old = relayer;
        if (old != address(0) && old != _relayer) {
            if (hasRole(SPENDER_ROLE, old))     _revokeRole(SPENDER_ROLE, old);
            if (hasRole(LOCK_EXEMPT_ROLE, old)) _revokeRole(LOCK_EXEMPT_ROLE, old);
        }
        relayer = _relayer;
        if (!hasRole(SPENDER_ROLE, _relayer))     _grantRole(SPENDER_ROLE, _relayer);
        if (!hasRole(LOCK_EXEMPT_ROLE, _relayer)) _grantRole(LOCK_EXEMPT_ROLE, _relayer);
        emit RelayerUpdated(old, _relayer);
    }

    // ---------- Views ----------
    function locksOf(address user) external view returns (Lock[] memory) {
        return _locks[user];
    }

    function lockedAmount(address user) public view returns (uint256 total) {
        Lock[] storage arr = _locks[user];
        uint64 nowTs = uint64(block.timestamp);
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i].release > nowTs) total += uint256(arr[i].amount);
        }
    }

    function unlockedBalanceOf(address user) public view returns (uint256) {
        return balanceOf(user) - lockedAmount(user);
    }

    // ---------- Legacy helper ----------
    function spendToken(uint256 amount) external onlyRole(SPENDER_ROLE) {
        require(balanceOf(msg.sender) >= amount, "Insufficient balance");
        uint256 half = amount / 2;
        uint256 otherHalf = amount - half;
        _burn(msg.sender, half);
        _transfer(msg.sender, treasury, otherHalf);
    }

    // ---------- Backend-only spend path ----------
    function spendFrom(address owner, uint256 amount) public onlyRole(SPENDER_ROLE) {
        _spendAllowance(owner, msg.sender, amount);
        uint256 half = amount / 2;
        uint256 otherHalf = amount - half;
        _burn(owner, half);
        _transfer(owner, treasury, otherHalf);
        emit TokenSpent(owner, amount, half, otherHalf);
    }

    function permitAndSpend(
        address owner,
        uint256 value,
        uint256 deadline,
        uint8 v, bytes32 r, bytes32 s
    ) external onlyRole(SPENDER_ROLE) {
        permit(owner, msg.sender, value, deadline, v, r, s);
        spendFrom(owner, value);
    }

    // ---------- Locking internals ----------
    function _bucketedRelease(uint64 nowTs, uint64 duration) internal pure returns (uint64) {
        uint256 raw = uint256(nowTs) + uint256(duration);
        return uint64((raw / 1 days) * 1 days); // midnight UTC of that day
    }

    function _addOrMergeLock(address to, uint256 value, uint64 release) internal {
        Lock[] storage arr = _locks[to];
        for (uint256 i = 0; i < arr.length; i++) {
            if (arr[i].release == release) {
                arr[i].amount += uint128(value);
                return;
            }
        }
        arr.push(Lock({amount: uint128(value), release: release}));
    }

    function _bypassLock(address operator, address /*from*/, address to) internal view returns (bool) {
        return hasRole(SPENDER_ROLE, operator) && (to == treasury || to == address(0));
    }

    function _consumeLocks(address user, uint256 amount) internal {
        if (amount == 0) return;
        Lock[] storage arr = _locks[user];
        uint64 nowTs = uint64(block.timestamp);
        uint256 remaining = amount;

        // pass 1: still-locked
        for (uint256 i = 0; i < arr.length && remaining > 0; i++) {
            if (arr[i].release > nowTs) {
                uint256 a = uint256(arr[i].amount);
                if (a == 0) continue;
                if (a <= remaining) { remaining -= a; arr[i].amount = 0; }
                else { arr[i].amount = uint128(a - remaining); remaining = 0; }
            }
        }
        // pass 2: expired
        for (uint256 i = 0; i < arr.length && remaining > 0; i++) {
            uint256 a = uint256(arr[i].amount);
            if (a == 0) continue;
            if (a <= remaining) { remaining -= a; arr[i].amount = 0; }
            else { arr[i].amount = uint128(a - remaining); remaining = 0; }
        }
        // trim trailing zeros
        while (arr.length > 0 && arr[arr.length - 1].amount == 0) {
            arr.pop();
        }
    }

    // ---------- Overrides ----------
    function transferFrom(address from, address to, uint256 value) public override returns (bool) {
        if (from != address(0) && !_bypassLock(msg.sender, from, to)) {
            require(unlockedBalanceOf(from) >= value, "YAP: amount exceeds unlocked");
        }
        return super.transferFrom(from, to, value);
    }

    function _update(address from, address to, uint256 value) internal override {
        if (from != address(0)) {
            bool bypass = _bypassLock(msg.sender, from, to);
            if (bypass) {
                if (value > 0) _consumeLocks(from, value);
            } else {
                require(unlockedBalanceOf(from) >= value, "YAP: amount exceeds unlocked");
            }
        }

        super._update(from, to, value);

        if (to != address(0) && value > 0 && !hasRole(LOCK_EXEMPT_ROLE, to)) {
            uint64 release = _bucketedRelease(uint64(block.timestamp), lockDuration);
            _addOrMergeLock(to, value, release);
        }
    }

    // Admin-only: clear ALL existing lock buckets for an address that is lock-exempt.
    // PROBABLY TESTING ONLY
    function adminClearAllLocksForExempt(address user) external onlyRole(DEFAULT_ADMIN_ROLE) {
        require(hasRole(LOCK_EXEMPT_ROLE, user), "user not exempt");
        Lock[] storage arr = _locks[user];
        for (uint256 i = 0; i < arr.length; i++) { arr[i].amount = 0; }
        while (arr.length > 0 && arr[arr.length - 1].amount == 0) { arr.pop(); }
    }
}
