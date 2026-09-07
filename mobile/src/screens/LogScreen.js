import { useState, useCallback } from "react";
import { View, Text, FlatList, RefreshControl, ActivityIndicator, Pressable, StyleSheet } from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../context/AuthContext";
import { useError } from "../context/ErrorContext";
import { usePolling } from "../hooks/usePolling";
import { ScreenShell } from "../components/ScreenShell";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyState } from "../components/EmptyState";
import { Card } from "../components/Card";
import { confirm } from "../components/confirm";
import { getActionMeta } from "../auditActions";
import { colors, spacing, radius, font, mono } from "../theme";

const ROW_HEIGHT = 74;

export function LogScreen() {
  const { api } = useAuth();
  const { showError } = useError();
  const navigation = useNavigation();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLog = useCallback(async () => {
    try {
      const data = await api("GET", "/audit");
      setEntries([...data.entries].reverse());
    } catch (e) {
      showError("AUDIT LOG FAILED", e);
    }
    setLoading(false);
  }, [api, showError]);

  const { refreshing, onRefresh } = usePolling(fetchLog, 15000);

  const clearLog = () => {
    confirm(
      "Purge log",
      "The current entries move to audit.log.1 on the PC, so nothing is lost for good.",
      {
        confirmText: "Purge",
        destructive: true,
        onConfirm: async () => {
          try {
            await api("POST", "/audit/clear");
            setEntries([]);
          } catch (e) {
            showError("LOG PURGE FAILED", e);
          }
        },
      },
    );
  };

  const header = (
    <ScreenHeader
      title="AUDIT.LOG"
      onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
      right={
        <>
          <Text style={styles.countBadge}>{entries.length}</Text>
          <Pressable
            onPress={clearLog}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel="Purge audit log"
            style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="trash-outline" size={16} color={colors.danger} />
            <Text style={styles.clearText}>PURGE</Text>
          </Pressable>
        </>
      }
    />
  );

  const renderItem = ({ item }) => {
    const meta = getActionMeta(item.action);
    const line = `${item.timestamp} | ${item.action} | ${item.ip}`;
    return (
      <Pressable
        onLongPress={() => Clipboard.setStringAsync(line)}
        delayLongPress={300}
        accessibilityRole="button"
        accessibilityLabel={`${item.action} at ${item.timestamp} from ${item.ip}`}
        accessibilityHint="Long press to copy"
      >
        <Card style={styles.entryCard}>
          <View style={styles.entryRow}>
            <Ionicons name={meta.icon} size={14} color={meta.color} />
            <Text style={[styles.actionText, { color: meta.color }]}>{item.action}</Text>
          </View>
          <Text style={styles.meta}>
            {item.timestamp}  {"•"}  {item.ip}
          </Text>
        </Card>
      </Pressable>
    );
  };

  return (
    <ScreenShell header={header} scroll={false}>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <FlatList
          data={entries}
          renderItem={renderItem}
          // The server returns the last 50 entries, so timestamp+action+ip is
          // unique in practice; an index key reorders every row on refresh.
          keyExtractor={(item) => `${item.timestamp}|${item.action}|${item.ip}`}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          contentContainerStyle={styles.list}
          refreshControl={
            <RefreshControl
              refreshing={refreshing}
              onRefresh={onRefresh}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListEmptyComponent={
            <EmptyState
              icon="receipt-outline"
              title="NO ENTRIES"
              message="Remote actions appear here as they happen."
            />
          }
        />
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  countBadge: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    backgroundColor: colors.surfaceHi,
    paddingHorizontal: spacing.sm,
    paddingVertical: 2,
    borderRadius: radius.sm,
    overflow: "hidden",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingVertical: spacing.xs,
    paddingHorizontal: spacing.sm,
    minHeight: 44,
  },
  clearText: {
    color: colors.danger,
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
  },
  list: { paddingBottom: spacing.xl },
  entryCard: { marginBottom: spacing.sm },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: spacing.xs,
  },
  actionText: { fontWeight: "700", fontSize: font.sm, fontFamily: mono },
  meta: { color: colors.textMuted, fontSize: font.xs, fontFamily: mono, marginLeft: 22 },
});
