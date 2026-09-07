// The orbit rings run an infinite native-driver Animated.loop that jest has no
// backend for; irrelevant here, so render their children plainly and keep a
// marker so the test can tell whether they were rendered at all.
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("../src/components/OrbitRing", () => {
  const { View } = require("react-native");
  return {
    OrbitRing: ({ children }) => <View testID="orbit">{children}</View>,
  };
});
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: ({ children, style }) => <View style={style}>{children}</View> };
});

let mockKeyboardVisible = false;
let mockLandscape = false;

// Partial: ScreenShell also pulls keyboardAvoidBehavior from this module, and
// replacing the whole thing would leave it undefined.
jest.mock("../src/keyboard", () => ({
  ...jest.requireActual("../src/keyboard"),
  useKeyboardVisible: () => mockKeyboardVisible,
}));
jest.mock("../src/layout", () => {
  const actual = jest.requireActual("../src/layout");
  return { ...actual, useLayout: () => ({ ...actual.classifyWindow({ width: 1000, height: 700 }), isLandscape: mockLandscape, width: 1000, height: 700 }) };
});
jest.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({
    password: "pw",
    setPassword: jest.fn(),
    loading: false,
    authenticate: jest.fn(),
    authError: null,
    server: "http://pc:2000",
    lastGood: null,
    servers: ["http://pc:2000"],
    biometrics: { available: false, saved: false },
    remember: false,
    setRememberPassword: jest.fn(),
    unlockWithBiometrics: jest.fn(),
  }),
}));

import { act } from "react";
import TestRenderer from "react-test-renderer";
import { TextInput, ScrollView } from "react-native";
import { LoginScreen } from "../src/screens/LoginScreen";

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockKeyboardVisible = false;
  mockLandscape = false;
  jest.useFakeTimers();
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

function render() {
  let tree;
  act(() => { tree = TestRenderer.create(<LoginScreen />); });
  return tree;
}

const orbits = (tree) => tree.root.findAll((n) => n.props?.testID === "orbit");
const field = (tree) =>
  tree.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === "Password")[0];

// ScreenShell puts the vertical alignment on the ScrollView's content style.
function contentStyle(tree) {
  const sv = tree.root.findAllByType(ScrollView)[0];
  return Object.assign({}, ...[].concat(sv.props.contentContainerStyle).filter(Boolean));
}

describe("the sign-in screen with the keyboard up", () => {
  test("at rest it is centred and shows the orbit rings", () => {
    const tree = render();
    expect(orbits(tree).length).toBeGreaterThan(0);
    expect(contentStyle(tree).justifyContent).toBe("center");
  });

  test("an open keyboard moves the form off centre, to the top", () => {
    // Centred plus a keyboard is what pushed the field behind the keyboard.
    mockKeyboardVisible = true;
    const tree = render();
    expect(contentStyle(tree).justifyContent).toBe("flex-start");
    // Whatever else changes, the field itself must still be there to type into.
    expect(field(tree)).toBeDefined();
  });

  test("in landscape it also drops the orbit rings for the height", () => {
    mockKeyboardVisible = true;
    mockLandscape = true;
    const tree = render();
    expect(orbits(tree)).toEqual([]);
    expect(field(tree)).toBeDefined();
  });

  test("in portrait the rings survive, since there is room", () => {
    mockKeyboardVisible = true;
    mockLandscape = false;
    expect(orbits(render()).length).toBeGreaterThan(0);
  });

  test("dismissing the keyboard restores the centred layout", () => {
    mockKeyboardVisible = true;
    mockLandscape = true;
    expect(orbits(render())).toEqual([]);

    mockKeyboardVisible = false;
    const after = render();
    expect(orbits(after).length).toBeGreaterThan(0);
    expect(contentStyle(after).justifyContent).toBe("center");
  });
});
