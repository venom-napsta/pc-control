// Which requests must carry the Linux password rather than a session token.
//
// The server guards these with a PIN-only dependency, so a stolen or leaked
// token cannot shut the PC down, delete files, wipe the audit log or end other
// sessions. Keep this list in step with the strict routes in server.py.
const PIN_ONLY: readonly string[] = [
  "/shutdown",
  "/reboot",
  "/files/delete",
  "/audit/clear",
  "/sessions/revoke-all",
];

export function requiresPin(endpoint: unknown): boolean {
  const path = String(endpoint || "").split("?")[0].replace(/\/+$/, "") || "/";
  return PIN_ONLY.includes(path);
}

// The server answers 401 with this detail when a token has aged out or the
// server restarted. It means "sign in again", not "wrong password".
export const SESSION_EXPIRED_DETAIL = "Session expired";

export function isSessionExpired(status: unknown, detail: unknown): boolean {
  return status === 401 && String(detail || "").includes(SESSION_EXPIRED_DETAIL);
}
