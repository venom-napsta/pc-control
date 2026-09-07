jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
// Decorative infinite Animated.loop on the native driver, which jest has no
// backend for. Irrelevant to the reveal toggle, so render the children plainly.
jest.mock("../src/components/OrbitRing", () => ({
  OrbitRing: ({ children }) => children ?? null,
}));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: ({ children, style }) => <View style={style}>{children}</View> };
});
jest.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({
    password: "hunter2",
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
import { TextInput } from "react-native";
import { LoginScreen } from "../src/screens/LoginScreen";

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  // The screen's entrance animations run on the native driver. Fake timers keep
  // them from completing and reaching for a backend jest does not have.
  jest.useFakeTimers();
  // Silence React 19's react-test-renderer deprecation notice; the renderer works.
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

const field = (tree) =>
  tree.root.findAll((n) => n.type === TextInput && n.props.accessibilityLabel === "Password")[0];

// The eye relabels itself, so match either state.
const eye = (tree) =>
  tree.root.findAll((n) => /^(Show|Hide) password$/.test(n.props?.accessibilityLabel ?? ""))[0];

describe("the password reveal toggle", () => {
  test("the password is masked to begin with", () => {
    const tree = render();
    expect(field(tree).props.secureTextEntry).toBe(true);
    expect(eye(tree).props.accessibilityLabel).toBe("Show password");
  });

  test("the eye unmasks it and relabels itself", () => {
    const tree = render();
    act(() => { eye(tree).props.onPress(); });

    expect(field(tree).props.secureTextEntry).toBe(false);
    expect(eye(tree).props.accessibilityLabel).toBe("Hide password");
  });

  test("pressing it again re-masks", () => {
    const tree = render();
    act(() => { eye(tree).props.onPress(); });
    act(() => { eye(tree).props.onPress(); });

    expect(field(tree).props.secureTextEntry).toBe(true);
    expect(eye(tree).props.accessibilityLabel).toBe("Show password");
  });

  test("revealing does not disturb the value or the typing behaviour", () => {
    const tree = render();
    act(() => { eye(tree).props.onPress(); });

    const f = field(tree);
    expect(f.props.value).toBe("hunter2");
    // Autocapitalise/autocorrect must stay off, or the keyboard would alter a
    // revealed password on the way in.
    expect(f.props.autoCapitalize).toBe("none");
    expect(f.props.autoCorrect).toBe(false);
  });

  test("the field starts masked again on a fresh mount", () => {
    const first = render();
    act(() => { eye(first).props.onPress(); });
    expect(field(first).props.secureTextEntry).toBe(false);

    const second = render();
    expect(field(second).props.secureTextEntry).toBe(true);
  });
});
