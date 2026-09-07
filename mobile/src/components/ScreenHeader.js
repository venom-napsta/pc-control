import { View, StyleSheet } from "react-native";
import { BackButton } from "./BackButton";
import { SectionHeader } from "./SectionHeader";
import { spacing } from "../theme";

// Screen title row: [back] TITLE ........ right. `onBack` omitted hides the
// back button; `right` is any element (badges, actions).
export function ScreenHeader({ title, onBack, right, style }) {
  return (
    <View style={[styles.row, style]}>
      <View style={styles.left}>
        {onBack ? <BackButton onPress={onBack} label={null} style={styles.back} /> : null}
        {title ? <SectionHeader style={styles.title}>{title}</SectionHeader> : null}
      </View>
      {right ? <View style={styles.right}>{right}</View> : null}
    </View>
  );
}

const styles = StyleSheet.create({
  row: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    minHeight: 44,
  },
  left: { flexDirection: "row", alignItems: "center", flex: 1 },
  back: { marginRight: spacing.xs, paddingRight: spacing.xs },
  title: { marginBottom: 0 },
  right: { flexDirection: "row", alignItems: "center", gap: spacing.md },
});
