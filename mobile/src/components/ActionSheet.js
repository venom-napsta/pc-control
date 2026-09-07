import { Modal, View, Text, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useLayout } from "../layout";
import { colors, spacing, radius, font, mono } from "../theme";

// Bottom-sheet menu for context actions. Replaces Alert-based menus, which on
// Android silently drop every button after the third and cannot be dismissed
// with Back. Each action: { label, icon, destructive?, onPress }.
export function ActionSheet({ visible, title, subtitle, actions = [], onClose }) {
  const { contentMaxWidth } = useLayout();

  const choose = (action) => {
    onClose();
    // Let the sheet finish dismissing before an action opens a native dialog.
    setTimeout(action.onPress, 250);
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close menu" />
      <View style={styles.wrap} pointerEvents="box-none">
        <View style={[styles.sheet, contentMaxWidth ? { maxWidth: contentMaxWidth } : null]}>
          <View style={styles.handle} />
          {title ? <Text style={styles.title} numberOfLines={1}>{title}</Text> : null}
          {subtitle ? <Text style={styles.subtitle} numberOfLines={2}>{subtitle}</Text> : null}
          {actions.map((a) => (
            <Pressable
              key={a.label}
              onPress={() => choose(a)}
              accessibilityRole="button"
              accessibilityLabel={a.label}
              style={({ pressed }) => [styles.action, pressed && styles.actionPressed]}
            >
              <Ionicons name={a.icon} size={18} color={a.destructive ? colors.danger : colors.primary} />
              <Text style={[styles.actionText, a.destructive && styles.actionTextDanger]}>{a.label}</Text>
            </Pressable>
          ))}
          <Pressable
            onPress={onClose}
            accessibilityRole="button"
            accessibilityLabel="Cancel"
            style={({ pressed }) => [styles.cancel, pressed && styles.actionPressed]}
          >
            <Text style={styles.cancelText}>Cancel</Text>
          </Pressable>
        </View>
      </View>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  wrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    width: "100%",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.lg,
    paddingBottom: spacing.xxxl,
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  title: { color: colors.text, fontSize: font.md, fontWeight: "700", fontFamily: mono, marginBottom: 2 },
  subtitle: { color: colors.textMuted, fontSize: font.xs, fontFamily: mono, marginBottom: spacing.md },
  action: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: 14,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    minHeight: 48,
  },
  actionPressed: { backgroundColor: colors.surfaceHi },
  actionText: { color: colors.text, fontSize: font.md, fontFamily: mono },
  actionTextDanger: { color: colors.danger },
  cancel: {
    marginTop: spacing.sm,
    paddingVertical: 14,
    alignItems: "center",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    minHeight: 48,
  },
  cancelText: { color: colors.textMuted, fontSize: font.md, fontFamily: mono, letterSpacing: 0.5 },
});
