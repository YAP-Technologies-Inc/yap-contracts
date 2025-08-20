# YAP Token Contracts

## Overview

This repository contains the smart contracts for the **YAP Token ecosystem**, designed to support a language-learning application with on-chain rewards and paywalls.

---

## YapToken Contract

The YapToken is an **upgradeable ERC-20 token** with specialized mechanics for our platform:

### Features

- **Spend logic**  
  Whenever our backend relayer spends tokens on behalf of a user, **half get burned** and the other half go to the **treasury**.  
  → This is our built-in *split-and-burn* model.

- **Permit flow (EIP-2612)**  
  Users can sign approvals without gas via `permit()`.  
  The relayer then calls `permitAndSpend` to execute the burn/treasury transfer in one step.

- **Locking**  
  By default, tokens sent to a normal user address are **locked for 1 day** (rounded to midnight UTC).  
  Only treasury, cold, hot, and relayer addresses are exempt.  
  → This ensures daily rewards can’t instantly be dumped, while still allowing the backend to consume them for paywall access.

### Roles

- `DEFAULT_ADMIN_ROLE` — config + wallet rotation  
- `UPGRADER_ROLE` — controls UUPS upgrades  
- `SPENDER_ROLE` — backend relayer only  
- `LOCK_EXEMPT_ROLE` — avoids locks (treasury, cold, hot, relayer)

### Wallet Setup

- **Cold wallet** — holds the full minted supply  
- **Hot wallet** — operational distribution  
- **Treasury** — receives half of all spends  
- **Relayer** — executes spend calls with user approval  

Everything else is standard OpenZeppelin:  
ERC20, Burnable, Permit, AccessControl, UUPS.

---

## Why It’s Designed This Way

We want the token to support a **language-learning app with on-chain rewards and paywalls**:

- Users **earn YAP tokens** when completing lessons and activities.  
- When they **spend a token** (unlock premium features, daily quizzes, AI teacher, etc.),  
  → 50% is burned, 50% goes to treasury.  
- Locking prevents instant dumping of daily rewards while still enabling backend consumption for paywalls.  
- Upgradeability and role-based permissions keep governance flexible but narrow.

---

## Pre-TGE “Points” System
## WIP FEATURE

We aren’t minting the real token until **TGE**, but we need an **on-chain record** to qualify for our mainnet grant and prove activity.

### Plan

- Off-chain we track **points** (how many tokens each user *would* have earned).  
- Each day we:
  1. Take a **snapshot** of cumulative points per user.  
  2. Build a **Merkle tree**.  
  3. Post the **Merkle root on-chain** in a lightweight registry contract.  

- The **daily transaction hash** is proof of activity for the grant.  
- The **full snapshot** (address → points) is stored on IPFS/Arweave for transparency.

### At TGE

- Deploy an **AirdropClaim** contract tied to YapToken.  
- Users submit a **Merkle proof** to claim real YAP tokens according to the latest cumulative snapshot.  
- Claims pull tokens from **treasury** (with capped allowance).  
- This keeps YapToken clean, with the **points → token conversion** handled in a sidecar flow.

---

## Why This Matters for Grants

Posting daily Merkle roots gives us a **concrete on-chain footprint** of user rewards and engagement *before the token exists*.  

- This allows us to **qualify for mainnet incentive programs** without rushing TGE.  
- Once the token launches, users can **convert their points** (1:1 or another ratio we define) into real YAP via the Merkle claim.
