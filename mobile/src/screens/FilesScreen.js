import { useState, useCallback, useEffect, memo } from "react";
import {
  View, Text, Pressable, Alert, ActivityIndicator, Image,
  FlatList, RefreshControl, ScrollView, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import * as FileSystem from "expo-file-system/legacy";
import * as Sharing from "expo-sharing";
import * as Clipboard from "expo-clipboard";
import * as DocumentPicker from "expo-document-picker";
import { useAuth } from "../context/AuthContext";
import { useError } from "../context/ErrorContext";
import { ScreenShell } from "../components/ScreenShell";
import { ActionSheet } from "../components/ActionSheet";
import { Card } from "../components/Card";
import { PrimaryButton } from "../components/Button";
import { SectionHeader } from "../components/SectionHeader";
import { EmptyState } from "../components/EmptyState";
import { NavLink } from "../components/NavLink";
import { Input } from "../components/Input";
import { CopyBadge } from "../components/CopyBadge";
import { formatBytes } from "../format";
import {
  splitDataUri, base64Bytes, imageFileName, describeImage, isSupportedImage, imageExtension,
} from "../images";
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

const formatSize = (bytes) => formatBytes(bytes);

const ROW_HEIGHT = 60;

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

// One directory entry. Memoized because a large folder re-renders the whole
// list on every poll otherwise.
const FileRow = memo(function FileRow({ entry, downloading, progress, onOpen, onMenu, onDownload }) {
  const busy = downloading === entry.path;
  return (
    <Pressable
      onPress={() => (entry.is_dir ? onOpen(entry.path) : onMenu(entry))}
      onLongPress={() => onMenu(entry)}
      accessibilityRole="button"
      accessibilityLabel={entry.is_dir ? `Open folder ${entry.name}` : entry.name}
      accessibilityHint="Long press for options"
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
        {busy ? (
          <View style={styles.progressWrap}>
            <ActivityIndicator color={colors.primary} size="small" />
            {progress > 0 ? (
              <Text style={styles.progressText}>{Math.round(progress * 100)}%</Text>
            ) : null}
          </View>
        ) : !entry.is_dir ? (
          <Pressable
            onPress={() => onDownload(entry.path, entry.name)}
            hitSlop={12}
            accessibilityRole="button"
            accessibilityLabel={`Download ${entry.name}`}
          >
            <Ionicons name="download-outline" size={18} color={colors.textMuted} />
          </Pressable>
        ) : (
          <Ionicons name="chevron-forward" size={16} color={colors.textDim} />
        )}
      </View>
    </Pressable>
  );
});

export function FilesScreen() {
  const { api, server: SERVER, authHeader } = useAuth();
  const { showError } = useError();
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
  const [menuEntry, setMenuEntry] = useState(null);
  const [progress, setProgress] = useState(0);
  const [uploading, setUploading] = useState(false);

  // Clipboard state
  const [pcClipboard, setPcClipboard] = useState("");
  const [phoneText, setPhoneText] = useState("");
  const [fetching, setFetching] = useState(false);
  const [pushing, setPushing] = useState(false);

  // An image staged on the phone, from the clipboard or the picker, waiting to
  // be pushed. { uri, name, mime, width, height, size } — uri is always a local
  // file:// path, so the same object works for either destination.
  const [image, setImage] = useState(null);
  const [sendingImage, setSendingImage] = useState(null);

  const fetchFiles = useCallback(async (dirPath = null) => {
    setLoading(true);
    try {
      const endpoint = dirPath ? `/files?path=${encodeURIComponent(dirPath)}` : "/files";
      const data = await api("GET", endpoint);
      setPath(data.path);
      setParentPath(data.parent);
      setEntries(data.entries || []);
    } catch (e) {
      showError("DIRECTORY LOAD FAILED", e);
    }
    setLoading(false);
  }, [api, showError]);

  useEffect(() => { fetchFiles(); }, [fetchFiles]);

  const navigateTo = (dirPath) => fetchFiles(dirPath);

  const goUp = () => {
    if (parentPath) fetchFiles(parentPath);
  };

  const downloadFile = async (filePath, fileName) => {
    setDownloading(filePath);
    setProgress(0);
    try {
      const url = `${SERVER}/files/download?path=${encodeURIComponent(filePath)}`;
      // The name goes into a file:// URI, so "#" or "%" in it must be encoded
      // or the path silently truncates.
      const localPath = FileSystem.cacheDirectory + encodeURIComponent(fileName);
      const task = FileSystem.createDownloadResumable(
        url,
        localPath,
        { headers: authHeader("/files/download") },
        ({ totalBytesWritten, totalBytesExpectedToWrite }) => {
          if (totalBytesExpectedToWrite > 0) {
            setProgress(totalBytesWritten / totalBytesExpectedToWrite);
          }
        },
      );
      const result = await task.downloadAsync();
      if (await Sharing.isAvailableAsync()) {
        await Sharing.shareAsync(result.uri);
      } else {
        Alert.alert("Downloaded", `Saved to ${result.uri}`);
      }
    } catch (e) {
      showError("DOWNLOAD FAILED", e);
    }
    setDownloading(null);
    setProgress(0);
  };

  const deleteItem = (itemPath, name, { permanent = false } = {}) => {
    const verb = permanent ? "Delete permanently" : "Move to Trash";
    const body = permanent
      ? `"${name}" will be deleted for good. This cannot be undone.`
      : `"${name}" will be moved to the PC's Trash.`;
    Alert.alert(verb, body, [
      { text: "Cancel", style: "cancel" },
      {
        text: verb,
        style: "destructive",
        onPress: async () => {
          try {
            await api("POST", "/files/delete", { path: itemPath, permanent });
            fetchFiles(path);
          } catch (e) {
            showError(permanent ? "DELETE FAILED" : "TRASH FAILED", e);
          }
        },
      },
    ], { cancelable: true });
  };

  // Send a file from the phone into the folder currently open on the PC.
  const uploadFile = async () => {
    const picked = await DocumentPicker.getDocumentAsync({ copyToCacheDirectory: true });
    if (picked.canceled) return;
    const asset = picked.assets?.[0];
    if (!asset) return;

    setUploading(true);
    setProgress(0);
    try {
      const form = new FormData();
      form.append("path", path || "");
      form.append("file", {
        uri: asset.uri,
        name: asset.name || "upload",
        type: asset.mimeType || "application/octet-stream",
      });
      // FormData needs the raw fetch: api() sets a JSON content type and would
      // strip the multipart boundary.
      const res = await fetch(`${SERVER}/files/upload`, {
        method: "POST",
        // Uploads accept a session token, so keep the password off the wire here.
        headers: authHeader("/files/upload"),
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} — ${text}`);
      }
      const body = await res.json();
      fetchFiles(path);
      Alert.alert("Uploaded", `Saved as ${body.name} on the PC`);
    } catch (e) {
      showError("UPLOAD FAILED", e);
    }
    setUploading(false);
    setProgress(0);
  };

  const menuActions = (entry) => {
    if (!entry) return [];
    const actions = [];
    if (!entry.is_dir) {
      actions.push({ label: "Download", icon: "download-outline", onPress: () => downloadFile(entry.path, entry.name) });
    }
    actions.push({ label: "Copy path", icon: "copy-outline", onPress: () => Clipboard.setStringAsync(entry.path) });
    actions.push({ label: "Move to Trash", icon: "trash-outline", destructive: true, onPress: () => deleteItem(entry.path, entry.name) });
    actions.push({ label: "Delete permanently", icon: "flame-outline", destructive: true, onPress: () => deleteItem(entry.path, entry.name, { permanent: true }) });
    return actions;
  };

  const fetchClipboard = async () => {
    setFetching(true);
    try {
      const data = await api("GET", "/clipboard");
      setPcClipboard(data.text);
    } catch (e) {
      showError("CLIPBOARD FETCH FAILED", e);
    }
    setFetching(false);
  };

  const sendToPC = async () => {
    if (!phoneText.trim()) return;
    setPushing(true);
    try {
      await api("POST", "/clipboard", { text: phoneText });
      Alert.alert("Sent", "Clipboard set on PC");
    } catch (e) {
      showError("CLIPBOARD PUSH FAILED", e);
    }
    setPushing(false);
  };

  const pasteFromPhone = async () => {
    const text = await Clipboard.getStringAsync();
    if (text) setPhoneText(text);
  };

  // ── Images ─────────────────────────────────────────────
  // Both sources end up as a local file, because a multipart upload needs a
  // uri and the clipboard hands over base64 instead.

  const stageClipboardImage = async () => {
    try {
      if (!(await Clipboard.hasImageAsync())) {
        Alert.alert("No image", "There is no image on this phone's clipboard.");
        return;
      }
      // png keeps screenshots lossless; the server accepts either.
      const shot = await Clipboard.getImageAsync({ format: "png" });
      const parts = shot && splitDataUri(shot.data);
      if (!parts) {
        Alert.alert("No image", "The clipboard image could not be read.");
        return;
      }
      const name = imageFileName(parts.mime);
      const uri = FileSystem.cacheDirectory + name;
      await FileSystem.writeAsStringAsync(uri, parts.base64, { encoding: "base64" });
      setImage({
        uri,
        name,
        mime: parts.mime,
        width: shot.size?.width,
        height: shot.size?.height,
        size: base64Bytes(parts.base64),
      });
    } catch (e) {
      showError("CLIPBOARD IMAGE FAILED", e);
    }
  };

  const pickImage = async () => {
    try {
      const picked = await DocumentPicker.getDocumentAsync({
        type: "image/*",
        copyToCacheDirectory: true,
      });
      if (picked.canceled) return;
      const asset = picked.assets?.[0];
      if (!asset) return;
      // A picker can still hand back something the PC clipboard cannot take,
      // so check here rather than after uploading it.
      if (!isSupportedImage(asset.mimeType)) {
        Alert.alert("Unsupported image", `${asset.mimeType || "That file"} is not an image the PC can paste.`);
        return;
      }
      setImage({
        uri: asset.uri,
        name: asset.name || imageFileName(asset.mimeType),
        mime: asset.mimeType,
        width: undefined,
        height: undefined,
        size: asset.size,
      });
    } catch (e) {
      showError("IMAGE PICK FAILED", e);
    }
  };

  // endpoint is "/clipboard/image" (paste on the PC) or "/files/upload" (keep
  // it on disk). Multipart needs the raw fetch: api() would set a JSON content
  // type and strip the boundary.
  const pushImage = async (endpoint) => {
    if (!image) return;
    setSendingImage(endpoint);
    try {
      const form = new FormData();
      // An image saved from here goes to Downloads, not to whatever folder the
      // browse tab happens to have open. Asking by name rather than by path
      // because only the PC knows where Downloads actually is.
      if (endpoint === "/files/upload") form.append("dest", "downloads");
      form.append("file", {
        uri: image.uri,
        name: image.name,
        type: image.mime || `image/${imageExtension(image.mime) || "png"}`,
      });
      const res = await fetch(`${SERVER}${endpoint}`, {
        method: "POST",
        headers: authHeader(endpoint),
        body: form,
      });
      if (!res.ok) {
        const text = await res.text();
        throw new Error(`${res.status} — ${text}`);
      }
      const body = await res.json();
      if (endpoint === "/files/upload") {
        // It landed in Downloads, so only refresh if that is what is on screen.
        if (body.path && path && body.path.startsWith(path)) fetchFiles(path);
        Alert.alert("Saved", `Saved to Downloads as ${body.name}`);
      } else {
        Alert.alert("On the clipboard", "Paste it anywhere on the PC.");
      }
      setImage(null);
    } catch (e) {
      showError(endpoint === "/files/upload" ? "IMAGE SAVE FAILED" : "IMAGE PUSH FAILED", e);
    }
    setSendingImage(null);
  };

  const visibleEntries = showHidden ? entries : entries.filter((e) => !e.hidden);
  const currentDir = path ? path.replace(/^\/home\/[^/]+/, "~") : "~";

  return (
    <ScreenShell scroll={false}>
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
        <FlatList
          data={loading ? [] : visibleEntries}
          // A home folder can hold thousands of entries; mapping them all into
          // a ScrollView mounted every row at once.
          renderItem={({ item }) => (
            <FileRow
              entry={item}
              downloading={downloading}
              progress={progress}
              onOpen={navigateTo}
              onMenu={setMenuEntry}
              onDownload={downloadFile}
            />
          )}
          keyExtractor={(item) => item.path}
          getItemLayout={(_, index) => ({ length: ROW_HEIGHT, offset: ROW_HEIGHT * index, index })}
          contentContainerStyle={styles.list}
          keyboardShouldPersistTaps="handled"
          refreshControl={
            <RefreshControl
              refreshing={loading}
              onRefresh={() => fetchFiles(path)}
              tintColor={colors.primary}
              colors={[colors.primary]}
              progressBackgroundColor={colors.surface}
            />
          }
          ListHeaderComponent={
            <>
              {/* Path breadcrumb */}
              <Card style={styles.breadcrumb}>
                <View style={styles.breadcrumbRow}>
                  <Ionicons name="folder-open-outline" size={14} color={colors.primary} />
                  <Text style={styles.breadcrumbText} numberOfLines={1}>{currentDir}</Text>
                  <Pressable
                    onPress={() => setShowHidden(!showHidden)}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel={showHidden ? "Hide hidden files" : "Show hidden files"}
                    style={styles.hiddenToggle}
                  >
                    <Ionicons name={showHidden ? "eye" : "eye-off"} size={14} color={colors.textMuted} />
                  </Pressable>
                  <Pressable
                    onPress={uploadFile}
                    disabled={uploading}
                    hitSlop={12}
                    accessibilityRole="button"
                    accessibilityLabel="Send a file from this device to the PC"
                    style={styles.hiddenToggle}
                  >
                    {uploading
                      ? <ActivityIndicator color={colors.primary} size="small" />
                      : <Ionicons name="cloud-upload-outline" size={16} color={colors.primary} />}
                  </Pressable>
                </View>
              </Card>

              {/* Go up */}
              {parentPath && (
                <Pressable
                  onPress={goUp}
                  accessibilityRole="button"
                  accessibilityLabel="Go to parent folder"
                  style={({ pressed }) => [styles.fileRow, pressed && { opacity: 0.7 }]}
                >
                  <View style={styles.fileInfo}>
                    <Ionicons name="arrow-up-outline" size={20} color={colors.primary} />
                    <Text style={styles.fileName}>. .</Text>
                  </View>
                </Pressable>
              )}
            </>
          }
          ListEmptyComponent={
            loading ? (
              <ActivityIndicator color={colors.primary} style={{ marginTop: 40 }} />
            ) : (
              <EmptyState icon="folder-open-outline" title="EMPTY DIRECTORY" message="Nothing here to show." />
            )
          }
          ListFooterComponent={
            <NavLink
              icon="terminal-outline"
              label="OPEN TERMINAL"
              onPress={() => navigation.navigate("Terminal")}
              style={styles.footerLink}
            />
          }
        />
      ) : (
        /* ── Clipboard tab ── */
        <ScrollView contentContainerStyle={styles.list} keyboardShouldPersistTaps="handled">

          <SectionHeader>CLIP.RECV</SectionHeader>
          <Card>
            <PrimaryButton title="FETCH FROM PC" onPress={fetchClipboard} loading={fetching} />
            {pcClipboard !== "" && (
              <>
                <View style={styles.resultHeader}>
                  <Text style={styles.resultLabel}>{"// received"}</Text>
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
            <Input
              style={styles.input}
              placeholder=">> paste or type here..."
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

          <SectionHeader style={{ marginTop: spacing.xxl }}>CLIP.IMG</SectionHeader>
          <Card>
            <View style={styles.inputHeader}>
              <IconBtn
                icon="clipboard-outline"
                label="PASTE IMAGE"
                onPress={stageClipboardImage}
                color={colors.primary}
              />
              <IconBtn icon="images-outline" label="PICK" onPress={pickImage} color={colors.primary} />
              {image && (
                <IconBtn icon="close-circle-outline" label="CLEAR" onPress={() => setImage(null)} />
              )}
            </View>
            {image ? (
              <>
                <View style={styles.imageRow}>
                  <Image source={{ uri: image.uri }} style={styles.imageThumb} resizeMode="cover" />
                  <View style={styles.imageMeta}>
                    <Text style={styles.imageName} numberOfLines={2}>{image.name}</Text>
                    <Text style={styles.imageDims}>{describeImage(image) || "// ready"}</Text>
                  </View>
                </View>
                <PrimaryButton
                  title="PUSH TO PC CLIPBOARD"
                  onPress={() => pushImage("/clipboard/image")}
                  loading={sendingImage === "/clipboard/image"}
                  disabled={sendingImage !== null}
                />
                <PrimaryButton
                  title="SAVE TO DOWNLOADS"
                  variant="outline"
                  onPress={() => pushImage("/files/upload")}
                  loading={sendingImage === "/files/upload"}
                  disabled={sendingImage !== null}
                  style={{ marginTop: spacing.sm }}
                />
              </>
            ) : (
              <Text style={styles.imageHint}>
                {"// paste a screenshot or pick an image, then push it to the PC's clipboard or save it to disk"}
              </Text>
            )}
          </Card>
        </ScrollView>
      )}
      <ActionSheet
        visible={menuEntry !== null}
        title={menuEntry?.name}
        subtitle={menuEntry && !menuEntry.is_dir ? `${formatSize(menuEntry.size)} \u2022 ${menuEntry.modified}` : menuEntry ? "Folder" : null}
        actions={menuActions(menuEntry)}
        onClose={() => setMenuEntry(null)}
      />
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
  list: { paddingBottom: spacing.xl },
  footerLink: { marginTop: spacing.lg },
  progressWrap: { flexDirection: "row", alignItems: "center", gap: spacing.sm },
  progressText: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    fontVariant: ["tabular-nums"],
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
  // Staged-image styles
  imageRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    marginTop: spacing.md,
    marginBottom: spacing.lg,
  },
  imageThumb: {
    width: 64,
    height: 64,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.border,
    backgroundColor: colors.bg,
  },
  imageMeta: {
    flex: 1,
    gap: spacing.xs,
  },
  imageName: {
    color: colors.text,
    fontSize: font.sm,
    fontFamily: mono,
  },
  imageDims: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
  },
  imageHint: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: spacing.md,
    lineHeight: 18,
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
