// The hook picks its event names by platform, so react-native is replaced
// wholesale here to control Platform.OS and to capture the listeners.
let mockOS = "android";
const mockRegistered = {};

jest.mock("react-native", () => ({
  get Platform() {
    return { OS: mockOS };
  },
  Keyboard: {
    addListener: (event, cb) => {
      mockRegistered[event] = cb;
      return { remove: () => { delete mockRegistered[event]; } };
    },
  },
}));

import { act } from "react";
import TestRenderer from "react-test-renderer";
import { useKeyboardVisible, keyboardEvents, keyboardAvoidBehavior } from "../src/keyboard";

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  mockOS = "android";
  for (const k of Object.keys(mockRegistered)) delete mockRegistered[k];
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => jest.restoreAllMocks());

function mount(hook = useKeyboardVisible) {
  const seen = [];
  function Probe() {
    seen.push(hook());
    return null;
  }
  let tree;
  act(() => { tree = TestRenderer.create(<Probe />); });
  return { seen, tree, latest: () => seen[seen.length - 1] };
}


const emit = (event) => act(() => { mockRegistered[event]?.(); });

describe("useKeyboardVisible", () => {
  test("starts hidden", () => {
    expect(mount().latest()).toBe(false);
  });

  test("on Android it listens for the Did events", () => {
    // Android never emits keyboardWillShow, so subscribing to the Will pair
    // there would mean never hearing about the keyboard at all.
    mount();
    expect(Object.keys(mockRegistered).sort()).toEqual(["keyboardDidHide", "keyboardDidShow"]);
  });

  test("iOS gets the Will pair, so the layout moves with the animation", () => {
    expect(keyboardEvents("ios")).toEqual({
      show: "keyboardWillShow",
      hide: "keyboardWillHide",
    });
  });

  test("every other platform gets the Did pair", () => {
    // Android emits only these two; asking for Will would hear nothing.
    expect(keyboardEvents("android")).toEqual({
      show: "keyboardDidShow",
      hide: "keyboardDidHide",
    });
    expect(keyboardEvents("web")).toEqual(keyboardEvents("android"));
  });

  test("follows the keyboard up and back down", () => {
    const h = mount();
    emit("keyboardDidShow");
    expect(h.latest()).toBe(true);
    emit("keyboardDidHide");
    expect(h.latest()).toBe(false);
  });

  test("unsubscribes on unmount", () => {
    const h = mount();
    act(() => { h.tree.unmount(); });
    expect(Object.keys(mockRegistered)).toEqual([]);
  });
});

describe("keyboardAvoidBehavior", () => {
  test("iOS pads, so the content lifts above the keyboard", () => {
    expect(keyboardAvoidBehavior("ios")).toBe("padding");
  });

  test("Android gets a behaviour rather than none", () => {
    // This is the whole bug: it used to be undefined on Android, on the
    // assumption that adjustResize would shrink the window. Edge-to-edge
    // stops that, so the keyboard just covered whatever was being typed into.
    expect(keyboardAvoidBehavior("android")).toBe("height");
    expect(keyboardAvoidBehavior("android")).not.toBeUndefined();
  });

  test("an unknown platform is treated like Android, never left undefined", () => {
    for (const os of ["web", "windows", "macos", ""]) {
      expect(keyboardAvoidBehavior(os)).toBe("height");
    }
  });
});

// A guard, not a unit test: three separate avoiding views had drifted into
// disabling themselves on Android. Any new one must go through the helper.
describe("every KeyboardAvoidingView in the app", () => {
  const fs = require("fs");
  const path = require("path");

  function sourceFiles(dir, out = []) {
    for (const e of fs.readdirSync(dir, { withFileTypes: true })) {
      const p = path.join(dir, e.name);
      if (e.isDirectory()) sourceFiles(p, out);
      else if (/\.(js|jsx|ts|tsx)$/.test(e.name)) out.push(p);
    }
    return out;
  }

  test("takes its behaviour from keyboardAvoidBehavior", () => {
    // Resolve src/ from the module graph rather than __dirname, which is not a
    // global and so is not available here.
    const root = path.dirname(require.resolve("../src/keyboard"));
    const offenders = [];
    for (const file of sourceFiles(root)) {
      const src = fs.readFileSync(file, "utf8");
      if (!src.includes("<KeyboardAvoidingView")) continue;
      // Every behavior= prop on an avoiding view must call the helper.
      for (const m of src.matchAll(/behavior=\{([^}]*)\}/g)) {
        if (!m[1].includes("keyboardAvoidBehavior")) {
          offenders.push(`${path.relative(root, file)}: behavior={${m[1].trim()}}`);
        }
      }
      // And none may switch itself off.
      for (const m of src.matchAll(/enabled=\{([^}]*)\}/g)) {
        offenders.push(`${path.relative(root, file)}: enabled={${m[1].trim()}}`);
      }
    }
    expect(offenders).toEqual([]);
  });

  test("the guard can actually see the avoiding views", () => {
    // Otherwise the test above would pass by finding nothing at all.
    // Resolve src/ from the module graph rather than __dirname, which is not a
    // global and so is not available here.
    const root = path.dirname(require.resolve("../src/keyboard"));
    const withKav = sourceFiles(root)
      .filter((f) => fs.readFileSync(f, "utf8").includes("<KeyboardAvoidingView"));
    expect(withKav.length).toBeGreaterThanOrEqual(3);
  });
});
