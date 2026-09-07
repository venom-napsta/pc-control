import { useRef } from "react";
import { Pressable, Text, View, ActivityIndicator, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { colors, radius, spacing, font, mono } from "../theme";

function usePressScale(down = 0.96) {
  const scale = useRef(new Animated.Value(1)).current;
  const onPressIn = () => {
    Animated.spring(scale, { toValue: down, friction: 8, tension: 400, useNativeDriver: true }).start();
  };
  const onPressOut = () => {
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 300, useNativeDriver: true }).start();
  };
  return { scale, onPressIn, onPressOut };
}

const VARIANTS = {
  primary: { btn: { backgroundColor: colors.primary }, fg: colors.bg },
  outline: { btn: { backgroundColor: "transparent", borderWidth: 1, borderColor: colors.primaryDim }, fg: colors.primary },
  danger: { btn: { backgroundColor: colors.dangerGhost, borderWidth: 1, borderColor: colors.dangerBorder }, fg: colors.danger },
};

// The single primary action style: mono uppercase label, letterSpacing 1,
// radius.lg. variant: "primary" (filled) | "outline" | "danger".
export function PrimaryButton({
  title, onPress, disabled, loading, style, variant = "primary", icon, accessibilityLabel,
}) {
  const { scale, onPressIn, onPressOut } = usePressScale();
  const v = VARIANTS[variant] || VARIANTS.primary;

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        disabled={disabled || loading}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        accessibilityState={{ disabled: !!disabled, busy: !!loading }}
        style={[styles.btn, v.btn, (disabled && !loading) && styles.disabled]}
      >
        {loading ? (
          <ActivityIndicator color={v.fg} />
        ) : (
          <View style={styles.content}>
            {icon ? <Ionicons name={icon} size={16} color={v.fg} /> : null}
            <Text style={[styles.text, { color: v.fg }]}>{title}</Text>
          </View>
        )}
      </Pressable>
    </Animated.View>
  );
}

export function GhostButton({ title, onPress, color = colors.primary, style, accessibilityLabel }) {
  const { scale, onPressIn, onPressOut } = usePressScale(0.95);

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={onPressIn}
        onPressOut={onPressOut}
        accessibilityRole="button"
        accessibilityLabel={accessibilityLabel || title}
        style={[styles.ghost, style]}
      >
        <Text style={[styles.ghostText, { color }]}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.xxl,
    borderRadius: radius.lg,
    alignItems: "center",
    justifyContent: "center",
    minHeight: 44,
  },
  content: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  disabled: { opacity: 0.4 },
  text: {
    fontSize: font.md,
    fontWeight: "700",
    fontFamily: mono,
    textTransform: "uppercase",
    letterSpacing: 1,
  },
  ghost: { paddingVertical: spacing.sm, alignItems: "center", minHeight: 44, justifyContent: "center" },
  ghostText: { fontSize: font.md },
});
