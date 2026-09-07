import Constants from "expo-constants";
import { parseServerList, serverLabel, isTailscaleAddress } from "./servers";

// Build-time defaults. EXPO_PUBLIC_SERVERS is a comma-separated list of every
// address the PC might be reachable at (MagicDNS name, Tailscale IP, LAN IP,
// hotspot IP). The app probes them all and uses whichever answers first, and
// the list can be edited on the device, so nothing here is load-bearing.
const extra = Constants.expoConfig?.extra ?? {};
export const DEFAULT_SERVERS = parseServerList(
  extra.servers ??
  process.env.EXPO_PUBLIC_SERVERS ??
  extra.serverUrl ??
  process.env.EXPO_PUBLIC_SERVER ??
  "http://localhost:2000",
);

export const APP_VERSION = Constants.expoConfig?.version ?? "dev";

export const DEFAULT_TIMEOUT_MS = 10000;
export const LOGIN_TIMEOUT_MS = 8000;
export const PROBE_TIMEOUT_MS = 4000;

export function isTimeoutError(err: unknown): boolean {
  const e = err as { name?: unknown; message?: unknown } | null | undefined;
  return e?.name === "AbortError" || /abort/i.test(String(e?.message ?? ""));
}

export function isNetworkError(err: unknown): boolean {
  return err instanceof TypeError && /network request failed/i.test(err.message || "");
}

// fetch() in React Native has no timeout at all. An unroutable address
// (Tailscale switched off on the device) can hang for minutes without this.
export async function fetchWithTimeout(
  url: string,
  options: RequestInit = {},
  timeoutMs: number = DEFAULT_TIMEOUT_MS,
): Promise<Response> {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), timeoutMs);
  try {
    return await fetch(url, { ...options, signal: controller.signal });
  } finally {
    clearTimeout(timer);
  }
}

export const NO_INTERNET_MESSAGE =
  "Can't reach the PC, and this device has no internet. Check Wi-Fi or mobile data.";

function hintFor(server: string | null | undefined): string {
  return server && isTailscaleAddress(server)
    ? "Open Tailscale on this device and check it's connected."
    : "Is this device on the same network as the PC?";
}

// Explain a failed request to one specific address. Pure function, no network I/O.
export function connectionFailureMessage(
  err: unknown,
  { timeoutMs = DEFAULT_TIMEOUT_MS, server = null }:
    { timeoutMs?: number; server?: string | null } = {},
): string {
  const where = server ? `the PC at ${serverLabel(server)}` : "the PC";
  if (isTimeoutError(err)) {
    const secs = Math.round(timeoutMs / 1000);
    return `No answer from ${where} in ${secs}s. ${hintFor(server)}`;
  }
  if (isNetworkError(err)) {
    return `Can't reach ${where}. ${hintFor(server)}`;
  }
  return `Network error: ${(err as { message?: string } | null | undefined)?.message || String(err)}`;
}

// Explain that none of the saved addresses answered the health probe.
export function noServerMessage(servers: readonly string[] = []): string {
  const n = servers.length;
  const tried = n <= 1
    ? "The saved address didn't answer"
    : `None of the ${n} saved addresses answered`;
  const hint = servers.some(isTailscaleAddress)
    ? "Away from home? Open Tailscale on this device and check it's connected."
    : "Add the PC's current address under Server settings.";
  return `${tried}. ${hint}`;
}

// Probe something that does NOT go through Tailscale. If this succeeds while
// the PC is unreachable, the problem is Tailscale, not the device's internet.
const INTERNET_PROBE = "https://www.gstatic.com/generate_204";

export async function hasInternet(timeoutMs: number = 4000): Promise<boolean> {
  try {
    const res = await fetchWithTimeout(`${INTERNET_PROBE}?t=${Date.now()}`, { method: "GET" }, timeoutMs);
    return res.status >= 200 && res.status < 400;
  } catch {
    return false;
  }
}
