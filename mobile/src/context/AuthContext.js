import {
  createContext, useContext, useState, useCallback, useEffect, useRef, useReducer,
} from "react";
import { Platform } from "react-native";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";
import {
  DEFAULT_SERVERS, DEFAULT_TIMEOUT_MS, LOGIN_TIMEOUT_MS, PROBE_TIMEOUT_MS, NO_INTERNET_MESSAGE,
  fetchWithTimeout, connectionFailureMessage, noServerMessage, isTimeoutError, hasInternet,
} from "../config";
import { resolveServer, probeAll } from "../connection";
import {
  normalizeServerUrl, dedupe, loadServers, saveServers, clearServers, loadLastGood, saveLastGood,
  loadRemember, saveRemember,
} from "../servers";
import { reduceConnection, INITIAL_CONNECTION } from "../connectionState";
import { requiresPin, isSessionExpired } from "../session";
import {
  biometricsAvailable, hasSavedPassword, savePassword, forgetPassword, unlockPassword,
} from "../credentials";

export const SESSION_REJECTED_MESSAGE = "Password rejected by the PC. Sign in again.";

function credentialError(message, status) {
  const err = new Error(message);
  err.status = status;
  return err;
}

// The PC sends Retry-After alongside its 429, so quote the wait instead of a
// bare status code. Guarded because res.headers is absent in some fetch mocks.
function retryAfterMessage(res) {
  const retry = Number(res?.headers?.get?.("retry-after")) || 0;
  return retry
    ? `Too many failed attempts. Try again in ${retry}s.`
    : "Too many failed attempts. Try again shortly.";
}

const AuthContext = createContext(null);

export function useAuth() {
  return useContext(AuthContext);
}

