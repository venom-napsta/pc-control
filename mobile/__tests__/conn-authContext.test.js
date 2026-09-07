jest.mock("expo-notifications", () => ({
  getPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  requestPermissionsAsync: jest.fn(async () => ({ status: "denied" })),
  setNotificationChannelAsync: jest.fn(),
  getExpoPushTokenAsync: jest.fn(),
  AndroidImportance: { MAX: 5 },
}));
jest.mock("expo-device", () => ({ isDevice: false, deviceName: "test", modelName: "test" }));

import { useEffect, act } from "react";
import TestRenderer from "react-test-renderer";
import { AuthProvider, useAuth, SESSION_REJECTED_MESSAGE } from "../src/context/AuthContext";

global.IS_REACT_ACT_ENVIRONMENT = true;

const HEALTHY = { ok: true, service: "pc-control", host: "venom", version: "1.2.0" };
const NETWORK_FAIL = () => new TypeError("Network request failed");
const TIMEOUT = () => Object.assign(new Error("Aborted"), { name: "AbortError" });

// routes: { [path]: { status, body } | () => Error }. Unlisted paths use "*".
let routes;
function route(path) {
  return routes[path] ?? routes["*"] ?? { status: 404, body: { detail: "no route" } };
}
function installFetch() {
  global.fetch = jest.fn(async (url) => {
    const r = route(url.replace(/^https?:\/\/[^/]+/, "").split("?")[0]);
    if (typeof r === "function") throw r();
    const body = r.body ?? {};
    return {
      ok: r.status < 400,
      status: r.status,
      statusText: "",
      text: async () => JSON.stringify(body),
      json: async () => body,
    };
  });
}
const calledPaths = () => global.fetch.mock.calls.map(([url]) => url.replace(/^https?:\/\/[^/]+/, ""));

beforeEach(() => {
  routes = { "/health": { status: 200, body: HEALTHY }, "/status": { status: 200, body: { locked: false } } };
  installFetch();
  // Silence React 19's react-test-renderer deprecation notice; the renderer works.
  jest.spyOn(console, "error").mockImplementation(() => {});
  jest.spyOn(console, "log").mockImplementation(() => {});
});
afterEach(() => {
  jest.restoreAllMocks();
});

function Harness({ onAuth }) {
  const auth = useAuth();
  useEffect(() => { onAuth(auth); });
  return null;
}

async function mount() {
  let latest;
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<AuthProvider><Harness onAuth={(a) => { latest = a; }} /></AuthProvider>);
  });
  return { renderer, auth: () => latest };
}

// Run an api() call inside act and return its settled outcome.
async function call(auth, ...args) {
  let outcome;
  await act(async () => {
    outcome = await auth().api(...args).then((value) => ({ value }), (error) => ({ error }));
  });
  return outcome;
}

async function login(auth, password = "pw") {
  await act(async () => { auth().setPassword(password); });
  await act(async () => { await auth().authenticate(); });
}

describe("useAuth() shape", () => {
  test("keeps every existing field and adds connectionState/connectionError", async () => {
    const { auth } = await mount();
    const a = auth();
    for (const key of [
      "api", "password", "setPassword", "authenticated", "loading", "authenticate", "logout", "authError",
      "server", "serverInfo", "servers", "lastGood", "defaultServers",
      "addServer", "removeServer", "resetServers", "probeServers", "connect",
    ]) {
      expect(a).toHaveProperty(key);
    }
    expect(a.connectionState).toBe("unknown");
    expect(a.connectionError).toBeNull();
    expect(a.server).toBeNull();
    expect(a.authenticated).toBe(false);
  });
});

