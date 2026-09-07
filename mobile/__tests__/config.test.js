import {
  connectionFailureMessage, noServerMessage, isTimeoutError, isNetworkError,
  fetchWithTimeout, hasInternet, DEFAULT_SERVERS, NO_INTERNET_MESSAGE,
} from "../src/config";

const abortError = () => Object.assign(new Error("Aborted"), { name: "AbortError" });
const netError = () => new TypeError("Network request failed");
const TS = "http://venom.tailnet.ts.net:2000";
const LAN = "http://192.168.1.10:2000";

describe("error predicates", () => {
  test("isTimeoutError", () => {
    expect(isTimeoutError(abortError())).toBe(true);
    expect(isTimeoutError(new Error("The operation was aborted"))).toBe(true);
    expect(isTimeoutError(netError())).toBe(false);
    expect(isTimeoutError(null)).toBe(false);
  });
  test("isNetworkError", () => {
    expect(isNetworkError(netError())).toBe(true);
    expect(isNetworkError(new Error("Network request failed"))).toBe(false);
    expect(isNetworkError(new TypeError("something else"))).toBe(false);
  });
});

describe("connectionFailureMessage", () => {
  test("timeout over Tailscale points at Tailscale", () => {
    const msg = connectionFailureMessage(abortError(), { timeoutMs: 8000, server: TS });
    expect(msg).toMatch(/No answer from the PC at venom\.tailnet\.ts\.net:2000 in 8s/);
    expect(msg).toMatch(/Tailscale/);
  });
  test("refused connection on the LAN asks about the network, not Tailscale", () => {
    const msg = connectionFailureMessage(netError(), { server: LAN });
    expect(msg).toMatch(/Can't reach the PC at 192\.168\.1\.215:2000/);
    expect(msg).toMatch(/same network/);
    expect(msg).not.toMatch(/Tailscale/);
  });
  test("works without knowing the address", () => {
    expect(connectionFailureMessage(netError())).toMatch(/^Can't reach the PC\./);
  });
  test("other errors are passed through", () => {
    expect(connectionFailureMessage(new Error("boom"))).toBe("Network error: boom");
  });
});

describe("noServerMessage", () => {
  test("mentions the count and Tailscale when a Tailscale address is saved", () => {
    const msg = noServerMessage([TS, LAN, "http://10.42.0.1:2000"]);
    expect(msg).toMatch(/None of the 3 saved addresses answered/);
    expect(msg).toMatch(/Tailscale/);
  });
  test("single address wording", () => {
    expect(noServerMessage([LAN])).toMatch(/^The saved address didn't answer/);
  });
  test("without Tailscale it points at Server settings", () => {
    expect(noServerMessage([LAN])).toMatch(/Server settings/);
  });
  test("NO_INTERNET_MESSAGE names the real cause", () => {
    expect(NO_INTERNET_MESSAGE).toMatch(/no internet/);
  });
});

describe("fetchWithTimeout", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("aborts a hanging request after the timeout", async () => {
    global.fetch = jest.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(abortError()));
    }));
    const p = fetchWithTimeout("http://x/health", {}, 300);
    const assertion = expect(p).rejects.toMatchObject({ name: "AbortError" });
    await jest.advanceTimersByTimeAsync(300);
    await assertion;
  });

  test("passes the response through and clears the timer on success", async () => {
    global.fetch = jest.fn(async () => ({ ok: true, status: 200 }));
    await expect(fetchWithTimeout("http://x/health", { method: "GET" }, 300)).resolves.toMatchObject({ status: 200 });
    expect(jest.getTimerCount()).toBe(0);
    expect(global.fetch).toHaveBeenCalledWith("http://x/health", expect.objectContaining({ method: "GET", signal: expect.any(Object) }));
  });
});

describe("hasInternet", () => {
  beforeEach(() => jest.useFakeTimers());
  afterEach(() => jest.useRealTimers());

  test("true when the probe answers", async () => {
    global.fetch = jest.fn(async () => ({ status: 204 }));
    await expect(hasInternet()).resolves.toBe(true);
    expect(global.fetch.mock.calls[0][0]).toMatch(/^https:\/\/www\.gstatic\.com\/generate_204\?t=\d+$/);
  });
  test("false when the probe fails", async () => {
    global.fetch = jest.fn(async () => { throw new TypeError("Network request failed"); });
    await expect(hasInternet()).resolves.toBe(false);
  });
  test("false when the probe hangs", async () => {
    global.fetch = jest.fn((url, { signal }) => new Promise((_, reject) => {
      signal.addEventListener("abort", () => reject(abortError()));
    }));
    const p = hasInternet(1000);
    await jest.advanceTimersByTimeAsync(1000);
    await expect(p).resolves.toBe(false);
  });
});

test("DEFAULT_SERVERS is a non-empty list of normalized URLs", () => {
  expect(DEFAULT_SERVERS.length).toBeGreaterThan(0);
  for (const url of DEFAULT_SERVERS) expect(url).toMatch(/^https?:\/\/[^/]+:\d+$/);
});
