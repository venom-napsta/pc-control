import { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, ActivityIndicator, Switch,
  Pressable, Animated, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useError } from "../context/ErrorContext";
import { usePolling } from "../hooks/usePolling";
import { fetchParts } from "../snapshot";
import { ScreenShell } from "../components/ScreenShell";
import { ScreenHeader } from "../components/ScreenHeader";
import { ServerSettingsSheet } from "../components/ServerSettingsSheet";
import { Card } from "../components/Card";
import { CardTitle } from "../components/CardTitle";
import { ConnectionStrip } from "../components/ConnectionStrip";
import { PulsingDot } from "../components/PulsingDot";
import { GhostButton } from "../components/Button";
import { OrbitRing } from "../components/OrbitRing";
import { useLayout } from "../layout";
import { saveSnapshot, loadSnapshot, formatAsOf } from "../statsCache";
import { colors, spacing, font, radius, mono } from "../theme";

export const STATUS_SNAPSHOT_KEY = "status";

// Pure. Which lock state to paint, and whether it is a remembered one.
// A cached value is only worth showing while the PC is out of reach and no
// live answer has arrived; it is display-only, so `actionable` stays false —
// sending /lock or /unlock off a remembered state could do the opposite of
// what the user sees.
export function pickLockState({ locked, connectionState, snapshot }) {
  if (locked !== null && locked !== undefined) {
    return { shown: locked, stale: false, at: null, actionable: true };
  }
  const cached = snapshot?.data?.locked;
  if (connectionState === "unreachable" && typeof cached === "boolean") {
    return { shown: cached, stale: true, at: snapshot.at, actionable: false };
  }
  return { shown: null, stale: false, at: null, actionable: false };
}

