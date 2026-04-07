import { useState, useRef } from "react";
import { Pressable, Text, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { colors, font, mono, spacing } from "../theme";

export function CopyBadge({ text, label = "COPY" }) {
  const [copied, setCopied] = useState(false);
  const flash = useRef(new Animated.Value(0)).current;

  const handleCopy = async () => {
    if (!text) return;
    await Clipboard.setStringAsync(text);
    setCopied(true);
    Animated.sequence([
      Animated.timing(flash, { toValue: 1, duration: 150, useNativeDriver: true }),
      Animated.timing(flash, { toValue: 0, duration: 800, useNativeDriver: true }),
    ]).start(() => setCopied(false));
  };

  return (
    <Pressable
      onPress={handleCopy}
      style={({ pressed }) => [styles.badge, pressed && { opacity: 0.6 }]}
    >
      <Animated.View
        style={[
          StyleSheet.absoluteFill,
          styles.flashBg,
          { opacity: flash },
        ]}
      />
      <Ionicons
        name={copied ? "checkmark" : "copy-outline"}
        size={13}
        color={copied ? colors.success : colors.primary}
      />
      <Text style={[styles.text, copied && { color: colors.success }]}>
        {copied ? "COPIED" : label}
      </Text>
    </Pressable>
  );
}

const styles = StyleSheet.create({
  badge: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: 10,
    paddingVertical: 5,
    borderRadius: 8,
    backgroundColor: colors.surfaceHi,
    borderWidth: 1,
    borderColor: colors.primaryDim,
    overflow: "hidden",
  },
  flashBg: {
    backgroundColor: colors.success,
    borderRadius: 8,
  },
  text: {
    color: colors.primary,
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
  },
});
