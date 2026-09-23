# NeXaVerSe Phase 11 — Safe 3-of-5 Hardware Multisig Ceremony Runbook

> **Author:** Ayuba Garba (`Principal Product Architect, Security Engineering Lead & Web3 Security Coordinator`)  
> **Repository:** `BrightQueen2024/NeXaVerSe.MVP`  
> **Classification:** OPERATIONAL GOVERNANCE & PROTOCOL SECURITY STANDARD  
> **Target Deployment:** Arbitrum One Mainnet (Chain ID 42161)  
> **Governance Quorum:** 3-of-5 Standard Execution / 2-of-5 Emergency Protocol Pause  

---

## 1. Overview & Objective

This runbook specifies the protocol for conducting the **Air-Gapped Safe 3-of-5 Hardware Multisig Key Generation and Verification Ceremony**.

The Safe multisig will assume absolute on-chain ownership of all NeXaVerSe smart contracts:
- `NexEscrow.sol` (escrow holds and mediator actions)
- `NeXacoin.sol` (token parameter adjustments, minter roles)
- `NexaStaking.sol` (yield distributions, staking tier definitions)

**Core Security Mandate:** No private key for any of the five governance signers may ever touch an internet-connected device, cloud storage, browser extension, or mobile wallet.

---

## 2. Designated Signers & Hardware Allocation

To ensure defense-in-depth against single-vendor hardware supply chain attacks, signers use diverse, verified hardware from multiple manufacturers:

| Signer # | Role Description | Hardware Device | Manufacturer Diversity | Backup Storage Medium |
| :---: | :--- | :---: | :---: | :--- |
| **Signer 1** | Principal Product Lead | **Ledger Stax** | Ledger (CC EAL6+) | Stainless Steel Punched Plate (Vault A) |
| **Signer 2** | Lead Systems Architect | **Ledger Nano X** | Ledger (CC EAL5+) | Stainless Steel Punched Plate (Vault B) |
| **Signer 3** | Security Engineering Lead | **Trezor Safe 3** | Trezor (Secure Element) | Titanium Capsule (Vault C) |
| **Signer 4** | Infrastructure / SRE Lead | **Trezor Model T** | Trezor (Open Source HW) | Stainless Steel Punched Plate (Vault D) |
| **Signer 5** | Compliance & Legal Arbiter | **GridPlus Lattice1** | GridPlus (Tamper-Resistant) | Stainless Steel Punched Plate (Vault E) |

---

## 3. Pre-Ceremony Checklist (Phase 0)

1. **Hardware Verification:**
   - Inspect all five devices for physical tampering or broken seals.
   - Verify official vendor firmware cryptographic hashes using air-gapped checksum verification.
2. **Environment Isolation:**
   - Conduct key generation in an RF-shielded / Faraday environment or air-gapped room with zero external wireless transmission.
   - Prohibit all smartphones, smart watches, recording devices, or internet-connected cameras in the ceremony room.
3. **Materials Required:**
   - 5x Factory-sealed hardware wallets.
   - 5x Cryptosteel / stamped stainless steel backup plates.
   - 2x Air-gapped laptops booted from read-only live Linux OS (Tails OS / Debian Minimal).

---

## 4. Key Generation Protocol (Phase 1)

For each signer sequentially:

1. **Initialization:**
   - Connect hardware wallet to air-gapped machine using USB power only (data lines severed or machine offline).
   - Configure a strong 8-digit device PIN.
2. **Entropy Collection:**
   - Generate standard 24-word BIP-39 mnemonic seed using the device's internal true random number generator (TRNG) supplemented by physical dice entropy if supported.
3. **Physical Backup:**
   - Manually stamp the 24 words onto the stainless steel plate.
   - Do NOT write down words on paper.
   - Do NOT take photographs or transcribe into any digital file.
4. **Seed Verification:**
   - Perform the device's onboard recovery check to verify that the stamped seed phrase successfully restores the generated key.
