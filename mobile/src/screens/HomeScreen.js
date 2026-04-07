import { useState, useCallback, useEffect, useRef } from "react";
import {
  View, Text, ActivityIndicator, Alert, Switch,
  Pressable, Animated, Easing, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { usePolling } from "../hooks/usePolling";
import { ScreenShell } from "../components/ScreenShell";
import { Card } from "../components/Card";
import { PulsingDot } from "../components/PulsingDot";
import { GhostButton } from "../components/Button";
import { OrbitRing } from "../components/OrbitRing";
import { colors, spacing, font, radius, mono } from "../theme";

export function HomeScreen() {
  const { api, logout } = useAuth();
  const navigation = useNavigation();
  const [locked, setLocked] = useState(null);
  const [phoneWatch, setPhoneWatch] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [watchToggling, setWatchToggling] = useState(false);
  const [latency, setLatency] = useState(null);

  // Lock button rotation
  const lockRotation = useRef(new Animated.Value(0)).current;
  // Lock press scale
  const lockScale = useRef(new Animated.Value(1)).current;
  // Connection badge flash
  const connPulse = useRef(new Animated.Value(0.6)).current;
  // Entrance animations
  const entranceFade = useRef(new Animated.Value(0)).current;
  const entranceSlide = useRef(new Animated.Value(30)).current;

  useEffect(() => {
    const spinAnim = Animated.loop(
      Animated.timing(lockRotation, {
        toValue: 1,
        duration: 12000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spinAnim.start();

    const pulseAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(connPulse, { toValue: 1, duration: 1500, useNativeDriver: true }),
        Animated.timing(connPulse, { toValue: 0.6, duration: 1500, useNativeDriver: true }),
      ])
    );
    pulseAnim.start();

    const entranceAnim = Animated.parallel([
      Animated.timing(entranceFade, { toValue: 1, duration: 600, useNativeDriver: true }),
      Animated.timing(entranceSlide, { toValue: 0, duration: 600, useNativeDriver: true }),
    ]);
    entranceAnim.start();

    return () => { spinAnim.stop(); pulseAnim.stop(); entranceAnim.stop(); };
  }, [lockRotation, connPulse, entranceFade, entranceSlide]);

  const fetchAll = useCallback(async () => {
    try {
      const t0 = Date.now();
      const [s, w] = await Promise.all([
        api("GET", "/status"),
        api("GET", "/phone-watch/status"),
      ]);
      setLatency(Date.now() - t0);
      setLocked(s.locked);
      setPhoneWatch(w.active);
    } catch {}
  }, [api]);

  const { refreshing, onRefresh } = usePolling(fetchAll, 5000);

  const toggleLock = async () => {
    // Bounce animation
    Animated.sequence([
      Animated.timing(lockScale, { toValue: 0.9, duration: 100, useNativeDriver: true }),
      Animated.spring(lockScale, { toValue: 1, friction: 3, tension: 200, useNativeDriver: true }),
    ]).start();

    setToggling(true);
    try {
      await api("POST", locked ? "/unlock" : "/lock");
      await fetchAll();
    } catch {
      Alert.alert("Error", "Could not reach PC");
    }
    setToggling(false);
  };

  const toggleWatch = async () => {
    setWatchToggling(true);
    try {
      const data = await api("POST", "/phone-watch/toggle");
      setPhoneWatch(data.active);
    } catch {
      Alert.alert("Error", "Could not toggle phone watch");
    }
    setWatchToggling(false);
  };

  const statusColor = locked ? colors.danger : colors.primary;

  const lockSpin = lockRotation.interpolate({
    inputRange: [0, 1],
    outputRange: ["0deg", "360deg"],
  });

  return (
    <ScreenShell centered refreshing={refreshing} onRefresh={onRefresh}>
      <Animated.View style={{ opacity: entranceFade, transform: [{ translateY: entranceSlide }], alignItems: "center", width: "100%" }}>

        {/* Connection badge */}
        {latency !== null && (
          <Animated.View style={[styles.connBadge, { opacity: connPulse }]}>
            <Text style={styles.connText}>
              LINK OK {"\u2022"} {latency}ms
            </Text>
          </Animated.View>
        )}

        {/* Status */}
        <View style={styles.statusRow}>
          <PulsingDot color={statusColor} />
          <Text style={[styles.statusText, { color: statusColor, marginLeft: spacing.sm }]}>
            {locked === null ? "CONNECTING..." : locked ? "LOCKED" : "UNLOCKED"}
          </Text>
        </View>

        {/* Lock button with orbit ring */}
        <View style={styles.lockContainer}>
          {/* Outer rotating ring */}
          <Animated.View style={[styles.orbitRingOuter, { transform: [{ rotate: lockSpin }] }]}>
            {Array.from({ length: 16 }).map((_, i) => {
              const angle = (2 * Math.PI * i) / 16;
              const r = 112;
              const x = r + (r - 3) * Math.cos(angle) - 1.5;
              const y = r + (r - 3) * Math.sin(angle) - 1.5;
              const dot = i % 4 === 0 ? 4 : 2;
              return (
                <View
                  key={i}
                  style={{
                    position: "absolute",
                    left: x - (dot - 3) / 2,
                    top: y - (dot - 3) / 2,
                    width: dot,
                    height: dot,
                    borderRadius: dot / 2,
                    backgroundColor: locked ? colors.danger : colors.primary,
                    opacity: i % 4 === 0 ? 0.7 : 0.25,
                  }}
                />
              );
            })}
          </Animated.View>

          <Animated.View style={{ transform: [{ scale: lockScale }] }}>
            <Pressable
              onPress={toggleLock}
              disabled={toggling}
              style={({ pressed }) => [
                styles.lockBtn,
                {
                  borderColor: locked ? colors.primary : colors.danger,
                  backgroundColor: locked ? "#0D2A1A" : "#2A0D0D",
                },
                pressed && { opacity: 0.9 },
              ]}
            >
              {toggling ? (
                <ActivityIndicator color={colors.primary} size="large" />
              ) : (
                <>
                  <Ionicons
                    name={locked ? "lock-open-outline" : "lock-closed-outline"}
                    size={44}
                    color={locked ? colors.primary : colors.danger}
                  />
                  <Text style={[styles.lockLabel, { color: locked ? colors.primary : colors.danger }]}>
                    {locked ? "UNLOCK" : "LOCK"}
                  </Text>
                </>
              )}
            </Pressable>
          </Animated.View>
        </View>

        {/* Phone Watch */}
        <Card style={{ alignSelf: "stretch" }}>
          <View style={styles.cardRow}>
            <View style={{ flex: 1 }}>
              <View style={styles.cardTitleRow}>
                <Ionicons name="phone-portrait-outline" size={18} color={colors.text} />
                <Text style={styles.cardTitle}>PHONE.WATCH</Text>
              </View>
              <Text style={styles.cardSub}>
                {phoneWatch ? "active \u2014 locks on disconnect" : "inactive"}
              </Text>
            </View>
            {watchToggling ? (
              <ActivityIndicator color={colors.primary} />
            ) : (
              <Switch
                value={phoneWatch ?? false}
                onValueChange={toggleWatch}
                trackColor={{ false: "#1a1a1a", true: colors.primaryDim }}
                thumbColor={phoneWatch ? colors.primary : "#555"}
              />
            )}
          </View>
        </Card>

        {/* ── Quick Nav ── */}
        <View style={styles.navRow}>
          <Pressable
            onPress={() => navigation.navigate("Monitor")}
            style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
          >
            <Ionicons name="stats-chart-outline" size={20} color={colors.primary} />
            <Text style={styles.navBtnLabel}>MONITOR</Text>
          </Pressable>
          <Pressable
            onPress={() => navigation.navigate("Log")}
            style={({ pressed }) => [styles.navBtn, pressed && { opacity: 0.8, transform: [{ scale: 0.97 }] }]}
          >
            <Ionicons name="list-outline" size={20} color={colors.primary} />
            <Text style={styles.navBtnLabel}>LOG</Text>
          </Pressable>
        </View>

        <GhostButton title={"\u21BB  Refresh"} onPress={fetchAll} />
        <GhostButton
          title="// disconnect"
          onPress={logout}
          color={colors.textDim}
          style={{ marginTop: spacing.xs }}
        />
      </Animated.View>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  connBadge: {
    backgroundColor: colors.surfaceHi,
    paddingHorizontal: 14,
    paddingVertical: 4,
    borderRadius: 12,
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.primaryDim,
  },
  connText: {
    color: colors.primary,
    fontSize: font.xs,
    fontFamily: mono,
    fontWeight: "700",
    letterSpacing: 1,
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
    width: 224,
    height: 224,
    alignItems: "center",
    justifyContent: "center",
    marginBottom: 40,
  },
  orbitRingOuter: {
    position: "absolute",
    width: 224,
    height: 224,
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
  cardTitleRow: {
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
  cardSub: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: 4,
    marginLeft: 26,
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
