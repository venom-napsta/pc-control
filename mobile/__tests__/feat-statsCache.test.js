import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  saveSnapshot, loadSnapshot, clearSnapshot, parseSnapshot,
  formatAsOf, isStale, snapshotStorageKey,
  MINUTE_MS, HOUR_MS, DAY_MS, DEFAULT_MAX_AGE_MS,
} from "../src/statsCache";

beforeEach(async () => {
  await AsyncStorage.clear();
});

afterEach(() => {
  jest.restoreAllMocks();
});

// AsyncStorage's own methods are already jest.fn()s, so jest.spyOn returns them
// as-is and registers nothing to restore — a plain mockRejectedValue would stay
// broken for every later test in the file. One-shot failures do not leak.
const failOnce = (method, message) =>
  jest.spyOn(AsyncStorage, method).mockImplementationOnce(() => Promise.reject(new Error(message)));

describe("saveSnapshot / loadSnapshot", () => {
  test("a saved snapshot comes back with its data and a timestamp", async () => {
    jest.spyOn(Date, "now").mockReturnValue(1_700_000_000_000);
    const written = await saveSnapshot("stats", { cpu_percent: 42 });
    expect(written).toEqual({ data: { cpu_percent: 42 }, at: 1_700_000_000_000 });
    await expect(loadSnapshot("stats")).resolves.toEqual({
      data: { cpu_percent: 42 },
      at: 1_700_000_000_000,
    });
  });

  test("keys are namespaced, so two readings do not collide", async () => {
    await saveSnapshot("stats", { cpu_percent: 1 });
    await saveSnapshot("status", { locked: true });
    expect((await loadSnapshot("stats")).data).toEqual({ cpu_percent: 1 });
    expect((await loadSnapshot("status")).data).toEqual({ locked: true });
    expect(snapshotStorageKey("stats")).toBe("pc-control/snapshot/stats");
    expect(await AsyncStorage.getItem("stats")).toBeNull();
  });

  test("a later save replaces the earlier one", async () => {
    const now = jest.spyOn(Date, "now").mockReturnValue(1000);
    await saveSnapshot("stats", { cpu_percent: 10 });
    now.mockReturnValue(2000);
    await saveSnapshot("stats", { cpu_percent: 90 });
    await expect(loadSnapshot("stats")).resolves.toEqual({ data: { cpu_percent: 90 }, at: 2000 });
  });

  test("a missing key loads as null", async () => {
    await expect(loadSnapshot("never-written")).resolves.toBeNull();
  });

  test("corrupt JSON loads as null instead of throwing", async () => {
    await AsyncStorage.setItem(snapshotStorageKey("stats"), "{not json");
    await expect(loadSnapshot("stats")).resolves.toBeNull();
  });

  test.each([
    ["a bare JSON string", '"hello"'],
    ["a JSON array", '[{"cpu_percent":1}]'],
    ["null", "null"],
    ["no timestamp", '{"data":{"cpu_percent":1}}'],
    ["a non-numeric timestamp", '{"data":{"cpu_percent":1},"at":"yesterday"}'],
    ["no data key", '{"at":1000}'],
    ["a null data key", '{"data":null,"at":1000}'],
  ])("%s loads as null", async (_label, raw) => {
    await AsyncStorage.setItem(snapshotStorageKey("stats"), raw);
    await expect(loadSnapshot("stats")).resolves.toBeNull();
  });

  test("a read that throws loads as null", async () => {
    failOnce("getItem", "storage gone");
    await expect(loadSnapshot("stats")).resolves.toBeNull();
  });

  test("a write that throws returns null rather than failing the caller", async () => {
    failOnce("setItem", "disk full");
    await expect(saveSnapshot("stats", { cpu_percent: 1 })).resolves.toBeNull();
  });

  test("nothing worth caching is not written", async () => {
    await expect(saveSnapshot("stats", undefined)).resolves.toBeNull();
    await expect(saveSnapshot("stats", null)).resolves.toBeNull();
    await expect(saveSnapshot("", { cpu_percent: 1 })).resolves.toBeNull();
    await expect(loadSnapshot("")).resolves.toBeNull();
    expect(await AsyncStorage.getAllKeys()).toEqual([]);
  });

  test("unserialisable data is not written", async () => {
    const circular = { name: "loop" };
    circular.self = circular;
    await expect(saveSnapshot("stats", circular)).resolves.toBeNull();
    await expect(loadSnapshot("stats")).resolves.toBeNull();
  });

  test("clearSnapshot removes the entry", async () => {
    await saveSnapshot("stats", { cpu_percent: 1 });
    await expect(clearSnapshot("stats")).resolves.toBe(true);
    await expect(loadSnapshot("stats")).resolves.toBeNull();
  });

  test("clearSnapshot reports failure instead of throwing", async () => {
    failOnce("removeItem", "nope");
    await expect(clearSnapshot("stats")).resolves.toBe(false);
    await expect(clearSnapshot("")).resolves.toBe(false);
  });

  test("a falsy-but-real reading survives the round trip", async () => {
    await saveSnapshot("status", { locked: false });
    expect((await loadSnapshot("status")).data).toEqual({ locked: false });
  });
});

