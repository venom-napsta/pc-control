import { useState, useEffect, useCallback } from "react";
import {
  View, Text, TextInput, Alert, Pressable, ActivityIndicator,
  Switch, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import { useAuth } from "../context/AuthContext";
import { ScreenShell } from "../components/ScreenShell";
import { Card } from "../components/Card";
import { PrimaryButton } from "../components/Button";
import { SectionHeader } from "../components/SectionHeader";
import { colors, spacing, font, radius, mono } from "../theme";

function PowerButton({ icon, label, onPress }) {
  return (
    <Pressable
      onPress={onPress}
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
  const [volume, setVolume] = useState(50);
  const [volumeLoaded, setVolumeLoaded] = useState(false);
  const [notifyText, setNotifyText] = useState("");
  const [sending, setSending] = useState(false);

  // WoL state
  const [wolMac, setWolMac] = useState("");
  const [wolSending, setWolSending] = useState(false);

  // Fake busy state
  const [fakeBusy, setFakeBusy] = useState(false);
  const [fakeBusyLoading, setFakeBusyLoading] = useState(false);

  useEffect(() => {
    api("GET", "/volume")
      .then((d) => { setVolume(d.level); setVolumeLoaded(true); })
      .catch(() => {});
    api("GET", "/fake-busy/status")
      .then((d) => setFakeBusy(d.active))
      .catch(() => {});
  }, [api]);

  const confirmAction = (title, action, endpoint) => {
    Alert.alert(title, "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: action,
        style: "destructive",
        onPress: async () => {
          try { await api("POST", endpoint); }
          catch { Alert.alert("Error", `Failed to ${action.toLowerCase()}`); }
        },
      },
    ]);
  };

  const commitVolume = useCallback(async (val) => {
    try { await api("POST", "/volume", { level: Math.round(val) }); } catch {}
  }, [api]);

  const sendNotify = async () => {
    if (!notifyText.trim()) return;
    setSending(true);
    try {
      await api("POST", "/notify", { message: notifyText });
      setNotifyText("");
      Alert.alert("Sent", "Notification delivered to PC");
    } catch {
      Alert.alert("Error", "Failed to send notification");
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
      Alert.alert("Error", "Failed to send WoL packet");
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
    } catch {
      Alert.alert("Error", "Failed to toggle fake busy screen");
    }
    setFakeBusyLoading(false);
  };

  return (
    <ScreenShell>
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
          <View style={styles.volumeTitleRow}>
            <Ionicons name="volume-high-outline" size={18} color={colors.text} />
            <Text style={styles.cardTitle}>VOL</Text>
          </View>
          <Text style={styles.volValue}>{volume}%</Text>
        </View>
        {volumeLoaded && (
          <Slider
            minimumValue={0}
            maximumValue={100}
            step={1}
            value={volume}
            onValueChange={(v) => setVolume(Math.round(v))}
            onSlidingComplete={commitVolume}
            minimumTrackTintColor={colors.primary}
            maximumTrackTintColor={colors.surfaceHi}
            thumbTintColor={colors.primary}
            style={{ marginTop: spacing.sm }}
          />
        )}
      </Card>

      {/* ── Notification ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>NOTIFY.PC</SectionHeader>
      <Card>
        <TextInput
          style={styles.input}
          placeholder=">> message..."
          placeholderTextColor={colors.primaryDim}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          value={notifyText}
          onChangeText={setNotifyText}
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
        <TextInput
          style={styles.input}
          placeholder=">> MAC address (AA:BB:CC:DD:EE:FF)"
          placeholderTextColor={colors.primaryDim}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          value={wolMac}
          onChangeText={setWolMac}
          autoCapitalize="characters"
          autoCorrect={false}
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
          <View style={{ flex: 1 }}>
            <View style={styles.cardTitleRow}>
              <Ionicons name="code-slash-outline" size={18} color={colors.text} />
              <Text style={styles.cardTitle}>BUSY.MODE</Text>
            </View>
            <Text style={styles.cardSub}>
              {fakeBusy ? 'active \u2014 VS Code shown on PC' : "inactive \u2014 tap to activate"}
            </Text>
          </View>
          {fakeBusyLoading ? (
            <ActivityIndicator color={colors.primary} />
          ) : (
            <Switch
              value={fakeBusy}
              onValueChange={toggleFakeBusy}
              trackColor={{ false: "#1a1a1a", true: colors.primaryDim }}
              thumbColor={fakeBusy ? colors.primary : "#555"}
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
  volumeTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: "700",
    fontFamily: mono,
  },
  cardTitleRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  cardSub: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: 4,
    marginLeft: 26,
  },
  volValue: {
    color: colors.primary,
    fontSize: font.lg,
    fontWeight: "700",
    fontFamily: mono,
  },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: font.lg,
    fontFamily: mono,
    padding: 14,
    borderRadius: radius.md,
    textAlign: "left",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
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
