import { useEffect, useRef } from "react";
import { View, Text, Animated, StyleSheet } from "react-native";
import { colors, font, spacing, mono } from "../theme";

export function StatBar({ label, value, pct }) {
  const width = useRef(new Animated.Value(0)).current;
  const glow = useRef(new Animated.Value(1)).current;
  const critical = pct > 80;

  useEffect(() => {
    Animated.timing(width, {
      toValue: Math.min(pct, 100),
      duration: 600,
      useNativeDriver: false,
    }).start();
  }, [pct, width]);

  useEffect(() => {
    if (critical) {
      const pulse = Animated.loop(
        Animated.sequence([
          Animated.timing(glow, { toValue: 0.45, duration: 500, useNativeDriver: false }),
          Animated.timing(glow, { toValue: 1, duration: 500, useNativeDriver: false }),
        ])
      );
      pulse.start();
      return () => pulse.stop();
    }
    glow.setValue(1);
  }, [critical, glow]);

  const barColor = critical ? colors.danger : colors.primary;

  return (
    <View style={styles.container}>
      <View style={styles.row}>
        <Text style={styles.label}>{label}</Text>
        <Animated.Text style={[styles.value, { color: barColor, opacity: critical ? glow : 1 }]}>
          {value}
        </Animated.Text>
      </View>
      <View style={styles.track}>
        <Animated.View
          style={[
            styles.fill,
            {
              backgroundColor: barColor,
              opacity: critical ? glow : 1,
              width: width.interpolate({
                inputRange: [0, 100],
                outputRange: ["0%", "100%"],
              }),
            },
          ]}
        />
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  container: { marginBottom: spacing.md },
  row: { flexDirection: "row", justifyContent: "space-between", marginBottom: 4 },
  label: { color: colors.textMuted, fontSize: font.sm, fontFamily: mono, letterSpacing: 1 },
  value: { fontSize: font.sm, fontFamily: mono },
  track: { height: 6, backgroundColor: colors.surfaceHi, borderRadius: 3, overflow: "hidden" },
  fill: { height: 6, borderRadius: 3 },
});
