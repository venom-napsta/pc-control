import { requiresPin, isSessionExpired, SESSION_EXPIRED_DETAIL } from "../src/session";

describe("requiresPin", () => {
  test.each(["/shutdown", "/reboot", "/files/delete", "/audit/clear", "/sessions/revoke-all"])(
    "%s must carry the password, never a token",
    (endpoint) => {
      expect(requiresPin(endpoint)).toBe(true);
    },
  );

  test.each([
    "/status", "/stats", "/bandwidth", "/volume", "/files", "/clipboard",
    "/screenshot", "/webcam/status", "/audit", "/register-token", "/lock", "/unlock",
  ])("%s may use a session token", (endpoint) => {
    expect(requiresPin(endpoint)).toBe(false);
  });

  test("query strings and trailing slashes do not change the decision", () => {
    expect(requiresPin("/files/delete?force=1")).toBe(true);
    expect(requiresPin("/shutdown/")).toBe(true);
    expect(requiresPin("/files?path=/home/napsta")).toBe(false);
  });

  test("a path that merely starts the same is not treated as destructive", () => {
    expect(requiresPin("/files/download")).toBe(false);
    expect(requiresPin("/audit")).toBe(false);
    expect(requiresPin("/shutdownx")).toBe(false);
  });

  test.each([null, undefined, "", 42])("junk input %p is not destructive", (bad) => {
    expect(requiresPin(bad)).toBe(false);
  });
});

describe("isSessionExpired", () => {
  test("only a 401 carrying the server's detail counts", () => {
    expect(isSessionExpired(401, SESSION_EXPIRED_DETAIL)).toBe(true);
    expect(isSessionExpired(401, "401 — Session expired")).toBe(true);
    expect(isSessionExpired(401, "Invalid credentials")).toBe(false);
    expect(isSessionExpired(403, SESSION_EXPIRED_DETAIL)).toBe(false);
    expect(isSessionExpired(401, null)).toBe(false);
  });
});
