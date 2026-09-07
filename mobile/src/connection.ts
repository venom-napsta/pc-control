import { fetchWithTimeout, isTimeoutError, PROBE_TIMEOUT_MS } from "./config";
import { dedupe } from "./servers";

// Hit GET /health on one address. Never throws; always resolves to a result
// object so callers can race many probes without try/catch soup.
export interface ProbeResult {
  url: string;
  latencyMs: number;
  ok: boolean;
  host?: string | null;
  version?: string | null;
  timedOut?: boolean;
  reason?: string;
}

export async function probeServer(
  url: string,
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult> {
  const started = Date.now();
  const done = (fields: Partial<ProbeResult>): ProbeResult =>
    ({ url, latencyMs: Date.now() - started, ok: false, ...fields });
  try {
    const res = await fetchWithTimeout(`${url}/health`, { method: "GET" }, timeoutMs);
    if (!res.ok) return done({ ok: false, reason: `HTTP ${res.status}` });
    let info: { service?: string; host?: string; version?: string } = {};
    try {
      info = await res.json();
    } catch {
      info = {};
    }
    if (info?.service && info.service !== "pc-control") {
      return done({ ok: false, reason: "not a PC Control server" });
    }
    return done({ ok: true, host: info?.host ?? null, version: info?.version ?? null });
  } catch (err) {
    const timedOut = isTimeoutError(err);
    return done({ ok: false, timedOut, reason: timedOut ? "timed out" : "unreachable" });
  }
}

// Probe every candidate in parallel and resolve with the FIRST healthy one.
// On the home LAN that is the LAN address (fastest); away from home only the
// Tailscale address answers. Resolves null when nothing answers.
export function firstReachable(
  candidates: readonly (string | null | undefined)[],
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult | null> {
  const list = dedupe(candidates);
  return new Promise<ProbeResult | null>((resolve) => {
    if (list.length === 0) {
      resolve(null);
      return;
    }
    let pending = list.length;
    let settled = false;
    for (const url of list) {
      probeServer(url, timeoutMs).then((result) => {
        if (settled) return;
        if (result.ok) {
          settled = true;
          resolve(result);
          return;
        }
        pending -= 1;
        if (pending === 0) {
          settled = true;
          resolve(null);
        }
      });
    }
  });
}

export const resolveServer = firstReachable;

// Probe every candidate and wait for all of them — for the settings sheet,
// which shows a status dot per address.
export function probeAll(
  candidates: readonly (string | null | undefined)[],
  timeoutMs: number = PROBE_TIMEOUT_MS,
): Promise<ProbeResult[]> {
  return Promise.all(dedupe(candidates).map((url) => probeServer(url, timeoutMs)));
}
