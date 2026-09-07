import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, font, mono } from "../theme";

// Centered "nothing here" block. `action` is an optional element (a button)
// rendered under the message.
export function EmptyState({ icon = "file-tray-outline", title, message, action, style }) {
  return (
    <View style={[styles.wrap, style]} accessibilityRole="summary">
      <Ionicons name={icon} size={28} color={colors.textMuted} />
      {title ? <Text style={styles.title}>{title}</Text> : null}
      {message ? <Text style={styles.message}>{message}</Text> : null}
      {action ? <View style={styles.action}>{action}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  wrap: {
    alignItems: "center",
    paddingVertical: spacing.xxxl,
    paddingHorizontal: spacing.xl,
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 1,
    textAlign: "center",
  },
  message: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    lineHeight: 16,
    textAlign: "center",
  },
  action: { marginTop: spacing.sm, alignSelf: "stretch" },
});
