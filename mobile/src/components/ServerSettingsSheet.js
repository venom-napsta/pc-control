import { useEffect, useState, useCallback } from "react";
import {
  Modal, View, Text, Pressable, ScrollView,
  ActivityIndicator, KeyboardAvoidingView, Platform, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { serverLabel, serverKind } from "../servers";
import { useLayout } from "../layout";
import { keyboardAvoidBehavior } from "../keyboard";
import { Input } from "./Input";
import { confirm } from "./confirm";
import { colors, spacing, radius, font, mono } from "../theme";

const KIND_LABEL = { tailscale: "tailscale", lan: "lan", other: "" };

function StatusDot({ result, testing }) {
  if (testing && !result) return <ActivityIndicator size={10} color={colors.textMuted} />;
  const color = !result ? colors.textDim : result.ok ? colors.success : colors.danger;
  return <View style={[styles.dot, { backgroundColor: color }]} />;
}

function ServerRow({ url, active, result, testing, onRemove }) {
  const kind = KIND_LABEL[serverKind(url)];
  const detail = result
    ? result.ok
      ? `${result.host ? result.host + " · " : ""}${result.latencyMs} ms`
      : result.reason
    : "not tested";
  return (
    <View style={[styles.row, active && styles.rowActive]}>
      <StatusDot result={result} testing={testing} />
      <View style={styles.rowText}>
        <Text style={styles.rowLabel} numberOfLines={1}>{serverLabel(url)}</Text>
        <Text style={styles.rowDetail} numberOfLines={1}>
          {detail}{kind ? `  //  ${kind}` : ""}{active ? "  //  in use" : ""}
        </Text>
      </View>
      <Pressable
        onPress={onRemove}
        hitSlop={12}
        accessibilityRole="button"
        accessibilityLabel={`Remove ${serverLabel(url)}`}
        style={styles.iconBtn}
      >
        <Ionicons name="trash-outline" size={16} color={colors.textMuted} />
      </Pressable>
    </View>
  );
}

export function ServerSettingsSheet({ visible, onClose }) {
  const { servers, server, addServer, removeServer, resetServers, probeServers } = useAuth();
  const { contentMaxWidth } = useLayout();
  const [input, setInput] = useState("");
  const [inputError, setInputError] = useState(null);
  const [results, setResults] = useState({});
  const [testing, setTesting] = useState(false);

  const testAll = useCallback(async () => {
    setTesting(true);
    try {
      const list = await probeServers();
      const byUrl = {};
      for (const r of list) byUrl[r.url] = r;
      setResults(byUrl);
    } finally {
      setTesting(false);
    }
  }, [probeServers]);

  // Re-test whenever the sheet opens or the list changes.
  useEffect(() => {
    if (visible) testAll();
  }, [visible, servers, testAll]);

  const onAdd = async () => {
    setInputError(null);
    try {
      await addServer(input);
      setInput("");
    } catch (e) {
      setInputError(e.message);
    }
  };

  const onReset = () => {
    confirm(
      "Reset server list",
      "Replace your saved addresses with the built-in defaults?",
      { confirmText: "Reset", destructive: true, onConfirm: resetServers },
    );
  };

  return (
    <Modal visible={visible} transparent animationType="slide" onRequestClose={onClose}>
      <Pressable style={styles.backdrop} onPress={onClose} accessibilityLabel="Close server settings" />
      {/* A Modal is its own view hierarchy, so the ScreenShell behind it does
          not lift this sheet's address field clear of the keyboard. */}
      <KeyboardAvoidingView
        behavior={keyboardAvoidBehavior(Platform.OS)}
        style={styles.sheetWrap}
        pointerEvents="box-none"
      >
        <View style={[styles.sheet, contentMaxWidth ? { maxWidth: contentMaxWidth } : null]}>
          <View style={styles.handle} />
          <View style={styles.header}>
            <Text style={styles.title}>Server addresses</Text>
            <Pressable
              onPress={onClose}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Close"
              style={styles.iconBtn}
            >
              <Ionicons name="close" size={18} color={colors.textMuted} />
            </Pressable>
          </View>
          <Text style={styles.blurb}>
            The app tries every address here at once and uses the first one that answers.
            Keep the Tailscale name for when you are away, and the LAN address for home.
          </Text>

          <ScrollView style={styles.list} keyboardShouldPersistTaps="handled">
            {servers.map((url) => (
              <ServerRow
                key={url}
                url={url}
                active={url === server}
                result={results[url]}
                testing={testing}
                onRemove={() => removeServer(url)}
              />
            ))}
            {servers.length === 0 && (
              <Text style={styles.empty}>No addresses. Add one below.</Text>
            )}
          </ScrollView>

          <View style={styles.addRow}>
            <Input
              style={styles.input}
              value={input}
              onChangeText={setInput}
              placeholder="host or ip[:port]"
              autoCapitalize="none"
              autoCorrect={false}
              keyboardType="url"
              returnKeyType="done"
              onSubmitEditing={onAdd}
              accessibilityLabel="Server address"
            />
            <Pressable
              onPress={onAdd}
              hitSlop={12}
              accessibilityRole="button"
              accessibilityLabel="Add address"
              style={({ pressed }) => [styles.addBtn, pressed && { opacity: 0.8 }]}
            >
              <Ionicons name="add" size={20} color={colors.bg} />
            </Pressable>
          </View>
          {inputError && <Text style={styles.inputError}>{inputError}</Text>}

          <View style={styles.footer}>
            <Pressable
              onPress={testAll}
              disabled={testing}
              accessibilityRole="button"
              accessibilityLabel="Test all addresses"
              accessibilityState={{ disabled: testing, busy: testing }}
              style={styles.footerBtn}
            >
              <Ionicons name="pulse-outline" size={14} color={colors.primary} />
              <Text style={styles.footerText}>{testing ? "testing…" : "test all"}</Text>
            </Pressable>
            <Pressable
              onPress={onReset}
              accessibilityRole="button"
              accessibilityLabel="Reset to default addresses"
              style={styles.footerBtn}
            >
              <Ionicons name="refresh-outline" size={14} color={colors.textMuted} />
              <Text style={[styles.footerText, { color: colors.textMuted }]}>reset defaults</Text>
            </Pressable>
          </View>
        </View>
      </KeyboardAvoidingView>
    </Modal>
  );
}

const styles = StyleSheet.create({
  backdrop: { ...StyleSheet.absoluteFillObject, backgroundColor: "rgba(0,0,0,0.55)" },
  sheetWrap: { flex: 1, justifyContent: "flex-end" },
  sheet: {
    width: "100%",
    alignSelf: "center",
    backgroundColor: colors.surface,
    borderTopLeftRadius: radius.xl,
    borderTopRightRadius: radius.xl,
    borderWidth: 1,
    borderColor: colors.border,
    padding: spacing.xl,
    paddingBottom: spacing.xxxl,
    maxHeight: "85%",
  },
  handle: {
    alignSelf: "center",
    width: 36,
    height: 4,
    borderRadius: 2,
    backgroundColor: colors.border,
    marginBottom: spacing.md,
  },
  header: { flexDirection: "row", alignItems: "center", justifyContent: "space-between" },
  title: { color: colors.text, fontSize: font.lg, fontWeight: "700", fontFamily: mono, letterSpacing: 0.5 },
  blurb: { color: colors.textMuted, fontSize: font.xs, fontFamily: mono, lineHeight: 16, marginTop: spacing.sm, marginBottom: spacing.md },
  list: { flexGrow: 0 },
  row: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "transparent",
    marginBottom: spacing.xs,
  },
  rowActive: { borderColor: colors.primaryDim, backgroundColor: colors.primaryGhost },
  rowText: { flex: 1 },
  rowLabel: { color: colors.text, fontSize: font.sm, fontFamily: mono },
  rowDetail: { color: colors.textMuted, fontSize: font.xxs, fontFamily: mono, marginTop: 2 },
  dot: { width: 8, height: 8, borderRadius: 4 },
  iconBtn: { minWidth: 32, minHeight: 32, alignItems: "center", justifyContent: "center" },
  empty: { color: colors.textMuted, fontSize: font.xs, fontFamily: mono, padding: spacing.md },
  addRow: { flexDirection: "row", gap: spacing.sm, marginTop: spacing.md },
  input: {
    flex: 1,
    fontSize: font.sm,
    paddingVertical: 10,
  },
  addBtn: {
    backgroundColor: colors.primary,
    borderRadius: radius.md,
    paddingHorizontal: spacing.md,
    minWidth: 44,
    alignItems: "center",
    justifyContent: "center",
  },
  inputError: { color: colors.danger, fontSize: font.xs, fontFamily: mono, marginTop: spacing.sm },
  footer: { flexDirection: "row", justifyContent: "space-between", marginTop: spacing.lg },
  footerBtn: { flexDirection: "row", alignItems: "center", gap: 6, paddingVertical: spacing.xs, minHeight: 44 },
  footerText: { color: colors.primary, fontSize: font.xs, fontFamily: mono, letterSpacing: 0.5 },
});
