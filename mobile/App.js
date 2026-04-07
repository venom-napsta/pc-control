import { useState, useEffect, useCallback, createContext, useContext } from "react";
import {
  View, Text, TouchableOpacity, TextInput, StyleSheet,
  ActivityIndicator, Alert, SafeAreaView, StatusBar, Switch,
  ScrollView, Image, Modal, Platform,
} from "react-native";
import { NavigationContainer } from "@react-navigation/native";
import { createBottomTabNavigator } from "@react-navigation/bottom-tabs";
import { Ionicons } from "@expo/vector-icons";
import Slider from "@react-native-community/slider";
import * as Notifications from "expo-notifications";
import * as Device from "expo-device";

// ── Constants ──────────────────────────────────────────
const SERVER = process.env.EXPO_PUBLIC_SERVER || "http://localhost:8000";
const TEAL = "#00BCD4";
const TEAL_DARK = "#00838F";
const TEAL_DIM = "#004D5C";
const BG = "#060F11";
const CARD = "#0D1F23";
const LOCKED_COLOR = "#EF5350";
const UNLOCKED_COLOR = "#00BCD4";

const Tab = createBottomTabNavigator();
const AuthCtx = createContext();
const useAuth = () => useContext(AuthCtx);

// ── Push notification handler ──────────────────────────
Notifications.setNotificationHandler({
  handleNotification: async () => ({
    shouldShowAlert: true,
    shouldPlaySound: true,
    shouldSetBadge: false,
  }),
});

// ════════════════════════════════════════════════════════
//  HOME TAB
// ════════════════════════════════════════════════════════
function HomeScreen() {
  const { api, logout } = useAuth();
  const [locked, setLocked] = useState(null);
  const [phoneWatch, setPhoneWatch] = useState(null);
  const [toggling, setToggling] = useState(false);
  const [watchToggling, setWatchToggling] = useState(false);

  const fetchAll = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api("GET", "/status"),
        api("GET", "/phone-watch/status"),
      ]);
      setLocked(s.locked);
      setPhoneWatch(w.active);
    } catch {}
  }, [api]);

  useEffect(() => {
    fetchAll();
    const iv = setInterval(fetchAll, 5000);
    return () => clearInterval(iv);
  }, [fetchAll]);

  const toggleLock = async () => {
    setToggling(true);
    try {
      await api("POST", locked ? "/unlock" : "/lock");
      await fetchAll();
    } catch {
      Alert.alert("Error", "Could not reach PC");
    }
    setToggling(false);
  };

  const toggleWatch = async () => {
    setWatchToggling(true);
    try {
      const data = await api("POST", "/phone-watch/toggle");
      setPhoneWatch(data.active);
    } catch {
      Alert.alert("Error", "Could not toggle phone watch");
    }
    setWatchToggling(false);
  };

  return (
    <SafeAreaView style={st.screen}>
      <ScrollView contentContainerStyle={st.centerContent}>
        {/* Status */}
        <View style={st.statusRow}>
          <View style={[st.dot, { backgroundColor: locked ? LOCKED_COLOR : UNLOCKED_COLOR }]} />
          <Text style={[st.statusText, { color: locked ? LOCKED_COLOR : UNLOCKED_COLOR }]}>
            {locked === null ? "Checking..." : locked ? "Locked" : "Unlocked"}
          </Text>
        </View>

        {/* Lock button */}
        <TouchableOpacity
          style={[st.lockButton, {
            borderColor: locked ? UNLOCKED_COLOR : LOCKED_COLOR,
            backgroundColor: locked ? "#0D2A1A" : "#2A0D0D",
          }]}
          onPress={toggleLock}
          disabled={toggling}
          activeOpacity={0.8}
        >
          {toggling ? (
            <ActivityIndicator color={TEAL} size="large" />
          ) : (
            <>
              <Text style={st.lockIcon}>{locked ? "\uD83D\uDD13" : "\uD83D\uDD12"}</Text>
              <Text style={[st.lockLabel, { color: locked ? UNLOCKED_COLOR : LOCKED_COLOR }]}>
                {locked ? "Unlock PC" : "Lock PC"}
              </Text>
            </>
          )}
        </TouchableOpacity>

        {/* Phone Watch */}
        <View style={st.card}>
          <View style={st.cardRow}>
            <View style={{ flex: 1 }}>
              <Text style={st.cardTitle}>{"\uD83D\uDCE1"} Phone Away Lock</Text>
              <Text style={st.cardSub}>
                {phoneWatch ? "Active \u2014 locks when phone disconnects" : "Inactive"}
              </Text>
            </View>
            {watchToggling ? (
              <ActivityIndicator color={TEAL} />
            ) : (
              <Switch
                value={phoneWatch ?? false}
                onValueChange={toggleWatch}
                trackColor={{ false: "#1a1a1a", true: TEAL_DIM }}
                thumbColor={phoneWatch ? TEAL : "#555"}
              />
            )}
          </View>
        </View>

        <TouchableOpacity onPress={fetchAll} style={{ marginTop: 16 }}>
          <Text style={{ color: TEAL, fontSize: 15 }}>{"\u21BB"}  Refresh</Text>
        </TouchableOpacity>

        <TouchableOpacity onPress={logout} style={{ marginTop: 16 }}>
          <Text style={{ color: "#2a4a4e", fontSize: 13 }}>Disconnect</Text>
        </TouchableOpacity>
      </ScrollView>
    </SafeAreaView>
  );
}

