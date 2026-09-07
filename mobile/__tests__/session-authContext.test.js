jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));
jest.mock("expo-device", () => ({ isDevice: false, deviceName: "Galaxy Tab S11", modelName: "SM-X900" }));

import { useEffect, act } from "react";
import TestRenderer from "react-test-renderer";
import { AuthProvider, useAuth } from "../src/context/AuthContext";

global.IS_REACT_ACT_ENVIRONMENT = true;

const HEALTHY = { ok: true, service: "pc-control", host: "venom", version: "1.4.0", sessions: true };

// Each entry: { status, body } or a function receiving { headers } for
// header-dependent behaviour. Unlisted paths fall back to "*".
let routes;
let requests;

function installFetch() {
  requests = [];
  global.fetch = jest.fn(async (url, options = {}) => {
    const path = url.replace(/^https?:\/\/[^/]+/, "").split("?")[0];
    const headers = options.headers || {};
    requests.push({ path, method: options.method || "GET", headers });
    let r = routes[path] ?? routes["*"] ?? { status: 404, body: { detail: "no route" } };
    if (typeof r === "function") r = r({ headers });
    const body = r.body ?? {};
    return {
      ok: r.status < 400,
      status: r.status,
      statusText: "",
      headers: { get: (k) => r.headers?.[String(k).toLowerCase()] ?? null },
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  });
}

beforeEach(() => {
  routes = {
    "/health": { status: 200, body: HEALTHY },
    "/login": { status: 200, body: { token: "TOKEN-1", expires_in: 28800, token_header: "x-token" } },
    "/logout": { status: 200, body: { status: "logged_out", revoked: true } },
    "/status": { status: 200, body: { locked: false } },
  };
  installFetch();
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function Harness({ onAuth }) {
  const auth = useAuth();
  useEffect(() => { onAuth(auth); });
  return null;
}

async function mount() {
  let latest;
  await act(async () => {
    TestRenderer.create(<AuthProvider><Harness onAuth={(a) => { latest = a; }} /></AuthProvider>);
  });
  return () => latest;
}

async function login(auth, password = "pw") {
  await act(async () => { auth().setPassword(password); });
  await act(async () => { await auth().authenticate(); });
}

async function call(auth, ...args) {
  let outcome;
  await act(async () => {
    outcome = await auth().api(...args).then((value) => ({ value }), (error) => ({ error }));
  });
  return outcome;
}

const sent = (path) => requests.filter((r) => r.path === path);
const lastTo = (path) => sent(path).at(-1);

describe("opening a session", () => {
  test("the password is sent once, to /login, and polls carry the token", async () => {
    const auth = await mount();
    await login(auth);
    expect(auth().authenticated).toBe(true);

    // /login is the only request that carries the password, and it doubles as
    // the password check, so signing in costs exactly one authenticated call.
    expect(lastTo("/login").headers["x-pin"]).toBe("pw");
    expect(sent("/status")).toHaveLength(0);

    await call(auth, "GET", "/status");
    expect(lastTo("/status").headers["x-token"]).toBe("TOKEN-1");
    expect(lastTo("/status").headers["x-pin"]).toBeUndefined();

    await call(auth, "GET", "/stats");
    await call(auth, "GET", "/bandwidth");
    // Only the login request ever carried the account password.
    const withPin = requests.filter((r) => r.headers["x-pin"]);
    expect(withPin.map((r) => r.path)).toEqual(["/login"]);
  });

  test("the device name is offered so the PC can label the session", async () => {
    const auth = await mount();
    await login(auth);
    expect(lastTo("/login").headers["x-device"]).toBe("Galaxy Tab S11");
  });

  test("hasSession reflects whether a token is held", async () => {
    const auth = await mount();
    expect(auth().hasSession).toBe(false);
    await login(auth);
    expect(auth().hasSession).toBe(true);
  });
});

describe("destructive routes", () => {
  test.each(["/shutdown", "/reboot", "/files/delete", "/audit/clear"])(
    "%s sends the password, never the token",
    async (endpoint) => {
      routes[endpoint] = { status: 200, body: { status: "ok" } };
      const auth = await mount();
      await login(auth);
      await call(auth, "POST", endpoint, endpoint === "/files/delete" ? { path: "/x" } : null);
      expect(lastTo(endpoint).headers["x-pin"]).toBe("pw");
      expect(lastTo(endpoint).headers["x-token"]).toBeUndefined();
    },
  );
});

describe("a token that ages out", () => {
  test("is refreshed silently and the request is retried once", async () => {
    const auth = await mount();
    await login(auth);

    // The PC restarted: the old token is rejected, a fresh login succeeds.
    let served = 0;
    routes["/stats"] = ({ headers }) => {
      if (headers["x-token"] === "TOKEN-1") return { status: 401, body: { detail: "Session expired" } };
      served += 1;
      return { status: 200, body: { cpu_percent: 12 } };
    };
    routes["/login"] = { status: 200, body: { token: "TOKEN-2", expires_in: 28800 } };

    const { value, error } = await call(auth, "GET", "/stats");
    expect(error).toBeUndefined();
    expect(value).toEqual({ cpu_percent: 12 });
    expect(served).toBe(1);
    expect(sent("/login")).toHaveLength(2);
    expect(lastTo("/stats").headers["x-token"]).toBe("TOKEN-2");
    // A stale token is not a rejected password, so the user stays signed in.
    expect(auth().authenticated).toBe(true);
    expect(auth().authError).toBeNull();
  });

  test("does not sign the user out when the refresh itself fails", async () => {
    const auth = await mount();
    await login(auth);
    routes["/stats"] = { status: 401, body: { detail: "Session expired" } };
    routes["/login"] = { status: 401, body: { detail: "Invalid credentials" } };

    const { error } = await call(auth, "GET", "/stats");
    expect(error.status).toBe(401);
    // The caller sees the failure, but a stale session is never reported as a
    // wrong password.
    expect(auth().authError).toBeNull();
  });
});

describe("a genuinely rejected password", () => {
  test("signs the user out with an explanation", async () => {
    const auth = await mount();
    await login(auth);
    routes["/stats"] = { status: 401, body: { detail: "Invalid credentials" } };

    await call(auth, "GET", "/stats");
    expect(auth().authenticated).toBe(false);
    expect(auth().authError).toMatch(/Sign in again/i);
  });
});

describe("authenticate() wired straight to a React event handler", () => {
  // LoginScreen binds authenticate to onPress and onSubmitEditing, which hand
  // their synthetic event over as the first argument. An event is neither null
  // nor undefined, so `pin ?? password` picked the event and sent the string
  // "[object Object]" to PAM — "Incorrect password" for a correct password,
  // twice per press once the /status fallback ran too.
  const pressEvent = () => ({
    nativeEvent: { target: 1 },
    preventDefault() {},
    stopPropagation() {},
  });

  test("ignores a press event and sends the typed password", async () => {
    const auth = await mount();
    await act(async () => { auth().setPassword("correct-horse"); });
    await act(async () => { await auth().authenticate(pressEvent()); });

    expect(lastTo("/login").headers["x-pin"]).toBe("correct-horse");
    expect(auth().authenticated).toBe(true);
  });

  test("ignores a submit event carrying text of its own", async () => {
    const auth = await mount();
    await act(async () => { auth().setPassword("correct-horse"); });
    await act(async () => {
      await auth().authenticate({ nativeEvent: { text: "not-the-password" } });
    });

    expect(lastTo("/login").headers["x-pin"]).toBe("correct-horse");
  });

  test("never puts a stringified object on the wire", async () => {
    const auth = await mount();
    await act(async () => { auth().setPassword("correct-horse"); });
    await act(async () => { await auth().authenticate(pressEvent()); });

    const pins = requests.filter((r) => r.headers["x-pin"]).map((r) => r.headers["x-pin"]);
    expect(pins.length).toBeGreaterThan(0);
    for (const pin of pins) expect(String(pin)).not.toMatch(/\[object/);
  });

  test("still accepts an explicit password, as biometric unlock passes", async () => {
    const auth = await mount();
    await act(async () => { await auth().authenticate("from-keystore"); });
    expect(lastTo("/login").headers["x-pin"]).toBe("from-keystore");
    expect(auth().authenticated).toBe(true);
  });

  test("an empty typed password still short-circuits", async () => {
    const auth = await mount();
    await act(async () => { await auth().authenticate(pressEvent()); });
    expect(sent("/login")).toHaveLength(0);
    expect(auth().authenticated).toBe(false);
  });
});

describe("a wrong password at the login screen", () => {
  // The PC allows five failed attempts per address before locking it out for
  // 60s, doubling each strike. /login refusing the password used to return
  // null, which reads as "no sessions here" and sent the caller on to prove
  // the password against /status — a second PAM check for one typo, so three
  // sign-ins exhausted a five-attempt budget.
  test("costs exactly one authenticated request, not two", async () => {
    routes["/login"] = { status: 401, body: { detail: "Invalid credentials" } };
    const auth = await mount();
    await login(auth, "wrong");

    expect(auth().authenticated).toBe(false);
    expect(sent("/login")).toHaveLength(1);
    expect(sent("/status")).toHaveLength(0);
    const withPin = requests.filter((r) => r.headers["x-pin"]);
    expect(withPin.map((r) => r.path)).toEqual(["/login"]);
  });

  test("still explains that the password was wrong", async () => {
    routes["/login"] = { status: 401, body: { detail: "Invalid credentials" } };
    const auth = await mount();
    await login(auth, "wrong");
    expect(auth().authError).toMatch(/incorrect password/i);
  });

  test("a lockout quotes the wait from Retry-After", async () => {
    routes["/login"] = {
      status: 429,
      headers: { "retry-after": "240" },
      body: { detail: "Too many failed attempts. Try again in 240s" },
    };
    const auth = await mount();
    await login(auth, "wrong");

    expect(auth().authenticated).toBe(false);
    expect(auth().authError).toMatch(/240s/);
    // A lockout must not spend a further attempt proving the password again.
    expect(sent("/status")).toHaveLength(0);
  });

  test("a lockout without Retry-After still reads as a lockout", async () => {
    routes["/login"] = { status: 429, body: { detail: "Too many failed attempts" } };
    const auth = await mount();
    await login(auth, "wrong");
    expect(auth().authError).toMatch(/too many failed attempts/i);
    expect(sent("/status")).toHaveLength(0);
  });
});

describe("servers without session support", () => {
  test("fall back to sending the PIN on every request", async () => {
    routes["/login"] = { status: 404, body: { detail: "Not Found" } };
    const auth = await mount();
    await login(auth);
    expect(auth().authenticated).toBe(true);
    expect(auth().hasSession).toBe(false);
    // Without sessions the password is proved against /status instead.
    expect(lastTo("/status").headers["x-pin"]).toBe("pw");
  });

  test("also fall back when the server has sessions disabled", async () => {
    routes["/login"] = { status: 503, body: { detail: "Session tokens are disabled on this server" } };
    const auth = await mount();
    await login(auth);
    expect(auth().authenticated).toBe(true);
    expect(lastTo("/status").headers["x-pin"]).toBe("pw");
  });
});

describe("signing out", () => {
  test("revokes the session on the PC", async () => {
    const auth = await mount();
    await login(auth);
    await act(async () => { auth().logout(); });
    expect(lastTo("/logout").headers["x-token"]).toBe("TOKEN-1");
    expect(auth().authenticated).toBe(false);
    expect(auth().hasSession).toBe(false);
  });

  test("still signs out locally when the PC cannot be reached", async () => {
    const auth = await mount();
    await login(auth);
    routes["/logout"] = () => { throw new TypeError("Network request failed"); };
    await act(async () => { auth().logout(); });
    expect(auth().authenticated).toBe(false);
    expect(auth().hasSession).toBe(false);
  });
});

describe("authHeader", () => {
  test("hands out the token for ordinary endpoints and the password for destructive ones", async () => {
    const auth = await mount();
    await login(auth);
    // Used by requests that cannot go through api(): multipart uploads,
    // resumable downloads, image sources.
    expect(auth().authHeader("/files/upload")).toEqual({ "x-token": "TOKEN-1" });
    expect(auth().authHeader("/files/download")).toEqual({ "x-token": "TOKEN-1" });
    expect(auth().authHeader("/files/delete")).toEqual({ "x-pin": "pw" });
    expect(auth().authHeader()).toEqual({ "x-token": "TOKEN-1" });
  });

  test("falls back to the password when there is no session", async () => {
    routes["/login"] = { status: 404, body: {} };
    const auth = await mount();
    await login(auth);
    expect(auth().authHeader("/files/upload")).toEqual({ "x-pin": "pw" });
  });
});
