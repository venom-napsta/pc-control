// Only the pure "what should we paint" helpers are under test here. The
// screens import icons, navigation and the auth layer for rendering, all of
// which need native modules under jest.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("@react-navigation/native", () => ({
  useNavigation: () => ({ navigate: () => {}, goBack: () => {}, canGoBack: () => false }),
  useIsFocused: () => true,
}));
jest.mock("../src/context/AuthContext", () => ({ useAuth: () => ({}) }));
jest.mock("../src/context/ErrorContext", () => ({ useError: () => ({ showError: () => {} }) }));
jest.mock("expo-clipboard", () => ({ setStringAsync: async () => true }));

import { pickLockState, STATUS_SNAPSHOT_KEY } from "../src/screens/HomeScreen";
import {
  pickStats, snapshotStats, shouldShowUnreachableEmpty, STATS_SNAPSHOT_KEY,
} from "../src/screens/MonitorScreen";

const AT = 1_700_000_000_000;
const snap = (data, at = AT) => ({ data, at });

describe("pickLockState", () => {
  test("a live value wins and is actionable", () => {
    expect(pickLockState({ locked: true, connectionState: "online", snapshot: null })).toEqual({
      shown: true, stale: false, at: null, actionable: true,
    });
    expect(pickLockState({ locked: false, connectionState: "online", snapshot: null })).toEqual({
      shown: false, stale: false, at: null, actionable: true,
    });
  });

  test("a live value beats a cached one, even a contradictory one", () => {
    const state = pickLockState({
      locked: false, connectionState: "unreachable", snapshot: snap({ locked: true }),
    });
    expect(state).toMatchObject({ shown: false, stale: false, actionable: true });
  });

  test("unreachable with nothing live falls back to the cache, dimmed", () => {
    expect(pickLockState({
      locked: null, connectionState: "unreachable", snapshot: snap({ locked: true }),
    })).toEqual({ shown: true, stale: true, at: AT, actionable: false });
  });

  test("a remembered UNLOCKED reads as unlocked, not as missing", () => {
    expect(pickLockState({
      locked: null, connectionState: "unreachable", snapshot: snap({ locked: false }),
    })).toMatchObject({ shown: false, stale: true });
  });

  // Acting on a remembered state could lock a PC the user just unlocked, so a
  // cache hit must never re-enable the button.
  test("a cached value is never actionable", () => {
    for (const locked of [true, false]) {
      expect(pickLockState({
        locked: null, connectionState: "unreachable", snapshot: snap({ locked }),
      }).actionable).toBe(false);
    }
  });

  test("while still connecting there is nothing to show", () => {
    for (const connectionState of ["unknown", "online"]) {
      expect(pickLockState({ locked: null, connectionState, snapshot: snap({ locked: true }) }))
        .toEqual({ shown: null, stale: false, at: null, actionable: false });
    }
  });

  test.each([
    ["no snapshot", null],
    ["an empty snapshot", snap({})],
    ["a snapshot with no lock field", snap({ hostname: "pc" })],
    ["a non-boolean lock field", snap({ locked: "yes" })],
    ["a null data payload", { data: null, at: AT }],
  ])("%s leaves nothing to show", (_label, snapshot) => {
    expect(pickLockState({ locked: null, connectionState: "unreachable", snapshot }))
      .toEqual({ shown: null, stale: false, at: null, actionable: false });
  });

  test("an undefined live value is treated as no value", () => {
    expect(pickLockState({ locked: undefined, connectionState: "unknown", snapshot: null }))
      .toMatchObject({ shown: null, actionable: false });
  });

  test("the snapshot key is the one the screen writes", () => {
    expect(STATUS_SNAPSHOT_KEY).toBe("status");
  });
});

describe("snapshotStats", () => {
  test("a reading with a cpu figure is usable", () => {
    expect(snapshotStats(snap({ cpu_percent: 12 }))).toEqual({ cpu_percent: 12 });
    expect(snapshotStats(snap({ cpu_percent: 0 }))).toEqual({ cpu_percent: 0 });
  });

  test.each([
    ["nothing", null],
    ["undefined", undefined],
    ["an empty payload", snap({})],
    ["a payload with no cpu figure", snap({ hostname: "pc" })],
    ["a null payload", { data: null, at: AT }],
    ["a string payload", { data: "cpu 12%", at: AT }],
  ])("%s is not usable", (_label, snapshot) => {
    expect(snapshotStats(snapshot)).toBeNull();
  });
});

describe("pickStats", () => {
  test("live stats win and are not stale", () => {
    const stats = { cpu_percent: 90 };
    expect(pickStats({ stats, snapshot: snap({ cpu_percent: 1 }) })).toEqual({
      data: stats, stale: false, at: null,
    });
  });

  test("the cache stands in until the first live answer, carrying its age", () => {
    expect(pickStats({ stats: null, snapshot: snap({ cpu_percent: 7 }) })).toEqual({
      data: { cpu_percent: 7 }, stale: true, at: AT,
    });
  });

  test("nothing live and nothing cached leaves the spinner in place", () => {
    expect(pickStats({ stats: null, snapshot: null })).toEqual({
      data: null, stale: false, at: null,
    });
    expect(pickStats({ stats: null, snapshot: snap({}) })).toEqual({
      data: null, stale: false, at: null,
    });
  });

  test("the snapshot key is the one the screen writes", () => {
    expect(STATS_SNAPSHOT_KEY).toBe("stats");
  });
});

describe("shouldShowUnreachableEmpty", () => {
  test("unreachable with nothing at all says so", () => {
    expect(shouldShowUnreachableEmpty({
      connectionState: "unreachable", stats: null, snapshot: null,
    })).toBe(true);
  });

  // The whole point of the cache: remembered numbers beat an empty screen.
  test("a usable cached reading replaces the empty state", () => {
    expect(shouldShowUnreachableEmpty({
      connectionState: "unreachable", stats: null, snapshot: snap({ cpu_percent: 3 }),
    })).toBe(false);
  });

  test("an unusable cached reading does not replace it", () => {
    expect(shouldShowUnreachableEmpty({
      connectionState: "unreachable", stats: null, snapshot: snap({ hostname: "pc" }),
    })).toBe(true);
  });

  test("live stats never show the empty state", () => {
    expect(shouldShowUnreachableEmpty({
      connectionState: "unreachable", stats: { cpu_percent: 5 }, snapshot: null,
    })).toBe(false);
  });

  test.each(["unknown", "online", undefined])(
    "connection state %p is not a reason to give up",
    (connectionState) => {
      expect(shouldShowUnreachableEmpty({ connectionState, stats: null, snapshot: null })).toBe(false);
    },
  );
});
