// Where a tapped notification should take the viewer.
//
// server.py's push() puts {"kind": ...} in the payload data: "intruder" for a
// failed desktop login (the photo is on Monitor) and "audit" for anything that
// belongs in the log. Unknown or missing kinds return null, which means "just
// open the app" rather than guessing.
export interface NotificationTarget {
  tab: string;
  screen?: string;
}

const ROUTES: Record<string, NotificationTarget> = {
  intruder: { tab: "Home", screen: "Monitor" },
  audit: { tab: "Home", screen: "Log" },
  monitor: { tab: "Home", screen: "Monitor" },
  files: { tab: "Files" },
  terminal: { tab: "Terminal" },
  controls: { tab: "Controls" },
};

export function routeForKind(kind: unknown): NotificationTarget | null {
  if (typeof kind !== "string") return null;
  return ROUTES[kind.toLowerCase()] ?? null;
}

// Accepts an Expo notification response, tolerating every shape it can take
// (no response at all on a cold start that was not a tap, missing data, etc).
export function routeForNotification(response: unknown): NotificationTarget | null {
  const data = (response as { notification?: { request?: { content?: { data?: unknown } } } })
    ?.notification?.request?.content?.data;
  return routeForKind((data as { kind?: unknown })?.kind);
}
