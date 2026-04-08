import { createContext, useContext, useState, useCallback, useRef } from "react";
import { ErrorToast } from "../components/ErrorToast";

const ErrorContext = createContext(null);

export function useError() {
  return useContext(ErrorContext);
}

function parseError(err) {
  if (err && err.apiError) return err.apiError;

  if (err instanceof TypeError && err.message === "Network request failed") {
    return { message: "Network unreachable — check Wi-Fi or server", status: null };
  }

  if (err instanceof Error) {
    return { message: err.message, status: err.status || null, method: err.method, endpoint: err.endpoint };
  }

  return { message: String(err), status: null };
}

export function ErrorProvider({ children }) {
  const [error, setError] = useState(null);
  const timerRef = useRef(null);

  const showError = useCallback((title, err) => {
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
