import * as SecureStore from "expo-secure-store";
import * as LocalAuthentication from "expo-local-authentication";

// Remembering the Linux password so a cold start does not mean retyping it.
//
// It goes into the platform keystore (Keychain / Android Keystore), never
// AsyncStorage, and is released only after a successful biometric or device
// passcode check. Every call is wrapped: on a device with no sensor, nothing
// enrolled, or a keystore that refuses, these degrade to "not available" and
// the app falls back to typing the password.
//
// The platform modules arrive as arguments so the behaviour can be tested with
// plain fakes; `credentials` below is the instance the app uses.

export const KEY = "pc-control-password";

export function createCredentials({ store, auth }) {
  const attempt = async (fn, fallback) => {
    try {
      return await fn();
    } catch {
      return fallback;
    }
  };

  return {
    async biometricsAvailable() {
      return attempt(async () => {
        const [hasHardware, enrolled] = await Promise.all([
          auth.hasHardwareAsync(),
          auth.isEnrolledAsync(),
        ]);
        return Boolean(hasHardware && enrolled);
      }, false);
    },

    async canStoreSecrets() {
      return attempt(async () => Boolean(await store.isAvailableAsync()), false);
    },

    // True once a password is saved, so the login screen knows whether to
    // offer the unlock button at all.
    async hasSavedPassword() {
      return attempt(async () => (await store.getItemAsync(KEY)) != null, false);
    },

    async savePassword(password) {
      if (!password) return false;
      return attempt(async () => {
        await store.setItemAsync(KEY, password, {
          keychainAccessible: store.WHEN_UNLOCKED_THIS_DEVICE_ONLY,
          requireAuthentication: true,
          authenticationPrompt: "Unlock PC Control",
        });
        return true;
      }, false);
      // A device that refuses requireAuthentication returns false: better not
      // to remember the password than to store it unprotected.
    },

    async forgetPassword() {
      return attempt(async () => {
        await store.deleteItemAsync(KEY);
        return true;
      }, false);
    },

    // Prompt for fingerprint/face/passcode, then hand back the password.
    // Returns null on cancel, failure, or anything unavailable.
    async unlockPassword() {
      return attempt(async () => {
        const result = await auth.authenticateAsync({
          promptMessage: "Unlock PC Control",
          fallbackLabel: "Use device passcode",
          cancelLabel: "Cancel",
        });
        if (!result?.success) return null;
        return (await store.getItemAsync(KEY)) ?? null;
      }, null);
    },
  };
}

const credentials = createCredentials({ store: SecureStore, auth: LocalAuthentication });

export const biometricsAvailable = () => credentials.biometricsAvailable();
export const canStoreSecrets = () => credentials.canStoreSecrets();
export const hasSavedPassword = () => credentials.hasSavedPassword();
export const savePassword = (password) => credentials.savePassword(password);
export const forgetPassword = () => credentials.forgetPassword();
export const unlockPassword = () => credentials.unlockPassword();
