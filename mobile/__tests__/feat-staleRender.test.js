// Renders Home and Monitor for real, to prove the two-column branch and the
// cached-snapshot branch actually build a tree. Native-only modules are
// stubbed; statsCache and layout stay real (layout only has its window size
// swapped, so classifyWindow still decides the column count).
// `var`, not `const`: jest hoists the mock factories below above these
// declarations, and a const would still be in its temporal dead zone when a
// factory first runs.
/* eslint-disable no-var */
var mockWindow = { width: 390, height: 844 };
var mockAuth = {};

// The screens read status through GET /snapshot?parts=a,b (src/snapshot.js).
// This turns a per-part map into a stub that answers that shape, so the tests
// keep describing data rather than transport.
function snapshotApi(parts) {
  return (method, path) => {
    const match = /^\/snapshot\?parts=(.*)$/.exec(path);
    if (match) {
      const body = {};
      for (const name of match[1].split(",")) body[name] = parts[name] ?? {};
      return Promise.resolve(body);
    }
    return Promise.resolve(parts[path] ?? {});
  };
}
// Stable identity, like the real ErrorContext's useCallback: MonitorScreen's
// one-shot fetch effect depends on showError, so a fresh function per render
// would re-fire it forever.
var mockErrors = { showError: () => {} };
/* eslint-enable no-var */

jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("expo-clipboard", () => ({ setStringAsync: async () => true }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return {
    SafeAreaView: ({ children, style }) => <View style={style}>{children}</View>,
    useSafeAreaInsets: () => ({ top: 0, bottom: 0, left: 0, right: 0 }),
  };
});
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, canGoBack: () => false }),
  useIsFocused: () => true,
}));
jest.mock("../src/context/AuthContext", () => ({ useAuth: () => mockAuth }));
// The scheduling rules have their own tests (usePolling.test.js); here the
// fetch just needs to run once, deterministically, without AppState.
jest.mock("../src/hooks/usePolling", () => ({
  usePolling: (fn) => {
    const { useEffect } = require("react");
    useEffect(() => { fn(); }, [fn]);
    return { refreshing: false, onRefresh: fn };
  },
}));
jest.mock("../src/context/ErrorContext", () => ({ useError: () => mockErrors }));
jest.mock("../src/layout", () => {
  const actual = jest.requireActual("../src/layout");
  return {
    ...actual,
    useLayout: () => ({ ...mockWindow, ...actual.classifyWindow(mockWindow) }),
  };
});

import { act } from "react";
import TestRenderer from "react-test-renderer";
import { Text, StyleSheet } from "react-native";
import AsyncStorage from "@react-native-async-storage/async-storage";
import { HomeScreen } from "../src/screens/HomeScreen";
import { MonitorScreen } from "../src/screens/MonitorScreen";
import { TabBar, CONNECTION_DOT_SIZE } from "../src/components/TabBar";
import { loadSnapshot, snapshotStorageKey } from "../src/statsCache";
import { colors } from "../src/theme";

global.IS_REACT_ACT_ENVIRONMENT = true;

const PHONE = { width: 390, height: 844 };
const TABLET_LANDSCAPE = { width: 1280, height: 800 };

const STATS = {
  cpu_percent: 11, ram_used_gb: 4, ram_total_gb: 16, ram_percent: 25,
  disk_used_gb: 100, disk_total_gb: 500, disk_percent: 20,
  hostname: "venom", kernel: "6.14.0", uptime: "3 days", cpu_count: 8,
};

// Nothing on either screen is reachable in these tests: every request fails
// the way an unreachable PC's would, so only cached data can appear.
const unreachableApi = () => Promise.reject(Object.assign(new Error("no route"), { kind: "unreachable" }));

async function seed(key, data, at) {
  await AsyncStorage.setItem(snapshotStorageKey(key), JSON.stringify({ data, at }));
}

// Every mounted tree is unmounted again in afterEach: these screens run
// looping Animated.loop animations, and one still scheduled when the jest
// environment tears down takes the worker with it.
const mounted = [];

async function mount(Screen) {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(<Screen />); });
  // The snapshot load and the first poll (a Promise.allSettled over four
  // requests) settle over several microtask turns.
  for (let i = 0; i < 5; i += 1) await act(async () => {});
  mounted.push(renderer);
  return renderer;
}

const texts = (renderer) =>
  renderer.root.findAllByType(Text)
    .map((t) => [].concat(t.props.children).filter((c) => typeof c === "string").join(""))
    .join("\n");

const byLabel = (renderer, label) => renderer.root.findAllByProps({ accessibilityLabel: label })[0];

