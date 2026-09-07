import { colors } from "./theme";

// Colour and icon per audit action. Server action names share prefixes
// ("auth_failed" inside "auth_failed_lockout", "lock" inside "unlock"), so the
// lookup below matches the LONGEST key first rather than the first declared.
export interface ActionMeta {
  color: string;
  icon: string;
}

const ACTION_META: Record<string, ActionMeta> = {
  auth_failed_lockout: { color: colors.danger, icon: "hand-left" },
  auth_failed:         { color: colors.warning, icon: "key" },
  audit_cleared:       { color: colors.textMuted, icon: "trash" },
  file_download:       { color: colors.blue, icon: "download" },
  file_trash:          { color: colors.warning, icon: "trash-bin" },
  file_delete:         { color: colors.danger, icon: "trash" },
  intruder_photo_view: { color: colors.blue, icon: "image" },
  intruder:            { color: colors.danger, icon: "warning" },
  webcam_kill:         { color: colors.warning, icon: "videocam-off" },
  push_register:       { color: colors.blue, icon: "phone-portrait" },
  phone_watch:         { color: colors.primaryDark, icon: "phone-portrait" },
  network_scan:        { color: colors.blue, icon: "wifi" },
  screenshot:          { color: colors.blue, icon: "camera" },
  clipboard:           { color: colors.yellow, icon: "clipboard" },
  fake_busy:           { color: colors.purple, icon: "desktop" },
  media_toggle:        { color: colors.purple, icon: "play" },
  volume:              { color: colors.purple, icon: "volume-high" },
  notify:              { color: colors.success, icon: "notifications" },
  terminal:            { color: colors.success, icon: "terminal" },
  shutdown:            { color: colors.warning, icon: "power" },
  reboot:              { color: colors.warning, icon: "refresh" },
  unlock:              { color: colors.primary, icon: "lock-open" },
  lock:                { color: colors.danger, icon: "lock-closed" },
  wol:                 { color: colors.primary, icon: "flash" },
};

const META_KEYS = Object.keys(ACTION_META).sort((a, b) => b.length - a.length);

export const FALLBACK_META: ActionMeta = { color: colors.primary, icon: "ellipse" };

export function getActionMeta(action: unknown): ActionMeta {
  const key = META_KEYS.find((k) => String(action).includes(k));
  return key ? ACTION_META[key] : FALLBACK_META;
}
