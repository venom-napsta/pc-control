import { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { colors, font, mono } from "../theme";

const TAB_CFG = {
  Home:      { outline: "home-outline",        filled: "home" },
  Controls:  { outline: "settings-outline",    filled: "settings-sharp" },
  Files:     { outline: "folder-outline",      filled: "folder" },
  Terminal:  { outline: "terminal-outline",    filled: "terminal" },
};

function TabItem({ route, focused, onPress }) {
  const cfg = TAB_CFG[route.name];
  const scale = useRef(new Animated.Value(1)).current;
  const prevFocused = useRef(focused);

  useEffect(() => {
    if (focused && !prevFocused.current) {
      scale.setValue(0.85);
      Animated.spring(scale, {
        toValue: 1,
        friction: 8,
        tension: 120,
        useNativeDriver: true,
      }).start();
    }
    prevFocused.current = focused;
  }, [focused, scale]);

  return (
    <Pressable
      onPress={onPress}
      android_ripple={{ color: colors.primaryGhost, borderless: true, radius: 32 }}
      style={styles.tab}
      accessibilityRole="button"
      accessibilityState={focused ? { selected: true } : {}}
      accessibilityLabel={route.name}
    >
      <Animated.View style={[styles.iconWrap, focused && styles.pill, { transform: [{ scale }] }]}>
        <Ionicons
          name={focused ? cfg.filled : cfg.outline}
          size={22}
          color={focused ? colors.primary : colors.textMuted}
        />
      </Animated.View>
      <Text style={[styles.label, focused && styles.labelActive]}>
        {route.name}
      </Text>
    </Pressable>
  );
}

export function TabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };
        return <TabItem key={route.key} route={route} focused={focused} onPress={onPress} />;
      })}
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    flexDirection: "row",
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: 8,
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: 4,
  },
  iconWrap: {
    paddingHorizontal: 16,
    paddingVertical: 4,
    borderRadius: 16,
    overflow: "hidden",
  },
  pill: {
    backgroundColor: colors.primaryGhost,
    overflow: "hidden",
  },
  label: {
    fontSize: font.xs,
    fontWeight: "600",
    color: colors.textMuted,
  },
  labelActive: {
    color: colors.primary,
  },
});
