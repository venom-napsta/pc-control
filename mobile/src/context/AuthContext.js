import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import Constants from "expo-constants";

const SERVER = Constants.expoConfig?.extra?.serverUrl || process.env.EXPO_PUBLIC_SERVER || "http://localhost:2000";

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  const api = useCallback(async (method, endpoint, body = null) => {
    const headers = { "x-pin": password };
    if (body) headers["Content-Type"] = "application/json";
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);

    let res;
    try {
      res = await fetch(`${SERVER}${endpoint}`, options);
    } catch (netErr) {
      const err = new Error(
        netErr.message === "Network request failed"
          ? "Network unreachable — is the server running?"
          : `Network error: ${netErr.message}`
      );
      err.method = method;
      err.endpoint = endpoint;
      throw err;
    }

    if (!res.ok) {
      let serverMsg = "";
      try {
        const text = await res.text();
        try {
          const json = JSON.parse(text);
          serverMsg = json.error || json.message || json.detail || text;
        } catch {
          serverMsg = text;
        }
      } catch {}
      const err = new Error(
        serverMsg
          ? `${res.status} — ${serverMsg}`
          : `Server responded ${res.status} ${res.statusText}`
      );
      err.status = res.status;
      err.method = method;
      err.endpoint = endpoint;
      throw err;
    }

    return res.json();
  }, [password]);

  const [authError, setAuthError] = useState(null);

  const authenticate = useCallback(async () => {
    if (password.length < 1) return;
    setLoading(true);
    setAuthError(null);
    try {
      await api("GET", "/status");
      setAuthenticated(true);
    } catch (e) {
      const msg = e.status === 401
        ? "Incorrect password"
        : e.message || "Server unreachable";
      setAuthError(msg);
    }
    setLoading(false);
  }, [api, password]);

  const logout = useCallback(() => {
    setAuthenticated(false);
    setPassword("");
  }, []);

  useEffect(() => {
    if (!authenticated) return;
    (async () => {
      try {
        if (!Device.isDevice) return;
        const { status: existing } = await Notifications.getPermissionsAsync();
        let finalStatus = existing;
        if (existing !== "granted") {
          const { status } = await Notifications.requestPermissionsAsync();
          finalStatus = status;
        }
        if (finalStatus !== "granted") return;
        if (Platform.OS === "android") {
          await Notifications.setNotificationChannelAsync("default", {
            name: "default",
            importance: Notifications.AndroidImportance.MAX,
          });
        }
        const tokenData = await Notifications.getExpoPushTokenAsync();
        await api("POST", "/register-token", { token: tokenData.data });
      } catch (e) {
        console.log("Push registration skipped:", e.message);
      }
    })();
  }, [authenticated, api]);

  return (
    <AuthContext.Provider value={{
      api, password, setPassword, authenticated, loading, authenticate, logout, authError,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
