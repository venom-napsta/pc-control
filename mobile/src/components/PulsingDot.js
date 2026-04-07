import { useEffect, useRef } from "react";
import { View, Animated } from "react-native";

export function PulsingDot({ color, size = 10 }) {
  const scale = useRef(new Animated.Value(1)).current;
  const opacity = useRef(new Animated.Value(1)).current;
  const ringScale = useRef(new Animated.Value(1)).current;
  const ringOpacity = useRef(new Animated.Value(0.5)).current;

  useEffect(() => {
    const pulse = Animated.loop(
      Animated.sequence([
        Animated.parallel([
          Animated.timing(scale, { toValue: 1.5, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 0.3, duration: 900, useNativeDriver: true }),
        ]),
        Animated.parallel([
          Animated.timing(scale, { toValue: 1, duration: 900, useNativeDriver: true }),
          Animated.timing(opacity, { toValue: 1, duration: 900, useNativeDriver: true }),
        ]),
      ])
    );

    const radar = Animated.loop(
      Animated.parallel([
        Animated.timing(ringScale, { toValue: 3.5, duration: 1800, useNativeDriver: true }),
        Animated.timing(ringOpacity, { toValue: 0, duration: 1800, useNativeDriver: true }),
      ]),
    );

    pulse.start();
    radar.start();
    return () => { pulse.stop(); radar.stop(); };
  }, [scale, opacity, ringScale, ringOpacity]);

  return (
    <View style={{ width: size * 4, height: size * 4, alignItems: "center", justifyContent: "center" }}>
      {/* Radar ring */}
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          borderRadius: size / 2,
          borderWidth: 1.5,
          borderColor: color,
          transform: [{ scale: ringScale }],
          opacity: ringOpacity,
        }}
      />
      {/* Core dot */}
      <Animated.View
        style={{
          width: size,
          height: size,
          borderRadius: size / 2,
          backgroundColor: color,
          transform: [{ scale }],
          opacity,
        }}
      />
    </View>
  );
}
