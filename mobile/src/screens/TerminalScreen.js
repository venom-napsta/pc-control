import { useState, useRef, useCallback, useMemo, useEffect } from "react";
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet,
  KeyboardAvoidingView, Platform,
} from "react-native";
import { SafeAreaView } from "react-native-safe-area-context";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../context/AuthContext";
import { keyboardAvoidBehavior } from "../keyboard";
import { colors, spacing, font, radius, mono } from "../theme";
import { getTerminalHTML, startTerminalScript, toWsUrl } from "../terminalHtml";

// How long the page gets to load xterm from the PC and open the WebSocket
// before the spinner is replaced by an error.
export const CONNECT_TIMEOUT_MS = 10000;

const EXTRA_KEYS = [
  { label: "ESC", data: "\x1b" },
  { label: "TAB", data: "\t" },
  { label: "\u2190", data: "\x1b[D", wide: true },
  { label: "\u2191", data: "\x1b[A", wide: true },
  { label: "\u2193", data: "\x1b[B", wide: true },
  { label: "\u2192", data: "\x1b[C", wide: true },
  { label: "CTRL", toggle: true },
  { label: "PASTE", action: "paste", wide: true },
  { label: "A-", action: "smaller" },
  { label: "A+", action: "bigger" },
  { label: "^C", data: "\x03" },
  { label: "^Z", data: "\x1a" },
  { label: "^D", data: "\x04" },
  { label: "^L", data: "\x0c" },
  { label: "|", data: "|" },
  { label: "~", data: "~" },
  { label: "/", data: "/" },
  { label: "-", data: "-" },
  { label: "_", data: "_" },
];

// Messages from the page that end the "connecting" phase one way or another.
const SETTLING_MESSAGES = ["connected", "disconnected", "auth_failed", "assets_failed", "error"];

export const FONT_STEP = 1;

