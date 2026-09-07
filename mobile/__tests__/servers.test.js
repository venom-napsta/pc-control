import AsyncStorage from "@react-native-async-storage/async-storage";
import {
  normalizeServerUrl, parseServerList, serverLabel, isTailscaleAddress, isPrivateLanAddress,
  serverKind, dedupe, hostOf, loadServers, saveServers, clearServers, loadLastGood, saveLastGood,
} from "../src/servers";

describe("normalizeServerUrl", () => {
  test.each([
    ["192.168.1.10:2000", "http://192.168.1.10:2000"],
    ["  http://192.168.1.10:2000/  ", "http://192.168.1.10:2000"],
    ["venom.tailnet.ts.net:2000", "http://venom.tailnet.ts.net:2000"],
    ["HTTP://Venom:2000", "http://venom:2000"],
    ["192.168.1.10", "http://192.168.1.10:2000"],
    ["https://pc.example.com", "https://pc.example.com:2000"],
    ["http://[fd7a:115c:a1e0::c801:a7b0]:2000", "http://[fd7a:115c:a1e0::c801:a7b0]:2000"],
    ["http://host:2000/some/path?x=1#frag", "http://host:2000"],
  ])("normalizes %p", (input, expected) => {
    expect(normalizeServerUrl(input)).toBe(expected);
  });

  test.each([
    "", "   ", "ftp://host:2000", "http://", "host:99999", "host:0", "host:abc",
    "http://ho st:2000", "http://a:b:c", "-bad-.host:2000", null, undefined, 42,
  ])("rejects %p", (bad) => {
    expect(normalizeServerUrl(bad)).toBeNull();
  });

  test("default port is configurable", () => {
    expect(normalizeServerUrl("host", { defaultPort: 8080 })).toBe("http://host:8080");
  });
});

describe("parseServerList", () => {
  test("splits on commas, spaces and newlines and normalizes", () => {
    expect(parseServerList("a:2000, b:2000\n  http://c:3000/ ")).toEqual([
      "http://a:2000", "http://b:2000", "http://c:3000",
    ]);
  });
  test("accepts arrays and drops invalid entries", () => {
    expect(parseServerList(["a:2000", "not a url!!", "", "b"])).toEqual(["http://a:2000", "http://b:2000"]);
  });
  test("de-duplicates after normalization", () => {
    expect(parseServerList("192.168.1.10:2000, http://192.168.1.10:2000/, HTTP://192.168.1.10:2000"))
      .toEqual(["http://192.168.1.10:2000"]);
  });
  test("empty input gives an empty list", () => {
    expect(parseServerList("")).toEqual([]);
    expect(parseServerList(undefined)).toEqual([]);
    expect(parseServerList([])).toEqual([]);
  });
});

describe("address classification", () => {
  test.each([
    ["http://100.64.0.1:2000", true],
    ["http://100.64.0.1:2000", true],
    ["http://100.127.255.255:2000", true],
    ["http://100.128.0.1:2000", false],
    ["http://100.63.1.1:2000", false],
    ["http://venom.tailnet.ts.net:2000", true],
    ["http://ts.net.evil.com:2000", false],
    ["http://192.168.1.10:2000", false],
  ])("isTailscaleAddress(%s) -> %s", (url, expected) => {
    expect(isTailscaleAddress(url)).toBe(expected);
  });

  test.each([
    ["http://10.42.0.1:2000", true],
    ["http://172.16.5.5:2000", true],
    ["http://172.32.0.1:2000", false],
    ["http://192.168.1.10:2000", true],
    ["http://8.8.8.8:2000", false],
  ])("isPrivateLanAddress(%s) -> %s", (url, expected) => {
    expect(isPrivateLanAddress(url)).toBe(expected);
  });

  test("serverKind buckets addresses", () => {
    expect(serverKind("http://100.64.0.1:2000")).toBe("tailscale");
    expect(serverKind("http://venom.tailnet.ts.net:2000")).toBe("tailscale");
    expect(serverKind("http://10.42.0.1:2000")).toBe("lan");
    expect(serverKind("http://pc.example.com:2000")).toBe("other");
  });

  test("hostOf and serverLabel", () => {
    expect(hostOf("http://venom.tailnet.ts.net:2000")).toBe("venom.tailnet.ts.net");
    expect(hostOf("http://[fd7a::1]:2000")).toBe("[fd7a::1]");
    expect(hostOf("garbage")).toBe("");
    expect(serverLabel("http://100.64.0.1:2000/")).toBe("100.64.0.1:2000");
  });

  test("dedupe keeps first occurrence and drops empties", () => {
    expect(dedupe(["a", "b", "a", "", null, "c", "b"])).toEqual(["a", "b", "c"]);
  });
});

describe("persistence", () => {
  const defaults = ["http://default:2000"];
  beforeEach(() => AsyncStorage.clear());

  test("falls back to defaults when nothing is stored", async () => {
    expect(await loadServers(defaults)).toBe(defaults);
  });
  test("round-trips a saved list", async () => {
    await saveServers(["http://a:2000", "http://b:2000", "http://a:2000"]);
    expect(await loadServers(defaults)).toEqual(["http://a:2000", "http://b:2000"]);
  });
  test("ignores corrupt storage", async () => {
    await AsyncStorage.setItem("pc-control/servers", "{not json");
    expect(await loadServers(defaults)).toBe(defaults);
  });
  test("an empty saved list means defaults", async () => {
    await saveServers([]);
    expect(await loadServers(defaults)).toBe(defaults);
  });
  test("clearServers restores defaults", async () => {
    await saveServers(["http://a:2000"]);
    await clearServers();
    expect(await loadServers(defaults)).toBe(defaults);
  });
  test("last-good address round-trips and starts null", async () => {
    expect(await loadLastGood()).toBeNull();
    await saveLastGood("http://a:2000");
    expect(await loadLastGood()).toBe("http://a:2000");
  });
});
