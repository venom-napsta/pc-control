import { useRef } from "react";
import { Pressable, Text, ActivityIndicator, Animated, StyleSheet } from "react-native";
import { colors, radius, spacing, font } from "../theme";

export function PrimaryButton({ title, onPress, disabled, loading, style }) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, {
      toValue: 0.96,
      friction: 8,
      tension: 400,
      useNativeDriver: true,
    }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, {
      toValue: 1,
      friction: 4,
      tension: 300,
      useNativeDriver: true,
    }).start();
  };

  return (
    <Animated.View style={[{ transform: [{ scale }] }, style]}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        disabled={disabled || loading}
        style={[
          styles.btn,
          (disabled && !loading) && styles.disabled,
        ]}
      >
        {loading
          ? <ActivityIndicator color={colors.bg} />
          : <Text style={styles.text}>{title}</Text>}
      </Pressable>
    </Animated.View>
  );
}

export function GhostButton({ title, onPress, color = colors.primary, style }) {
  const scale = useRef(new Animated.Value(1)).current;

  const handlePressIn = () => {
    Animated.spring(scale, { toValue: 0.95, friction: 8, tension: 400, useNativeDriver: true }).start();
  };

  const handlePressOut = () => {
    Animated.spring(scale, { toValue: 1, friction: 4, tension: 300, useNativeDriver: true }).start();
  };

  return (
    <Animated.View style={{ transform: [{ scale }] }}>
      <Pressable
        onPress={onPress}
        onPressIn={handlePressIn}
        onPressOut={handlePressOut}
        style={[styles.ghost, style]}
      >
        <Text style={[styles.ghostText, { color }]}>{title}</Text>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  btn: {
    backgroundColor: colors.primary,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    alignItems: "center",
  },
  disabled: { opacity: 0.4 },
  text: { color: colors.bg, fontSize: font.md, fontWeight: "700" },
  ghost: { paddingVertical: spacing.sm, alignItems: "center" },
  ghostText: { fontSize: font.md },
});
