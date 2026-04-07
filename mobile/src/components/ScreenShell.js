import { SafeAreaView, ScrollView, RefreshControl, StyleSheet } from "react-native";
import { colors, spacing } from "../theme";

export function ScreenShell({ children, refreshing, onRefresh, centered, style }) {
  return (
    <SafeAreaView style={styles.screen}>
      <ScrollView
        contentContainerStyle={[
          centered ? styles.centered : styles.padded,
          style,
        ]}
        refreshControl={
          onRefresh ? (
            <RefreshControl
              refreshing={refreshing ?? false}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          ) : undefined
        }
      >
        {children}
      </ScrollView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  centered: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  padded: { padding: spacing.xl, paddingTop: spacing.huge },
});
