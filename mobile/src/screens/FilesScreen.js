import { useState, useCallback, useEffect } from "react";
import {
  View, Text, Pressable, Alert, ActivityIndicator,
  TextInput, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as FileSystem from "expo-file-system";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import { useAuth } from "../context/AuthContext";
import { ScreenShell } from "../components/ScreenShell";
import { Card } from "../components/Card";
import { PrimaryButton } from "../components/Button";
import { SectionHeader } from "../components/SectionHeader";
import { CopyBadge } from "../components/CopyBadge";
import { colors, spacing, font, radius, mono } from "../theme";

const FILE_ICONS = {
  dir: "folder",
  image: "image",
  video: "videocam",
  audio: "musical-notes",
  archive: "archive",
  code: "code-slash",
  doc: "document-text",
  default: "document",
};

function getFileIcon(name, isDir) {
  if (isDir) return FILE_ICONS.dir;
  const ext = name.split(".").pop().toLowerCase();
  if (["jpg", "jpeg", "png", "gif", "bmp", "svg", "webp"].includes(ext)) return FILE_ICONS.image;
  if (["mp4", "mkv", "avi", "mov", "webm"].includes(ext)) return FILE_ICONS.video;
  if (["mp3", "wav", "flac", "ogg", "aac", "m4a"].includes(ext)) return FILE_ICONS.audio;
  if (["zip", "tar", "gz", "rar", "7z", "bz2", "xz"].includes(ext)) return FILE_ICONS.archive;
  if (["js", "ts", "py", "java", "c", "cpp", "rs", "go", "rb", "sh", "json", "html", "css", "yml", "yaml", "toml"].includes(ext)) return FILE_ICONS.code;
  if (["pdf", "doc", "docx", "txt", "md", "csv", "xls", "xlsx"].includes(ext)) return FILE_ICONS.doc;
  return FILE_ICONS.default;
}

function formatSize(bytes) {
  if (bytes === 0) return "";
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1048576) return `${(bytes / 1024).toFixed(1)} KB`;
  if (bytes < 1073741824) return `${(bytes / 1048576).toFixed(1)} MB`;
  return `${(bytes / 1073741824).toFixed(1)} GB`;
}

function IconBtn({ icon, label, onPress, color = colors.textMuted }) {
  return (
    <Pressable
      onPress={onPress}
      style={({ pressed }) => [styles.iconBtn, pressed && { opacity: 0.6 }]}
    >
      <Ionicons name={icon} size={14} color={color} />
      <Text style={[styles.iconBtnText, { color }]}>{label}</Text>
    </Pressable>
  );
}

