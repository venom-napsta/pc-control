import { getActionMeta, FALLBACK_META } from "../src/auditActions";
import { colors } from "../src/theme";

// Audit actions share prefixes, so the lookup must prefer the longest match.
describe("getActionMeta", () => {
  test("a lockout is not mistaken for an ordinary failed attempt", () => {
    expect(getActionMeta("auth_failed_lockout").color).toBe(colors.danger);
    expect(getActionMeta("auth_failed").color).toBe(colors.warning);
  });

  test("trashing a file is distinguished from deleting it", () => {
    expect(getActionMeta("file_trash").color).toBe(colors.warning);
    expect(getActionMeta("file_delete").color).toBe(colors.danger);
  });

  test("lock and unlock do not collide", () => {
    expect(getActionMeta("unlock").icon).toBe("lock-open");
    expect(getActionMeta("lock").icon).toBe("lock-closed");
  });

  test("every action the server writes has an entry", () => {
    const serverActions = [
      "lock", "unlock", "shutdown", "reboot", "volume", "notify", "screenshot",
      "clipboard_read", "clipboard_write", "file_download", "file_trash",
      "file_delete", "terminal_open", "terminal_close", "network_scan",
      "webcam_kill", "fake_busy", "wol", "audit_cleared", "push_register",
      "intruder_alert", "intruder_photo_view", "phone_watch_on",
      "phone_watch_off", "media_toggle", "auth_failed", "auth_failed_lockout",
    ];
    for (const action of serverActions) {
      expect(getActionMeta(action).icon).not.toBe("ellipse");
    }
  });

  test("an unknown action still renders with a neutral fallback", () => {
    expect(getActionMeta("brand_new_action")).toEqual(FALLBACK_META);
    expect(FALLBACK_META.color).toBe(colors.primary);
  });
});