export function TerminalScreen() {
  const { password, server } = useAuth();
  const webviewRef = useRef(null);
  const html = useMemo(() => getTerminalHTML(server), [server]);
  const [status, setStatus] = useState("idle");
  const [key, setKey] = useState(0);
  const [ctrlActive, setCtrlActive] = useState(false);
  const connectTimerRef = useRef(null);

  const clearConnectTimer = useCallback(() => {
    if (connectTimerRef.current) {
      clearTimeout(connectTimerRef.current);
      connectTimerRef.current = null;
    }
  }, []);

  useEffect(() => clearConnectTimer, [clearConnectTimer]);

  const handleMessage = useCallback((event) => {
    const msg = event.nativeEvent.data;
    if (SETTLING_MESSAGES.includes(msg)) clearConnectTimer();
    if (msg === "connected") setStatus("connected");
    else if (msg === "disconnected") setStatus("disconnected");
    else if (msg === "auth_failed") setStatus("auth_failed");
    else if (msg === "assets_failed") setStatus("assets_failed");
    else if (msg === "error") setStatus("error");
    else if (msg === "ctrl_off") setCtrlActive(false);
  }, [clearConnectTimer]);

  const sendKey = useCallback((data) => {
    const escaped = JSON.stringify(data);
    webviewRef.current?.injectJavaScript(`window.sendTermKey(${escaped}); true;`);
  }, []);

  // Send the phone's clipboard into the shell. Typing a long path or a URL on
  // a phone keyboard is the worst part of a mobile terminal.
  const pasteFromClipboard = useCallback(async () => {
    const text = await Clipboard.getStringAsync();
    if (text) sendKey(text);
  }, [sendKey]);

  const nudgeFont = useCallback((delta) => {
    webviewRef.current?.injectJavaScript(`window.nudgeFontSize(${delta}); true;`);
  }, []);

  const toggleCtrl = useCallback(() => {
    const next = !ctrlActive;
    setCtrlActive(next);
    webviewRef.current?.injectJavaScript(`window.setCtrl(${next}); true;`);
  }, [ctrlActive]);

  const onExtraKey = useCallback((k) => {
    if (k.toggle) return toggleCtrl();
    if (k.action === "paste") return pasteFromClipboard();
    if (k.action === "smaller") return nudgeFont(-FONT_STEP);
    if (k.action === "bigger") return nudgeFont(FONT_STEP);
    return sendKey(k.data);
  }, [toggleCtrl, pasteFromClipboard, nudgeFont, sendKey]);

  const connect = () => {
    setStatus("connecting");
    setKey((k) => k + 1);
    // If neither "connected" nor a failure arrives in time (assets never
    // load, WebSocket hangs), stop spinning and say so.
    clearConnectTimer();
    connectTimerRef.current = setTimeout(() => {
      connectTimerRef.current = null;
      setStatus((current) => (current === "connecting" ? "error" : current));
    }, CONNECT_TIMEOUT_MS);
  };

  const disconnect = () => {
    clearConnectTimer();
    setStatus("idle");
    setKey((k) => k + 1);
  };

  // Once the page has loaded, hand it the address and PIN. The PIN goes over
  // the WebSocket as the first frame, never in a URL or the HTML.
  const onLoadEnd = useCallback(() => {
    if (!server) return;
    webviewRef.current?.injectJavaScript(startTerminalScript({ wsUrl: toWsUrl(server), pin: password }));
  }, [server, password]);

  const failed = ["error", "disconnected", "auth_failed", "assets_failed"].includes(status);
  const statusColor =
    status === "connected" ? colors.success :
    failed ? colors.danger :
    colors.textMuted;

  const statusLabel =
    status === "connected" ? "CONNECTED" :
    status === "connecting" ? "CONNECTING..." :
    status === "disconnected" ? "DISCONNECTED" :
    status === "auth_failed" ? "REJECTED" :
    status === "assets_failed" ? "TERMINAL ASSETS DIDN'T LOAD" :
    status === "error" ? "ERROR" : "READY";

  return (
    <SafeAreaView edges={["top"]} style={styles.screen}>
      {/* Header bar */}
      <View style={styles.header}>
        <View style={styles.headerLeft}>
          <Ionicons name="terminal" size={16} color={colors.primary} />
          <Text style={styles.headerTitle}>TERMINAL</Text>
          <View style={[styles.statusDot, { backgroundColor: statusColor }]} />
          <Text style={[styles.statusText, { color: statusColor }]}>{statusLabel}</Text>
        </View>
        <View style={styles.headerRight}>
          {status === "connected" ? (
            <Pressable onPress={disconnect} hitSlop={12} accessibilityRole="button" accessibilityLabel="Disconnect terminal" style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
            </Pressable>
          ) : (
            <Pressable onPress={connect} hitSlop={12} accessibilityRole="button" accessibilityLabel="Connect terminal" style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="play-circle-outline" size={18} color={colors.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Terminal area */}
      {status === "idle" ? (
        <View style={styles.placeholder}>
          <Ionicons name="terminal-outline" size={48} color={colors.primaryDim} />
          <Text style={styles.placeholderText}>{"// tap play to connect"}</Text>
          <Pressable onPress={connect} style={({ pressed }) => [styles.connectBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="play" size={20} color={colors.bg} />
            <Text style={styles.connectBtnText}>CONNECT</Text>
          </Pressable>
        </View>
      ) : (
        // Lifts the extra-keys toolbar above the soft keyboard. Android no
        // longer resizes the window for us under edge-to-edge, so it needs a
        // behaviour too rather than none.
        <KeyboardAvoidingView
          style={styles.webviewContainer}
          behavior={keyboardAvoidBehavior(Platform.OS)}
        >
          {status === "connecting" && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          )}
          <WebView
            key={key}
            ref={webviewRef}
            source={{ html }}
            style={styles.webview}
            onMessage={handleMessage}
            onLoadEnd={onLoadEnd}
            javaScriptEnabled
            domStorageEnabled
            originWhitelist={["*"]}
            mixedContentMode="always"
            allowsInlineMediaPlayback
            scrollEnabled={false}
            showsHorizontalScrollIndicator={false}
            showsVerticalScrollIndicator={false}
            keyboardDisplayRequiresUserAction={false}
          />
          {/* Extra keys toolbar */}
          <View style={styles.toolbar}>
            <ScrollView horizontal showsHorizontalScrollIndicator={false}
              contentContainerStyle={styles.toolbarScroll}
              keyboardShouldPersistTaps="always"
            >
              {EXTRA_KEYS.map((k) => (
                <Pressable
                  key={k.label}
                  onPress={() => onExtraKey(k)}
                  accessibilityRole="button"
                  accessibilityLabel={
                    k.action === "paste" ? "Paste clipboard into terminal"
                    : k.action === "smaller" ? "Smaller terminal text"
                    : k.action === "bigger" ? "Larger terminal text"
                    : k.label
                  }
                  style={({ pressed }) => [
                    styles.extraKey,
                    k.wide && styles.extraKeyWide,
                    k.toggle && ctrlActive && styles.extraKeyActive,
                    pressed && { opacity: 0.5 },
                  ]}
                >
                  <Text style={[
                    styles.extraKeyText,
                    k.wide && styles.extraKeyTextWide,
                    k.toggle && ctrlActive && styles.extraKeyTextActive,
                  ]}>
                    {k.label}
                  </Text>
                </Pressable>
              ))}
            </ScrollView>
          </View>
        </KeyboardAvoidingView>
      )}
    </SafeAreaView>
  );
}

const styles = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  header: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    paddingHorizontal: spacing.lg,
    paddingTop: spacing.sm,
    paddingBottom: spacing.sm,
    backgroundColor: colors.surface,
    borderBottomWidth: 1,
    borderBottomColor: colors.border,
  },
  headerLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  headerTitle: {
    color: colors.text,
    fontSize: font.md,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 1,
  },
  statusDot: {
    width: 8,
    height: 8,
    borderRadius: 4,
    marginLeft: spacing.sm,
  },
  statusText: {
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  headerRight: {
    flexDirection: "row",
    gap: spacing.sm,
  },
  headerBtn: {
    padding: spacing.xs,
  },
  placeholder: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.lg,
  },
  placeholderText: {
    color: colors.primaryDim,
    fontSize: font.md,
    fontFamily: mono,
  },
  connectBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    backgroundColor: colors.primary,
    paddingHorizontal: spacing.xxl,
    paddingVertical: spacing.md,
    borderRadius: radius.lg,
    marginTop: spacing.lg,
  },
  connectBtnText: {
    color: colors.bg,
    fontSize: font.md,
    fontWeight: "700",
    fontFamily: mono,
  },
  webviewContainer: {
    flex: 1,
  },
  loadingOverlay: {
    ...StyleSheet.absoluteFillObject,
    zIndex: 10,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: "rgba(11,20,32,0.85)",
  },
  webview: {
    flex: 1,
    backgroundColor: colors.bg,
  },
  toolbar: {
    backgroundColor: colors.surface,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  toolbarScroll: {
    paddingHorizontal: spacing.sm,
    paddingVertical: spacing.sm,
    gap: spacing.xs,
  },
  extraKey: {
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.sm,
    backgroundColor: colors.surfaceHi,
    borderRadius: 6,
    borderWidth: 1,
    borderColor: colors.border,
    minWidth: 36,
    alignItems: "center",
  },
  extraKeyWide: {
    paddingHorizontal: spacing.lg,
  },
  extraKeyActive: {
    backgroundColor: colors.primary,
    borderColor: colors.primary,
  },
  extraKeyText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
  },
  extraKeyTextWide: {
    fontSize: font.lg,
  },
  extraKeyTextActive: {
    color: colors.bg,
  },
});
