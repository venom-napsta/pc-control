import { useState, useCallback, useRef } from "react";
import {
  View, Text, Alert, Pressable, ActivityIndicator,
  Switch, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useAuth } from "../context/AuthContext";
import { useError } from "../context/ErrorContext";
import { usePolling } from "../hooks/usePolling";
import { fetchParts } from "../snapshot";
import { ScreenShell } from "../components/ScreenShell";
import { Card } from "../components/Card";
import { CardTitle } from "../components/CardTitle";
import { Input } from "../components/Input";
import { PrimaryButton } from "../components/Button";
import { SectionHeader } from "../components/SectionHeader";
import { confirm } from "../components/confirm";
import { colors, spacing, font, radius, mono } from "../theme";

const CONTROLS_POLL_MS = 10000;

function PowerButton({ icon, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={label}
      style={({ pressed }) => [
        styles.powerBtn,
        pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] },
      ]}
    >
      <Ionicons name={icon} size={28} color={colors.text} />
      <Text style={styles.powerLabel}>{label}</Text>
    </Pressable>
  );
}

export function ControlsScreen() {
  const { api } = useAuth();
  const { showError } = useError();
  // null until the PC has answered once; the UI shows "—" meanwhile.
  const [volume, setVolume] = useState(null);
  const slidingRef = useRef(false);
  const [notifyText, setNotifyText] = useState("");
  const [sending, setSending] = useState(false);

  // WoL state
  const [wolMac, setWolMac] = useState("");
  const [wolSending, setWolSending] = useState(false);

  // Media state: the server reports playback plus whatever the active player
  // exposes about the current track.
  const [media, setMedia] = useState(null);
  const [mediaBusy, setMediaBusy] = useState(false);

  // Fake busy state
  const [fakeBusy, setFakeBusy] = useState(false);
  const [fakeBusyLoading, setFakeBusyLoading] = useState(false);

  const loadControls = useCallback(async () => {
    let values, errors;
    try {
      ({ values, errors } = await fetchParts(api, ["volume", "media", "fake_busy"]));
    } catch (e) {
      showError("CONTROLS LOAD FAILED", e);
      return;
    }
    // Don't yank the slider out from under a finger mid-drag.
    if (values.volume && !slidingRef.current) setVolume(values.volume.level);
    if (values.media) setMedia(values.media);
    if (values.fake_busy) setFakeBusy(!!values.fake_busy.active);

    // Surface one failure per poll; three toasts in a row would only replace each other.
    const failed = [
      ["VOLUME LOAD FAILED", "volume"],
      ["MEDIA STATUS FAILED", "media"],
      ["BUSY STATUS FAILED", "fake_busy"],
    ].find(([, name]) => errors[name]);
    if (failed) showError(failed[0], errors[failed[1]]);
  }, [api, showError]);

  const { refreshing, onRefresh } = usePolling(loadControls, CONTROLS_POLL_MS);

  const confirmAction = (title, action, endpoint) => {
    confirm(title, "Are you sure?", {
      confirmText: action,
      destructive: true,
      onConfirm: async () => {
        try { await api("POST", endpoint); }
        catch (e) { showError(`${action.toUpperCase()} FAILED`, e); }
      },
    });
  };

  const commitVolume = useCallback(async (val) => {
    slidingRef.current = false;
    try { await api("POST", "/volume", { level: Math.round(val) }); }
    catch (e) { showError("VOLUME SET FAILED", e); }
  }, [api, showError]);

  // toggle / next / previous all answer with the new state, so one handler
  // covers the whole transport.
  const mediaCommand = async (endpoint, label) => {
    setMediaBusy(true);
    try {
      setMedia(await api("POST", endpoint));
    } catch (e) {
      showError(label, e);
    }
    setMediaBusy(false);
  };

  const sendNotify = async () => {
    if (!notifyText.trim()) return;
    setSending(true);
    try {
      await api("POST", "/notify", { message: notifyText });
      setNotifyText("");
      Alert.alert("Sent", "Notification delivered to PC");
    } catch (e) {
      showError("NOTIFY FAILED", e);
    }
    setSending(false);
  };

  const sendWol = async () => {
    if (!wolMac.trim()) return;
    setWolSending(true);
    try {
      await api("POST", "/wol", { mac: wolMac.trim() });
      Alert.alert("Sent", "Magic packet sent — PC should wake up shortly");
    } catch (e) {
      showError("WOL FAILED", e);
    }
    setWolSending(false);
  };

  const toggleFakeBusy = async () => {
    setFakeBusyLoading(true);
    try {
      if (fakeBusy) {
        await api("POST", "/fake-busy/dismiss");
        setFakeBusy(false);
      } else {
        await api("POST", "/fake-busy");
        setFakeBusy(true);
      }
    } catch (e) {
      showError("FAKE BUSY FAILED", e);
    }
    setFakeBusyLoading(false);
  };

  return (
    <ScreenShell refreshing={refreshing} onRefresh={onRefresh}>
      {/* ── Power ── */}
      <SectionHeader>PWR.MGMT</SectionHeader>
      <View style={styles.powerRow}>
        <PowerButton
          icon="power-outline"
          label="SHUTDOWN"
          onPress={() => confirmAction("Shutdown PC", "Shutdown", "/shutdown")}
        />
        <PowerButton
          icon="refresh-outline"
          label="REBOOT"
          onPress={() => confirmAction("Reboot PC", "Reboot", "/reboot")}
        />
      </View>

      {/* ── Volume ── */}
      <SectionHeader>AUDIO.CTRL</SectionHeader>
      <Card>
        <View style={styles.volumeHeader}>
          <CardTitle icon="volume-high-outline" title="VOL" />
          <Text style={styles.volValue}>{volume === null ? "—" : `${volume}%`}</Text>
        </View>
        {volume !== null ? (
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={volume}
            onSlidingStart={() => { slidingRef.current = true; }}
            onValueChange={(v) => setVolume(Math.round(v))}
            onSlidingComplete={commitVolume}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.surfaceHi}
            thumbTintColor={colors.primary}
            accessibilityLabel="Volume"
            style={{ marginTop: spacing.sm }}
          />
        ) : (
          <Text style={styles.volHint}>{"// waiting for the PC…"}</Text>
        )}
      </Card>

      {/* ── Media ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>MEDIA</SectionHeader>
      <Card>
        <View style={styles.mediaRow}>
          <View style={styles.mediaMeta}>
            {media?.title ? (
              <>
                <Text style={styles.mediaTitle} numberOfLines={1}>{media.title}</Text>
                <Text style={styles.mediaSub} numberOfLines={1}>
                  {[media.artist, media.player].filter(Boolean).join("  •  ") || "\u2014"}
                </Text>
              </>
            ) : (
              <Text style={styles.mediaSub}>
                {media ? "// nothing playing" : "// waiting for the PC…"}
              </Text>
            )}
          </View>
          <View style={styles.mediaTransport}>
            <Pressable
              onPress={() => mediaCommand("/media/previous", "PREVIOUS TRACK FAILED")}
              disabled={mediaBusy || !media}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Previous track"
              style={({ pressed }) => [styles.mediaBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="play-skip-back" size={18} color={colors.text} />
            </Pressable>
            <Pressable
              onPress={() => mediaCommand("/media/toggle", "MEDIA TOGGLE FAILED")}
              disabled={mediaBusy || !media}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel={media?.playing ? "Pause media" : "Play media"}
              style={({ pressed }) => [styles.mediaBtnMain, pressed && { opacity: 0.7 }]}
            >
              {mediaBusy
                ? <ActivityIndicator color={colors.primary} size="small" />
                : <Ionicons
                    name={media?.playing ? "pause" : "play"}
                    size={20}
                    color={media?.playing ? colors.primary : colors.text}
                  />}
            </Pressable>
            <Pressable
              onPress={() => mediaCommand("/media/next", "NEXT TRACK FAILED")}
              disabled={mediaBusy || !media}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Next track"
              style={({ pressed }) => [styles.mediaBtn, pressed && { opacity: 0.7 }]}
            >
              <Ionicons name="play-skip-forward" size={18} color={colors.text} />
            </Pressable>
          </View>
        </View>
      </Card>

      {/* ── Notification ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>NOTIFY.PC</SectionHeader>
      <Card>
        <Input
          style={styles.input}
          placeholder=">> message..."
          value={notifyText}
          onChangeText={setNotifyText}
          accessibilityLabel="Notification message"
        />
        <PrimaryButton
          title="SEND"
          onPress={sendNotify}
          loading={sending}
          disabled={!notifyText.trim()}
        />
      </Card>

      {/* ── Wake on LAN ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>WAKE.LAN</SectionHeader>
      <Card>
        <View style={styles.wolInfo}>
          <Ionicons name="flash-outline" size={14} color={colors.textMuted} />
          <Text style={styles.wolInfoText}>Send magic packet to wake a PC on your network</Text>
        </View>
        <Input
          style={styles.input}
          placeholder=">> MAC address (AA:BB:CC:DD:EE:FF)"
          value={wolMac}
          onChangeText={setWolMac}
          autoCapitalize="characters"
          autoCorrect={false}
          accessibilityLabel="MAC address"
        />
        <PrimaryButton
          title="WAKE UP"
          onPress={sendWol}
          loading={wolSending}
          disabled={!wolMac.trim()}
        />
      </Card>

      {/* ── Fake Busy ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>FAKE.BUSY</SectionHeader>
      <Card>
        <View style={styles.fakeBusyRow}>
          <CardTitle
            style={{ flex: 1 }}
            icon="code-slash-outline"
            title="BUSY.MODE"
            sub={fakeBusy ? "active — VS Code shown on PC" : "inactive — tap to activate"}
          />
          {fakeBusyLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Switch
              value={fakeBusy}
              onValueChange={toggleFakeBusy}
              trackColor={{ false: colors.switchTrackOff, true: colors.primaryDim }}
              thumbColor={fakeBusy ? colors.primary : colors.switchThumbOff}
              accessibilityLabel="Fake busy mode"
            />
          )}
        </View>
      </Card>

    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  powerRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginBottom: spacing.xxl,
  },
  powerBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    paddingVertical: spacing.xxl,
  },
  powerLabel: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    marginTop: spacing.sm,
    letterSpacing: 1,
  },
  volumeHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  mediaRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
  },
  mediaMeta: { flex: 1, minWidth: 0 },
  mediaTitle: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
  },
  mediaSub: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: 2,
  },
  mediaTransport: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
  },
  mediaBtn: {
    padding: spacing.sm,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  mediaBtnMain: {
    padding: spacing.sm,
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
    borderRadius: radius.pill,
    backgroundColor: colors.surfaceHi,
  },
  volValue: {
    color: colors.primary,
    fontSize: font.lg,
    fontWeight: "700",
    fontFamily: mono,
  },
  volHint: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: spacing.md,
  },
  input: { marginBottom: spacing.md },
  // WoL
  wolInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.md,
  },
  wolInfoText: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    flex: 1,
  },
  // Fake busy
  fakeBusyRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
});
