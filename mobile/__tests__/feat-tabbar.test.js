// TabBar's pure helpers are what is under test here; the icon set and the auth
// layer are only imported for rendering, and both need native modules.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../src/context/AuthContext", () => ({ useAuth: () => ({ connectionState: "unknown" }) }));

import {
  connectionDotColor, connectionDotHint, tabAccessibilityLabel,
  STATUS_TAB, CONNECTION_DOT_SIZE,
} from "../src/components/TabBar";
import { colors } from "../src/theme";
import { CONNECTION_STATES } from "../src/connectionState";

describe("connectionDotColor", () => {
  test("each connection state has its own colour", () => {
    expect(connectionDotColor("online")).toBe(colors.success);
    expect(connectionDotColor("unreachable")).toBe(colors.danger);
    expect(connectionDotColor("unknown")).toBe(colors.textMuted);
  });

  test("the three colours are distinguishable", () => {
    const seen = CONNECTION_STATES.map(connectionDotColor);
    expect(new Set(seen).size).toBe(3);
  });

  test.each([undefined, null, "", "offline", 0, {}])(
    "an unrecognised state %p reads as unknown",
    (bad) => {
      expect(connectionDotColor(bad)).toBe(colors.textMuted);
    },
  );

  test("every state the auth layer can report is handled", () => {
    for (const state of CONNECTION_STATES) {
      expect(typeof connectionDotColor(state)).toBe("string");
    }
  });
});

describe("connectionDotHint", () => {
  test.each([
    ["online", "PC online"],
    ["unreachable", "PC unreachable"],
    ["unknown", "PC status unknown"],
    [undefined, "PC status unknown"],
  ])("%p announces as %p", (state, expected) => {
    expect(connectionDotHint(state)).toBe(expected);
  });
});

describe("tabAccessibilityLabel", () => {
  test("the Home tab carries the connection state", () => {
    expect(tabAccessibilityLabel("Home", "online")).toBe("Home, PC online");
    expect(tabAccessibilityLabel("Home", "unreachable")).toBe("Home, PC unreachable");
    expect(tabAccessibilityLabel("Home", "unknown")).toBe("Home, PC status unknown");
  });

  test("Home is the tab that carries the dot", () => {
    expect(STATUS_TAB).toBe("Home");
    expect(tabAccessibilityLabel(STATUS_TAB, "online")).toContain("PC online");
  });

  test.each(["Controls", "Files", "Terminal"])(
    "%s keeps its plain name — one dot is enough",
    (name) => {
      expect(tabAccessibilityLabel(name, "unreachable")).toBe(name);
    },
  );

  test("the label always starts with the tab's own name", () => {
    for (const name of ["Home", "Controls", "Files", "Terminal"]) {
      for (const state of [...CONNECTION_STATES, undefined]) {
        expect(tabAccessibilityLabel(name, state).startsWith(name)).toBe(true);
      }
    }
  });
});

test("the dot is a badge, not a second icon", () => {
  expect(CONNECTION_DOT_SIZE).toBeGreaterThan(4);
  expect(CONNECTION_DOT_SIZE).toBeLessThan(12);
});
