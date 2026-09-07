import { fetchParts, splitParts, partFailed, PART_ENDPOINTS } from "../src/snapshot";

const err = (status) => Object.assign(new Error(`HTTP ${status}`), { status });

describe("partFailed", () => {
  test.each([
    [{ locked: false }, false],
    [{ cpu_percent: 0 }, false],
    [{ error: "wpctl is not installed on the PC", status: 503 }, true],
    [null, true],
    [undefined, true],
    ["nope", true],
  ])("%p -> %p", (value, expected) => {
    expect(partFailed(value)).toBe(expected);
  });
});

describe("splitParts", () => {
  test("separates usable parts from failed ones", () => {
    const body = {
      status: { locked: true },
      volume: { error: "wpctl is not installed on the PC", status: 503 },
    };
    expect(splitParts(body, ["status", "volume"])).toEqual({
      values: { status: { locked: true } },
      errors: { volume: "wpctl is not installed on the PC" },
    });
  });

  test("a part missing from the response is an error, not silence", () => {
    expect(splitParts({}, ["stats"]).errors.stats).toMatch(/missing/);
  });
});

describe("fetchParts with a batching server", () => {
  test("makes one request and returns the parts", async () => {
    const api = jest.fn(async () => ({ status: { locked: false }, stats: { cpu_percent: 7 } }));
    const result = await fetchParts(api, ["status", "stats"]);
    expect(api).toHaveBeenCalledTimes(1);
    expect(api.mock.calls[0][1]).toBe("/snapshot?parts=status,stats");
    expect(result.batched).toBe(true);
    expect(result.values).toEqual({ status: { locked: false }, stats: { cpu_percent: 7 } });
    expect(result.errors).toEqual({});
  });

  test("one broken part does not lose the others", async () => {
    const api = jest.fn(async () => ({
      stats: { cpu_percent: 7 },
      active_window: { error: "xprop is not installed on the PC", status: 503 },
    }));
    const { values, errors } = await fetchParts(api, ["stats", "active_window"]);
    expect(values.stats).toEqual({ cpu_percent: 7 });
    expect(errors.active_window).toMatch(/xprop/);
  });

  test("a network failure still reaches the caller", async () => {
    const api = jest.fn(async () => { throw Object.assign(new Error("unreachable"), { kind: "unreachable" }); });
    await expect(fetchParts(api, ["status"])).rejects.toMatchObject({ kind: "unreachable" });
  });

  test("options are passed through", async () => {
    const api = jest.fn(async () => ({ stats: { cpu_percent: 1 } }));
    await fetchParts(api, ["stats"], { timeoutMs: 1234 });
    expect(api.mock.calls[0][3]).toEqual({ timeoutMs: 1234 });
  });
});

describe("fetchParts against a server without /snapshot", () => {
  test("falls back to the individual endpoints", async () => {
    const api = jest.fn(async (method, endpoint) => {
      if (endpoint.startsWith("/snapshot")) throw err(404);
      if (endpoint === "/status") return { locked: true };
      if (endpoint === "/phone-watch/status") return { active: false };
      throw err(500);
    });
    const result = await fetchParts(api, ["status", "phone_watch"]);
    expect(result.batched).toBe(false);
    expect(result.values).toEqual({ status: { locked: true }, phone_watch: { active: false } });
    const paths = api.mock.calls.map(([, e]) => e);
    expect(paths).toEqual(["/snapshot?parts=status,phone_watch", "/status", "/phone-watch/status"]);
  });

  test("405 is treated the same as 404", async () => {
    const api = jest.fn(async (method, endpoint) => {
      if (endpoint.startsWith("/snapshot")) throw err(405);
      return { locked: false };
    });
    expect((await fetchParts(api, ["status"])).batched).toBe(false);
  });

  test("a partial fallback keeps what worked and records what did not", async () => {
    const api = jest.fn(async (method, endpoint) => {
      if (endpoint.startsWith("/snapshot")) throw err(404);
      if (endpoint === "/stats") return { cpu_percent: 3 };
      throw err(503);
    });
    const { values, errors } = await fetchParts(api, ["stats", "webcam"]);
    expect(values).toEqual({ stats: { cpu_percent: 3 } });
    expect(errors.webcam).toMatchObject({ status: 503 });
  });

  test("when every fallback fails the error surfaces", async () => {
    const api = jest.fn(async (method, endpoint) => {
      if (endpoint.startsWith("/snapshot")) throw err(404);
      throw Object.assign(new Error("unreachable"), { kind: "unreachable" });
    });
    await expect(fetchParts(api, ["status", "stats"])).rejects.toMatchObject({ kind: "unreachable" });
  });

  test("batching can be skipped outright", async () => {
    const api = jest.fn(async () => ({ locked: false }));
    await fetchParts(api, ["status"], { batch: false });
    expect(api.mock.calls.map(([, e]) => e)).toEqual(["/status"]);
  });

  test("every part name maps to a real endpoint", () => {
    for (const [name, endpoint] of Object.entries(PART_ENDPOINTS)) {
      expect(typeof endpoint).toBe("string");
      expect(endpoint.startsWith("/")).toBe(true);
      expect(name).toMatch(/^[a-z_]+$/);
    }
  });
});
