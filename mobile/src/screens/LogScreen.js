import { useState, useCallback } from "react";
import {
  View, Text, SafeAreaView, ScrollView, RefreshControl,
  ActivityIndicator, Alert, Pressable, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../context/AuthContext";
import { usePolling } from "../hooks/usePolling";
import { Card } from "../components/Card";
import { SectionHeader } from "../components/SectionHeader";
import { colors, spacing, font, mono } from "../theme";

const ACTION_META = {
  lock:           { color: "#EF5350", icon: "lock-closed" },
  unlock:         { color: "#00D9C4", icon: "lock-open" },
  shutdown:       { color: "#FF9800", icon: "power" },
  reboot:         { color: "#FF9800", icon: "refresh" },
  volume:         { color: "#9C27B0", icon: "volume-high" },
  notify:         { color: "#4CAF50", icon: "notifications" },
  screenshot:     { color: "#5C7CF5", icon: "camera" },
  clipboard:      { color: "#FFEB3B", icon: "clipboard" },
  intruder:       { color: "#F44336", icon: "warning" },
  phone_watch:    { color: "#00A896", icon: "phone-portrait" },
  audit_cleared:  { color: "#666",    icon: "trash" },
  file_delete:    { color: "#F44336", icon: "trash" },
  terminal:       { color: "#4CAF50", icon: "terminal" },
  network_scan:   { color: "#5C7CF5", icon: "wifi" },
  webcam_kill:    { color: "#FF5722", icon: "videocam-off" },
  fake_busy:      { color: "#9C27B0", icon: "desktop" },
  wol:            { color: "#00D9C4", icon: "flash" },
};

function getActionMeta(action) {
  for (const [key, meta] of Object.entries(ACTION_META)) {
    if (action.includes(key)) return meta;
  }
  return { color: colors.primary, icon: "ellipse" };
}

export function LogScreen() {
  const { api } = useAuth();
  const navigation = useNavigation();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLog = useCallback(async () => {
    try {
      const data = await api("GET", "/audit");
      setEntries([...data.entries].reverse());
    } catch {}
    setLoading(false);
  }, [api]);

  const { refreshing, onRefresh } = usePolling(fetchLog, 15000);

  const clearLog = () => {
    Alert.alert("Purge Log", "Clear all audit entries?", [
      { text: "Cancel", style: "cancel" },
      {
        text: "Purge",
        style: "destructive",
        onPress: async () => {
          try {
            await api("POST", "/audit/clear");
            setEntries([]);
          } catch {
            Alert.alert("Error", "Failed to clear log");
          }
        },
      },
    ]);
  };

  return (
    <SafeAreaView style={styles.screen}>
      <View style={styles.header}>
        {navigation.canGoBack() && (
          <Pressable
            onPress={() => navigation.goBack()}
            style={({ pressed }) => [styles.backRow, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="chevron-back" size={20} color={colors.primary} />
            <Text style={styles.backText}>Back</Text>
          </Pressable>
        )}
        <View style={styles.headerRow}>
          <SectionHeader style={{ marginBottom: 0 }}>AUDIT.LOG</SectionHeader>
          <View style={styles.headerActions}>
            <Text style={styles.countBadge}>{entries.length}</Text>
            <Pressable
              onPress={clearLog}
              style={({ pressed }) => [styles.clearBtn, pressed && { opacity: 0.6 }]}
            >
              <Ionicons name="trash-outline" size={16} color={colors.danger} />
              <Text style={styles.clearText}>PURGE</Text>
            </Pressable>
          </View>
        </View>
      </View>
      {loading ? (
        <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView
          style={{ flex: 1 }}
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
        >
          {entries.length === 0 && (
            <Text style={styles.empty}>// no entries</Text>
          )}
          {entries.map((e, i) => {
            const meta = getActionMeta(e.action);
            const line = `${e.timestamp} | ${e.action} | ${e.ip}`;
            return (
              <Pressable
                key={i}
                onLongPress={() => {
                  Clipboard.setStringAsync(line);
                  Alert.alert("Copied", line);
                }}
                delayLongPress={300}
              >
                <Card style={{ marginBottom: spacing.sm }}>
                  <View style={styles.entryRow}>
                    <Ionicons name={meta.icon} size={14} color={meta.color} />
                    <Text style={[styles.actionText, { color: meta.color }]}>
                      {e.action}
                    </Text>
                  </View>
                  <Text style={styles.meta}>
                    {e.timestamp}  {"\u2022"}  {e.ip}
                  </Text>
                </Card>
              </Pressable>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: { flex: 1, backgroundColor: colors.bg },
  header: { padding: spacing.xl, paddingTop: spacing.huge },
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
    marginBottom: spacing.md,
    paddingVertical: spacing.xs,
    paddingRight: spacing.sm,
  },
  backText: {
    color: colors.primary,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  headerRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
  },
  headerActions: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  countBadge: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    backgroundColor: colors.surfaceHi,
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 8,
    overflow: "hidden",
  },
  clearBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 8,
  },
  clearText: {
    color: colors.danger,
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
  },
  list: { paddingHorizontal: spacing.xl, paddingBottom: spacing.xl },
  empty: {
    color: colors.textDim,
    fontFamily: mono,
    textAlign: "center",
    marginTop: 40,
  },
  entryRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginBottom: 4,
  },
  actionText: { fontWeight: "700", fontSize: font.sm, fontFamily: mono },
  meta: { color: colors.textMuted, fontSize: font.xs, fontFamily: mono, marginLeft: 22 },
});
