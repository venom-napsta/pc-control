import { createContext, useContext, useState, useCallback, useEffect } from "react";
import { Alert, Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

const SERVER = process.env.EXPO_PUBLIC_SERVER || "http://localhost:8000";

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
    const res = await fetch(`${SERVER}${endpoint}`, options);
    if (res.status === 401) throw new Error("Invalid credentials");
    return res.json();
  }, [password]);

  const authenticate = useCallback(async () => {
    if (password.length < 1) return;
    setLoading(true);
    try {
      await api("GET", "/status");
      setAuthenticated(true);
    } catch {
      Alert.alert("Access Denied", "Incorrect password or server unreachable");
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
      api, password, setPassword, authenticated, loading, authenticate, logout,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
