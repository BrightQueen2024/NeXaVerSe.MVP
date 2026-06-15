import * as LocalAuthentication from 'expo-local-authentication';
import * as SecureStore from 'expo-secure-store';
import { Platform } from 'react-native';

/**
 * Service to manage biometric authentication and Secure Enclave key storage on mobile device.
 */
export class BiometricWalletService {
  private static readonly WALLET_SEED_KEY = 'nexa_wallet_private_seed';
  private static mockMemoryStore: Record<string, string> = {};

  /**
   * Checks if biometric hardware is present and user has enrolled FaceID/Fingerprints.
   */
  static async isBiometricsAvailable(): Promise<{ supported: boolean; enrolled: boolean }> {
    if (Platform.OS === 'web') {
      return { supported: true, enrolled: true };
    }
    try {
      const hasHardware = await LocalAuthentication.hasHardwareAsync();
      const isEnrolled = await LocalAuthentication.isEnrolledAsync();
      return {
        supported: hasHardware,
        enrolled: isEnrolled
      };
    } catch (e) {
      return { supported: false, enrolled: false };
    }
  }

  /**
   * Prompts the user for biometric authorization.
   */
  static async authenticate(): Promise<boolean> {
    if (Platform.OS === 'web') {
      // Simulate web biometric approval
      return true;
    }
    const { supported, enrolled } = await this.isBiometricsAvailable();
    if (!supported || !enrolled) {
      console.warn('Biometrics not configured or supported on this device.');
      return false;
    }

    const result = await LocalAuthentication.authenticateAsync({
      promptMessage: 'Authorize NeXaVerSe Transaction',
      fallbackLabel: 'Use Passcode',
      disableDeviceFallback: false,
    });

    return result.success;
  }

  /**
   * Generates and stores a private key seed inside Secure Store (backed by Secure Enclave / Keystore).
   * Gated by biometric authentication.
   */
  static async createSecuredWallet(): Promise<string | null> {
    const isAuthenticated = await this.authenticate();
    if (!isAuthenticated) {
      throw new Error('Biometric authorization failed. Cannot create wallet.');
    }

    // Simulate generating a high-entropy private key seed
    const mockSeed = '0x' + Array.from({ length: 64 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

    // Save key securely with encryption or fallback
    try {
      const isSecureAvailable = await SecureStore.isAvailableAsync();
      if (isSecureAvailable) {
        await SecureStore.setItemAsync(this.WALLET_SEED_KEY, mockSeed, {
          keychainAccessible: SecureStore.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
        });
      } else {
        this.mockMemoryStore[this.WALLET_SEED_KEY] = mockSeed;
      }
    } catch (e) {
      this.mockMemoryStore[this.WALLET_SEED_KEY] = mockSeed;
    }

    // Derive mock public key address
    const mockAddress = '0x' + mockSeed.substring(2, 42);
    return mockAddress;
  }

  /**
   * Signs a transaction hash. Requires active biometric approval.
   */
  static async signTransaction(txHash: string): Promise<string> {
    const isAuthenticated = await this.authenticate();
    if (!isAuthenticated) {
      throw new Error('Biometric signature authorization rejected.');
    }

    let seed: string | null = null;
    try {
      const isSecureAvailable = await SecureStore.isAvailableAsync();
      if (isSecureAvailable) {
        seed = await SecureStore.getItemAsync(this.WALLET_SEED_KEY);
      } else {
        seed = this.mockMemoryStore[this.WALLET_SEED_KEY] || null;
      }
    } catch (e) {
      seed = this.mockMemoryStore[this.WALLET_SEED_KEY] || null;
    }

    if (!seed) {
      throw new Error('No secured wallet found on this device.');
    }

    // Simulate signing the txHash using the stored private key seed (ECDSA signature)
    const mockSignature = `0x-sig-sha256-hash-${txHash}-signed-by-${seed.substring(0, 10)}`;
    return mockSignature;
  }
}

