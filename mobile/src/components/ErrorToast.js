import { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, spacing, font, radius, mono } from "../theme";

export function ErrorToast({ error, onDismiss }) {
  const insets = useSafeAreaInsets();
  const slideY = useRef(new Animated.Value(-120)).current;
  const opacity = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.spring(slideY, { toValue: 0, friction: 8, tension: 80, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 1, duration: 250, useNativeDriver: true }),
    ]).start();
  }, [slideY, opacity]);

  const dismiss = () => {
    Animated.parallel([
      Animated.timing(slideY, { toValue: -120, duration: 200, useNativeDriver: true }),
      Animated.timing(opacity, { toValue: 0, duration: 200, useNativeDriver: true }),
    ]).start(() => onDismiss?.());
  };

  const statusTag = error.status ? `${error.status}` : "ERR";
  const methodTag = error.method && error.endpoint
    ? `${error.method} ${error.endpoint}`
    : null;

  return (
    <Animated.View
      style={[styles.container, { top: insets.top + spacing.sm, transform: [{ translateY: slideY }], opacity }]}
    >
      <Pressable onPress={dismiss} style={styles.inner} accessibilityRole="button" accessibilityLabel={`Dismiss error: ${error.title}`}>
        {/* Left accent bar */}
        <View style={styles.accent} />

        <View style={styles.content}>
          {/* Header row: icon + title + status badge */}
          <View style={styles.headerRow}>
            <Ionicons name="alert-circle" size={16} color={colors.danger} />
            <Text style={styles.title} numberOfLines={1}>{error.title}</Text>
            <View style={styles.statusBadge}>
              <Text style={styles.statusText}>{statusTag}</Text>
            </View>
          </View>

          {/* Message */}
          <Text style={styles.message} numberOfLines={3}>{error.message}</Text>

          {/* Method/endpoint detail */}
          {methodTag && (
            <Text style={styles.detail} numberOfLines={1}>{methodTag}</Text>
          )}
        </View>

        {/* Dismiss X */}
        <Pressable onPress={dismiss} hitSlop={12} style={styles.closeBtn} accessibilityRole="button" accessibilityLabel="Dismiss error">
          <Ionicons name="close" size={14} color={colors.textMuted} />
        </Pressable>
      </Pressable>
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  container: {
    position: "absolute",
    left: spacing.lg,
    right: spacing.lg,
    zIndex: 9999,
  },
  inner: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
    overflow: "hidden",
    shadowColor: "#000",
    shadowOffset: { width: 0, height: 4 },
    shadowOpacity: 0.4,
    shadowRadius: 12,
    elevation: 8,
  },
  accent: {
    width: 4,
    backgroundColor: colors.danger,
  },
  content: {
    flex: 1,
    paddingVertical: spacing.sm,
    paddingLeft: spacing.md,
    paddingRight: spacing.xs,
  },
  headerRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 4,
  },
  title: {
    flex: 1,
    color: colors.text,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  statusBadge: {
    backgroundColor: colors.dangerGhost,
    paddingHorizontal: 6,
    paddingVertical: 1,
    borderRadius: radius.xs,
  },
  statusText: {
    color: colors.danger,
    fontSize: font.xxs,
    fontWeight: "700",
    fontFamily: mono,
  },
  message: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    lineHeight: 16,
  },
  detail: {
    color: colors.textMuted,
    fontSize: font.xxs,
    fontFamily: mono,
    marginTop: 2,
  },
  closeBtn: {
    padding: spacing.sm,
    alignSelf: "flex-start",
  },
});
