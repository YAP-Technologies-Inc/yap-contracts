
##TOKEN-V2 Branch audit please

# YAP Token Test Contract

This repository contains the smart contract and deployment setup for testing the **YAP Token** on the **Sei EVM Testnet**. It uses **Hardhat** and **OpenZeppelin** to create an **ERC20-compliant token** with minting and burning functionality. This is intended for **testnet usage only** during MVP development.

---

## Setup Instructions

### 1. Install dependencies
npm install


### 2. Create `.env` file

In the root directory, create a `.env` file with your testnet wallet’s private key:


PRIVATE_KEY=your_private_key_here

Make sure `.env` is included in your `.gitignore` to avoid exposing sensitive information.

---

## Deployment

To deploy the contract to Sei Testnet:

npx hardhat ignition deploy ./ignition/modules/deploy-yap-token.ts --network seitestnet

> Ensure your wallet has SEI testnet tokens for gas fees.

---

## Run Tests

To run unit tests for the token contract:

npx hardhat test

---

## Project Structure

- **Solidity Version**: `^0.8.28`
- **Contracts**: Located in `./contracts`
- **Deployment Script**: Located in `./ignition/modules/deploy-yap-token.ts`
- **Minting**: Only the contract owner can mint new tokens
- **Initial Supply**: 1,000,000 tokens are minted to the deployer on contract deployment

---

## Purpose

This project is for **testnet experimentation and integration with the YAP frontend MVP**. Token behavior like minting, transfers, and ownership can be tested and verified on the [Sei testnet explorer](https://sei.explorers.guru/).
