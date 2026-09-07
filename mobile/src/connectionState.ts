// Reachability of the PC as seen from this device, derived from what api()
// and reconnect() observe. Pure so the transitions can be unit-tested; the
// AuthContext feeds it events and exposes the result as
// connectionState ("unknown" | "online" | "unreachable") and connectionError.

export type ConnectionState = "unknown" | "online" | "unreachable";
export type NetworkErrorKind = "unreachable" | "timeout";

export interface Connection {
  state: ConnectionState;
  error: string | null;
}

export type ConnectionEvent =
  | { type: "success" }
  | { type: "reconnected" }
  | { type: "failure"; kind?: string | null; message?: string | null }
  | { type: "reset" };

export const CONNECTION_STATES: readonly ConnectionState[] =
  Object.freeze<ConnectionState[]>(["unknown", "online", "unreachable"]);

// err.kind values produced by api() for failures that never reached the PC.
export const NETWORK_ERROR_KINDS: readonly NetworkErrorKind[] =
  Object.freeze<NetworkErrorKind[]>(["unreachable", "timeout"]);

export function isNetworkErrorKind(kind: unknown): kind is NetworkErrorKind {
  return kind === "unreachable" || kind === "timeout";
}

export const INITIAL_CONNECTION: Connection = Object.freeze({ state: "unknown", error: null });

// Events:
//   { type: "success" }                         any api() call got a response
//   { type: "reconnected" }                     reconnect() found a server
//   { type: "failure", kind, message }          api() threw; only network kinds count
//   { type: "reset" }                           back to the initial state
//
// Returns the SAME object when nothing changes so React state setters can
// bail out: api() runs every few seconds while polling.
export function reduceConnection(
  current: Connection = INITIAL_CONNECTION,
  event?: ConnectionEvent,
): Connection {
  switch (event?.type) {
    case "success":
    case "reconnected":
      if (current.state === "online" && current.error === null) return current;
      return { state: "online", error: null };

    case "failure": {
      if (!isNetworkErrorKind(event.kind)) return current;
      const error = event.message ? String(event.message) : "Can't reach the PC.";
      if (current.state === "unreachable" && current.error === error) return current;
      return { state: "unreachable", error };
    }

    case "reset":
      return current === INITIAL_CONNECTION ? current : INITIAL_CONNECTION;

    default:
      return current;
  }
}