export function AuthProvider({ children }) {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);
  const [authError, setAuthError] = useState(null);
  const authenticatedRef = useRef(false);
  // Session token, held only in memory. Polls carry this instead of the Linux
  // password; destructive routes still demand the password itself.
  const tokenRef = useRef(null);
  const [hasSession, setHasSession] = useState(false);
  // Biometric unlock: only offered when the device can do it AND a password
  // has actually been saved.
  const [biometrics, setBiometrics] = useState({ available: false, saved: false });
  const [remember, setRemember] = useState(false);
  const rememberRef = useRef(false);

  // Candidate addresses (persisted, editable on the device) and the one in use.
  const [servers, setServers] = useState(DEFAULT_SERVERS);
  const [server, setServer] = useState(null);
  const [serverInfo, setServerInfo] = useState(null);
  const [lastGood, setLastGood] = useState(null);
  const serversRef = useRef(DEFAULT_SERVERS);
  const serverRef = useRef(null);
  const reconnectPromiseRef = useRef(null);

  // "unknown" until the first request; "online" after any response from the
  // PC; "unreachable" after a network failure (with the message that explains it).
  const [connection, dispatchConnection] = useReducer(reduceConnection, INITIAL_CONNECTION);

  useEffect(() => {
    serversRef.current = servers;
  }, [servers]);

  useEffect(() => {
    authenticatedRef.current = authenticated;
  }, [authenticated]);

  useEffect(() => {
    let cancelled = false;
    (async () => {
      const [stored, last, wantRemember, available, saved] = await Promise.all([
        loadServers(DEFAULT_SERVERS), loadLastGood(), loadRemember(),
        biometricsAvailable(), hasSavedPassword(),
      ]);
      if (cancelled) return;
      setServers(stored);
      setLastGood(last);
      rememberRef.current = wantRemember;
      setRemember(wantRemember);
      setBiometrics({ available, saved });
    })();
    return () => { cancelled = true; };
  }, []);

  const activate = useCallback((result) => {
    serverRef.current = result.url;
    setServer(result.url);
    setServerInfo({
      host: result.host ?? null,
      version: result.version ?? null,
      latencyMs: result.latencyMs ?? null,
    });
    setLastGood(result.url);
    saveLastGood(result.url);
  }, []);

  // Probe every saved address in parallel and switch to the first that answers.
  const connect = useCallback(async () => {
    const found = await resolveServer(serversRef.current, PROBE_TIMEOUT_MS);
    if (found) activate(found);
    return found;
  }, [activate]);

  // Called when a request fails mid-session so the app roams between LAN and
  // Tailscale on its own. A burst of failures probes only once: every caller
  // during that window awaits the same in-flight probe.
  const reconnect = useCallback(() => {
    if (reconnectPromiseRef.current) return reconnectPromiseRef.current;
    const pending = (async () => {
      try {
        const found = await connect();
        if (found) dispatchConnection({ type: "reconnected" });
        return found;
      } finally {
        reconnectPromiseRef.current = null;
      }
    })();
    reconnectPromiseRef.current = pending;
    return pending;
  }, [connect]);

  // Ask the PC to forget this session. Best effort: a failure here must not
  // block signing out locally.
  const revokeSession = useCallback(async () => {
    const token = tokenRef.current;
    const base = serverRef.current;
    tokenRef.current = null;
    setHasSession(false);
    if (!token || !base) return;
    try {
      await fetchWithTimeout(`${base}/logout`, {
        method: "POST",
        headers: { "x-token": token },
      }, PROBE_TIMEOUT_MS);
    } catch {
      // The token expires on its own, and a server restart drops it anyway.
    }
  }, []);

  const logout = useCallback(() => {
    revokeSession();
    authenticatedRef.current = false;
    setAuthenticated(false);
    setPassword("");
  }, [revokeSession]);

  // Trade the password for a token. Returns the token, or null when this
  // server does not offer sessions (older build, or SESSION_TTL=0), in which
  // case every request keeps carrying the PIN as before.
  const openSession = useCallback(async (pin, base) => {
    if (!pin || !base) return null;
    try {
      const res = await fetchWithTimeout(`${base}/login`, {
        method: "POST",
        headers: { "x-pin": pin, "x-device": Device.deviceName || Device.modelName || Platform.OS },
      }, LOGIN_TIMEOUT_MS);
      // The PC answered, so it is reachable even if it refused the password.
      dispatchConnection({ type: "success" });
      // A verdict on the password is final, so report it rather than returning
      // null. Null means "this server has no sessions", which the caller
      // answers by proving the password again through verifyWith() — a second
      // PAM check that spends another of the server's five per-IP attempts.
      // One mistyped password would then cost two, locking the address out
      // after three sign-ins instead of five.
      if (res.status === 401) throw credentialError("Incorrect password", 401);
      if (res.status === 429) throw credentialError(retryAfterMessage(res), 429);
      if (!res.ok) return null;
      const body = await res.json();
      if (!body?.token) return null;
      tokenRef.current = body.token;
      setHasSession(true);
      return body.token;
    } catch (e) {
      // Only a credential verdict is final. A transport failure still falls
      // back to verifyWith(), which supports servers predating /login.
      if (e?.status === 401 || e?.status === 429) throw e;
      return null;
    }
  }, []);

  const api = useCallback(async (method, endpoint, body = null, { timeoutMs = DEFAULT_TIMEOUT_MS } = {}) => {
    const fail = (message, kind, status) => {
      const err = new Error(message);
      if (kind) err.kind = kind;
      if (status) err.status = status;
      err.method = method;
      err.endpoint = endpoint;
      dispatchConnection({ type: "failure", kind, message });
      return err;
    };

    // No server picked yet (fresh launch, or the active one was removed):
    // look for one before giving up.
    let base = serverRef.current;
    if (!base) {
      const found = await reconnect();
      if (!found) throw fail(noServerMessage(serversRef.current), "unreachable");
      base = found.url;
    }

    const send = () => {
      // A token keeps the account password off the wire on every poll; the
      // destructive routes deliberately refuse tokens, so those still send it.
      const usePin = requiresPin(endpoint) || !tokenRef.current;
      const headers = usePin ? { "x-pin": password } : { "x-token": tokenRef.current };
      if (body) headers["Content-Type"] = "application/json";
      const options = { method, headers };
      if (body) options.body = JSON.stringify(body);
      return fetchWithTimeout(`${base}${endpoint}`, options, timeoutMs);
    };

    let res;
    try {
      res = await send();
    } catch (netErr) {
      reconnect().catch(() => {});
      throw fail(
        connectionFailureMessage(netErr, { timeoutMs, server: base }),
        isTimeoutError(netErr) ? "timeout" : "unreachable",
      );
    }

    // The PC answered, so it is reachable even if it refused the request.
    dispatchConnection({ type: "success" });

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

      // The token aged out or the PC restarted. Sign the session in again with
      // the password we already hold and retry once, so this is invisible.
      if (isSessionExpired(res.status, serverMsg) && password) {
        tokenRef.current = null;
        setHasSession(false);
        // openSession() now reports a refused password by throwing. Mid-session
        // that is not fatal, so swallow it and fall through to the 401 handling
        // below, which drops to the login screen and explains why.
        let reopened = null;
        try {
          reopened = await openSession(password, base);
        } catch {
          reopened = null;
        }
        if (reopened) {
          try {
            const retry = await send();
            if (retry.ok) return retry.json();
            res = retry;
          } catch (netErr) {
            reconnect().catch(() => {});
            throw fail(
              connectionFailureMessage(netErr, { timeoutMs, server: base }),
              isTimeoutError(netErr) ? "timeout" : "unreachable",
            );
          }
        }
      }

      // The PIN stopped working mid-session (changed on the PC, or a lockout):
      // drop back to the login screen and say why. A stale token is not that.
      if (res.status === 401 && authenticatedRef.current
          && !isSessionExpired(res.status, serverMsg)) {
        logout();
        setAuthError(SESSION_REJECTED_MESSAGE);
      }

      throw fail(
        serverMsg ? `${res.status} — ${serverMsg}` : `Server responded ${res.status} ${res.statusText}`,
        null,
        res.status,
      );
    }

    return res.json();
  }, [password, reconnect, logout, openSession]);

  // Turning this off also erases what is already stored.
  const setRememberPassword = useCallback(async (next) => {
    rememberRef.current = Boolean(next);
    setRemember(Boolean(next));
    await saveRemember(Boolean(next));
    if (!next) {
      await forgetPassword();
      setBiometrics((b) => ({ ...b, saved: false }));
    }
  }, []);

  // Check a password against the PC directly. Used only when the server has
  // no session support, so there is no token to fall back on.
  const verifyWith = useCallback(async (pin, base) => {
    let res;
    try {
      res = await fetchWithTimeout(`${base}/status`, {
        method: "GET",
        headers: { "x-pin": pin },
      }, LOGIN_TIMEOUT_MS);
    } catch (netErr) {
      const kind = isTimeoutError(netErr) ? "timeout" : "unreachable";
      const message = connectionFailureMessage(netErr, { timeoutMs: LOGIN_TIMEOUT_MS, server: base });
      dispatchConnection({ type: "failure", kind, message });
      const err = new Error(message);
      err.kind = kind;
      throw err;
    }
    dispatchConnection({ type: "success" });
    if (res.status === 401) {
      const err = new Error("Incorrect password");
      err.status = 401;
      throw err;
    }
    if (!res.ok) {
      const err = new Error(`Server responded ${res.status}`);
      err.status = res.status;
      throw err;
    }
    return res.json();
  }, []);

  // The header api() would use for this endpoint. For requests that cannot go
  // through api(), such as a multipart upload or an <Image> source.
  const authHeader = useCallback((endpoint = "/") => (
    (requiresPin(endpoint) || !tokenRef.current)
      ? { "x-pin": password }
      : { "x-token": tokenRef.current }
  ), [password]);

  // `pin` is passed only by unlockWithBiometrics(), which has the password out
  // of the keystore. Check the TYPE, not just null: this is also wired straight
  // to onPress and onSubmitEditing, which hand over a synthetic event, and an
  // event is neither null nor undefined — so `pin ?? password` would pick the
  // event and send the string "[object Object]" to PAM as the password.
  const authenticate = useCallback(async (pin = null) => {
    const secret = typeof pin === "string" ? pin : password;
    if (secret.length < 1) return;
    setLoading(true);
    setAuthError(null);
    try {
      const found = await connect();
      if (!found) {
        setAuthError((await hasInternet()) ? noServerMessage(serversRef.current) : NO_INTERNET_MESSAGE);
        return;
      }
      // Trade the password for a token before the first real call, so only
      // this one request carries the password.
      const token = await openSession(secret, found.url);
      if (!token) {
        // No sessions on this server: prove the password with a real call
        // before treating the sign-in as successful.
        await verifyWith(secret, found.url);
      }
      authenticatedRef.current = true;
      setAuthenticated(true);
      if (rememberRef.current) {
        const stored = await savePassword(secret);
        setBiometrics((b) => ({ ...b, saved: stored }));
      }
    } catch (e) {
      let msg;
      if (e.status === 401) {
        msg = "Incorrect password";
      } else if (e.kind) {
        // PC unreachable. Check the device has internet at all, so the message
        // blames Tailscale only when that is really the problem.
        msg = (await hasInternet()) ? e.message : NO_INTERNET_MESSAGE;
      } else {
        msg = e.message || "Server unreachable";
      }
      setAuthError(msg);
    } finally {
      setLoading(false);
    }
  }, [connect, openSession, password, verifyWith]);

  // Unlock with fingerprint/face, then sign in with the stored password.
  const unlockWithBiometrics = useCallback(async () => {
    setAuthError(null);
    const stored = await unlockPassword();
    if (!stored) {
      setAuthError("Unlock cancelled or unavailable. Type the password instead.");
      return;
    }
    setPassword(stored);
    await authenticate(stored);
  }, [authenticate]);

  // ── Server list management ─────────────────────────────

  const persist = useCallback(async (next) => {
    serversRef.current = next;
    setServers(next);
    await saveServers(next);
  }, []);

  const addServer = useCallback(async (input) => {
    const url = normalizeServerUrl(input);
    if (!url) {
      throw new Error("Enter an address like 192.168.1.10:2000 or venom.tailnet.ts.net:2000");
    }
    await persist(dedupe([...serversRef.current, url]));
    return url;
  }, [persist]);

  const removeServer = useCallback(async (url) => {
    await persist(serversRef.current.filter((u) => u !== url));
    if (serverRef.current === url) {
      serverRef.current = null;
      setServer(null);
      setServerInfo(null);
    }
  }, [persist]);

  const resetServers = useCallback(async () => {
    await clearServers();
    serversRef.current = DEFAULT_SERVERS;
    setServers(DEFAULT_SERVERS);
  }, []);

  const probeServers = useCallback(
    (timeoutMs = PROBE_TIMEOUT_MS) => probeAll(serversRef.current, timeoutMs),
    [],
  );

  // ── Push registration (one token per device; the server keeps them all) ──

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
        const device = Device.deviceName || Device.modelName || Platform.OS;
        await api("POST", "/register-token", { token: tokenData.data, device });
      } catch (e) {
        console.log("Push registration skipped:", e.message);
      }
    })();
  }, [authenticated, api]);

  return (
    <AuthContext.Provider value={{
      api, password, setPassword, authenticated, loading, authenticate, logout, authError,
      server, serverInfo, servers, lastGood, defaultServers: DEFAULT_SERVERS,
      hasSession,
      biometrics, remember, setRememberPassword, unlockWithBiometrics,
      authHeader,
      addServer, removeServer, resetServers, probeServers, connect,
      connectionState: connection.state,
      connectionError: connection.error,
    }}>
      {children}
    </AuthContext.Provider>
  );
}
