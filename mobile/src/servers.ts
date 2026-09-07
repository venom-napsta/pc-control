import AsyncStorage from "@react-native-async-storage/async-storage";

// Server address list: parsing, validation, classification and persistence.
// Pure functions live at the top so they are trivially testable; the storage
// helpers at the bottom are the only thing that touches AsyncStorage.

const KEY_SERVERS = "pc-control/servers";
const KEY_LAST_GOOD = "pc-control/last-good-server";
const KEY_REMEMBER = "pc-control/remember-password";

export const DEFAULT_PORT = 2000;

// Tailscale assigns 100.64.0.0/10 (the CGNAT range) and MagicDNS names end in .ts.net.
const CGNAT_RE = /^100\.(6[4-9]|[7-9]\d|1[01]\d|12[0-7])\.\d{1,3}\.\d{1,3}$/;
const PRIVATE_RE = /^(10\.\d{1,3}\.\d{1,3}\.\d{1,3}|172\.(1[6-9]|2\d|3[01])\.\d{1,3}\.\d{1,3}|192\.168\.\d{1,3}\.\d{1,3})$/;
const HOST_RE = /^(?:\[[0-9a-f:.]+\]|[a-z0-9](?:[a-z0-9-]*[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]*[a-z0-9])?)*)$/i;

export function hostOf(url: unknown): string {
  const m = String(url || "").match(/^[a-z][a-z0-9+.-]*:\/\/(\[[^\]]+\]|[^/:?#\s]+)/i);
  return m ? m[1] : "";
}

export function isTailscaleAddress(url: unknown): boolean {
  const host = hostOf(url).replace(/^\[|\]$/g, "");
  return /\.ts\.net$/i.test(host) || CGNAT_RE.test(host);
}

export function isPrivateLanAddress(url: unknown): boolean {
  return PRIVATE_RE.test(hostOf(url));
}

// "tailscale" | "lan" | "other" — used for the little tag in the settings sheet.
export type ServerKind = "tailscale" | "lan" | "other";

export function serverKind(url: unknown): ServerKind {
  if (isTailscaleAddress(url)) return "tailscale";
  if (isPrivateLanAddress(url)) return "lan";
  return "other";
}

// Accepts what a person types — "192.168.1.10:2000", "venom.tailnet.ts.net",
// "HTTP://Host:2000/" — and returns a canonical "http://host:port" or null if
// it is not a usable address. A missing port gets DEFAULT_PORT.
export function normalizeServerUrl(
  input: unknown,
  { defaultPort = DEFAULT_PORT }: { defaultPort?: number } = {},
): string | null {
  if (typeof input !== "string") return null;
  let s = input.trim();
  if (!s) return null;
  if (!/^[a-z][a-z0-9+.-]*:\/\//i.test(s)) s = `http://${s}`;

  const m = s.match(/^(https?):\/\/([^/?#\s]+)(?:[/?#].*)?$/i);
  if (!m) return null;
  const scheme = m[1].toLowerCase();
  const authority = m[2];

  let host: string | undefined;
  let port: string | undefined;
  const v6 = authority.match(/^(\[[^\]]+\])(?::(\d+))?$/);
  if (v6) {
    [, host, port] = v6;
  } else {
    const parts = authority.split(":");
    if (parts.length > 2) return null;
    [host, port] = parts;
  }
  if (!host || !HOST_RE.test(host)) return null;

  if (port === undefined || port === "") {
    port = String(defaultPort);
  }
  const n = Number(port);
  if (!Number.isInteger(n) || n < 1 || n > 65535) return null;

  return `${scheme}://${host.toLowerCase()}:${n}`;
}

// "http://100.64.0.1:2000" -> "100.64.0.1:2000"
export function serverLabel(url: unknown): string {
  return String(url || "").replace(/^[a-z][a-z0-9+.-]*:\/\//i, "").replace(/\/+$/, "");
}

export function dedupe(list: readonly (string | null | undefined)[] | null | undefined): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of list || []) {
    if (item && !seen.has(item)) {
      seen.add(item);
      out.push(item);
    }
  }
  return out;
}

// Turns an env string ("a:2000, b:2000") or a stored array into a clean list.
export function parseServerList(
  value: unknown,
  opts?: { defaultPort?: number },
): string[] {
  const raw = Array.isArray(value)
    ? value
    : String(value ?? "").split(/[,\s]+/);
  return dedupe(raw.map((v) => normalizeServerUrl(v, opts)).filter(Boolean));
}

// ── Persistence ───────────────────────────────────────────

export async function loadServers(defaults: string[]): Promise<string[]> {
  try {
    const raw = await AsyncStorage.getItem(KEY_SERVERS);
    if (raw) {
      const list = parseServerList(JSON.parse(raw));
      if (list.length) return list;
    }
  } catch {
    // Corrupt or unavailable storage: fall through to defaults.
  }
  return defaults;
}

export async function saveServers(list: readonly string[]): Promise<void> {
  await AsyncStorage.setItem(KEY_SERVERS, JSON.stringify(dedupe(list)));
}

export async function clearServers(): Promise<void> {
  await AsyncStorage.removeItem(KEY_SERVERS);
}

export async function loadLastGood(): Promise<string | null> {
  try {
    return (await AsyncStorage.getItem(KEY_LAST_GOOD)) || null;
  } catch {
    return null;
  }
}

export async function saveLastGood(url: string | null | undefined): Promise<void> {
  try {
    if (url) await AsyncStorage.setItem(KEY_LAST_GOOD, url);
  } catch {
    // Best effort only.
  }
}

export async function loadRemember(): Promise<boolean> {
  try {
    return (await AsyncStorage.getItem(KEY_REMEMBER)) === "1";
  } catch {
    return false;
  }
}

export async function saveRemember(on: boolean): Promise<void> {
  try {
    if (on) await AsyncStorage.setItem(KEY_REMEMBER, "1");
    else await AsyncStorage.removeItem(KEY_REMEMBER);
  } catch {
    // A lost preference just means the box starts unchecked next time.
  }
}