describe("connection state", () => {
  test("a successful response sets online", async () => {
    const { auth } = await mount();
    const { value, error } = await call(auth, "GET", "/status");
    expect(error).toBeUndefined();
    expect(value).toEqual({ locked: false });
    expect(auth().connectionState).toBe("online");
    expect(auth().connectionError).toBeNull();
  });

  test("a network failure sets unreachable with the explanation, then recovers", async () => {
    const { auth } = await mount();
    await call(auth, "GET", "/status");
    const server = auth().server;
    expect(server).toBeTruthy();

    routes = { "*": NETWORK_FAIL };
    const { error } = await call(auth, "GET", "/status");
    expect(error).toMatchObject({ kind: "unreachable", method: "GET", endpoint: "/status" });
    expect(auth().connectionState).toBe("unreachable");
    expect(auth().connectionError).toBe(error.message);
    expect(auth().connectionError).toMatch(/Can't reach the PC at/);

    routes = { "/health": { status: 200, body: HEALTHY }, "/status": { status: 200, body: { locked: true } } };
    const ok = await call(auth, "GET", "/status");
    expect(ok.value).toEqual({ locked: true });
    expect(auth().connectionState).toBe("online");
    expect(auth().connectionError).toBeNull();
  });

  test("a timeout sets unreachable too", async () => {
    const { auth } = await mount();
    await call(auth, "GET", "/status");
    routes = { "*": TIMEOUT };
    const { error } = await call(auth, "GET", "/status", null, { timeoutMs: 3000 });
    expect(error.kind).toBe("timeout");
    expect(auth().connectionState).toBe("unreachable");
    expect(auth().connectionError).toMatch(/No answer from the PC at .* in 3s/);
  });

  test("HTTP errors leave the PC online: it answered", async () => {
    const { auth } = await mount();
    await call(auth, "GET", "/status");
    routes["/status"] = { status: 500, body: { detail: "boom" } };
    const { error } = await call(auth, "GET", "/status");
    expect(error).toMatchObject({ status: 500, message: "500 — boom" });
    expect(error.kind).toBeUndefined();
    expect(auth().connectionState).toBe("online");
    expect(auth().connectionError).toBeNull();
  });

  test("a mid-session failure followed by a successful reconnect goes back online", async () => {
    const { auth } = await mount();
    await call(auth, "GET", "/status");
    // Only the request fails; the health probe still answers, so reconnect()
    // finds the PC again straight away.
    routes["/status"] = NETWORK_FAIL;
    const { error } = await call(auth, "GET", "/status");
    expect(error.kind).toBe("unreachable");
    // Let the fire-and-forget reconnect settle.
    await act(async () => { await Promise.resolve(); await Promise.resolve(); });
    expect(auth().connectionState).toBe("online");
    expect(auth().connectionError).toBeNull();
  });
});

describe("api() without an active server", () => {
  test("looks for a server first and uses it instead of failing", async () => {
    const { auth } = await mount();
    expect(auth().server).toBeNull();
    const { value } = await call(auth, "GET", "/status");
    expect(value).toEqual({ locked: false });
    const paths = calledPaths();
    expect(paths[0]).toBe("/health");
    expect(paths[paths.length - 1]).toBe("/status");
    expect(auth().server).toBeTruthy();
    expect(auth().serverInfo).toMatchObject({ host: "venom", version: "1.2.0" });
    // The request went to the server the probe found.
    expect(global.fetch.mock.calls[paths.length - 1][0]).toBe(`${auth().server}/status`);
  });

  test("a burst of requests probes once and all use the result", async () => {
    const { auth } = await mount();
    let results;
    await act(async () => {
      results = await Promise.all([
        auth().api("GET", "/status"), auth().api("GET", "/status"), auth().api("GET", "/status"),
      ]);
    });
    expect(results).toHaveLength(3);
    const healthCalls = calledPaths().filter((p) => p === "/health").length;
    expect(healthCalls).toBe(auth().servers.length);
    expect(calledPaths().filter((p) => p === "/status")).toHaveLength(3);
  });

  test("throws unreachable when nothing answers", async () => {
    const { auth } = await mount();
    routes = { "*": NETWORK_FAIL };
    const { error } = await call(auth, "GET", "/status");
    expect(error.kind).toBe("unreachable");
    expect(error.message).toMatch(/didn't answer|None of the .* saved addresses answered/);
    expect(calledPaths()).not.toContain("/status");
    expect(auth().connectionState).toBe("unreachable");
    expect(auth().connectionError).toBe(error.message);
  });
});

describe("401 handling", () => {
  test("during login it is just a wrong password", async () => {
    const { auth } = await mount();
    routes["/status"] = { status: 401, body: { detail: "Invalid credentials" } };
    await login(auth, "wrong");
    expect(auth().authenticated).toBe(false);
    expect(auth().authError).toBe("Incorrect password");
    expect(auth().password).toBe("wrong");
    expect(auth().connectionState).toBe("online");
  });

  test("mid-session it logs out and explains why, and still throws", async () => {
    const { auth } = await mount();
    await login(auth);
    expect(auth().authenticated).toBe(true);
    expect(auth().authError).toBeNull();
    expect(auth().connectionState).toBe("online");

    routes["/status"] = { status: 401, body: { detail: "Invalid credentials" } };
    const { error } = await call(auth, "GET", "/status");
    expect(error).toMatchObject({ status: 401, message: "401 — Invalid credentials" });
    expect(auth().authenticated).toBe(false);
    expect(auth().password).toBe("");
    expect(auth().authError).toBe(SESSION_REJECTED_MESSAGE);
    expect(SESSION_REJECTED_MESSAGE).toBe("Password rejected by the PC. Sign in again.");
    // The PC answered, so it is still reachable.
    expect(auth().connectionState).toBe("online");
  });

  test("other HTTP errors mid-session keep the session", async () => {
    const { auth } = await mount();
    await login(auth);
    routes["/status"] = { status: 503, body: { detail: "busy" } };
    const { error } = await call(auth, "GET", "/status");
    expect(error.status).toBe(503);
    expect(auth().authenticated).toBe(true);
    expect(auth().authError).toBeNull();
  });
});
