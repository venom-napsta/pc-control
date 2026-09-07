import {
  reduceConnection, INITIAL_CONNECTION, CONNECTION_STATES, NETWORK_ERROR_KINDS, isNetworkErrorKind,
} from "../src/connectionState";

const MSG = "Can't reach the PC at 100.64.0.1:2000. Open Tailscale on this device and check it's connected.";

describe("reduceConnection", () => {
  test("starts unknown with no error", () => {
    expect(INITIAL_CONNECTION).toEqual({ state: "unknown", error: null });
  });

  test("any successful response marks the PC online", () => {
    expect(reduceConnection(INITIAL_CONNECTION, { type: "success" }))
      .toEqual({ state: "online", error: null });
  });

  test("a network failure marks it unreachable and keeps the explanation", () => {
    expect(reduceConnection(INITIAL_CONNECTION, { type: "failure", kind: "unreachable", message: MSG }))
      .toEqual({ state: "unreachable", error: MSG });
  });

  test("a timeout counts as unreachable", () => {
    const next = reduceConnection(
      { state: "online", error: null },
      { type: "failure", kind: "timeout", message: "No answer from the PC in 10s." },
    );
    expect(next).toEqual({ state: "unreachable", error: "No answer from the PC in 10s." });
  });

  test("HTTP errors do not change reachability: the PC answered", () => {
    const online = { state: "online", error: null };
    expect(reduceConnection(online, { type: "failure", kind: null, message: "401 — Invalid credentials" })).toBe(online);
    expect(reduceConnection(online, { type: "failure", kind: undefined, message: "500" })).toBe(online);
    expect(reduceConnection(INITIAL_CONNECTION, { type: "failure", message: "500" })).toBe(INITIAL_CONNECTION);
  });

  test("a successful reconnect brings it back online and clears the error", () => {
    const down = { state: "unreachable", error: MSG };
    expect(reduceConnection(down, { type: "reconnected" })).toEqual({ state: "online", error: null });
    expect(reduceConnection(down, { type: "success" })).toEqual({ state: "online", error: null });
  });

  test("a later failure replaces the stored message", () => {
    const down = { state: "unreachable", error: MSG };
    const next = reduceConnection(down, { type: "failure", kind: "timeout", message: "No answer in 10s." });
    expect(next.error).toBe("No answer in 10s.");
  });

  test("a failure without a message still explains itself", () => {
    const next = reduceConnection(INITIAL_CONNECTION, { type: "failure", kind: "unreachable" });
    expect(next.state).toBe("unreachable");
    expect(typeof next.error).toBe("string");
    expect(next.error.length).toBeGreaterThan(0);
  });

  test("returns the same object when nothing changes, so setState can bail out", () => {
    const online = { state: "online", error: null };
    expect(reduceConnection(online, { type: "success" })).toBe(online);
    expect(reduceConnection(online, { type: "reconnected" })).toBe(online);
    const down = { state: "unreachable", error: MSG };
    expect(reduceConnection(down, { type: "failure", kind: "unreachable", message: MSG })).toBe(down);
  });

  test("reset returns to the initial state", () => {
    expect(reduceConnection({ state: "online", error: null }, { type: "reset" })).toBe(INITIAL_CONNECTION);
    expect(reduceConnection(INITIAL_CONNECTION, { type: "reset" })).toBe(INITIAL_CONNECTION);
  });

  test("unknown or missing events are ignored", () => {
    const online = { state: "online", error: null };
    expect(reduceConnection(online, { type: "nonsense" })).toBe(online);
    expect(reduceConnection(online, undefined)).toBe(online);
    expect(reduceConnection(undefined, undefined)).toBe(INITIAL_CONNECTION);
  });

  test("only ever produces the three documented states", () => {
    const events = [
      { type: "success" }, { type: "failure", kind: "timeout", message: "t" }, { type: "reconnected" },
      { type: "failure", kind: "unreachable", message: "u" }, { type: "failure", kind: null, message: "500" },
      { type: "reset" }, { type: "bogus" }, { type: "success" },
    ];
    let s = INITIAL_CONNECTION;
    for (const e of events) {
      s = reduceConnection(s, e);
      expect(CONNECTION_STATES).toContain(s.state);
      expect(s.error === null || typeof s.error === "string").toBe(true);
      if (s.state !== "unreachable") expect(s.error).toBeNull();
    }
  });
});

describe("isNetworkErrorKind", () => {
  test.each(NETWORK_ERROR_KINDS)("%s is a network kind", (kind) => {
    expect(isNetworkErrorKind(kind)).toBe(true);
  });
  test.each([null, undefined, "", "http", "auth", 401])("%p is not", (kind) => {
    expect(isNetworkErrorKind(kind)).toBe(false);
  });
});
