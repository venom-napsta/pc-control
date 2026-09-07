import AsyncStorage from "@react-native-async-storage/async-storage";

// Last-known snapshots of PC readings, so an unreachable PC shows the numbers
// it last reported instead of an empty screen. The formatting/age helpers at
// the top are pure; only saveSnapshot/loadSnapshot/clearSnapshot touch
// AsyncStorage, and they swallow every storage error — a cache that cannot be
// read is a missing cache, never a crash.

const PREFIX = "pc-control/snapshot/";

export const MINUTE_MS = 60 * 1000;
export const HOUR_MS = 60 * MINUTE_MS;
export const DAY_MS = 24 * HOUR_MS;

// How old a snapshot may be before it is worth calling out as stale.
export const DEFAULT_MAX_AGE_MS = 5 * MINUTE_MS;

const MONTHS = [
  "Jan", "Feb", "Mar", "Apr", "May", "Jun",
  "Jul", "Aug", "Sep", "Oct", "Nov", "Dec",
];

export interface Snapshot<T = unknown> {
  data: T;
  at: number;
}

// Number.isFinite accepts unknown but does not narrow it, so this guard does
// both jobs and keeps the age helpers honest about what they were handed.
function isFiniteNumber(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

export function snapshotStorageKey(key: string): string {
  return `${PREFIX}${key}`;
}

// Pure. "just now" | "3 min ago" | "2 h ago" | "12 Mar" — coarse on purpose:
// the point is "roughly how old", not a timestamp. A timestamp from the future
// (a device whose clock jumped) reads as "just now" rather than a negative
// age; one that is not a number at all reads as "unknown".
export function formatAsOf(at: unknown, now: number = Date.now()): string {
  if (!isFiniteNumber(at) || !isFiniteNumber(now)) return "unknown";
  const age = now - at;
  if (age < MINUTE_MS) return "just now";
  if (age < HOUR_MS) return `${Math.floor(age / MINUTE_MS)} min ago`;
  if (age < DAY_MS) return `${Math.floor(age / HOUR_MS)} h ago`;
  const d = new Date(at);
  if (Number.isNaN(d.getTime())) return "unknown";
  return `${d.getDate()} ${MONTHS[d.getMonth()]}`;
}

// Pure. True when the snapshot is older than maxAgeMs. Exactly maxAgeMs old is
// not yet stale; an unusable timestamp is treated as stale, since we cannot
// promise it is fresh.
export function isStale(
  at: unknown,
  now: number = Date.now(),
  maxAgeMs: number = DEFAULT_MAX_AGE_MS,
): boolean {
  if (!isFiniteNumber(at) || !isFiniteNumber(now)) return true;
  if (!isFiniteNumber(maxAgeMs) || maxAgeMs < 0) return true;
  const age = now - at;
  if (age < 0) return false;
  return age > maxAgeMs;
}

// Pure. Narrows whatever came back out of storage to a usable snapshot, or
// null. Exported so the parsing rules can be tested without AsyncStorage.
export function parseSnapshot(raw: unknown): Snapshot | null {
  if (typeof raw !== "string" || raw === "") return null;
  let parsed: unknown;
  try {
    parsed = JSON.parse(raw);
  } catch {
    return null;
  }
  if (!parsed || typeof parsed !== "object" || Array.isArray(parsed)) return null;
  const candidate = parsed as { at?: unknown; data?: unknown };
  if (!isFiniteNumber(candidate.at)) return null;
  if (!Object.prototype.hasOwnProperty.call(parsed, "data")) return null;
  if (candidate.data === undefined || candidate.data === null) return null;
  return { data: candidate.data, at: candidate.at };
}

// Stores { data, at }. Returns the snapshot it wrote, or null if it could not
// write one. Never throws: a failed cache write must not fail the fetch that
// triggered it.
export async function saveSnapshot<T>(key: string, data: T): Promise<Snapshot<T> | null> {
  if (!key || data === undefined || data === null) return null;
  const snapshot = { data, at: Date.now() };
  let payload: string | undefined;
  try {
    payload = JSON.stringify(snapshot);
  } catch {
    return null; // circular or otherwise unserialisable
  }
  if (payload === undefined) return null;
  try {
    await AsyncStorage.setItem(snapshotStorageKey(key), payload);
  } catch {
    return null;
  }
  return snapshot;
}

// Returns { data, at } or null for a missing key, a storage failure or corrupt
// content.
export async function loadSnapshot(key: string): Promise<Snapshot | null> {
  if (!key) return null;
  let raw: string | null;
  try {
    raw = await AsyncStorage.getItem(snapshotStorageKey(key));
  } catch {
    return null;
  }
  return parseSnapshot(raw);
}

export async function clearSnapshot(key: string): Promise<boolean> {
  if (!key) return false;
  try {
    await AsyncStorage.removeItem(snapshotStorageKey(key));
    return true;
  } catch {
    return false;
  }
}
