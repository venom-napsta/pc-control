import { Pressable, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, radius, font, mono } from "../theme";

// Full-width row that leads somewhere else: icon, label, trailing chevron.
export function NavLink({ icon, label, onPress, accessibilityLabel, style }) {
  return (
    <Pressable
      onPress={onPress}
      accessibilityRole="button"
      accessibilityLabel={accessibilityLabel || label}
      style={({ pressed }) => [styles.link, pressed && { opacity: 0.6 }, style]}
    >
      <Ionicons name={icon} size={14} color={colors.primary} />
      <Text style={styles.text}>{label}</Text>
      <Ionicons name="chevron-forward" size={14} color={colors.primaryDim} />
    </Pressable>
  );
}

const styles = StyleSheet.create({
  link: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    minHeight: 44,
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
  text: {
    flex: 1,
    color: colors.primary,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
});
