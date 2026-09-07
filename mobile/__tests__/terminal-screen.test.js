const mockInject = jest.fn();
jest.mock("react-native-webview", () => {
  const React = require("react");
  // Renders nothing, but exposes injectJavaScript through the ref like the
  // real component so the screen's injections can be observed.
  const WebView = React.forwardRef((props, ref) => {
    React.useImperativeHandle(ref, () => ({ injectJavaScript: mockInject }));
    return null;
  });
  return { WebView };
});
jest.mock("@expo/vector-icons", () => ({ Ionicons: () => null }));
jest.mock("react-native-safe-area-context", () => {
  const { View } = require("react-native");
  return { SafeAreaView: jest.fn(({ children, style }) => <View style={style}>{children}</View>) };
});
jest.mock("../src/context/AuthContext", () => ({
  useAuth: () => ({ password: "s3cret", server: "http://pc:2000" }),
}));

import { act } from "react";
import TestRenderer from "react-test-renderer";
import { Text, ActivityIndicator, KeyboardAvoidingView } from "react-native";
import { WebView } from "react-native-webview";
import { SafeAreaView } from "react-native-safe-area-context";
import { TerminalScreen, CONNECT_TIMEOUT_MS } from "../src/screens/TerminalScreen";

global.IS_REACT_ACT_ENVIRONMENT = true;

