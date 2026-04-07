import { useEffect, useRef, useCallback, useState } from "react";

export function usePolling(fn, intervalMs) {
  const [refreshing, setRefreshing] = useState(false);
  const savedFn = useRef(fn);
  savedFn.current = fn;

  useEffect(() => {
    savedFn.current();
    const id = setInterval(() => savedFn.current(), intervalMs);
    return () => clearInterval(id);
  }, [intervalMs]);

  const onRefresh = useCallback(async () => {
    setRefreshing(true);
    await savedFn.current();
    setRefreshing(false);
  }, []);

  return { refreshing, onRefresh };
}
