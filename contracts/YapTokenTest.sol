// SPDX-License-Identifier: MIT
pragma solidity ^0.8.22;
 
import "@openzeppelin/contracts/token/ERC20/ERC20.sol";
import "@openzeppelin/contracts/access/Ownable.sol";
 
contract YapTokenTest is ERC20, Ownable {
    constructor(address initialOwner)
        ERC20("Yap Test Token", "YAP")
        Ownable(initialOwner)
    {
        // Mint 1 million tokens to the contract deployer (with 18 decimals)
        _mint(msg.sender, 1000000 * 10 ** decimals());
    }
 
    // Function to mint new tokens (only owner)
    function mint(address to, uint256 amount) public onlyOwner {
        _mint(to, amount);
    }
 
    // Function to burn tokens
    function burn(uint256 amount) public {
        _burn(msg.sender, amount);
    }
}