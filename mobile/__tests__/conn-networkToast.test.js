jest.mock("../src/components/ErrorToast", () => ({ ErrorToast: jest.fn(() => null) }));

import { useEffect, act } from "react";
import TestRenderer from "react-test-renderer";
import { ErrorToast } from "../src/components/ErrorToast";
import {
  ErrorProvider, useError, shouldShowNetworkToast, isNetworkErrorReport, NETWORK_TOAST_INTERVAL_MS,
} from "../src/context/ErrorContext";

global.IS_REACT_ACT_ENVIRONMENT = true;

const T0 = new Date("2026-09-07T10:00:00Z").getTime();

beforeEach(() => {
  jest.useFakeTimers();
  jest.setSystemTime(T0);
  // Silence React 19's react-test-renderer deprecation notice; the renderer works.
  jest.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

describe("shouldShowNetworkToast", () => {
  test("the first network toast always shows", () => {
    expect(shouldShowNetworkToast(null, Date.now())).toBe(true);
    expect(shouldShowNetworkToast(undefined, Date.now())).toBe(true);
  });

  test("a second one inside the window is suppressed", () => {
    const shownAt = Date.now();
    jest.advanceTimersByTime(1);
    expect(shouldShowNetworkToast(shownAt, Date.now())).toBe(false);
    jest.advanceTimersByTime(NETWORK_TOAST_INTERVAL_MS - 2);
    expect(shouldShowNetworkToast(shownAt, Date.now())).toBe(false);
  });

  test("shows again once the window has elapsed", () => {
    const shownAt = Date.now();
    jest.advanceTimersByTime(NETWORK_TOAST_INTERVAL_MS);
    expect(shouldShowNetworkToast(shownAt, Date.now())).toBe(true);
    jest.advanceTimersByTime(60000);
    expect(shouldShowNetworkToast(shownAt, Date.now())).toBe(true);
  });

  test("the window is 30 seconds by default and can be overridden", () => {
    expect(NETWORK_TOAST_INTERVAL_MS).toBe(30000);
    expect(shouldShowNetworkToast(0, 999, 1000)).toBe(false);
    expect(shouldShowNetworkToast(0, 1000, 1000)).toBe(true);
  });
});

describe("isNetworkErrorReport", () => {
  test("recognises api() network kinds only", () => {
    expect(isNetworkErrorReport(Object.assign(new Error("x"), { kind: "unreachable" }))).toBe(true);
    expect(isNetworkErrorReport(Object.assign(new Error("x"), { kind: "timeout" }))).toBe(true);
    expect(isNetworkErrorReport(Object.assign(new Error("x"), { status: 500 }))).toBe(false);
    expect(isNetworkErrorReport(new TypeError("Network request failed"))).toBe(false);
    expect(isNetworkErrorReport(null)).toBe(false);
    expect(isNetworkErrorReport("plain")).toBe(false);
  });
});

// ── ErrorProvider integration ─────────────────────────────

function Harness({ onApi }) {
  const api = useError();
  useEffect(() => { onApi(api); });
  return null;
}

async function mount() {
  let latest;
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(
      <ErrorProvider><Harness onApi={(a) => { latest = a; }} /></ErrorProvider>,
    );
  });
  return { renderer, api: () => latest };
}

function visibleToast(renderer) {
  const toasts = renderer.root.findAllByType(ErrorToast);
  return toasts.length ? toasts[0].props.error : null;
}

const unreachable = (msg = "Can't reach the PC.") => Object.assign(new Error(msg), { kind: "unreachable", method: "GET", endpoint: "/status" });
const timeout = (msg = "No answer from the PC in 10s.") => Object.assign(new Error(msg), { kind: "timeout" });
const httpError = (status, msg) => Object.assign(new Error(msg), { status, method: "GET", endpoint: "/status" });

describe("ErrorProvider network toast throttling", () => {
  test("shows the first network error, swallows repeats for 30 s, then shows again", async () => {
    const { renderer, api } = await mount();
    expect(visibleToast(renderer)).toBeNull();

    await act(async () => { api().showError("STATUS FETCH FAILED", unreachable("first")); });
    expect(visibleToast(renderer)).toMatchObject({ title: "STATUS FETCH FAILED", message: "first" });

    // A poll every second keeps failing: nothing new appears...
    for (let i = 0; i < 4; i++) {
      await act(() => jest.advanceTimersByTimeAsync(1000));
      await act(async () => { api().showError("STATUS FETCH FAILED", i % 2 ? timeout("later") : unreachable("later")); });
      expect(visibleToast(renderer)?.message).toBe("first");
    }
    // ...and the first toast still auto-dismisses after 5 s.
    await act(() => jest.advanceTimersByTimeAsync(1000));
    expect(visibleToast(renderer)).toBeNull();
    await act(async () => { api().showError("STATUS FETCH FAILED", unreachable("still suppressed")); });
    expect(visibleToast(renderer)).toBeNull();

    // Once the window has passed, the next one shows.
    await act(() => jest.advanceTimersByTimeAsync(NETWORK_TOAST_INTERVAL_MS - 5000));
    await act(async () => { api().showError("STATUS FETCH FAILED", timeout("back")); });
    expect(visibleToast(renderer)).toMatchObject({ title: "STATUS FETCH FAILED", message: "back", status: null });
  });

  test("other errors are never throttled", async () => {
    const { renderer, api } = await mount();
    await act(async () => { api().showError("A", unreachable("net")); });
    expect(visibleToast(renderer)?.message).toBe("net");

    await act(() => jest.advanceTimersByTimeAsync(1));
    await act(async () => { api().showError("B", httpError(500, "500 — boom")); });
    expect(visibleToast(renderer)).toMatchObject({ title: "B", message: "500 — boom", status: 500 });

    await act(() => jest.advanceTimersByTimeAsync(1));
    await act(async () => { api().showError("C", httpError(401, "401 — Invalid credentials")); });
    expect(visibleToast(renderer)).toMatchObject({ title: "C", status: 401 });

    await act(() => jest.advanceTimersByTimeAsync(1));
    await act(async () => { api().showError("D", "plain string"); });
    expect(visibleToast(renderer)).toMatchObject({ title: "D", message: "plain string" });

    // A network error inside the window is still held back even though other
    // toasts have shown in between.
    await act(() => jest.advanceTimersByTimeAsync(1));
    await act(async () => { api().showError("E", unreachable("net again")); });
    expect(visibleToast(renderer)?.title).toBe("D");
  });

  test("dismissing a toast does not reset the network window", async () => {
    const { renderer, api } = await mount();
    await act(async () => { api().showError("A", unreachable("net")); });
    await act(async () => { api().clearError(); });
    expect(visibleToast(renderer)).toBeNull();
    await act(() => jest.advanceTimersByTimeAsync(1000));
    await act(async () => { api().showError("A", unreachable("net")); });
    expect(visibleToast(renderer)).toBeNull();
  });
});
