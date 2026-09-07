import { Pressable, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, font, mono } from "../theme";

export function BackButton({ onPress, label = "Back", style }) {
  return (
    <Pressable
      onPress={onPress}
      hitSlop={12}
      accessibilityRole="button"
      accessibilityLabel="Go back"
      style={({ pressed }) => [styles.row, pressed && { opacity: 0.6 }, style]}
    >
      <Ionicons name="chevron-back" size={20} color={colors.primary} />
      {label ? <Text style={styles.text}>{label}</Text> : null}
    </Pressable>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
    minHeight: 44,
    paddingRight: spacing.sm,
  },
  text: {
    color: colors.primary,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
});
