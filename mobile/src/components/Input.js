import { TextInput, StyleSheet } from "react-native";
import { colors, spacing, radius, font, mono } from "../theme";

// The one TextInput look used across the app. Pass `style` for layout
// tweaks (width, margins, alignment); every other TextInput prop passes through.
export function Input({ style, multiline, ...rest }) {
  return (
    <TextInput
      placeholderTextColor={colors.placeholder}
      selectionColor={colors.primary}
      cursorColor={colors.primary}
      multiline={multiline}
      style={[styles.input, multiline && styles.multiline, style]}
      {...rest}
    />
  );
}

const styles = StyleSheet.create({
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: font.lg,
    fontFamily: mono,
    paddingHorizontal: spacing.md,
    paddingVertical: 14,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    textAlign: "left",
    minHeight: 44,
  },
  multiline: {
    height: 100,
    textAlignVertical: "top",
  },
});
