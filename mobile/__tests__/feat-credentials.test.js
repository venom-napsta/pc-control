import { createCredentials, KEY } from "../src/credentials";

// Plain fakes standing in for the keystore and the biometric prompt. No jest
// module mocking, so nothing depends on Babel's ESM interop.
function fakes(overrides = {}) {
  const saved = { value: null };
  const store = {
    WHEN_UNLOCKED_THIS_DEVICE_ONLY: "whenUnlockedThisDeviceOnly",
    isAvailableAsync: jest.fn(async () => true),
    getItemAsync: jest.fn(async () => saved.value),
    setItemAsync: jest.fn(async (k, v) => { saved.value = v; }),
    deleteItemAsync: jest.fn(async () => { saved.value = null; }),
    ...(overrides.store || {}),
  };
  const auth = {
    hasHardwareAsync: jest.fn(async () => true),
    isEnrolledAsync: jest.fn(async () => true),
    authenticateAsync: jest.fn(async () => ({ success: true })),
    ...(overrides.auth || {}),
  };
  return { creds: createCredentials({ store, auth }), store, auth, saved };
}

const boom = () => { throw new Error("platform module unavailable"); };

describe("biometricsAvailable", () => {
  test("needs both a sensor and an enrolled identity", async () => {
    await expect(fakes().creds.biometricsAvailable()).resolves.toBe(true);
    await expect(
      fakes({ auth: { isEnrolledAsync: async () => false } }).creds.biometricsAvailable(),
    ).resolves.toBe(false);
    await expect(
      fakes({ auth: { hasHardwareAsync: async () => false } }).creds.biometricsAvailable(),
    ).resolves.toBe(false);
  });

  test("a throwing platform module reads as unavailable, not a crash", async () => {
    await expect(
      fakes({ auth: { hasHardwareAsync: boom } }).creds.biometricsAvailable(),
    ).resolves.toBe(false);
  });
});

describe("saving", () => {
  test("the password is bound to an authentication check", async () => {
    const { creds, store } = fakes();
    await expect(creds.savePassword("hunter2")).resolves.toBe(true);
    const [key, value, options] = store.setItemAsync.mock.calls.at(-1);
    expect(key).toBe(KEY);
    expect(value).toBe("hunter2");
    expect(options.requireAuthentication).toBe(true);
    expect(options.keychainAccessible).toBe("whenUnlockedThisDeviceOnly");
  });

  test("a keystore that refuses the requirement stores nothing", async () => {
    const { creds } = fakes({ store: { setItemAsync: boom } });
    await expect(creds.savePassword("hunter2")).resolves.toBe(false);
  });

  test.each(["", null, undefined])("an empty password (%p) is never stored", async (bad) => {
    const { creds, store } = fakes();
    await expect(creds.savePassword(bad)).resolves.toBe(false);
    expect(store.setItemAsync).not.toHaveBeenCalled();
  });
});

describe("reading back", () => {
  test("hasSavedPassword reflects the keystore", async () => {
    const { creds } = fakes();
    await expect(creds.hasSavedPassword()).resolves.toBe(false);
    await creds.savePassword("hunter2");
    await expect(creds.hasSavedPassword()).resolves.toBe(true);
  });

  test("unlock prompts, then returns the password", async () => {
    const { creds, auth } = fakes();
    await creds.savePassword("hunter2");
    await expect(creds.unlockPassword()).resolves.toBe("hunter2");
    expect(auth.authenticateAsync).toHaveBeenCalled();
  });

  test("a cancelled prompt yields nothing and never reads the keystore", async () => {
    const { creds, store } = fakes({ auth: { authenticateAsync: async () => ({ success: false }) } });
    await expect(creds.unlockPassword()).resolves.toBeNull();
    expect(store.getItemAsync).not.toHaveBeenCalled();
  });

  test("a successful prompt with nothing stored yields null", async () => {
    const { creds } = fakes();
    await expect(creds.unlockPassword()).resolves.toBeNull();
  });

  test("a throwing prompt yields null rather than propagating", async () => {
    const { creds } = fakes({ auth: { authenticateAsync: boom } });
    await expect(creds.unlockPassword()).resolves.toBeNull();
  });

  test("a keystore read that throws yields null", async () => {
    const { creds } = fakes({ store: { getItemAsync: boom } });
    await expect(creds.unlockPassword()).resolves.toBeNull();
    await expect(creds.hasSavedPassword()).resolves.toBe(false);
  });
});

describe("forgetting", () => {
  test("deletes the stored password", async () => {
    const { creds, store } = fakes();
    await creds.savePassword("hunter2");
    await expect(creds.forgetPassword()).resolves.toBe(true);
    expect(store.deleteItemAsync).toHaveBeenCalledWith(KEY);
    await expect(creds.hasSavedPassword()).resolves.toBe(false);
  });

  test("reports failure without throwing", async () => {
    const { creds } = fakes({ store: { deleteItemAsync: boom } });
    await expect(creds.forgetPassword()).resolves.toBe(false);
  });
});

test("canStoreSecrets follows the platform", async () => {
  await expect(fakes().creds.canStoreSecrets()).resolves.toBe(true);
  await expect(
    fakes({ store: { isAvailableAsync: boom } }).creds.canStoreSecrets(),
  ).resolves.toBe(false);
});