describe("parseSnapshot", () => {
  test.each([undefined, null, "", 0, 42, {}, []])("%p is not a snapshot", (raw) => {
    expect(parseSnapshot(raw)).toBeNull();
  });

  test("extra fields are dropped, data and at are kept", () => {
    expect(parseSnapshot('{"data":{"a":1},"at":5,"junk":true}')).toEqual({ data: { a: 1 }, at: 5 });
  });
});

describe("formatAsOf", () => {
  const now = 1_700_000_000_000;

  test.each([
    ["the same instant", now, "just now"],
    ["a second ago", now - 1000, "just now"],
    ["59 s ago", now - 59_000, "just now"],
    ["exactly a minute ago", now - MINUTE_MS, "1 min ago"],
    ["3 min ago", now - 3 * MINUTE_MS, "3 min ago"],
    ["59 min ago", now - 59 * MINUTE_MS, "59 min ago"],
    ["exactly an hour ago", now - HOUR_MS, "1 h ago"],
    ["2 h ago", now - 2 * HOUR_MS, "2 h ago"],
    ["23 h ago", now - 23 * HOUR_MS, "23 h ago"],
  ])("%s reads as %p", (_label, at, expected) => {
    expect(formatAsOf(at, now)).toBe(expected);
  });

  test("a day or more falls back to a calendar date", () => {
    const at = new Date(2024, 2, 12, 9, 30).getTime(); // 12 March 2024, local
    expect(formatAsOf(at, at + DAY_MS)).toBe("12 Mar");
    expect(formatAsOf(at, at + 400 * DAY_MS)).toBe("12 Mar");
  });

  test("every month has a short name", () => {
    const names = [];
    for (let m = 0; m < 12; m += 1) {
      const at = new Date(2024, m, 1).getTime();
      names.push(formatAsOf(at, at + DAY_MS));
    }
    expect(names).toEqual([
      "1 Jan", "1 Feb", "1 Mar", "1 Apr", "1 May", "1 Jun",
      "1 Jul", "1 Aug", "1 Sep", "1 Oct", "1 Nov", "1 Dec",
    ]);
  });

  test("a clock that jumped forward reads as just now, not a negative age", () => {
    expect(formatAsOf(now + 10 * MINUTE_MS, now)).toBe("just now");
  });

  test.each([undefined, null, NaN, Infinity, "yesterday", {}])(
    "an unusable timestamp %p reads as unknown",
    (bad) => {
      expect(formatAsOf(bad, now)).toBe("unknown");
    },
  );

  test("an unusable clock reads as unknown", () => {
    expect(formatAsOf(now, NaN)).toBe("unknown");
  });

  test("now defaults to the current time", () => {
    jest.spyOn(Date, "now").mockReturnValue(now);
    expect(formatAsOf(now - 5 * MINUTE_MS)).toBe("5 min ago");
  });
});

describe("isStale", () => {
  const now = 1_700_000_000_000;

  test("fresh data is not stale", () => {
    expect(isStale(now - 1000, now, MINUTE_MS)).toBe(false);
  });

  test("exactly maxAgeMs old is the last moment that counts as fresh", () => {
    expect(isStale(now - MINUTE_MS, now, MINUTE_MS)).toBe(false);
    expect(isStale(now - MINUTE_MS - 1, now, MINUTE_MS)).toBe(true);
  });

  test("a zero budget makes anything but this instant stale", () => {
    expect(isStale(now, now, 0)).toBe(false);
    expect(isStale(now - 1, now, 0)).toBe(true);
  });

  test("a timestamp in the future is not stale", () => {
    expect(isStale(now + HOUR_MS, now, MINUTE_MS)).toBe(false);
  });

  test.each([undefined, null, NaN, "old"])("an unusable timestamp %p is stale", (bad) => {
    expect(isStale(bad, now, MINUTE_MS)).toBe(true);
  });

  test.each([NaN, -1, "5m", null])("an unusable budget %p is stale", (bad) => {
    expect(isStale(now, now, bad)).toBe(true);
  });

  test("the defaults are the current time and a five minute budget", () => {
    expect(DEFAULT_MAX_AGE_MS).toBe(5 * MINUTE_MS);
    jest.spyOn(Date, "now").mockReturnValue(now);
    expect(isStale(now - 4 * MINUTE_MS)).toBe(false);
    expect(isStale(now - 6 * MINUTE_MS)).toBe(true);
  });
});