// ════════════════════════════════════════════════════════
//  CONTROLS TAB
// ════════════════════════════════════════════════════════
function ControlsScreen() {
  const { api } = useAuth();
  const [volume, setVolume] = useState(50);
  const [volumeLoaded, setVolumeLoaded] = useState(false);
  const [notifyText, setNotifyText] = useState("");
  const [sending, setSending] = useState(false);

  useEffect(() => {
    api("GET", "/volume")
      .then((d) => { setVolume(d.level); setVolumeLoaded(true); })
      .catch(() => {});
  }, [api]);

  const confirmAction = (title, action, endpoint) => {
    Alert.alert(title, "Are you sure?", [
      { text: "Cancel", style: "cancel" },
      {
        text: action,
        style: "destructive",
        onPress: async () => {
          try {
            await api("POST", endpoint);
          } catch {
            Alert.alert("Error", `Failed to ${action.toLowerCase()}`);
          }
        },
      },
    ]);
  };

  const commitVolume = async (val) => {
    const level = Math.round(val);
    try { await api("POST", "/volume", { level }); } catch {}
  };

  const sendNotify = async () => {
    if (!notifyText.trim()) return;
    setSending(true);
    try {
      await api("POST", "/notify", { message: notifyText });
      setNotifyText("");
      Alert.alert("Sent", "Notification delivered to PC");
    } catch {
      Alert.alert("Error", "Failed to send notification");
    }
    setSending(false);
  };

  return (
    <SafeAreaView style={st.screen}>
      <ScrollView contentContainerStyle={st.padded}>
        {/* Power */}
        <Text style={st.section}>Power</Text>
        <View style={{ flexDirection: "row", gap: 12, marginBottom: 24 }}>
          <TouchableOpacity
            style={[st.card, { flex: 1, alignItems: "center", paddingVertical: 24 }]}
            onPress={() => confirmAction("Shutdown PC", "Shutdown", "/shutdown")}
          >
            <Text style={{ fontSize: 28 }}>{"\u23FB"}</Text>
            <Text style={[st.cardTitle, { marginTop: 8 }]}>Shutdown</Text>
          </TouchableOpacity>
          <TouchableOpacity
            style={[st.card, { flex: 1, alignItems: "center", paddingVertical: 24 }]}
            onPress={() => confirmAction("Reboot PC", "Reboot", "/reboot")}
          >
            <Text style={{ fontSize: 28 }}>{"\uD83D\uDD04"}</Text>
            <Text style={[st.cardTitle, { marginTop: 8 }]}>Reboot</Text>
          </TouchableOpacity>
        </View>

        {/* Volume */}
        <Text style={st.section}>Volume</Text>
        <View style={st.card}>
          <View style={{ flexDirection: "row", justifyContent: "space-between" }}>
            <Text style={st.cardTitle}>{"\uD83D\uDD0A"} Volume</Text>
            <Text style={st.cardTitle}>{volume}%</Text>
          </View>
          {volumeLoaded && (
            <Slider
              minimumValue={0}
              maximumValue={100}
              step={1}
              value={volume}
              onValueChange={(v) => setVolume(Math.round(v))}
              onSlidingComplete={commitVolume}
              minimumTrackTintColor={TEAL}
              maximumTrackTintColor="#1a2a2e"
              thumbTintColor={TEAL}
              style={{ marginTop: 8 }}
            />
          )}
        </View>

        {/* Notification */}
        <Text style={[st.section, { marginTop: 24 }]}>Send Notification</Text>
        <View style={st.card}>
          <TextInput
            style={[st.input, { textAlign: "left", marginBottom: 12 }]}
            placeholder="Message to PC..."
            placeholderTextColor={TEAL_DIM}
            value={notifyText}
            onChangeText={setNotifyText}
          />
          <TouchableOpacity
            style={[st.tealBtn, !notifyText.trim() && { opacity: 0.4 }]}
            onPress={sendNotify}
            disabled={sending || !notifyText.trim()}
          >
            {sending
              ? <ActivityIndicator color="#000" />
              : <Text style={st.tealBtnText}>Send</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ════════════════════════════════════════════════════════
//  MONITOR TAB
// ════════════════════════════════════════════════════════
function StatBar({ label, value, pct }) {
  return (
    <View style={{ marginBottom: 12 }}>
      <View style={{ flexDirection: "row", justifyContent: "space-between", marginBottom: 4 }}>
        <Text style={{ color: "#5a8a90", fontSize: 13 }}>{label}</Text>
        <Text style={{ color: "#fff", fontSize: 13 }}>{value}</Text>
      </View>
      <View style={{ height: 6, backgroundColor: "#1a2a2e", borderRadius: 3 }}>
        <View
          style={{
            width: `${Math.min(pct, 100)}%`,
            height: 6,
            backgroundColor: pct > 80 ? LOCKED_COLOR : TEAL,
            borderRadius: 3,
          }}
        />
      </View>
    </View>
  );
}

function MonitorScreen() {
  const { api } = useAuth();
  const [stats, setStats] = useState(null);
  const [activeWin, setActiveWin] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [ssLoading, setSsLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  const fetchStats = useCallback(async () => {
    try {
      const [s, w] = await Promise.all([
        api("GET", "/stats"),
        api("GET", "/active-window"),
      ]);
      setStats(s);
      setActiveWin(w.title);
    } catch {}
  }, [api]);

  useEffect(() => {
    fetchStats();
    const iv = setInterval(fetchStats, 10000);
    return () => clearInterval(iv);
  }, [fetchStats]);

  const takeScreenshot = async () => {
    setSsLoading(true);
    try {
      const data = await api("GET", "/screenshot");
      setScreenshot(data.image);
    } catch {
      Alert.alert("Error", "Failed to take screenshot");
    }
    setSsLoading(false);
  };

  return (
    <SafeAreaView style={st.screen}>
      <ScrollView contentContainerStyle={st.padded}>
        {/* Stats */}
        <Text style={st.section}>System Stats</Text>
        {stats ? (
          <View style={st.card}>
            <StatBar label="CPU" value={`${stats.cpu_percent}%`} pct={stats.cpu_percent} />
            <StatBar label="RAM" value={`${stats.ram_used_gb} / ${stats.ram_total_gb} GB`} pct={stats.ram_percent} />
            <StatBar label="Disk" value={`${stats.disk_used_gb} / ${stats.disk_total_gb} GB`} pct={stats.disk_percent} />
          </View>
        ) : (
          <View style={st.card}>
            <ActivityIndicator color={TEAL} />
          </View>
        )}

        {/* Active Window */}
        <Text style={[st.section, { marginTop: 24 }]}>Active Window</Text>
        <View style={st.card}>
          <Text style={st.cardTitle}>{"\uD83E\uDEDF"} {activeWin || "\u2014"}</Text>
        </View>

        {/* Screenshot */}
        <Text style={[st.section, { marginTop: 24 }]}>Screenshot</Text>
        <TouchableOpacity
          style={st.card}
          onPress={screenshot ? () => setFullscreen(true) : takeScreenshot}
          activeOpacity={0.8}
        >
          {ssLoading ? (
            <ActivityIndicator color={TEAL} style={{ paddingVertical: 40 }} />
          ) : screenshot ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${screenshot}` }}
              style={{ width: "100%", height: 200, borderRadius: 8 }}
              resizeMode="contain"
            />
          ) : (
            <Text style={[st.cardTitle, { textAlign: "center", paddingVertical: 32 }]}>
              {"\uD83D\uDCF8"} Tap to capture
            </Text>
          )}
        </TouchableOpacity>
        {screenshot && (
          <TouchableOpacity onPress={takeScreenshot} style={{ marginTop: 8, alignSelf: "center" }}>
            <Text style={{ color: TEAL }}>{"\u21BB"}  Retake</Text>
          </TouchableOpacity>
        )}

        {/* Fullscreen modal */}
        <Modal visible={fullscreen} transparent animationType="fade">
          <TouchableOpacity
            style={{ flex: 1, backgroundColor: "rgba(0,0,0,0.95)", justifyContent: "center" }}
            onPress={() => setFullscreen(false)}
            activeOpacity={1}
          >
            {screenshot && (
              <Image
                source={{ uri: `data:image/jpeg;base64,${screenshot}` }}
                style={{ width: "100%", height: "80%" }}
                resizeMode="contain"
              />
            )}
          </TouchableOpacity>
        </Modal>
      </ScrollView>
    </SafeAreaView>
  );
}

// ════════════════════════════════════════════════════════
//  CLIPBOARD TAB
// ════════════════════════════════════════════════════════
function ClipboardScreen() {
  const { api } = useAuth();
  const [pcClipboard, setPcClipboard] = useState("");
  const [phoneText, setPhoneText] = useState("");
  const [fetching, setFetching] = useState(false);
  const [pushing, setPushing] = useState(false);

  const fetchClipboard = async () => {
    setFetching(true);
    try {
      const data = await api("GET", "/clipboard");
      setPcClipboard(data.text);
    } catch {
      Alert.alert("Error", "Failed to fetch clipboard");
    }
    setFetching(false);
  };

  const sendToPC = async () => {
    if (!phoneText.trim()) return;
    setPushing(true);
    try {
      await api("POST", "/clipboard", { text: phoneText });
      Alert.alert("Sent", "Clipboard set on PC");
    } catch {
      Alert.alert("Error", "Failed to set clipboard");
    }
    setPushing(false);
  };

  return (
    <SafeAreaView style={st.screen}>
      <ScrollView contentContainerStyle={st.padded}>
        {/* From PC */}
        <Text style={st.section}>PC Clipboard</Text>
        <View style={st.card}>
          <TouchableOpacity style={st.tealBtn} onPress={fetchClipboard} disabled={fetching}>
            {fetching
              ? <ActivityIndicator color="#000" />
              : <Text style={st.tealBtnText}>Fetch from PC</Text>}
          </TouchableOpacity>
          {pcClipboard !== "" && (
            <Text style={{ color: "#fff", marginTop: 12, fontSize: 14 }} selectable>
              {pcClipboard}
            </Text>
          )}
        </View>

        {/* To PC */}
        <Text style={[st.section, { marginTop: 24 }]}>Send to PC</Text>
        <View style={st.card}>
          <TextInput
            style={[st.input, { textAlign: "left", height: 100, textAlignVertical: "top", marginBottom: 12 }]}
            placeholder="Text to send to PC clipboard..."
            placeholderTextColor={TEAL_DIM}
            value={phoneText}
            onChangeText={setPhoneText}
            multiline
          />
          <TouchableOpacity
            style={[st.tealBtn, !phoneText.trim() && { opacity: 0.4 }]}
            onPress={sendToPC}
            disabled={pushing || !phoneText.trim()}
          >
            {pushing
              ? <ActivityIndicator color="#000" />
              : <Text style={st.tealBtnText}>Send to PC</Text>}
          </TouchableOpacity>
        </View>
      </ScrollView>
    </SafeAreaView>
  );
}

// ════════════════════════════════════════════════════════
//  LOG TAB
// ════════════════════════════════════════════════════════
const ACTION_COLORS = {
  lock: LOCKED_COLOR,
  unlock: UNLOCKED_COLOR,
  shutdown: "#FF9800",
  reboot: "#FF9800",
  volume: "#9C27B0",
  notify: "#4CAF50",
  screenshot: "#2196F3",
  clipboard: "#FFEB3B",
  intruder: "#F44336",
  phone_watch: TEAL_DARK,
};

function actionColor(action) {
  for (const [key, color] of Object.entries(ACTION_COLORS)) {
    if (action.includes(key)) return color;
  }
  return TEAL;
}

function LogScreen() {
  const { api } = useAuth();
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(true);

  const fetchLog = useCallback(async () => {
    try {
      const data = await api("GET", "/audit");
      setEntries([...data.entries].reverse());
    } catch {}
    setLoading(false);
  }, [api]);

  useEffect(() => {
    fetchLog();
    const iv = setInterval(fetchLog, 15000);
    return () => clearInterval(iv);
  }, [fetchLog]);

  return (
    <SafeAreaView style={st.screen}>
      <View style={st.padded}>
        <Text style={st.section}>Audit Log</Text>
      </View>
      {loading ? (
        <ActivityIndicator color={TEAL} style={{ marginTop: 40 }} />
      ) : (
        <ScrollView style={{ flex: 1 }} contentContainerStyle={{ paddingHorizontal: 20, paddingBottom: 20 }}>
          {entries.length === 0 && (
            <Text style={{ color: "#5a8a90", textAlign: "center", marginTop: 40 }}>
              No entries yet
            </Text>
          )}
          {entries.map((e, i) => {
            const color = actionColor(e.action);
            return (
              <View key={i} style={[st.card, { marginBottom: 8 }]}>
                <View style={{ flexDirection: "row", alignItems: "center", marginBottom: 4 }}>
                  <View style={{ width: 8, height: 8, borderRadius: 4, backgroundColor: color, marginRight: 8 }} />
                  <Text style={{ color, fontWeight: "700", fontSize: 13 }}>{e.action}</Text>
                </View>
                <Text style={{ color: "#5a8a90", fontSize: 11 }}>
                  {e.timestamp}  {"\u2022"}  {e.ip}
                </Text>
              </View>
            );
          })}
        </ScrollView>
      )}
    </SafeAreaView>
  );
}

// ════════════════════════════════════════════════════════
//  TAB ICONS
// ════════════════════════════════════════════════════════
const TAB_ICONS = {
  Home: "home",
  Controls: "settings-sharp",
  Monitor: "stats-chart",
  Clipboard: "clipboard",
  Log: "list",
};

// ════════════════════════════════════════════════════════
//  MAIN APP
// ════════════════════════════════════════════════════════
export default function App() {
  const [password, setPassword] = useState("");
  const [authenticated, setAuthenticated] = useState(false);
  const [loading, setLoading] = useState(false);

  const api = useCallback(async (method, endpoint, body = null) => {
    const headers = { "x-pin": password };
    if (body) headers["Content-Type"] = "application/json";
    const options = { method, headers };
    if (body) options.body = JSON.stringify(body);
    const res = await fetch(`${SERVER}${endpoint}`, options);
    if (res.status === 401) throw new Error("Invalid credentials");
    return res.json();
  }, [password]);

  const registerPush = useCallback(async () => {
    try {
      if (!Device.isDevice) return;
      const { status: existing } = await Notifications.getPermissionsAsync();
      let finalStatus = existing;
      if (existing !== "granted") {
        const { status } = await Notifications.requestPermissionsAsync();
        finalStatus = status;
      }
      if (finalStatus !== "granted") return;
      if (Platform.OS === "android") {
        await Notifications.setNotificationChannelAsync("default", {
          name: "default",
          importance: Notifications.AndroidImportance.MAX,
        });
      }
      const tokenData = await Notifications.getExpoPushTokenAsync();
      await api("POST", "/register-token", { token: tokenData.data });
    } catch (e) {
      console.log("Push registration skipped:", e.message);
    }
  }, [api]);

  const authenticate = async () => {
    if (password.length < 1) return;
    setLoading(true);
    try {
      await api("GET", "/status");
      setAuthenticated(true);
    } catch {
      Alert.alert("Access Denied", "Incorrect password or server unreachable");
    }
    setLoading(false);
  };

  useEffect(() => {
    if (authenticated) registerPush();
  }, [authenticated, registerPush]);

  const logout = useCallback(() => {
    setAuthenticated(false);
    setPassword("");
  }, []);

  // ── Login screen ──
  if (!authenticated) {
    return (
      <SafeAreaView style={st.screen}>
        <StatusBar barStyle="light-content" backgroundColor={BG} />
        <View style={st.centerContent}>
          <View style={{ marginBottom: 24 }}>
            <View style={st.logoRing}>
              <Text style={{ fontSize: 36 }}>{"\uD83D\uDDA5\uFE0F"}</Text>
            </View>
          </View>
          <Text style={st.title}>PC Control</Text>
          <Text style={st.subtitle}>Enter your PC password</Text>
          <TextInput
            style={st.input}
            secureTextEntry
            value={password}
            onChangeText={setPassword}
            placeholder="password"
            placeholderTextColor={TEAL_DIM}
            autoCapitalize="none"
            autoCorrect={false}
            onSubmitEditing={authenticate}
            returnKeyType="go"
          />
          <TouchableOpacity
            style={[st.authButton, password.length < 1 && { opacity: 0.4 }]}
            onPress={authenticate}
            disabled={loading || password.length < 1}
          >
            {loading
              ? <ActivityIndicator color="#000" />
              : <Text style={st.authText}>Connect</Text>}
          </TouchableOpacity>
        </View>
      </SafeAreaView>
    );
  }

  // ── Tabbed app ──
  return (
    <AuthCtx.Provider value={{ api, password, logout }}>
      <StatusBar barStyle="light-content" backgroundColor={BG} />
      <NavigationContainer>
        <Tab.Navigator
          screenOptions={({ route }) => ({
            headerShown: false,
            tabBarStyle: {
              backgroundColor: CARD,
              borderTopColor: TEAL_DIM,
              borderTopWidth: 1,
              paddingBottom: Platform.OS === "ios" ? 20 : 6,
              paddingTop: 6,
              height: Platform.OS === "ios" ? 80 : 60,
            },
            tabBarActiveTintColor: TEAL,
            tabBarInactiveTintColor: "#5a8a90",
            tabBarIcon: ({ color, size }) => (
              <Ionicons name={TAB_ICONS[route.name]} size={size} color={color} />
            ),
          })}
        >
          <Tab.Screen name="Home" component={HomeScreen} />
          <Tab.Screen name="Controls" component={ControlsScreen} />
          <Tab.Screen name="Monitor" component={MonitorScreen} />
          <Tab.Screen name="Clipboard" component={ClipboardScreen} />
          <Tab.Screen name="Log" component={LogScreen} />
        </Tab.Navigator>
      </NavigationContainer>
    </AuthCtx.Provider>
  );
}

// ════════════════════════════════════════════════════════
//  STYLES
// ════════════════════════════════════════════════════════
const st = StyleSheet.create({
  screen: {
    flex: 1,
    backgroundColor: BG,
  },
  centerContent: {
    flex: 1,
    alignItems: "center",
    justifyContent: "center",
    paddingHorizontal: 24,
  },
  padded: {
    padding: 20,
    paddingTop: 40,
  },
  logoRing: {
    width: 90, height: 90, borderRadius: 45,
    borderWidth: 2, borderColor: TEAL,
    alignItems: "center", justifyContent: "center",
    backgroundColor: CARD,
  },
  title: {
    fontSize: 28, fontWeight: "800",
    color: "#fff", letterSpacing: 1, marginBottom: 6,
  },
  subtitle: { fontSize: 14, color: "#5a8a90", marginBottom: 36 },
  input: {
    backgroundColor: CARD, color: "#fff",
    fontSize: 16, padding: 14, borderRadius: 14,
    width: 260, textAlign: "center",
    marginBottom: 24, borderWidth: 1, borderColor: TEAL_DIM,
  },
  authButton: {
    backgroundColor: TEAL, paddingHorizontal: 56,
    paddingVertical: 16, borderRadius: 14,
  },
  authText: { color: "#000", fontSize: 16, fontWeight: "700" },
  statusRow: {
    flexDirection: "row", alignItems: "center", marginBottom: 36,
  },
  dot: { width: 10, height: 10, borderRadius: 5, marginRight: 8 },
  statusText: { fontSize: 16, fontWeight: "600" },
  lockButton: {
    width: 200, height: 200, borderRadius: 100,
    alignItems: "center", justifyContent: "center",
    marginBottom: 40, borderWidth: 2,
  },
  lockIcon: { fontSize: 48, marginBottom: 8 },
  lockLabel: { fontSize: 16, fontWeight: "700" },
  card: {
    backgroundColor: CARD, borderRadius: 16,
    padding: 16, width: "100%",
    borderWidth: 1, borderColor: TEAL_DIM,
    marginBottom: 12,
  },
  cardRow: {
    flexDirection: "row", alignItems: "center", justifyContent: "space-between",
  },
  cardTitle: { color: "#fff", fontSize: 15, fontWeight: "700", marginBottom: 4 },
  cardSub: { color: "#5a8a90", fontSize: 12, maxWidth: 200 },
  section: {
    color: TEAL_DARK, fontSize: 13, fontWeight: "700",
    textTransform: "uppercase", letterSpacing: 1,
    marginBottom: 12,
  },
  tealBtn: {
    backgroundColor: TEAL, paddingVertical: 12,
    borderRadius: 10, alignItems: "center",
  },
  tealBtnText: { color: "#000", fontSize: 15, fontWeight: "700" },
});
