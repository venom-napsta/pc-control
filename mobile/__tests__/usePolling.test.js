jest.mock("@react-navigation/native", () => ({ useIsFocused: jest.fn(() => true) }));

import { useEffect, act } from "react";
import TestRenderer from "react-test-renderer";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { usePolling } from "../src/hooks/usePolling";

global.IS_REACT_ACT_ENVIRONMENT = true;

function Harness({ fn, interval, onApi }) {
  const api = usePolling(fn, interval);
  useEffect(() => { onApi(api); });
  return null;
}

let appStateListener;
beforeEach(() => {
  jest.useFakeTimers();
  // Silence React 19's react-test-renderer deprecation notice; the renderer works.
  jest.spyOn(console, "error").mockImplementation(() => {});
  useIsFocused.mockReturnValue(true);
  AppState.currentState = "active";
  jest.spyOn(AppState, "addEventListener").mockImplementation((type, cb) => {
    appStateListener = cb;
    return { remove: jest.fn() };
  });
});
afterEach(() => {
  jest.useRealTimers();
  jest.restoreAllMocks();
});

async function mount(fn, interval = 1000) {
  let latest;
  let renderer;
  await act(async () => {
    renderer = TestRenderer.create(<Harness fn={fn} interval={interval} onApi={(a) => { latest = a; }} />);
  });
  return { renderer, api: () => latest };
}

describe("usePolling", () => {
  test("polls while focused and foregrounded", async () => {
    const fn = jest.fn(async () => {});
    await mount(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    await act(() => jest.advanceTimersByTimeAsync(2000));
    expect(fn).toHaveBeenCalledTimes(3);
  });

  test("pauses when the screen loses focus and resumes when it regains it", async () => {
    const fn = jest.fn(async () => {});
    const { renderer } = await mount(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    useIsFocused.mockReturnValue(false);
    await act(async () => {
      renderer.update(<Harness fn={fn} interval={1000} onApi={() => {}} />);
    });
    await act(() => jest.advanceTimersByTimeAsync(5000));
    expect(fn).toHaveBeenCalledTimes(1);

    useIsFocused.mockReturnValue(true);
    await act(async () => {
      renderer.update(<Harness fn={fn} interval={1000} onApi={() => {}} />);
    });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("pauses when the app goes to the background", async () => {
    const fn = jest.fn(async () => {});
    await mount(fn);
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => { appStateListener("background"); });
    await act(() => jest.advanceTimersByTimeAsync(5000));
    expect(fn).toHaveBeenCalledTimes(1);

    await act(async () => { appStateListener("active"); });
    expect(fn).toHaveBeenCalledTimes(2);
  });

  test("onRefresh awaits one run and toggles the refreshing flag", async () => {
    let release;
    const fn = jest.fn(() => new Promise((r) => { release = r; }));
    const { api } = await mount(fn);
    expect(fn).toHaveBeenCalledTimes(1);
    release(); // finish the initial run
    await act(async () => {});

    let refreshPromise;
    await act(async () => { refreshPromise = api().onRefresh(); });
    expect(api().refreshing).toBe(true);
    expect(fn).toHaveBeenCalledTimes(2);
    release();
    await act(async () => { await refreshPromise; });
    expect(api().refreshing).toBe(false);
  });

  test("stops polling on unmount", async () => {
    const fn = jest.fn(async () => {});
    const { renderer } = await mount(fn);
    await act(async () => { renderer.unmount(); });
    await act(() => jest.advanceTimersByTimeAsync(5000));
    expect(fn).toHaveBeenCalledTimes(1);
    expect(jest.getTimerCount()).toBe(0);
  });
});
