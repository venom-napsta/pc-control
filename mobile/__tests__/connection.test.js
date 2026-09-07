import { probeServer, firstReachable, probeAll } from "../src/connection";

const HEALTHY = { ok: true, service: "pc-control", host: "venom", version: "1.2.0" };

// behaviours: { [urlPrefix]: { delay, status, body } | { delay, fail: true } | { hang: true } }
function mockFetch(behaviours) {
  global.fetch = jest.fn((url, { signal } = {}) => new Promise((resolve, reject) => {
    const key = Object.keys(behaviours).find((k) => url.startsWith(k));
    const b = behaviours[key] || { fail: true };
    const abort = () => reject(Object.assign(new Error("Aborted"), { name: "AbortError" }));
    if (signal) {
      if (signal.aborted) return abort();
      signal.addEventListener("abort", abort);
    }
    if (b.hang) return undefined;
    return setTimeout(() => {
      if (b.fail) reject(new TypeError("Network request failed"));
      else resolve({
        ok: (b.status ?? 200) < 400,
        status: b.status ?? 200,
        json: async () => b.body ?? HEALTHY,
      });
    }, b.delay ?? 0);
  }));
}

beforeEach(() => jest.useFakeTimers());
afterEach(() => jest.useRealTimers());

describe("probeServer", () => {
  test("reports a healthy PC Control server with latency", async () => {
    mockFetch({ "http://a:2000": { delay: 25 } });
    const p = probeServer("http://a:2000", 1000);
    await jest.advanceTimersByTimeAsync(25);
    const r = await p;
    expect(r).toMatchObject({ url: "http://a:2000", ok: true, host: "venom", version: "1.2.0" });
    expect(r.latencyMs).toBeGreaterThanOrEqual(25);
    expect(global.fetch).toHaveBeenCalledWith("http://a:2000/health", expect.objectContaining({ method: "GET" }));
  });

  test("times out an address that never answers", async () => {
    mockFetch({ "http://dead:2000": { hang: true } });
    const p = probeServer("http://dead:2000", 500);
    await jest.advanceTimersByTimeAsync(500);
    expect(await p).toMatchObject({ ok: false, timedOut: true, reason: "timed out" });
  });

  test("treats a refused connection as unreachable", async () => {
    mockFetch({ "http://x:2000": { fail: true } });
    const p = probeServer("http://x:2000", 500);
    await jest.advanceTimersByTimeAsync(0);
    expect(await p).toMatchObject({ ok: false, timedOut: false, reason: "unreachable" });
  });

  test("rejects something that answers but is not PC Control", async () => {
    mockFetch({ "http://router:2000": { body: { ok: true, service: "some-router" } } });
    const p = probeServer("http://router:2000", 500);
    await jest.advanceTimersByTimeAsync(0);
    expect(await p).toMatchObject({ ok: false, reason: "not a PC Control server" });
  });

  test("treats HTTP errors as unhealthy", async () => {
    mockFetch({ "http://x:2000": { status: 503 } });
    const p = probeServer("http://x:2000", 500);
    await jest.advanceTimersByTimeAsync(0);
    expect(await p).toMatchObject({ ok: false, reason: "HTTP 503" });
  });

  test("never throws", async () => {
    global.fetch = jest.fn(() => { throw new Error("boom"); });
    await expect(probeServer("http://x:2000", 500)).resolves.toMatchObject({ ok: false });
  });
});

describe("firstReachable", () => {
  test("picks the fastest healthy address, not the first listed", async () => {
    mockFetch({ "http://slow:2000": { delay: 300 }, "http://fast:2000": { delay: 50 } });
    const p = firstReachable(["http://slow:2000", "http://fast:2000"], 1000);
    await jest.advanceTimersByTimeAsync(60);
    expect((await p).url).toBe("http://fast:2000");
  });

  test("skips failures and dead addresses", async () => {
    mockFetch({
      "http://refused:2000": { fail: true },
      "http://dead:2000": { hang: true },
      "http://ok:2000": { delay: 100 },
    });
    const p = firstReachable(["http://refused:2000", "http://dead:2000", "http://ok:2000"], 1000);
    await jest.advanceTimersByTimeAsync(100);
    expect((await p).url).toBe("http://ok:2000");
  });

  test("resolves null when nothing answers", async () => {
    mockFetch({ "http://a:2000": { fail: true }, "http://b:2000": { hang: true } });
    const p = firstReachable(["http://a:2000", "http://b:2000"], 400);
    await jest.advanceTimersByTimeAsync(400);
    expect(await p).toBeNull();
  });

  test("resolves null immediately with no candidates", async () => {
    mockFetch({});
    await expect(firstReachable([], 400)).resolves.toBeNull();
    expect(global.fetch).not.toHaveBeenCalled();
  });

  test("probes each unique address once", async () => {
    mockFetch({ "http://a:2000": { delay: 10 } });
    const p = firstReachable(["http://a:2000", "http://a:2000", "http://a:2000"], 400);
    await jest.advanceTimersByTimeAsync(10);
    await p;
    expect(global.fetch).toHaveBeenCalledTimes(1);
  });
});

describe("probeAll", () => {
  test("returns one result per address, in order", async () => {
    mockFetch({ "http://a:2000": { delay: 10 }, "http://b:2000": { fail: true } });
    const p = probeAll(["http://a:2000", "http://b:2000", "http://c:2000"], 200);
    await jest.advanceTimersByTimeAsync(200);
    const rs = await p;
    expect(rs.map((r) => [r.url, r.ok])).toEqual([
      ["http://a:2000", true], ["http://b:2000", false], ["http://c:2000", false],
    ]);
  });
});
