import { useState, useRef, useCallback } from "react";
import {
  View, Text, Pressable, ScrollView, ActivityIndicator, StyleSheet,
} from "react-native";
import { WebView } from "react-native-webview";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { colors, spacing, font, radius, mono } from "../theme";

const EXTRA_KEYS = [
  { label: "ESC", data: "\x1b" },
  { label: "TAB", data: "\t" },
  { label: "\u2190", data: "\x1b[D", wide: true },
  { label: "\u2191", data: "\x1b[A", wide: true },
  { label: "\u2193", data: "\x1b[B", wide: true },
  { label: "\u2192", data: "\x1b[C", wide: true },
  { label: "CTRL", toggle: true },
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

const SERVER = process.env.EXPO_PUBLIC_SERVER || "http://localhost:2000";

function getTerminalHTML(serverUrl, pin) {
  const wsUrl = serverUrl.replace("http://", "ws://").replace("https://", "wss://");
  const safePin = pin.replace(/\\/g, "\\\\").replace(/'/g, "\\'");

  return `<!DOCTYPE html>
<html>
<head>
  <meta name="viewport" content="width=device-width,initial-scale=1,maximum-scale=1,user-scalable=no">
  <link rel="stylesheet" href="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/css/xterm.css">
  <script src="https://cdn.jsdelivr.net/npm/@xterm/xterm@5.5.0/lib/xterm.js"></script>
  <script src="https://cdn.jsdelivr.net/npm/@xterm/addon-fit@0.10.0/lib/addon-fit.js"></script>
  <style>
    *{margin:0;padding:0;box-sizing:border-box}
    html,body{height:100%;background:#0B1420;overflow:hidden}
    #terminal{height:100%}
    .xterm{height:100%;padding:4px}
    .xterm-viewport::-webkit-scrollbar{width:6px}
    .xterm-viewport::-webkit-scrollbar-thumb{background:#094A52;border-radius:3px}
  </style>
</head>
<body>
  <div id="terminal"></div>
  <script>
    const term = new Terminal({
      theme:{
        background:'#0B1420',foreground:'#e0e0e0',cursor:'#00D9C4',
        cursorAccent:'#0B1420',selectionBackground:'#094A52',
        black:'#000000',red:'#EF5350',green:'#4CAF50',yellow:'#FF9800',
        blue:'#5C7CF5',magenta:'#9C27B0',cyan:'#00D9C4',white:'#FFFFFF',
        brightBlack:'#546E7A',brightRed:'#FF8A80',brightGreen:'#69F0AE',
        brightYellow:'#FFD740',brightBlue:'#448AFF',brightMagenta:'#EA80FC',
        brightCyan:'#84FFFF',brightWhite:'#FFFFFF',
      },
      fontSize:13,fontFamily:'monospace',cursorBlink:true,cursorStyle:'bar',
      scrollback:5000,allowTransparency:true,
    });

    const fitAddon = new FitAddon.FitAddon();
    term.loadAddon(fitAddon);
    term.open(document.getElementById('terminal'));
    fitAddon.fit();

    function sendResize(){
      const dims = fitAddon.proposeDimensions();
      if(dims && ws && ws.readyState === WebSocket.OPEN){
        const enc = new TextEncoder();
        ws.send(enc.encode('\\x01RESIZE:'+dims.rows+','+dims.cols));
      }
    }

    const ws = new WebSocket('${wsUrl}/ws/terminal?pin='+encodeURIComponent('${safePin}'));
    ws.binaryType = 'arraybuffer';

    ws.onopen = function(){
      term.write('\\r\\n\\x1b[1;36m Connected to PC terminal \\x1b[0m\\r\\n\\r\\n');
      setTimeout(function(){ fitAddon.fit(); sendResize(); }, 100);
      window.ReactNativeWebView.postMessage('connected');
    };

    ws.onmessage = function(e){
      if(e.data instanceof ArrayBuffer){
        term.write(new Uint8Array(e.data));
      } else {
        term.write(e.data);
      }
    };

    ws.onclose = function(){
      term.write('\\r\\n\\x1b[1;31m Disconnected \\x1b[0m\\r\\n');
      window.ReactNativeWebView.postMessage('disconnected');
    };

    ws.onerror = function(){
      term.write('\\r\\n\\x1b[1;31m Connection error \\x1b[0m\\r\\n');
      window.ReactNativeWebView.postMessage('error');
    };

    var ctrlOn = false;
    window.setCtrl = function(on){ ctrlOn = on; };
    window.sendTermKey = function(data){
      if(ws.readyState === WebSocket.OPEN) ws.send(data);
    };

    term.onData(function(data){
      if(ws.readyState === WebSocket.OPEN){
        if(ctrlOn && data.length === 1){
          var code = data.toUpperCase().charCodeAt(0);
          if(code >= 65 && code <= 90) data = String.fromCharCode(code - 64);
          ctrlOn = false;
          window.ReactNativeWebView.postMessage('ctrl_off');
        }
        ws.send(data);
      }
    });

    window.addEventListener('resize', function(){
      fitAddon.fit();
      sendResize();
    });

    new ResizeObserver(function(){
      fitAddon.fit();
      sendResize();
    }).observe(document.getElementById('terminal'));
  </script>
</body>
</html>`;
}

export function TerminalScreen() {
  const { password } = useAuth();
  const webviewRef = useRef(null);
  const [status, setStatus] = useState("idle");
  const [key, setKey] = useState(0);
  const [ctrlActive, setCtrlActive] = useState(false);

  const handleMessage = useCallback((event) => {
    const msg = event.nativeEvent.data;
    if (msg === "connected") setStatus("connected");
    else if (msg === "disconnected") setStatus("disconnected");
    else if (msg === "error") setStatus("error");
    else if (msg === "ctrl_off") setCtrlActive(false);
  }, []);

  const sendKey = useCallback((data) => {
    const escaped = JSON.stringify(data);
    webviewRef.current?.injectJavaScript(`window.sendTermKey(${escaped}); true;`);
  }, []);

  const toggleCtrl = useCallback(() => {
    const next = !ctrlActive;
    setCtrlActive(next);
    webviewRef.current?.injectJavaScript(`window.setCtrl(${next}); true;`);
  }, [ctrlActive]);

  const connect = () => {
    setStatus("connecting");
    setKey((k) => k + 1);
  };

  const disconnect = () => {
    setStatus("idle");
    setKey((k) => k + 1);
  };

  const statusColor =
    status === "connected" ? colors.success :
    status === "error" || status === "disconnected" ? colors.danger :
    colors.textMuted;

  const statusLabel =
    status === "connected" ? "CONNECTED" :
    status === "connecting" ? "CONNECTING..." :
    status === "disconnected" ? "DISCONNECTED" :
    status === "error" ? "ERROR" : "READY";

  return (
    <View style={styles.screen}>
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
            <Pressable onPress={disconnect} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="close-circle-outline" size={18} color={colors.danger} />
            </Pressable>
          ) : (
            <Pressable onPress={connect} style={({ pressed }) => [styles.headerBtn, pressed && { opacity: 0.6 }]}>
              <Ionicons name="play-circle-outline" size={18} color={colors.primary} />
            </Pressable>
          )}
        </View>
      </View>

      {/* Terminal area */}
      {status === "idle" ? (
        <View style={styles.placeholder}>
          <Ionicons name="terminal-outline" size={48} color={colors.primaryDim} />
          <Text style={styles.placeholderText}>// tap play to connect</Text>
          <Pressable onPress={connect} style={({ pressed }) => [styles.connectBtn, pressed && { opacity: 0.85 }]}>
            <Ionicons name="play" size={20} color={colors.bg} />
            <Text style={styles.connectBtnText}>CONNECT</Text>
          </Pressable>
        </View>
      ) : (
        <View style={styles.webviewContainer}>
          {status === "connecting" && (
            <View style={styles.loadingOverlay}>
              <ActivityIndicator color={colors.primary} size="large" />
            </View>
          )}
          <WebView
            key={key}
            ref={webviewRef}
            source={{ html: getTerminalHTML(SERVER, password) }}
            style={styles.webview}
            onMessage={handleMessage}
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
                  onPress={() => k.toggle ? toggleCtrl() : sendKey(k.data)}
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
        </View>
      )}
    </View>
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
    paddingTop: spacing.huge,
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
