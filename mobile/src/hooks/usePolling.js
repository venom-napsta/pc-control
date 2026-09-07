import { useEffect, useRef, useCallback, useState } from "react";
import { AppState } from "react-native";
import { useIsFocused } from "@react-navigation/native";
import { createPoller } from "../polling";

// True while the app is in the foreground. Polling a PC every 5 s from a
// backgrounded app burns the device battery and the server's CPU for nothing.
export function useAppActive() {
  const initial = AppState.currentState;
  const [active, setActive] = useState(!initial || initial === "active");
  useEffect(() => {
    const sub = AppState.addEventListener("change", (state) => setActive(state === "active"));
    return () => sub.remove();
  }, []);
  return active;
}

// Poll `fn` every intervalMs, but only while this screen is focused and the
// app is in the foreground. Tab screens stay mounted after their first visit,
// so without the focus check every visited tab kept polling forever.
export function usePolling(fn, intervalMs) {
  const [refreshing, setRefreshing] = useState(false);
  const savedFn = useRef(fn);
  savedFn.current = fn;
  const isFocused = useIsFocused();
  const appActive = useAppActive();
  const shouldPoll = isFocused && appActive;
  const pollerRef = useRef(null);
  const shouldPollRef = useRef(shouldPoll);
  shouldPollRef.current = shouldPoll;

  useEffect(() => {
    const poller = createPoller(() => savedFn.current(), intervalMs);
    pollerRef.current = poller;
    poller.setActive(shouldPollRef.current);
    return () => {
      poller.stop();
      if (pollerRef.current === poller) pollerRef.current = null;
    };
  }, [intervalMs]);

  useEffect(() => {
    pollerRef.current?.setActive(shouldPoll);
  }, [shouldPoll]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    try {
      await (pollerRef.current ? pollerRef.current.run() : savedFn.current());
    } finally {
      setRefreshing(false);
    }
  }, []);

  return { refreshing, onRefresh };
}
