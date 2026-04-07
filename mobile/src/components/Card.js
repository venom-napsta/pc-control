import { useEffect, useRef } from "react";
import { Animated, StyleSheet } from "react-native";
import { colors, radius, spacing } from "../theme";

export function Card({ children, style, delay = 0 }) {
  const fade = useRef(new Animated.Value(0)).current;
  const slide = useRef(new Animated.Value(14)).current;

  useEffect(() => {
    Animated.parallel([
      Animated.timing(fade, {
        toValue: 1,
        duration: 420,
        delay,
        useNativeDriver: true,
      }),
      Animated.timing(slide, {
        toValue: 0,
        duration: 420,
        delay,
        useNativeDriver: true,
      }),
    ]).start();
  }, [fade, slide, delay]);

  return (
    <Animated.View
      style={[
        styles.card,
        { opacity: fade, transform: [{ translateY: slide }] },
        style,
      ]}
    >
      {children}
    </Animated.View>
  );
}

const styles = StyleSheet.create({
  card: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    padding: spacing.lg,
    width: "100%",
    borderWidth: 1,
    borderColor: colors.border,
    marginBottom: spacing.md,
  },
});
