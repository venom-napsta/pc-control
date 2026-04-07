import { useState, useCallback, useEffect } from "react";
import {
  View, Text, Image, Modal, Alert, ActivityIndicator,
  TouchableOpacity, Pressable, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { usePolling } from "../hooks/usePolling";
import { ScreenShell } from "../components/ScreenShell";
import { Card } from "../components/Card";
import { StatBar } from "../components/StatBar";
import { SectionHeader } from "../components/SectionHeader";
import { GhostButton } from "../components/Button";
import { CopyBadge } from "../components/CopyBadge";
import { colors, spacing, font, mono } from "../theme";

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

function formatSpeed(bytesPerSec) {
  const v = bytesPerSec || 0;
  if (v < 1024) return `${v} B/s`;
  if (v < 1048576) return `${(v / 1024).toFixed(1)} KB/s`;
  if (v < 1073741824) return `${(v / 1048576).toFixed(1)} MB/s`;
  return `${(v / 1073741824).toFixed(1)} GB/s`;
}

function formatBytes(bytes) {
  const v = bytes || 0;
  if (v < 1073741824) return `${(v / 1048576).toFixed(0)} MB`;
  return `${(v / 1073741824).toFixed(1)} GB`;
}

export function MonitorScreen() {
  const { api } = useAuth();
  const navigation = useNavigation();
  const [stats, setStats] = useState(null);
  const [activeWin, setActiveWin] = useState("");
  const [screenshot, setScreenshot] = useState(null);
  const [ssLoading, setSsLoading] = useState(false);
  const [fullscreen, setFullscreen] = useState(false);

  // New states
  const [bandwidth, setBandwidth] = useState(null);
  const [webcam, setWebcam] = useState(null);
  const [networkDevices, setNetworkDevices] = useState(null);
  const [uptimeExpanded, setUptimeExpanded] = useState(false);
  const [networkScanning, setNetworkScanning] = useState(false);
  const [uptimeHistory, setUptimeHistory] = useState(null);
  const [intruderPhoto, setIntruderPhoto] = useState(null);
  const [intruderFullscreen, setIntruderFullscreen] = useState(false);
  const [webcamKilling, setWebcamKilling] = useState(false);

  const fetchStats = useCallback(async () => {
    const [statsRes, winRes, bwRes, camRes] = await Promise.allSettled([
      api("GET", "/stats"),
      api("GET", "/active-window"),
      api("GET", "/bandwidth"),
      api("GET", "/webcam/status"),
    ]);
    if (statsRes.status === "fulfilled" && statsRes.value.cpu_percent !== undefined) {
      setStats(statsRes.value);
    }
    if (winRes.status === "fulfilled" && winRes.value.title !== undefined) {
      setActiveWin(winRes.value.title);
    }
    if (bwRes.status === "fulfilled") {
      setBandwidth(bwRes.value);
    }
    if (camRes.status === "fulfilled") {
      setWebcam(camRes.value);
    }
  }, [api]);

  const { refreshing, onRefresh } = usePolling(fetchStats, 5000);

  // Fetch uptime history once
  useEffect(() => {
    api("GET", "/uptime/history").then(setUptimeHistory).catch(() => {});
    api("GET", "/intruder/photo").then(setIntruderPhoto).catch(() => {});
  }, [api]);

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

  const scanNetwork = async () => {
    setNetworkScanning(true);
    try {
      const data = await api("GET", "/network/scan");
      setNetworkDevices(data.devices);
    } catch {
      Alert.alert("Error", "Network scan failed");
    }
    setNetworkScanning(false);
  };

  const killWebcam = async () => {
    setWebcamKilling(true);
    try {
      await api("POST", "/webcam/kill");
      Alert.alert("Done", "Webcam processes terminated");
      fetchStats();
    } catch {
      Alert.alert("Error", "Failed to kill webcam");
    }
    setWebcamKilling(false);
  };

  return (
    <ScreenShell refreshing={refreshing} onRefresh={onRefresh}>
      {/* Back navigation */}
      {navigation.canGoBack() && (
        <Pressable
          onPress={() => navigation.goBack()}
          style={({ pressed }) => [styles.backRow, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="chevron-back" size={20} color={colors.primary} />
          <Text style={styles.backText}>Back</Text>
        </Pressable>
      )}

      {/* ── System Info ── */}
      {stats && (
        <>
          <SectionHeader>SYS.INFO</SectionHeader>
          <Card style={styles.infoCard}>
            <InfoRow label="HOST" value={stats.hostname || "\u2014"} />
            <InfoRow label="KERNEL" value={stats.kernel || "\u2014"} />
            <InfoRow label="UPTIME" value={stats.uptime || "\u2014"} />
            <InfoRow label="CORES" value={String(stats.cpu_count || "\u2014")} />
          </Card>
        </>
      )}

      {/* ── System Load ── */}
      <SectionHeader>SYS.LOAD</SectionHeader>
      {stats ? (
        <Card>
          <StatBar label="CPU" value={`${stats.cpu_percent}%`} pct={stats.cpu_percent} />
          <StatBar label="RAM" value={`${stats.ram_used_gb} / ${stats.ram_total_gb} GB`} pct={stats.ram_percent} />
          <StatBar label="DISK" value={`${stats.disk_used_gb} / ${stats.disk_total_gb} GB`} pct={stats.disk_percent} />
        </Card>
      ) : (
        <Card style={{ alignItems: "center", paddingVertical: spacing.xxl }}>
          <ActivityIndicator color={colors.primary} />
        </Card>
      )}

      {/* ── Bandwidth ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>NET.SPEED</SectionHeader>
      <Card>
        {bandwidth ? (
          <View>
            <View style={styles.bwRow}>
              <View style={styles.bwItem}>
                <View style={styles.bwLabelRow}>
                  <Ionicons name="arrow-up" size={14} color={colors.success} />
                  <Text style={styles.bwLabel}>UPLOAD</Text>
                </View>
                <Text style={styles.bwSpeed}>{formatSpeed(bandwidth.upload_speed)}</Text>
              </View>
              <View style={styles.bwDivider} />
              <View style={styles.bwItem}>
                <View style={styles.bwLabelRow}>
                  <Ionicons name="arrow-down" size={14} color={colors.primary} />
                  <Text style={styles.bwLabel}>DOWNLOAD</Text>
                </View>
                <Text style={styles.bwSpeed}>{formatSpeed(bandwidth.download_speed)}</Text>
              </View>
            </View>
            <View style={styles.bwTotalRow}>
              <Text style={styles.bwTotal}>
                {"\u2191"} {formatBytes(bandwidth.total_sent)}  {"\u2022"}  {"\u2193"} {formatBytes(bandwidth.total_recv)}
              </Text>
            </View>
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </Card>

      {/* ── Webcam ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>WEBCAM.STATUS</SectionHeader>
      <Card>
        {webcam ? (
          <View>
            <View style={styles.webcamHeader}>
              <View style={styles.webcamStatusRow}>
                <View style={[
                  styles.webcamDot,
                  { backgroundColor: !webcam.available ? colors.textDim : webcam.active ? colors.danger : colors.success },
                ]} />
                <Text style={[
                  styles.webcamStatus,
                  { color: !webcam.available ? colors.textDim : webcam.active ? colors.danger : colors.success },
                ]}>
                  {!webcam.available ? "NO CAMERA" : webcam.active ? "ACTIVE" : "INACTIVE"}
                </Text>
              </View>
              {webcam.active && (
                <Pressable
                  onPress={killWebcam}
                  disabled={webcamKilling}
                  style={({ pressed }) => [styles.killBtn, pressed && { opacity: 0.7 }]}
                >
                  {webcamKilling ? (
                    <ActivityIndicator color={colors.danger} size="small" />
                  ) : (
                    <>
                      <Ionicons name="videocam-off-outline" size={14} color={colors.danger} />
                      <Text style={styles.killText}>KILL</Text>
                    </>
                  )}
                </Pressable>
              )}
            </View>
            {webcam.active && webcam.processes.length > 0 && (
              <View style={styles.processList}>
                {webcam.processes.map((p, i) => (
                  <Text key={i} style={styles.processItem}>
                    {"\u2022"} {p.name} (PID {p.pid})
                  </Text>
                ))}
              </View>
            )}
          </View>
        ) : (
          <ActivityIndicator color={colors.primary} />
        )}
      </Card>

      {/* Intruder photo */}
      {intruderPhoto && intruderPhoto.image && (
        <Card style={{ marginTop: spacing.xs }}>
          <View style={styles.intruderHeader}>
            <View style={{ flexDirection: "row", alignItems: "center", gap: spacing.sm }}>
              <Ionicons name="warning" size={14} color={colors.danger} />
              <Text style={styles.intruderLabel}>LAST INTRUDER</Text>
            </View>
            <Text style={styles.intruderTime}>{intruderPhoto.timestamp}</Text>
          </View>
          <Pressable onPress={() => setIntruderFullscreen(true)}>
            <Image
              source={{ uri: `data:image/jpeg;base64,${intruderPhoto.image}` }}
              style={styles.intruderImg}
              resizeMode="cover"
            />
          </Pressable>
        </Card>
      )}

      {/* View audit log link */}
      <Pressable
        onPress={() => navigation.navigate("Log")}
        style={({ pressed }) => [styles.navLink, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="list-outline" size={14} color={colors.primary} />
        <Text style={styles.navLinkText}>VIEW AUDIT LOG</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.primaryDim} />
      </Pressable>

      {/* ── Network Scan ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>LAN.DEVICES</SectionHeader>
      <Card>
        <Pressable
          onPress={scanNetwork}
          disabled={networkScanning}
          style={({ pressed }) => [styles.scanBtn, pressed && { opacity: 0.8 }]}
        >
          {networkScanning ? (
            <ActivityIndicator color={colors.primary} size="small" />
          ) : (
            <>
              <Ionicons name="radar-outline" size={16} color={colors.primary} />
              <Text style={styles.scanBtnText}>SCAN NETWORK</Text>
            </>
          )}
        </Pressable>
        {networkDevices && (
          <View style={{ marginTop: spacing.md }}>
            <Text style={styles.deviceCount}>{networkDevices.length} device{networkDevices.length !== 1 ? "s" : ""} found</Text>
            {networkDevices.map((d, i) => (
              <View key={i} style={styles.deviceRow}>
                <Ionicons name="hardware-chip-outline" size={14} color={colors.primary} />
                <View style={{ flex: 1 }}>
                  <Text style={styles.deviceIP}>{d.ip}</Text>
                  <Text style={styles.deviceMeta}>
                    {d.mac}{d.hostname ? ` \u2022 ${d.hostname}` : ""}
                  </Text>
                </View>
              </View>
            ))}
          </View>
        )}
      </Card>

      {/* ── Uptime History ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>UPTIME.HIST</SectionHeader>
      <Pressable onPress={() => setUptimeExpanded(!uptimeExpanded)}>
        <Card>
          <View style={styles.collapseHeader}>
            <View style={styles.collapseLeft}>
              <Ionicons name="time-outline" size={16} color={colors.primary} />
              <Text style={styles.collapseTitle}>
                {uptimeHistory && uptimeHistory.boots ? `${uptimeHistory.boots.length} boot${uptimeHistory.boots.length !== 1 ? "s" : ""}` : "loading..."}
              </Text>
            </View>
            <Ionicons name={uptimeExpanded ? "chevron-up" : "chevron-down"} size={16} color={colors.textMuted} />
          </View>
          {uptimeExpanded && uptimeHistory && uptimeHistory.boots ? (
            uptimeHistory.boots.length > 0 ? (
              <View style={{ marginTop: spacing.md }}>
                {uptimeHistory.boots.slice(0, 10).map((b, i) => (
                  <View key={i} style={styles.bootRow}>
                    <View style={styles.bootDot}>
                      <View style={[styles.bootDotInner, { backgroundColor: b.running ? colors.success : colors.textMuted }]} />
                    </View>
                    <View style={{ flex: 1 }}>
                      <Text style={styles.bootTime}>{b.boot}</Text>
                      <Text style={styles.bootEnd}>
                        {b.running ? "still running" : `\u2192 ${b.end}`}
                      </Text>
                    </View>
                    {b.running && (
                      <View style={styles.runningBadge}>
                        <Text style={styles.runningText}>LIVE</Text>
                      </View>
                    )}
                  </View>
                ))}
              </View>
            ) : (
              <Text style={styles.emptyText}>// no boot history available</Text>
            )
          ) : null}
        </Card>
      </Pressable>

      {/* ── Active Window ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>ACTIVE.PROC</SectionHeader>
      <Card>
        <View style={styles.windowRow}>
          <View style={styles.windowLeft}>
            <Ionicons name="browsers-outline" size={18} color={colors.primary} />
            <Text style={styles.windowText}>{activeWin || "\u2014"}</Text>
          </View>
          {activeWin ? <CopyBadge text={activeWin} /> : null}
        </View>
      </Card>

      {/* ── Screenshot ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>SCR.CAPTURE</SectionHeader>
      <Pressable
        onPress={screenshot ? () => setFullscreen(true) : takeScreenshot}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <Card>
          {ssLoading ? (
            <ActivityIndicator color={colors.primary} style={{ paddingVertical: 40 }} />
          ) : screenshot ? (
            <Image
              source={{ uri: `data:image/jpeg;base64,${screenshot}` }}
              style={styles.screenshotImg}
              resizeMode="contain"
            />
          ) : (
            <View style={styles.screenshotPlaceholder}>
              <Ionicons name="camera-outline" size={32} color={colors.primaryDim} />
              <Text style={styles.placeholderText}>// tap to capture</Text>
            </View>
          )}
        </Card>
      </Pressable>

      {screenshot && (
        <GhostButton title={"\u21BB  Retake"} onPress={takeScreenshot} />
      )}

      {/* Screenshot fullscreen modal */}
      <Modal visible={fullscreen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setFullscreen(false)}
          activeOpacity={1}
        >
          {screenshot && (
            <Image
              source={{ uri: `data:image/jpeg;base64,${screenshot}` }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>
      </Modal>

      {/* Intruder photo fullscreen modal */}
      <Modal visible={intruderFullscreen} transparent animationType="fade">
        <TouchableOpacity
          style={styles.modalOverlay}
          onPress={() => setIntruderFullscreen(false)}
          activeOpacity={1}
        >
          {intruderPhoto && intruderPhoto.image && (
            <Image
              source={{ uri: `data:image/jpeg;base64,${intruderPhoto.image}` }}
              style={styles.modalImage}
              resizeMode="contain"
            />
          )}
        </TouchableOpacity>
      </Modal>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  backRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 2,
    alignSelf: "flex-start",
    marginBottom: spacing.lg,
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
  navLink: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    paddingHorizontal: spacing.lg,
    marginTop: spacing.sm,
    marginBottom: spacing.xxl,
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
  infoCard: {
    backgroundColor: colors.surfaceHi,
    borderColor: colors.primaryDim,
  },
  infoRow: {
    flexDirection: "row",
    justifyContent: "space-between",
    paddingVertical: 3,
  },
  infoLabel: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    fontWeight: "700",
    letterSpacing: 1,
  },
  infoValue: {
    color: colors.primary,
    fontSize: font.xs,
    fontFamily: mono,
  },
  // Bandwidth
  bwRow: {
    flexDirection: "row",
    alignItems: "center",
  },
  bwItem: {
    flex: 1,
    alignItems: "center",
  },
  bwDivider: {
    width: 1,
    height: 40,
    backgroundColor: colors.border,
  },
  bwLabelRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    marginBottom: 4,
  },
  bwLabel: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    fontWeight: "700",
    letterSpacing: 0.5,
  },
  bwSpeed: {
    color: colors.text,
    fontSize: font.xl,
    fontFamily: mono,
    fontWeight: "700",
  },
  bwTotalRow: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
    alignItems: "center",
  },
  bwTotal: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
  },
  // Webcam
  webcamHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  webcamStatusRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  webcamDot: {
    width: 10,
    height: 10,
    borderRadius: 5,
  },
  webcamStatus: {
    fontSize: font.md,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 1,
  },
  killBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: 4,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: 8,
    backgroundColor: "rgba(239,83,80,0.12)",
    borderWidth: 1,
    borderColor: "rgba(239,83,80,0.3)",
  },
  killText: {
    color: colors.danger,
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
  },
  processList: {
    marginTop: spacing.sm,
    paddingTop: spacing.sm,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  processItem: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    paddingVertical: 2,
  },
  // Intruder
  intruderHeader: {
    flexDirection: "row",
    justifyContent: "space-between",
    alignItems: "center",
    marginBottom: spacing.sm,
  },
  intruderLabel: {
    color: colors.danger,
    fontSize: font.xs,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  intruderTime: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
  },
  intruderImg: {
    width: "100%",
    height: 150,
    borderRadius: 8,
  },
  // Network
  scanBtn: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "center",
    gap: spacing.sm,
    paddingVertical: spacing.md,
    borderRadius: 8,
    borderWidth: 1,
    borderColor: colors.primaryDim,
    borderStyle: "dashed",
  },
  scanBtnText: {
    color: colors.primary,
    fontSize: font.sm,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  deviceCount: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginBottom: spacing.sm,
  },
  deviceRow: {
    flexDirection: "row",
    alignItems: "flex-start",
    gap: spacing.sm,
    paddingVertical: spacing.xs,
    borderTopWidth: 1,
    borderTopColor: colors.border,
  },
  deviceIP: {
    color: colors.text,
    fontSize: font.sm,
    fontFamily: mono,
    fontWeight: "600",
  },
  deviceMeta: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: 1,
  },
  // Uptime
  collapseHeader: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
  },
  collapseLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
  },
  collapseTitle: {
    color: colors.text,
    fontSize: font.sm,
    fontFamily: mono,
    fontWeight: "700",
  },
  bootRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.md,
    paddingVertical: spacing.xs,
  },
  bootDot: {
    width: 16,
    alignItems: "center",
  },
  bootDotInner: {
    width: 8,
    height: 8,
    borderRadius: 4,
  },
  bootTime: {
    color: colors.text,
    fontSize: font.xs,
    fontFamily: mono,
    fontWeight: "600",
  },
  bootEnd: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: 1,
  },
  runningBadge: {
    paddingHorizontal: 8,
    paddingVertical: 2,
    borderRadius: 6,
    backgroundColor: "rgba(76,175,80,0.15)",
    borderWidth: 1,
    borderColor: "rgba(76,175,80,0.3)",
  },
  runningText: {
    color: colors.success,
    fontSize: 10,
    fontWeight: "700",
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  emptyText: {
    color: colors.textDim,
    fontFamily: mono,
    textAlign: "center",
    paddingVertical: spacing.lg,
  },
  // Active window
  windowRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.sm,
  },
  windowLeft: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    flex: 1,
    marginRight: spacing.sm,
  },
  windowText: {
    color: colors.text,
    fontSize: font.sm,
    fontFamily: mono,
    flex: 1,
  },
  // Screenshot
  screenshotImg: {
    width: "100%",
    height: 200,
    borderRadius: 8,
  },
  screenshotPlaceholder: {
    alignItems: "center",
    paddingVertical: 32,
    gap: spacing.sm,
  },
  placeholderText: {
    color: colors.primaryDim,
    fontSize: font.md,
    fontFamily: mono,
  },
  modalOverlay: {
    flex: 1,
    backgroundColor: "rgba(0,0,0,0.95)",
    justifyContent: "center",
  },
  modalImage: {
    width: "100%",
    height: "80%",
  },
});