beforeEach(async () => {
  // Fake timers keep the delayed animation starts from firing at all, so none
  // can outlive the test. React's act() drives its own flushing off
  // setImmediate/microtasks, so those stay real or nothing ever settles.
  jest.useFakeTimers({ doNotFake: ["setImmediate", "queueMicrotask", "nextTick"] });
  await AsyncStorage.clear();
  mockWindow = { ...PHONE };
  mockAuth = { api: unreachableApi, logout: () => {}, connectionState: "unreachable", servers: [], server: null, probeServers: async () => [] };
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(async () => {
  await act(async () => { for (const r of mounted) r.unmount(); });
  mounted.length = 0;
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("HomeScreen", () => {
  test("renders in one column with a gear that opens server settings", async () => {
    const r = await mount(HomeScreen);
    const gear = byLabel(r, "Server settings");
    expect(gear).toBeTruthy();
    await act(async () => { gear.props.onPress(); });
    expect(texts(r)).toContain("Server addresses");
  });

  test("with no cache and no answer it stays on CONNECTING", async () => {
    const r = await mount(HomeScreen);
    expect(texts(r)).toContain("CONNECTING...");
    expect(texts(r)).not.toContain("last known");
  });

  test("unreachable with a cached lock state shows it, dated and disabled", async () => {
    await seed("status", { locked: true }, Date.now() - 3 * 60 * 1000);
    const r = await mount(HomeScreen);
    const shown = texts(r);
    expect(shown).toContain("LOCKED");
    expect(shown).toContain("last known — as of 3 min ago");
    // A remembered state must not re-arm the button.
    const btn = r.root.findAllByProps({ accessibilityRole: "button" })
      .find((n) => String(n.props.accessibilityLabel).startsWith("Lock control unavailable"));
    expect(btn.props.disabled).toBe(true);
  });

  test("a live status is written to the cache for next time", async () => {
    mockAuth = {
      ...mockAuth,
      connectionState: "online",
      api: snapshotApi({ status: { locked: false }, phone_watch: { active: true } }),
    };
    const r = await mount(HomeScreen);
    expect(texts(r)).toContain("UNLOCKED");
    await expect(loadSnapshot("status")).resolves.toMatchObject({ data: { locked: false } });
  });

  test("a landscape tablet renders the two-column layout", async () => {
    mockWindow = { ...TABLET_LANDSCAPE };
    const r = await mount(HomeScreen);
    const shown = texts(r);
    expect(shown).toContain("PHONE.WATCH");
    expect(shown).toContain("MONITOR");
    expect(byLabel(r, "Open audit log")).toBeTruthy();
  });
});

describe("MonitorScreen", () => {
  test("unreachable with nothing cached shows the empty state", async () => {
    const r = await mount(MonitorScreen);
    expect(texts(r)).toContain("PC UNREACHABLE");
    expect(texts(r)).not.toContain("SYS.INFO");
  });

  test("a cached snapshot replaces the empty state and is dated", async () => {
    await seed("stats", STATS, Date.now() - 2 * 60 * 60 * 1000);
    const r = await mount(MonitorScreen);
    const shown = texts(r);
    expect(shown).not.toContain("PC UNREACHABLE");
    expect(shown).toContain("last known — as of 2 h ago");
    expect(shown).toContain("venom");
    expect(shown).toContain("11%");
  });

  test("a corrupt snapshot is ignored, so the empty state stands", async () => {
    await AsyncStorage.setItem(snapshotStorageKey("stats"), "{not json");
    const r = await mount(MonitorScreen);
    expect(texts(r)).toContain("PC UNREACHABLE");
  });

  test("both column counts render the same cards", async () => {
    await seed("stats", STATS, Date.now());
    const phone = texts(await mount(MonitorScreen));
    mockWindow = { ...TABLET_LANDSCAPE };
    const tablet = texts(await mount(MonitorScreen));
    for (const section of ["SYS.INFO", "SYS.LOAD", "NET.SPEED", "WEBCAM.STATUS", "LAN.DEVICES", "UPTIME.HIST", "ACTIVE.PROC", "SCR.CAPTURE"]) {
      expect(phone).toContain(section);
      expect(tablet).toContain(section);
    }
  });

  test("live stats drop the dimming and the as-of line", async () => {
    await seed("stats", { ...STATS, cpu_percent: 11 }, Date.now() - 60 * 60 * 1000);
    mockAuth = {
      ...mockAuth,
      connectionState: "online",
      api: snapshotApi({ stats: { ...STATS, cpu_percent: 77 } }),
    };
    const r = await mount(MonitorScreen);
    const shown = texts(r);
    expect(shown).toContain("77%");
    expect(shown).not.toContain("11%");
    expect(shown).not.toContain("last known");
  });
});

describe("TabBar connection dot", () => {
  const tabBarProps = {
    state: {
      index: 0,
      routes: [
        { key: "h", name: "Home" },
        { key: "c", name: "Controls" },
        { key: "f", name: "Files" },
        { key: "t", name: "Terminal" },
      ],
    },
    descriptors: {},
    navigation: { emit: () => ({ defaultPrevented: false }), navigate: () => {} },
  };

  // Host instances only: findAll also reports the composite wrapper for each.
  const dotStyles = (r) =>
    r.root
      .findAll((n) => typeof n.type === "string" && n.props?.pointerEvents === "none")
      .map((n) => StyleSheet.flatten(n.props.style));

  async function mountBar() {
    let renderer;
    await act(async () => { renderer = TestRenderer.create(<TabBar {...tabBarProps} />); });
    mounted.push(renderer);
    return renderer;
  }

  test.each([
    ["online", colors.success],
    ["unreachable", colors.danger],
    ["unknown", colors.textMuted],
  ])("state %p paints one dot in %p", async (connectionState, expected) => {
    mockAuth = { ...mockAuth, connectionState };
    const found = dotStyles(await mountBar());
    expect(found).toHaveLength(1);
    expect(found[0].backgroundColor).toBe(expected);
  });

  test("the dot is absolutely positioned, so it cannot shift the icon", async () => {
    const [dot] = dotStyles(await mountBar());
    expect(dot.position).toBe("absolute");
    expect(dot.width).toBe(CONNECTION_DOT_SIZE);
    expect(dot.height).toBe(CONNECTION_DOT_SIZE);
  });

  test("the tabs keep their tab role and Home carries the state in its label", async () => {
    mockAuth = { ...mockAuth, connectionState: "online" };
    const r = await mountBar();
    const tabs = r.root
      .findAllByProps({ accessibilityRole: "tab" })
      .filter((n) => typeof n.type === "string");
    expect(tabs).toHaveLength(4);
    expect(tabs.map((t) => t.props.accessibilityLabel)).toEqual([
      "Home, PC online", "Controls", "Files", "Terminal",
    ]);
  });
});
