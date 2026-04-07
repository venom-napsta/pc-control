import { useEffect, useRef } from "react";
import { View, Animated, Easing } from "react-native";
import { colors } from "../theme";

/**
 * Rotating ring of orbital dots — wraps any content.
 * Place behind a logo, lock button, etc. for that sci-fi scanner feel.
 */
export function OrbitRing({
  children,
  size = 120,
  dotCount = 8,
  dotSize = 4,
  color = colors.primary,
  duration = 10000,
  reverse = false,
  opacity: ringOpacity = 0.5,
}) {
  const rotation = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const spin = Animated.loop(
      Animated.timing(rotation, {
        toValue: reverse ? -1 : 1,
        duration,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    spin.start();
    return () => spin.stop();
  }, [rotation, duration, reverse]);

  const spinDeg = rotation.interpolate({
    inputRange: [-1, 0, 1],
    outputRange: ["-360deg", "0deg", "360deg"],
  });

  const r = size / 2;

  return (
    <View style={{ width: size, height: size, alignItems: "center", justifyContent: "center" }}>
      {/* Orbiting dots */}
      <Animated.View
        style={{
          position: "absolute",
          width: size,
          height: size,
          transform: [{ rotate: spinDeg }],
        }}
      >
        {Array.from({ length: dotCount }).map((_, i) => {
          const angle = (2 * Math.PI * i) / dotCount;
          const x = r + (r - dotSize) * Math.cos(angle) - dotSize / 2;
          const y = r + (r - dotSize) * Math.sin(angle) - dotSize / 2;
          // Vary dot opacity for comet-trail feel
          const dotOpacity = 0.3 + 0.7 * ((dotCount - i) / dotCount);
          return (
            <View
              key={i}
              style={{
                position: "absolute",
                left: x,
                top: y,
                width: dotSize,
                height: dotSize,
                borderRadius: dotSize / 2,
                backgroundColor: color,
                opacity: dotOpacity * ringOpacity,
              }}
            />
          );
        })}
      </Animated.View>
      {/* Center content */}
      {children}
    </View>
  );
}