export function HomeScreen() {
  const { api, logout, connectionState = "unknown" } = useAuth();
  const { showError } = useError();
  const navigation = useNavigation();
  const { columns = 1 } = useLayout();
  const [locked, setLocked] = useState(null);
  const [phoneWatch, setPhoneWatch] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [watchToggling, setWatchToggling] = useState(false);
  const [settingsOpen, setSettingsOpen] = useState(false);
  const [snapshot, setSnapshot] = useState(null);

  // Lock press scale
  const lockScale = useRef(new Animated.Value(1)).current;
  // Entrance animations
  const entranceFade = useRef(new Animated.Value(0)).current;
  const entranceSlide = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    const entranceAnim = Animated.parallel([
      Animated.timing(entranceFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(entranceSlide, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]);
    entranceAnim.start();
    return () => entranceAnim.stop();
  }, [entranceFade, entranceSlide]);

  // Last-known lock state, so an unreachable PC shows what it last reported.
  useEffect(() => {
    let alive = true;
    loadSnapshot(STATUS_SNAPSHOT_KEY).then((snap) => {
      if (alive && snap) setSnapshot(snap);
    });
    return () => { alive = false; };
  }, []);

  const fetchAll = useCallback(async () => {
    try {
      // One /snapshot round trip where the server supports it, two calls where
      // it does not.
      const { values } = await fetchParts(api, ["status", "phone_watch"]);
      if (values.status) {
        setLocked(values.status.locked);
        saveSnapshot(STATUS_SNAPSHOT_KEY, values.status);
      }
      if (values.phone_watch) setPhoneWatch(values.phone_watch.active);
    } catch (e) {
      showError("STATUS FETCH FAILED", e);
    }
  }, [api, showError]);

  const { refreshing, onRefresh } = usePolling(fetchAll, 5000);

  const toggleLock = async () => {
    // Bounce animation
    Animated.sequence([
      Animated.timing(lockScale, { toValue: 0.9, duration: 100, useNativeDriver: true }),
      Animated.spring(lockScale, { toValue: 1, friction: 3, tension: 200, useNativeDriver: true }),
    ]).start();

    if (locked === null) return;
    setToggling(true);
    try {
      await api("POST", locked ? "/unlock" : "/lock");
      await fetchAll();
    } catch (e) {
      showError("LOCK TOGGLE FAILED", e);
    }
    setToggling(false);
  };

  const toggleWatch = async () => {
    setWatchToggling(true);
    try {
      const data = await api("POST", "/phone-watch/toggle");
      setPhoneWatch(data.active);
    } catch (e) {
      showError("PHONE WATCH FAILED", e);
    }
    setWatchToggling(false);
  };

  const lock = pickLockState({ locked, connectionState, snapshot });
  const shownLocked = lock.shown;
  const statusColor = shownLocked ? colors.danger : colors.primary;

  const lockBlock = (
    <View style={[styles.lockBlock, lock.stale && styles.stale]}>
      {/* Status */}
      <View style={styles.statusRow}>
        <PulsingDot color={statusColor} />
        <Text style={[styles.statusText, { color: statusColor, marginLeft: spacing.sm }]}>
          {shownLocked === null ? "CONNECTING..." : shownLocked ? "LOCKED" : "UNLOCKED"}
        </Text>
      </View>

      {/* Lock button inside a slow orbit ring */}
      <View style={styles.lockContainer}>
        <OrbitRing size={224} dotCount={16} dotSize={3} color={statusColor} duration={12000} opacity={0.5}>
          <Animated.View style={{ transform: [{ scale: lockScale }] }}>
            <Pressable
              onPress={toggleLock}
              // Inert until the first status fetch answers: before that an
              // early tap would blindly send /lock. A remembered state from
              // the cache paints the button but never re-enables it — acting
              // on a stale reading could lock a PC the user just unlocked.
              disabled={toggling || !lock.actionable}
              accessibilityRole="button"
              accessibilityLabel={
                lock.stale
                  ? `Lock control unavailable, last known ${shownLocked ? "locked" : "unlocked"}`
                  : locked === null ? "Connecting" : locked ? "Unlock PC" : "Lock PC"
              }
              accessibilityState={{ disabled: toggling || !lock.actionable, busy: toggling }}
              style={({ pressed }) => [
                styles.lockBtn,
                {
                  borderColor: shownLocked === null ? colors.border : shownLocked ? colors.primary : colors.danger,
                  backgroundColor: shownLocked === null ? colors.surface : shownLocked ? "#0D2A1A" : "#2A0D0D",
                },
                pressed && { opacity: 0.9 },
              ]}
            >
              {toggling || shownLocked === null ? (
                <ActivityIndicator color={shownLocked === null ? colors.textMuted : colors.primary} size="large" />
              ) : (
                <>
                  <Ionicons
                    name={shownLocked ? "lock-open-outline" : "lock-closed-outline"}
                    size={44}
                    color={shownLocked ? colors.primary : colors.danger}
                  />
                  <Text style={[styles.lockLabel, { color: shownLocked ? colors.primary : colors.danger }]}>
                    {shownLocked ? "UNLOCK" : "LOCK"}
                  </Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        </OrbitRing>
      </View>
    </View>
  );

  const watchCard = (
    <Card style={{ alignSelf: "stretch" }}>
      <View style={styles.cardRow}>
        <CardTitle
          style={{ flex: 1 }}
          icon="phone-portrait-outline"
          title="PHONE.WATCH"
          sub={phoneWatch ? "active — locks on disconnect" : "inactive"}
        />
        {watchToggling ? (
          <ActivityIndicator color={colors.primary} />
        ) : (
          <Switch
            value={phoneWatch ?? false}
            onValueChange={toggleWatch}
            trackColor={{ false: colors.switchTrackOff, true: colors.primaryDim }}
            thumbColor={phoneWatch ? colors.primary : colors.switchThumbOff}
            accessibilityLabel="Phone watch"
          />
        )}
      </View>
    </Card>
  );

  const navRow = (
    <View style={styles.navRow}>
      <Pressable
        onPress={() => navigation.navigate("Monitor")}
        accessibilityRole="button"
        accessibilityLabel="Open system monitor"
        style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
      >
        <Ionicons name="stats-chart-outline" size={20} color={colors.primary} />
        <Text style={styles.navBtnLabel}>MONITOR</Text>
      </Pressable>
      <Pressable
        onPress={() => navigation.navigate("Log")}
        accessibilityRole="button"
        accessibilityLabel="Open audit log"
        style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
      >
        <Ionicons name="list-outline" size={20} color={colors.primary} />
        <Text style={styles.navBtnLabel}>LOG</Text>
      </Pressable>
    </View>
  );

  return (
    <ScreenShell
      centered
      refreshing={refreshing}
      onRefresh={onRefresh}
      header={
        <ScreenHeader
          right={
            <Pressable
              onPress={() => setSettingsOpen(true)}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Server settings"
              style={({ pressed }) => [styles.gearBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="settings-outline" size={20} color={colors.textMuted} />
            </Pressable>
          }
        />
      }
    >
      <Animated.View style={{ opacity: entranceFade, transform: [{ translateY: entranceSlide }], alignItems: "center", width: "100%" }}>

        {/* Connection status */}
        <ConnectionStrip style={styles.connStrip} />

        {/* Remembered reading: say how old it is, so nobody trusts it as live. */}
        {lock.stale && (
          <Text style={styles.asOf} accessibilityLiveRegion="polite">
            last known — as of {formatAsOf(lock.at)}
          </Text>
        )}

        {columns === 2 ? (
          <View style={styles.twoCol}>
            <View style={styles.colLeft}>{lockBlock}</View>
            <View style={styles.colRight}>
              {watchCard}
              {navRow}
            </View>
          </View>
        ) : (
          <>
            {lockBlock}
            {watchCard}
            {navRow}
          </>
        )}

        <GhostButton
          title="// disconnect"
          onPress={logout}
          color={colors.textMuted}
          accessibilityLabel="Disconnect from PC"
        />
      </Animated.View>

      <ServerSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  gearBtn: {
    minWidth: 44,
    minHeight: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  asOf: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    letterSpacing: 0.5,
    marginBottom: spacing.md,
  },
  // Remembered, not live: dimmed so it never reads as a current reading.
  stale: { opacity: 0.55 },
  lockBlock: { alignItems: "center", width: "100%" },
  // Two columns only on a landscape tablet, where there is width to spare.
  twoCol: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.xxl,
    width: "100%",
  },
  colLeft: { flex: 1, alignItems: "center" },
  colRight: { flex: 1 },
  connStrip: {
    marginBottom: spacing.xxl,
    backgroundColor: colors.surfaceHi,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  statusRow: {
    flexDirection: "row",
    alignItems: "center",
    marginBottom: 36,
  },
  statusText: {
    fontSize: font.lg,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 2,
  },
  lockContainer: {
    alignItems: "center",
    justifyContent: "center",
    marginBottom: spacing.huge,
  },
  lockBtn: {
    width: 180,
    height: 180,
    borderRadius: 90,
    alignItems: "center",
    justifyContent: "center",
    borderWidth: 2,
  },
  lockLabel: {
    fontSize: font.md,
    fontWeight: "800",
    fontFamily: mono,
    marginTop: spacing.sm,
    letterSpacing: 2,
  },
  cardRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  navRow: {
    flexDirection: "row",
    gap: spacing.md,
    marginTop: spacing.xxl,
    marginBottom: spacing.md,
    width: "100%",
  },
  navBtn: {
    flex: 1,
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    borderWidth: 1,
    borderColor: colors.border,
    alignItems: "center",
    paddingVertical: spacing.lg,
    gap: spacing.xs,
  },
  navBtnLabel: {
    color: colors.primary,
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 1,
  },
});