export function FilesScreen() {
  const { api, password } = useAuth();
  const navigation = useNavigation();

  // Tab state: "browse" or "clipboard"
  const [tab, setTab] = useState("browse");

  // File browser state
  const [path, setPath] = useState(null);
  const [parentPath, setParentPath] = useState(null);
  const [entries, setEntries] = useState([]);
  const [loading, setLoading] = useState(false);
  const [showHidden, setShowHidden] = useState(false);
  const [downloading, setDownloading] = useState(null);

  // Clipboard state
  const [pcClipboard, setPcClipboard] = useState("");
  const [phoneText, setPhoneText] = useState("");
  const [fetching, setFetching] = useState(false);
  const [pushing, setPushing] = useState(false);

  const SERVER = process.env.EXPO_PUBLIC_SERVER || "http://localhost:2000";

  const fetchFiles = useCallback(async (dirPath = null) => {
    setLoading(true);
    try {
      const endpoint = dirPath ? `/files?path=${encodeURIComponent(dirPath)}` : "/files";
      const data = await api("GET", endpoint);
      setPath(data.path);
      setParentPath(data.parent);
      setEntries(data.entries || []);
    } catch {
      Alert.alert("Error", "Failed to load directory");
    }
    setLoading(false);
  }, [api]);

  // Load files on first mount
  const [loaded, setLoaded] = useState(false);
  useEffect(() => {
    if (!loaded) {
      setLoaded(true);
      fetchFiles();
    }
  }, [loaded, fetchFiles]);

  const navigateTo = (dirPath) => fetchFiles(dirPath);

  const goUp = () => {
    if (parentPath) fetchFiles(parentPath);
  };

  const downloadFile = async (filePath, fileName) => {
    setDownloading(filePath);
    try {
      const url = `${SERVER}/files/download?path=${encodeURIComponent(filePath)}`;
      const localPath = FileSystem.cacheDirectory + fileName;
      const result = await FileSystem.downloadAsync(url, localPath, {
        headers: { "x-pin": password },
      });
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri);
      } else {
        Alert.alert("Downloaded", `Saved to ${result.uri}`);
      }
    } catch {
      Alert.alert("Error", "Download failed");
    }
    setDownloading(null);
  };

  const deleteItem = (itemPath, name) => {
    Alert.alert("Delete", `Delete "${name}"?`, [
      { text: "Cancel", style: "cancel" },
      {
        text: "Delete",
        style: "destructive",
        onPress: async () => {
          try {
            await api("POST", "/files/delete", { path: itemPath });
            fetchFiles(path);
          } catch {
            Alert.alert("Error", "Delete failed");
          }
        },
      },
    ]);
  };

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

  const pasteFromPhone = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setPhoneText(text);
  };

  const visibleEntries = showHidden ? entries : entries.filter((e) => !e.hidden);
  const currentDir = path ? path.replace(/^\/home\/[^/]+/, "~") : "~";

  return (
    <ScreenShell>
      {/* Tab switcher */}
      <View style={styles.tabRow}>
        <Pressable
          onPress={() => setTab("browse")}
          style={[styles.tabBtn, tab === "browse" && styles.tabActive]}
        >
          <Ionicons name="folder-outline" size={14} color={tab === "browse" ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === "browse" && styles.tabTextActive]}>BROWSE</Text>
        </Pressable>
        <Pressable
          onPress={() => setTab("clipboard")}
          style={[styles.tabBtn, tab === "clipboard" && styles.tabActive]}
        >
          <Ionicons name="clipboard-outline" size={14} color={tab === "clipboard" ? colors.primary : colors.textMuted} />
          <Text style={[styles.tabText, tab === "clipboard" && styles.tabTextActive]}>CLIPBOARD</Text>
        </Pressable>
      </View>

      {tab === "browse" ? (
        <>
          {/* Path breadcrumb */}
          <Card style={styles.breadcrumb}>
            <View style={styles.breadcrumbRow}>
              <Ionicons name="folder-open-outline" size={14} color={colors.primary} />
              <Text style={styles.breadcrumbText} numberOfLines={1}>{currentDir}</Text>
              <Pressable onPress={() => setShowHidden(!showHidden)} style={styles.hiddenToggle}>
                <Ionicons name={showHidden ? "eye" : "eye-off"} size={14} color={colors.textMuted} />
              </Pressable>
            </View>
          </Card>

          {/* Go up */}
          {parentPath && (
            <Pressable onPress={goUp} style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.7 }]}>
              <View style={styles.fileInfo}>
                <Ionicons name="arrow-up-outline" size={20} color={colors.primary} />
                <Text style={styles.fileName}>. .</Text>
              </View>
            </Pressable>
          )}

          {/* File list */}
          {loading ? (
            <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
          ) : (
            visibleEntries.map((entry) => (
              <Pressable
                key={entry.path}
                onPress={() => entry.is_dir ? navigateTo(entry.path) : null}
                onLongPress={() => {
                  if (entry.is_dir) {
                    Alert.alert(entry.name, "Directory options", [
                      { text: "Delete", style: "destructive", onPress: () => deleteItem(entry.path, entry.name) },
                      { text: "Copy Path", onPress: () => Clipboard.setStringAsync(entry.path) },
                      { text: "Cancel", style: "cancel" },
                    ]);
                  } else {
                    Alert.alert(entry.name, `${formatSize(entry.size)} \u2022 ${entry.modified}`, [
                      { text: "Download", onPress: () => downloadFile(entry.path, entry.name) },
                      { text: "Delete", style: "destructive", onPress: () => deleteItem(entry.path, entry.name) },
                      { text: "Copy Path", onPress: () => Clipboard.setStringAsync(entry.path) },
                      { text: "Cancel", style: "cancel" },
                    ]);
                  }
                }}
                delayLongPress={300}
                style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.7 }]}
              >
                <View style={styles.fileInfo}>
                  <Ionicons
                    name={getFileIcon(entry.name, entry.is_dir)}
                    size={20}
                    color={entry.is_dir ? colors.primary : colors.textMuted}
                  />
                  <View style={{ flex: 1 }}>
                    <Text style={[styles.fileName, entry.hidden && { opacity: 0.5 }]} numberOfLines={1}>
                      {entry.name}
                    </Text>
                    {!entry.is_dir && (
                      <Text style={styles.fileMeta}>
                        {formatSize(entry.size)}  {"\u2022"}  {entry.modified}
                      </Text>
                    )}
                  </View>
                  {downloading === entry.path ? (
                    <ActivityIndicator color={colors.primary} size="small" />
                  ) : !entry.is_dir ? (
                    <Pressable onPress={() => downloadFile(entry.path, entry.name)} hitSlop={8}>
                      <Ionicons name="download-outline" size={18} color={colors.textMuted} />
                    </Pressable>
                  ) : (
                    <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
                  )}
                </View>
              </Pressable>
            ))
          )}

          {!loading && visibleEntries.length === 0 && (
            <Text style={styles.empty}>// empty directory</Text>
          )}

          {/* Terminal link */}
          <Pressable
            onPress={() => navigation.navigate("Terminal")}
            style={({ pressed }) => [styles.navLink, pressed && { opacity: 0.6 }]}
          >
            <Ionicons name="terminal-outline" size={14} color={colors.primary} />
            <Text style={styles.navLinkText}>OPEN TERMINAL</Text>
            <Ionicons name="chevron-forward" size={14} color={colors.primaryDim} />
          </Pressable>
        </>
      ) : (
        /* ── Clipboard tab ── */
        <>
          <SectionHeader>CLIP.RECV</SectionHeader>
          <Card>
            <PrimaryButton title="FETCH FROM PC" onPress={fetchClipboard} loading={fetching} />
            {pcClipboard !== "" && (
              <>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultLabel}>// received</Text>
                  <CopyBadge text={pcClipboard} />
                </View>
                <Text style={styles.clipboardText} selectable>{pcClipboard}</Text>
              </>
            )}
          </Card>

          <SectionHeader style={{ marginTop: spacing.xxl }}>CLIP.SEND</SectionHeader>
          <Card>
            <View style={styles.inputHeader}>
              <IconBtn icon="clipboard-outline" label="PASTE" onPress={pasteFromPhone} color={colors.primary} />
              {phoneText.length > 0 && (
                <IconBtn icon="close-circle-outline" label="CLEAR" onPress={() => setPhoneText("")} />
              )}
            </View>
            <TextInput
              style={styles.input}
              placeholder=">> paste or type here..."
              placeholderTextColor={colors.primaryDim}
              selectionColor={colors.primary}
              cursorColor={colors.primary}
              value={phoneText}
              onChangeText={setPhoneText}
              multiline
            />
            <PrimaryButton
              title="PUSH TO PC"
              onPress={sendToPC}
              loading={pushing}
              disabled={!phoneText.trim()}
            />
          </Card>
        </>
      )}
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  tabRow: {
    flexDirection: "row",
    gap: spacing.sm,
    marginBottom: spacing.lg,
  },
  tabBtn: {
    flex: 1,
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.xs,
    paddingVertical: spacing.md,
    borderRadius: radius.md,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
  },
  tabActive: {
    borderColor: colors.primary,
    backgroundColor: colors.primaryGhost,
  },
  tabText: {
    color: colors.textMuted,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 1,
  },
  tabTextActive: {
    color: colors.primary,
  },
  breadcrumb: {
    paddingVertical: spacing.sm,
    paddingHorizontal: spacing.md,
    marginBottom: spacing.sm,
  },
  breadcrumbRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  breadcrumbText: {
    flex: 1,
    color: colors.primary,
    fontSize: font.xs,
    fontFamily: mono,
  },
  hiddenToggle: {
    padding: 4,
  },
  fileRow: {
    backgroundColor: colors.surface,
    borderRadius: radius.md,
    padding: spacing.md,
    marginBottom: 4,
    borderWidth: 1,
    borderColor: colors.border,
  },
  fileInfo: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
  },
  fileName: {
    color: colors.text,
    fontSize: font.sm,
    fontFamily: mono,
    fontWeight: "600",
  },
  fileMeta: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: 2,
  },
  empty: {
    color: colors.textDim,
    fontFamily: mono,
    textAlign: "center",
    marginTop: 40,
  },
  navLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.xxl,
    backgroundColor: colors.surface,
    borderRadius: 12,
    borderWidth: 1,
    borderColor: colors.border,
  },
  navLinkText: {
    flex: 1,
    color: colors.primary,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  // Clipboard styles
  resultHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginTop: spacing.md,
    marginBottom: spacing.sm,
  },
  resultLabel: {
    color: colors.textDim,
    fontSize: font.xs,
    fontFamily: mono,
  },
  clipboardText: {
    color: colors.primary,
    fontSize: font.sm,
    fontFamily: mono,
    backgroundColor: colors.surfaceHi,
    padding: spacing.md,
    borderRadius: 8,
    overflow: "hidden",
  },
  inputHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  iconBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingVertical: 4,
    paddingHorizontal: 6,
  },
  iconBtnText: {
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
  },
  input: {
    backgroundColor: colors.bg,
    color: colors.text,
    fontSize: font.lg,
    fontFamily: mono,
    padding: 14,
    borderRadius: radius.md,
    textAlign: "left",
    height: 100,
    textAlignVertical: "top",
    marginBottom: spacing.md,
    borderWidth: 1,
    borderColor: colors.border,
  },
});
