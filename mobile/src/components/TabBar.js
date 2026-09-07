import { useEffect, useRef } from "react";
import { View, Text, Pressable, Animated, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useSafeAreaInsets } from "react-native-safe-area-context";
import { useAuth } from "../context/AuthContext";
import { useLayout } from "../layout";
import { colors, font, radius, spacing } from "../theme";

const TAB_CFG = {
  Home:      { outline: "home-outline",        filled: "home" },
  Controls:  { outline: "settings-outline",    filled: "settings-sharp" },
  Files:     { outline: "folder-outline",      filled: "folder" },
  Terminal:  { outline: "terminal-outline",    filled: "terminal" },
};

// The tab that carries the reachability dot. Only Home gets one: repeating it
// on every tab would be noise.
export const STATUS_TAB = "Home";
// Small enough to read as a badge, big enough to see on a 22px icon.
export const CONNECTION_DOT_SIZE = 7;

// Pure: dot colour for a connectionState. Anything unrecognised (including
// undefined, before the auth layer has an answer) reads as "unknown".
export function connectionDotColor(connectionState) {
  if (connectionState === "online") return colors.success;
  if (connectionState === "unreachable") return colors.danger;
  return colors.textMuted;
}

// Pure: what a screen reader announces for the dot, e.g. "PC online".
export function connectionDotHint(connectionState) {
  if (connectionState === "online") return "PC online";
  if (connectionState === "unreachable") return "PC unreachable";
  return "PC status unknown";
}

// Pure: "Home, PC online" for the Home tab, the plain route name elsewhere.
export function tabAccessibilityLabel(routeName, connectionState) {
  if (routeName !== STATUS_TAB) return routeName;
  return `${routeName}, ${connectionDotHint(connectionState)}`;
}

function TabItem({ route, focused, onPress, connectionState }) {
  const cfg = TAB_CFG[route.name];
  const showDot = route.name === STATUS_TAB;
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
      accessibilityRole="tab"
      accessibilityState={{ selected: focused }}
      accessibilityLabel={tabAccessibilityLabel(route.name, connectionState)}
    >
      {/* The dot lives outside iconWrap: that view clips (overflow hidden) so
          the pill's rounded corners stay clean, which would eat the badge.
          Absolute positioning keeps the icon's own layout untouched. */}
      <View style={styles.iconSlot}>
        <Animated.View style={[styles.iconWrap, focused && styles.pill, { transform: [{ scale }] }]}>
          <Ionicons
            name={focused ? cfg.filled : cfg.outline}
            size={22}
            color={focused ? colors.primary : colors.textMuted}
          />
        </Animated.View>
        {showDot ? (
          <View
            pointerEvents="none"
            style={[styles.statusDot, { backgroundColor: connectionDotColor(connectionState) }]}
          />
        ) : null}
      </View>
      <Text style={[styles.label, focused && styles.labelActive]}>
        {route.name}
      </Text>
    </Pressable>
  );
}

export function TabBar({ state, descriptors, navigation }) {
  const insets = useSafeAreaInsets();
  const { tabBarMaxWidth } = useLayout();
  const { connectionState = "unknown" } = useAuth() || {};

  return (
    <View style={[styles.bar, { paddingBottom: Math.max(insets.bottom, 10) }]}>
      <View style={[styles.row, tabBarMaxWidth ? { maxWidth: tabBarMaxWidth } : null]}>
      {state.routes.map((route, i) => {
        const focused = state.index === i;
        const onPress = () => {
          const event = navigation.emit({ type: "tabPress", target: route.key, canPreventDefault: true });
          if (!focused && !event.defaultPrevented) {
            navigation.navigate(route.name, route.params);
          }
        };
        return (
          <TabItem
            key={route.key}
            route={route}
            focused={focused}
            onPress={onPress}
            connectionState={connectionState}
          />
        );
      })}
      </View>
    </View>
  );
}

const styles = StyleSheet.create({
  bar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    paddingTop: spacing.sm,
  },
  row: {
    flexDirection: "row",
    width: "100%",
    alignSelf: "center",
  },
  tab: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    minHeight: 44,
  },
  // Sizes itself to the icon, so wrapping changes nothing about the layout.
  iconSlot: {
    position: "relative",
  },
  statusDot: {
    position: "absolute",
    top: 0,
    right: spacing.sm,
    width: CONNECTION_DOT_SIZE,
    height: CONNECTION_DOT_SIZE,
    borderRadius: CONNECTION_DOT_SIZE / 2,
    borderWidth: 1,
    borderColor: colors.surface,
  },
  iconWrap: {
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.xs,
    borderRadius: radius.lg,
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
