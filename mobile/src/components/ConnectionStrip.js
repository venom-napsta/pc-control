import { View, Text, StyleSheet } from "react-native";
import { useAuth } from "../context/AuthContext";
import { serverLabel } from "../servers";
import { colors, spacing, font, mono } from "../theme";

// Pure so it can be unit-tested. Before the auth layer exposes
// connectionState, an active server is treated as online.
export function describeConnection({ connectionState, connectionError, server, serverInfo }) {
  const state = connectionState ?? (server ? "online" : "unknown");
  if (state === "online") {
    const latency = serverInfo?.latencyMs;
    const where = server ? ` via ${serverLabel(server)}` : "";
    const ms = latency != null ? ` · ${latency} ms` : "";
    return { state, color: colors.success, text: `online${where}${ms}` };
  }
  if (state === "unreachable") {
    const why = connectionError ? ` — ${connectionError}` : "";
    return { state, color: colors.danger, text: `unreachable${why}` };
  }
  return { state: "unknown", color: colors.textMuted, text: "connecting…" };
}

// One-line connection status: coloured dot + "online via host:port · 42 ms".
export function ConnectionStrip({ style }) {
  const { connectionState, connectionError = null, server, serverInfo } = useAuth();
  const { color, text, state } = describeConnection({ connectionState, connectionError, server, serverInfo });
  return (
    <View
      style={[styles.row, style]}
      accessibilityRole="text"
      accessibilityLabel={`Connection ${text}`}
      accessibilityLiveRegion="polite"
    >
      <View style={[styles.dot, { backgroundColor: color }]} />
      <Text
        style={[styles.text, state === "unreachable" && { color: colors.danger }]}
        numberOfLines={1}
        ellipsizeMode="tail"
      >
        {text}
      </Text>
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    maxWidth: "100%",
  },
  dot: { width: 8, height: 8, borderRadius: 4 },
  text: {
    flexShrink: 1,
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
});
