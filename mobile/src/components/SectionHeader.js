import { useEffect, useRef } from "react";
import { Animated, Text, StyleSheet } from "react-native";
import { colors, font, spacing, mono } from "../theme";

export function SectionHeader({ children, style }) {
  const blink = useRef(new Animated.Value(1)).current;

  useEffect(() => {
    const loop = Animated.loop(
      Animated.sequence([
        Animated.timing(blink, { toValue: 0, duration: 0, delay: 530, useNativeDriver: true }),
        Animated.timing(blink, { toValue: 1, duration: 0, delay: 530, useNativeDriver: true }),
      ])
    );
    loop.start();
    return () => loop.stop();
  }, [blink]);

  return (
    <Text style={[styles.section, style]}>
      <Text style={styles.prefix}>{">"}</Text>
      <Animated.Text style={[styles.cursor, { opacity: blink }]}>_</Animated.Text>
      {" "}{children}
    </Text>
  );
}

const styles = StyleSheet.create({
  section: {
    color: colors.primaryDark,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    textTransform: "uppercase",
    letterSpacing: 1.5,
    marginBottom: spacing.md,
  },
  prefix: {
    color: colors.primary,
    fontWeight: "800",
  },
  cursor: {
    color: colors.primary,
    fontWeight: "800",
  },
});
