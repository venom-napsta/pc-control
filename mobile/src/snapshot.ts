// Fetching several status reads in one request.
//
// The server exposes GET /snapshot?parts=a,b (added in 1.5.0), which runs the
// parts in parallel and answers once. That turns Home's two polls and
// Monitor's four into a single round trip every 5 s, which matters most over
// Tailscale on mobile data. Older servers answer 404, and then we fall back to
// the individual endpoints, so the app works against either.

export type PartName =
  | "status" | "phone_watch" | "stats" | "bandwidth" | "active_window"
  | "webcam" | "volume" | "media" | "fake_busy";

// A caller's api() from AuthContext.
export type ApiFn = (
  method: string,
  endpoint: string,
  body?: unknown,
  options?: Record<string, unknown>,
) => Promise<any>;

export interface PartsResult {
  values: Partial<Record<PartName, any>>;
  errors: Partial<Record<PartName, unknown>>;
  batched: boolean;
}

// Part name -> the endpoint that serves it on its own.
export const PART_ENDPOINTS: Record<PartName, string> = {
  status: "/status",
  phone_watch: "/phone-watch/status",
  stats: "/stats",
  bandwidth: "/bandwidth",
  active_window: "/active-window",
  webcam: "/webcam/status",
  volume: "/volume",
  media: "/media/status",
  fake_busy: "/fake-busy/status",
};

// A part the server could not produce comes back as {error, status} rather
// than failing the whole response.
export function partFailed(value: unknown): boolean {
  return !value || typeof value !== "object" || "error" in value;
}

// Batched result -> { values, errors }. `values` holds only usable parts.
export function splitParts(body: unknown, parts: readonly PartName[]): Omit<PartsResult, "batched"> {
  const values: Partial<Record<PartName, any>> = {};
  const errors: Partial<Record<PartName, unknown>> = {};
  for (const name of parts) {
    const value = (body as Record<string, unknown> | null | undefined)?.[name];
    if (partFailed(value)) errors[name] = (value as { error?: unknown })?.error ?? "missing from the response";
    else values[name] = value;
  }
  return { values, errors };
}

// True when this server has no /snapshot, so the caller should stop trying it.
function batchUnavailable(err: unknown): boolean {
  const status = (err as { status?: unknown } | null | undefined)?.status;
  return status === 404 || status === 405;
}

/**
 * Read `parts` in one request where possible.
 *
 * Returns { values, errors, batched }. Network failures still reject, so a
 * caller's existing error handling keeps working; only a per-part failure or a
 * missing /snapshot is handled here.
 */
export async function fetchParts(
  api: ApiFn,
  parts: readonly PartName[],
  { batch = true, ...options }: { batch?: boolean } & Record<string, unknown> = {},
): Promise<PartsResult> {
  if (batch) {
    try {
      const body = await api("GET", `/snapshot?parts=${parts.join(",")}`, null, options);
      return { ...splitParts(body, parts), batched: true };
    } catch (err) {
      if (!batchUnavailable(err)) throw err;
      // Fall through: this server predates /snapshot.
    }
  }

  const settled = await Promise.allSettled(
    parts.map((name) => api("GET", PART_ENDPOINTS[name], null, options)),
  );
  const values: Partial<Record<PartName, any>> = {};
  const errors: Partial<Record<PartName, unknown>> = {};
  const rejections: unknown[] = [];
  parts.forEach((name, i) => {
    const r = settled[i];
    if (r.status === "rejected") {
      rejections.push(r.reason);
      errors[name] = r.reason ?? "unavailable";
    } else if (partFailed(r.value)) {
      // The endpoint answered but the reading is unusable; keep its own
      // explanation rather than flattening it to "unavailable".
      errors[name] = (r.value as { error?: unknown })?.error ?? "unavailable";
    } else {
      values[name] = r.value;
    }
  });
  // A total failure is a network problem, not a per-part one: let it surface.
  if (rejections.length > 0 && Object.keys(values).length === 0) throw rejections[0];
  return { values, errors, batched: false };
}
