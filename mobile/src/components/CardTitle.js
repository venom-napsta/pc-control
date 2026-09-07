import { View, Text, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, spacing, font, mono } from "../theme";

// Card heading: optional icon + mono title, with an optional sub line that
// lines up under the title text.
export function CardTitle({ icon, title, sub, iconColor = colors.text, style }) {
  return (
    <View style={style}>
      <View style={styles.row}>
        {icon ? <Ionicons name={icon} size={18} color={iconColor} /> : null}
        <Text style={styles.title}>{title}</Text>
      </View>
      {sub ? <Text style={[styles.sub, icon && styles.subIndent]}>{sub}</Text> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  title: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: "700",
    fontFamily: mono,
  },
  sub: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: spacing.xs,
  },
  subIndent: { marginLeft: 26 },
});