5. **Address Derivation:**
   - Derive the primary Ethereum address (`m/44'/60'/0'/0/0`).
   - Export public address (`0x...`) via QR code displayed on the hardware screen.
   - Sign a standardized attestation message on-device:
     ```text
     "NeXaVerSe Governance Signer # [N] Attestation - Nonce [Hex]"
     ```

---

## 5. Safe 3-of-5 On-Chain Deployment (Phase 2)

Once all five public addresses are verified and cross-signed:

```bash
# Example deployment parameter verification payload (JSON)
{
  "owners": [
    "0xSigner1Address...",
    "0xSigner2Address...",
    "0xSigner3Address...",
    "0xSigner4Address...",
    "0xSigner5Address..."
  ],
  "threshold": 3,
  "timelockDelaySeconds": 172800, // 48 Hours
  "emergencyPauseThreshold": 2
}
```

### Steps:
1. **Deploy Timelock Controller:**
   - Deploy OpenZeppelin `TimelockController` on Arbitrum One Mainnet with `minDelay = 172800` (48 hours).
   - Grant `PROPOSER_ROLE` and `EXECUTOR_ROLE` strictly to the Safe multisig contract.
2. **Deploy Safe Proxy:**
   - Deploy official Safe v1.4.1 singleton proxy using the deterministic Safe Factory on Arbitrum One.
   - Initialize with the 5 verified signer addresses and `threshold = 3`.
3. **Deploy Emergency Pauser Module:**
   - Attach emergency pause module enabling 2-of-5 signers to call `emergencyPause()` on `NexEscrow` in the event of an active zero-day attack.

---

## 6. Ownership Handover & Burn of Hot Deployer (Phase 3)

1. **Transfer Smart Contract Ownership:**
   ```solidity
   // In NexEscrow, NeXacoin, NexaStaking:
   transferOwnership(safeMultisigTimelockAddress);
   ```
2. **Accept Ownership:**
   - Safe 3-of-5 executes `acceptOwnership()` via the 48-hour timelock controller.
3. **Verify Zero Hot Admin:**
   - Query `owner()` across all three contracts on-chain to confirm owner equals `safeMultisigTimelockAddress`.
   - Confirm deployer wallet EOA has **zero administrative privileges**.

---

## 7. Post-Ceremony Dry-Run & Verification (Phase 4)

1. **Simulated Transaction Proposal:**
   - Propose an arbitrary zero-value test transaction on the Safe Web App.
2. **Signature Collection:**
   - Signer 1 connects Ledger Stax and signs hash on hardware.
   - Signer 2 connects Ledger Nano X and signs hash on hardware.
   - Signer 3 connects Trezor Safe 3 and signs hash on hardware.
3. **Execution:**
   - Submit 3 valid signatures to Arbitrum One. Verify on Arbiscan that transaction executes cleanly under quorum.
4. **Emergency Pause Test:**
   - Simulate 2-of-5 emergency pause dry run on testnet before final sign-off.

---

## 8. Incident & Key Loss Protocols

- **Loss of 1 Hardware Key:**
  - The remaining 4 signers convene within 24 hours.
  - Submit `swapOwner(prevOwner, oldKey, newKey)` through the 48-hour timelock.
- **Loss of 2 Hardware Keys:**
  - The remaining 3 signers immediately execute emergency quorum to rotate the lost keys.
- **Compromise Alert:**
  - If any key's physical metal plate is tampered with, the key is declared compromised immediately, triggering emergency replacement.

---

## 9. Ceremony Sign-Off Checklist

- [ ] All 5 signers physically present or connected via secure video attestation.
- [ ] 5 hardware devices verified genuine via manufacturer cryptographic attestation.
- [ ] 5 stainless steel seed backups safely secured in geographic cold storage.
- [ ] Safe 3-of-5 deployed and verified on Arbiscan block explorer.
- [ ] 48-hour Timelock verified active.
- [ ] All smart contracts transferred to Safe. Hot deployer privileges completely revoked.