beforeEach(() => {
  jest.useFakeTimers();
  setTimeoutSpy = jest.spyOn(global, "setTimeout");
  clearTimeoutSpy = jest.spyOn(global, "clearTimeout");
  // Silence React 19's react-test-renderer deprecation notice; the renderer works.
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function mount() {
  let renderer;
  await act(async () => { renderer = TestRenderer.create(<TerminalScreen />); });
  return renderer;
}

const labels = (renderer) => renderer.root.findAllByType(Text).map((t) => t.props.children).flat();
const statusLabel = (renderer) => {
  const known = ["READY", "CONNECTING...", "CONNECTED", "DISCONNECTED", "REJECTED", "TERMINAL ASSETS DIDN'T LOAD", "ERROR"];
  return labels(renderer).find((l) => known.includes(l));
};
const spinnerCount = (renderer) => renderer.root.findAllByType(ActivityIndicator).length;
const webview = (renderer) => renderer.root.findByType(WebView);

async function pressConnect(renderer) {
  const btn = renderer.root.findAllByProps({ accessibilityLabel: "Connect terminal" })[0];
  await act(async () => { btn.props.onPress(); });
}

// React Native's own components schedule timers too, so instead of counting
// timers we track the id of the screen's 10 s connect timer specifically.
let setTimeoutSpy;
let clearTimeoutSpy;
const connectTimerIds = () => setTimeoutSpy.mock.calls
  .map((args, i) => (args[1] === CONNECT_TIMEOUT_MS ? setTimeoutSpy.mock.results[i].value : null))
  .filter((id) => id != null);
const connectTimerCleared = () => connectTimerIds().every((id) => clearTimeoutSpy.mock.calls.some(([x]) => x === id));

// The composite Pressable is a couple of levels above its label.
function pressableAbove(node) {
  let n = node;
  while (n && typeof n.props?.onPress !== "function") n = n.parent;
  return n;
}
async function pageSays(renderer, msg) {
  await act(async () => { webview(renderer).props.onMessage({ nativeEvent: { data: msg } }); });
}

describe("TerminalScreen", () => {
  test("starts idle inside a top-edge safe area", async () => {
    const renderer = await mount();
    expect(statusLabel(renderer)).toBe("READY");
    expect(renderer.root.findAllByType(WebView)).toHaveLength(0);
    const safe = renderer.root.findAllByType(SafeAreaView)[0];
    expect(safe.props.edges).toEqual(["top"]);
  });

  test("the page loads xterm from the PC and never contains the PIN", async () => {
    const renderer = await mount();
    await pressConnect(renderer);
    const { source } = webview(renderer).props;
    expect(source.html).toMatch('src="http://pc:2000/static/xterm.js"');
    expect(source.html).toMatch('src="http://pc:2000/static/addon-fit.js"');
    expect(source.html).toMatch('href="http://pc:2000/static/xterm.css"');
    expect(source.html).not.toMatch(/jsdelivr/);
    expect(source.html).not.toMatch(/s3cret/);
    expect(source.html).not.toMatch(/ws:\/\//);
  });

  test("the WebView and toolbar sit inside a KeyboardAvoidingView", async () => {
    const renderer = await mount();
    await pressConnect(renderer);
    const kav = renderer.root.findByType(KeyboardAvoidingView);
    expect(kav.findAllByType(WebView)).toHaveLength(1);
    expect(kav.findAllByProps({ keyboardShouldPersistTaps: "always" }).length).toBeGreaterThan(0);
  });

  test("gives up after 10 s when the page never reports back", async () => {
    const renderer = await mount();
    await pressConnect(renderer);
    expect(statusLabel(renderer)).toBe("CONNECTING...");
    expect(spinnerCount(renderer)).toBe(1);

    await act(() => jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS - 1));
    expect(statusLabel(renderer)).toBe("CONNECTING...");
    expect(spinnerCount(renderer)).toBe(1);

    await act(() => jest.advanceTimersByTimeAsync(1));
    expect(statusLabel(renderer)).toBe("ERROR");
    expect(spinnerCount(renderer)).toBe(0);
    expect(CONNECT_TIMEOUT_MS).toBe(10000);
  });

  test("a connected message in time cancels the timer", async () => {
    const renderer = await mount();
    await pressConnect(renderer);
    await act(() => jest.advanceTimersByTimeAsync(2000));
    await pageSays(renderer, "connected");
    expect(statusLabel(renderer)).toBe("CONNECTED");
    expect(spinnerCount(renderer)).toBe(0);
    expect(connectTimerIds()).toHaveLength(1);
    expect(connectTimerCleared()).toBe(true);
    await act(() => jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2));
    expect(statusLabel(renderer)).toBe("CONNECTED");
  });

  test.each([
    ["assets_failed", "TERMINAL ASSETS DIDN'T LOAD"],
    ["auth_failed", "REJECTED"],
    ["disconnected", "DISCONNECTED"],
    ["error", "ERROR"],
  ])("a %s message settles the status and stops the timer", async (msg, label) => {
    const renderer = await mount();
    await pressConnect(renderer);
    await pageSays(renderer, msg);
    expect(statusLabel(renderer)).toBe(label);
    expect(spinnerCount(renderer)).toBe(0);
    expect(connectTimerCleared()).toBe(true);
    await act(() => jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2));
    expect(statusLabel(renderer)).toBe(label);
  });

  test("the timer does not fire after disconnecting or unmounting", async () => {
    const renderer = await mount();
    await pressConnect(renderer);
    await pageSays(renderer, "connected");
    const disc = renderer.root.findAllByProps({ accessibilityLabel: "Disconnect terminal" })[0];
    await act(async () => { disc.props.onPress(); });
    expect(statusLabel(renderer)).toBe("READY");

    await pressConnect(renderer);
    expect(connectTimerIds()).toHaveLength(2);
    expect(connectTimerCleared()).toBe(false); // the second one is live
    await act(async () => { renderer.unmount(); });
    expect(connectTimerCleared()).toBe(true);
    // Nothing left to fire.
    await act(() => jest.advanceTimersByTimeAsync(CONNECT_TIMEOUT_MS * 2));
  });

  test("hands the page the WebSocket address and PIN only once it has loaded", async () => {
    const renderer = await mount();
    await pressConnect(renderer);
    expect(mockInject).not.toHaveBeenCalled();
    await act(async () => { webview(renderer).props.onLoadEnd(); });
    expect(mockInject).toHaveBeenCalledTimes(1);
    expect(mockInject).toHaveBeenCalledWith('window.startTerminal({"wsUrl":"ws://pc:2000","pin":"s3cret"}); true;');
  });

  test("extra keys are forwarded to the page", async () => {
    const renderer = await mount();
    await pressConnect(renderer);
    const tab = renderer.root.findAll((n) => n.type === Text && n.props.children === "TAB")[0];
    const press = pressableAbove(tab);
    await act(async () => { press.props.onPress(); });
    expect(mockInject).toHaveBeenCalledWith('window.sendTermKey("\\t"); true;');
  });
});
