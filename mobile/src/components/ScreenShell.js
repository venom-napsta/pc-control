import {
  View, ScrollView, RefreshControl, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { useLayout } from "../layout";
import { keyboardAvoidBehavior } from "../keyboard";
import { colors, spacing } from "../theme";

// Page frame: safe area, keyboard avoidance, tablet width cap, shared padding.
//  - header: element pinned above the body (gets the same width cap/padding)
//  - scroll={false}: body is a plain flex View, for screens that own their
//    own list (FlatList) instead of a ScrollView
export function ScreenShell({
  children, header, refreshing, onRefresh, centered, scroll = true, style,
}) {
  const { contentMaxWidth } = useLayout();
  const cap = contentMaxWidth ? { maxWidth: contentMaxWidth } : null;
  const bodyPad = [centered ? styles.centered : styles.padded, header && styles.underHeader, style];

  const body = scroll ? (
    <ScrollView
      style={styles.fill}
      contentContainerStyle={bodyPad}
      keyboardShouldPersistTaps="handled"
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
      {/* On tablets, cap the content width so phone layouts don't stretch edge to edge. */}
      <View style={[styles.content, cap, centered && styles.contentCentered]}>
        {children}
      </View>
    </ScrollView>
  ) : (
    <View style={[styles.fill, bodyPad]}>
      <View style={[styles.content, styles.fill, cap, centered && styles.contentCentered]}>
        {children}
      </View>
    </View>
  );

  return (
    <SafeAreaView style={styles.screen}>
      <KeyboardAvoidingView
        style={styles.fill}
        behavior={keyboardAvoidBehavior(Platform.OS)}
      >
        {header ? (
          <View style={styles.headerWrap}>
            <View style={[styles.content, cap]}>{header}</View>
          </View>
        ) : null}
        {body}
      </KeyboardAvoidingView>
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  fill: { flex: 1 },
  centered: {
    flexGrow: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: spacing.xxl,
  },
  padded: { padding: spacing.xl, paddingTop: spacing.md },
  underHeader: { paddingTop: spacing.xs },
  headerWrap: {
    paddingHorizontal: spacing.xl,
    paddingTop: spacing.md,
    paddingBottom: spacing.sm,
  },
  content: { width: "100%", alignSelf: "center" },
  contentCentered: { alignItems: "center" },
});
