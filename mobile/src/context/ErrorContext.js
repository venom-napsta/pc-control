import { createContext, useContext, useState, useCallback, useRef } from "react";
import { ErrorToast } from "../components/ErrorToast";
import { connectionFailureMessage, isNetworkError, isTimeoutError } from "../config";
import { isNetworkErrorKind } from "../connectionState";

const ErrorContext = createContext(null);

// Every polling screen reports the same "can't reach the PC" failure every few
// seconds while the PC is away, so those toasts are rate-limited to one per
// window. Other errors (a 500, a rejected PIN) always show.
export const NETWORK_TOAST_INTERVAL_MS = 30000;

export function useError() {
  return useContext(ErrorContext);
}

export function parseError(err) {
  if (err && err.apiError) return err.apiError;

  // Raw fetch failures that did not go through api() (e.g. file downloads).
  if (isNetworkError(err) || isTimeoutError(err)) {
    return { message: connectionFailureMessage(err), status: null };
  }

  if (err instanceof Error) {
    return { message: err.message, status: err.status || null, method: err.method, endpoint: err.endpoint };
  }

  return { message: String(err), status: null };
}

// True when an error carries an api() network kind ("unreachable" | "timeout").
export function isNetworkErrorReport(err) {
  return isNetworkErrorKind(err?.kind);
}

// Pure throttling decision. lastShownAt is the Date.now() of the previous
// network toast (null when none has been shown yet).
export function shouldShowNetworkToast(lastShownAt, now, intervalMs = NETWORK_TOAST_INTERVAL_MS) {
  if (lastShownAt == null) return true;
  return now - lastShownAt >= intervalMs;
}

export function ErrorProvider({ children }) {
  const [error, setError] = useState(null);
  const timerRef = useRef(null);
  const lastNetworkToastRef = useRef(null);

  const showError = useCallback((title, err) => {
    if (isNetworkErrorReport(err)) {
      const now = Date.now();
      if (!shouldShowNetworkToast(lastNetworkToastRef.current, now)) return;
      lastNetworkToastRef.current = now;
    }
    clearTimeout(timerRef.current);
    const parsed = parseError(err);
    setError({ title, ...parsed, id: Date.now() });
    timerRef.current = setTimeout(() => setError(null), 5000);
  }, []);

  const clearError = useCallback(() => {
    clearTimeout(timerRef.current);
    setError(null);
  }, []);

  return (
    <ErrorContext.Provider value={{ showError, clearError }}>
      {children}
      {error && <ErrorToast key={error.id} error={error} onDismiss={clearError} />}
    </ErrorContext.Provider>
  );
}
