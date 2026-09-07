import { useState, useCallback, useEffect } from "react";
import {
  View, Text, Image, Modal, ScrollView, ActivityIndicator,
  Pressable, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useNavigation } from "@react-navigation/native";
import { useAuth } from "../context/AuthContext";
import { useError } from "../context/ErrorContext";
import { usePolling } from "../hooks/usePolling";
import { fetchParts } from "../snapshot";
import { ScreenShell } from "../components/ScreenShell";
import { ScreenHeader } from "../components/ScreenHeader";
import { EmptyState } from "../components/EmptyState";
import { Card } from "../components/Card";
import { StatBar } from "../components/StatBar";
import { SectionHeader } from "../components/SectionHeader";
import { GhostButton, PrimaryButton } from "../components/Button";
import { confirm } from "../components/confirm";
import { CopyBadge } from "../components/CopyBadge";
import { formatBytes } from "../format";
import { useLayout } from "../layout";
import { saveSnapshot, loadSnapshot, formatAsOf } from "../statsCache";
import { colors, spacing, radius, font, mono } from "../theme";

export const STATS_SNAPSHOT_KEY = "stats";

// Pure. A cached snapshot is only worth painting if it actually carries
// readings — an empty or half-written one is no better than nothing.
export function snapshotStats(snapshot) {
  const data = snapshot?.data;
  return data && typeof data === "object" && data.cpu_percent !== undefined ? data : null;
}

// Pure. Live stats win; until they arrive the remembered ones stand in, marked
// stale so the UI can dim them and say how old they are.
export function pickStats({ stats, snapshot }) {
  if (stats) return { data: stats, stale: false, at: null };
  const cached = snapshotStats(snapshot);
  if (cached) return { data: cached, stale: true, at: snapshot.at };
  return { data: null, stale: false, at: null };
}

// Pure. "PC unreachable" is only the whole story when there is nothing
// remembered to show either.
export function shouldShowUnreachableEmpty({ connectionState, stats, snapshot }) {
  return connectionState === "unreachable" && !stats && !snapshotStats(snapshot);
}

// Landscape tablets lay the stat cards out two-up; every other window keeps
// the single column. Off, these render as bare fragments, so the phone tree is
// exactly what it was before the grid existed.
function Grid({ on, children }) {
  return on ? <View style={styles.grid}>{children}</View> : <>{children}</>;
}

function Cell({ on, children }) {
  return on ? <View style={styles.gridCell}>{children}</View> : <>{children}</>;
}

function Dim({ on, children }) {
  return on ? <View style={styles.stale}>{children}</View> : <>{children}</>;
}

function InfoRow({ label, value }) {
  return (
    <View style={styles.infoRow}>
      <Text style={styles.infoLabel}>{label}</Text>
      <Text style={styles.infoValue}>{value}</Text>
    </View>
  );
}

const formatSpeed = (bytesPerSec) => formatBytes(bytesPerSec, { perSecond: true });

// Fullscreen image with pinch/double-tap zoom. A half-scale desktop capture is
// unreadable on a phone otherwise. Android Back closes it via onRequestClose.
function ImageViewer({ visible, uri, label, headers, onClose }) {
  return (
    <Modal
      visible={visible}
      transparent
      animationType="fade"
      statusBarTranslucent
      onRequestClose={onClose}
    >
      <View style={styles.modalOverlay}>
        <ScrollView
          style={styles.modalScroll}
          contentContainerStyle={styles.modalScrollContent}
          maximumZoomScale={4}
          minimumZoomScale={1}
          centerContent
          showsHorizontalScrollIndicator={false}
          showsVerticalScrollIndicator={false}
        >
          {uri ? (
            <Image
              source={headers ? { uri, headers } : { uri }}
              style={styles.modalImage}
              resizeMode="contain"
              accessibilityLabel={label}
            />
          ) : null}
        </ScrollView>
        <Pressable
          onPress={onClose}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel={`Close ${label}`}
          style={({ pressed }) => [styles.modalClose, pressed && { opacity: 0.6 }]}
        >
          <Ionicons name="close" size={22} color={colors.text} />
        </Pressable>
      </View>
    </Modal>
  );
}

export const LIVE_SCREENSHOT_MS = 5000;

export function MonitorScreen() {
  const {
    api, connectionState = "unknown", server, authHeader = () => ({}),
  } = useAuth();
  const { showError } = useError();
  const navigation = useNavigation();
  const { columns = 1 } = useLayout();
  const [stats, setStats] = useState(null);
  const [snapshot, setSnapshot] = useState(null);
  const [activeWin, setActiveWin] = useState("");
  // Data URI, not raw base64: on Wayland the server captures PNG, on X11 JPEG.
  // A cache-busting stamp rather than the image itself: the PC serves
  // /screenshot.jpg directly, so nothing base64 has to cross the wire or sit
  // in memory. null means "nothing captured yet".
  const [shotAt, setShotAt] = useState(null);
  const [live, setLive] = useState(false);
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
    // Four polls become one /snapshot request where the server supports it.
    let values;
    try {
      ({ values } = await fetchParts(api, ["stats", "active_window", "bandwidth", "webcam"]));
    } catch {
      return; // Unreachable: the connection strip and the cached view say so.
    }
    if (values.stats && values.stats.cpu_percent !== undefined) {
      setStats(values.stats);
      // Remember the last good reading for the next time the PC is out of reach.
      saveSnapshot(STATS_SNAPSHOT_KEY, values.stats);
    }
    if (values.active_window && values.active_window.title !== undefined) {
      setActiveWin(values.active_window.title);
    }
    if (values.bandwidth) setBandwidth(values.bandwidth);
    if (values.webcam) setWebcam(values.webcam);
  }, [api]);

  const { refreshing, onRefresh } = usePolling(fetchStats, 5000);

  // Last-known readings, shown until the first live answer lands.
  useEffect(() => {
    let alive = true;
    loadSnapshot(STATS_SNAPSHOT_KEY).then((snap) => {
      if (alive && snap) setSnapshot(snap);
    });
    return () => { alive = false; };
  }, []);

  // Fetch uptime history once
  useEffect(() => {
    api("GET", "/uptime/history").then(setUptimeHistory).catch((e) => showError("UPTIME HISTORY FAILED", e));
    // 404 just means no intruder photo has ever been taken; anything else is real.
    api("GET", "/intruder/photo").then(setIntruderPhoto).catch((e) => {
      if (e.status !== 404) showError("INTRUDER PHOTO FAILED", e);
    });
  }, [api, showError]);

  // Bumping the stamp is the whole request: fetching /screenshot.jpg is what
  // makes the PC take the capture, so this costs exactly one round trip and
  // the load callbacks below report how it went.
  const takeScreenshot = useCallback(() => setShotAt(Date.now()), []);

  const shotUri = shotAt && server
    ? `${server}/screenshot.jpg?t=${shotAt}`
    : null;
  const shotSource = shotUri
    ? { uri: shotUri, headers: authHeader("/screenshot.jpg") }
    : null;

  // Refresh on a timer while live mode is on. usePolling already pauses when
  // the screen is not focused or the app is backgrounded, so this stops
  // capturing the moment you look away.
  const liveTick = useCallback(() => {
    if (live) setShotAt(Date.now());
  }, [live]);
  usePolling(liveTick, LIVE_SCREENSHOT_MS);

  const scanNetwork = async () => {
    setNetworkScanning(true);
    try {
      const data = await api("GET", "/network/scan", null, { timeoutMs: 90000 });
      setNetworkDevices(data.devices);
    } catch (e) {
      showError("NETWORK SCAN FAILED", e);
    }
    setNetworkScanning(false);
  };

  const killWebcam = () => {
    const names = (webcam?.processes || []).map((p) => `${p.name} (${p.pid})`).join(", ");
    confirm(
      "Kill webcam processes",
      names ? `This force-quits ${names} on the PC.` : "This force-quits whatever is using the webcam.",
      {
        confirmText: "Kill",
        destructive: true,
        onConfirm: async () => {
          setWebcamKilling(true);
          try {
            await api("POST", "/webcam/kill");
            fetchStats();
          } catch (e) {
            showError("WEBCAM KILL FAILED", e);
          }
          setWebcamKilling(false);
        },
      },
    );
  };

  const grid = columns === 2;
  const load = pickStats({ stats, snapshot });
  const shown = load.data;

  return (
    <ScreenShell
      refreshing={refreshing}
      onRefresh={onRefresh}
      header={
        <ScreenHeader
          title="MONITOR"
          onBack={navigation.canGoBack() ? () => navigation.goBack() : undefined}
        />
      }
    >
      {/* Unreachable and nothing cached yet: say so rather than spin forever. */}
      {shouldShowUnreachableEmpty({ connectionState, stats, snapshot }) && (
        <EmptyState
          icon="cloud-offline-outline"
          title="PC UNREACHABLE"
          message="Nothing to show yet. Check Tailscale is connected on this device, then pull to refresh."
        />
      )}

      {/* Remembered readings: say how old they are, so nobody reads them as live. */}
      {load.stale && (
        <Text style={styles.asOf} accessibilityLiveRegion="polite">
          last known — as of {formatAsOf(load.at)}
        </Text>
      )}

      <Dim on={load.stale}>
        <Grid on={grid}>
          {/* ── System Info ── */}
          {shown && (
            <Cell on={grid}>
              <SectionHeader>SYS.INFO</SectionHeader>
              <Card style={styles.infoCard}>
                <InfoRow label="HOST" value={shown.hostname || "\u2014"} />
                <InfoRow label="KERNEL" value={shown.kernel || "\u2014"} />
                <InfoRow label="UPTIME" value={shown.uptime || "\u2014"} />
                <InfoRow label="CORES" value={String(shown.cpu_count || "\u2014")} />
              </Card>
            </Cell>
          )}

          {/* ── System Load ── */}
          <Cell on={grid}>
            <SectionHeader>SYS.LOAD</SectionHeader>
            {shown ? (
              <Card>
                <StatBar label="CPU" value={`${shown.cpu_percent}%`} pct={shown.cpu_percent} />
                <StatBar label="RAM" value={`${shown.ram_used_gb} / ${shown.ram_total_gb} GB`} pct={shown.ram_percent} />
                <StatBar label="DISK" value={`${shown.disk_used_gb} / ${shown.disk_total_gb} GB`} pct={shown.disk_percent} />
              </Card>
            ) : (
              <Card style={{ alignItems: "center", paddingVertical: spacing.xxl }}>
                <ActivityIndicator color={colors.primary} />
              </Card>
            )}
          </Cell>
        </Grid>
      </Dim>

      <Grid on={grid}>
        <Cell on={grid}>
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
        </Cell>

        <Cell on={grid}>
          {/* ── Webcam ── */}
          <SectionHeader style={{ marginTop: spacing.xxl }}>WEBCAM.STATUS</SectionHeader>
          <Card>
            {webcam ? (
              <View>
                <View style={styles.webcamHeader}>
                  <View style={styles.webcamStatusRow}>
                    <View style={[
                      styles.webcamDot,
                      { backgroundColor: !webcam.available ? colors.textMuted : webcam.active ? colors.danger : colors.success },
                    ]} />
                    <Text style={[
                      styles.webcamStatus,
                      { color: !webcam.available ? colors.textMuted : webcam.active ? colors.danger : colors.success },
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
                    {webcam.processes.map((p) => (
                      <Text key={p.pid} style={styles.processItem}>
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

        </Cell>

        {/* Intruder photo */}
        {intruderPhoto && intruderPhoto.image && (
          <Cell on={grid}>
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
          </Cell>
        )}
      </Grid>

      {/* View audit log link */}
      <Pressable
        onPress={() => navigation.navigate("Log")}
        style={({ pressed }) => [styles.navLink, pressed && { opacity: 0.6 }]}
      >
        <Ionicons name="list-outline" size={14} color={colors.primary} />
        <Text style={styles.navLinkText}>VIEW AUDIT LOG</Text>
        <Ionicons name="chevron-forward" size={14} color={colors.primaryDim} />
      </Pressable>

      <Grid on={grid}>
        <Cell on={grid}>
          {/* ── Network Scan ── */}
          <SectionHeader style={{ marginTop: spacing.xxl }}>LAN.DEVICES</SectionHeader>
          <Card>
            <PrimaryButton
              title="SCAN NETWORK"
              icon="search-outline"
              variant="outline"
              onPress={scanNetwork}
              loading={networkScanning}
              disabled={networkScanning}
            />
            {networkDevices && (
              <View style={{ marginTop: spacing.md }}>
                <Text style={styles.deviceCount}>{networkDevices.length} device{networkDevices.length !== 1 ? "s" : ""} found</Text>
                {networkDevices.map((d) => (
                  <View key={d.mac || d.ip} style={styles.deviceRow}>
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

        </Cell>

        <Cell on={grid}>
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
                  <Text style={styles.emptyText}>{"// no boot history available"}</Text>
                )
              ) : null}
            </Card>
          </Pressable>
        </Cell>

        <Cell on={grid}>
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
        </Cell>
      </Grid>

      {/* ── Screenshot: full width even on a tablet; a half-width desktop
           capture is unreadable. ── */}
      <SectionHeader style={{ marginTop: spacing.xxl }}>SCR.CAPTURE</SectionHeader>
      <Pressable
        onPress={shotSource ? () => setFullscreen(true) : takeScreenshot}
        style={({ pressed }) => [pressed && { opacity: 0.85 }]}
      >
        <Card>
          {!shotSource ? (
            <View style={styles.screenshotPlaceholder}>
              <Ionicons name="camera-outline" size={32} color={colors.primaryDim} />
              <Text style={styles.placeholderText}>{"// tap to capture"}</Text>
            </View>
          ) : (
            <Image
              source={shotSource}
              onLoadStart={() => setSsLoading(true)}
              onLoadEnd={() => setSsLoading(false)}
              onError={() => {
                setSsLoading(false);
                if (!live) showError("SCREENSHOT FAILED", new Error("The PC could not send a capture"));
              }}
              style={styles.screenshotImg}
              resizeMode="contain"
            />
          )}
          {/* The PC needs a moment to capture; say so rather than sit blank. */}
          {ssLoading && (
            <View style={styles.shotLoading} pointerEvents="none">
              <ActivityIndicator color={colors.primary} />
            </View>
          )}
        </Card>
      </Pressable>

      {shotSource && (
        <View style={styles.shotActions}>
          <GhostButton title={"\u21BB  Retake"} onPress={takeScreenshot} />
          <Pressable
            onPress={() => setLive((v) => !v)}
            accessibilityRole="switch"
            accessibilityState={{ checked: live }}
            accessibilityLabel="Refresh the screenshot automatically"
            style={({ pressed }) => [styles.liveBtn, live && styles.liveBtnOn, pressed && { opacity: 0.7 }]}
          >
            <Ionicons
              name={live ? "radio-button-on" : "radio-button-off"}
              size={14}
              color={live ? colors.primary : colors.textMuted}
            />
            <Text style={[styles.liveText, live && { color: colors.primary }]}>
              {live ? `LIVE · ${LIVE_SCREENSHOT_MS / 1000}s` : "LIVE OFF"}
            </Text>
          </Pressable>
        </View>
      )}

      {/* Screenshot fullscreen viewer */}
      <ImageViewer
        visible={fullscreen}
        uri={shotUri}
        headers={shotSource?.headers}
        label="Screenshot"
        onClose={() => setFullscreen(false)}
      />

      {/* Intruder photo fullscreen viewer */}
      <ImageViewer
        visible={intruderFullscreen}
        uri={intruderPhoto?.image ? `data:image/jpeg;base64,${intruderPhoto.image}` : null}
        label="Intruder photo"
        onClose={() => setIntruderFullscreen(false)}
      />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  // Two-up wrapped grid, landscape tablets only.
  grid: {
    flexDirection: "row",
    flexWrap: "wrap",
    justifyContent: "space-between",
    width: "100%",
  },
  gridCell: { width: "48%" },
  // Remembered, not live: dimmed so it never reads as a current reading.
  stale: { opacity: 0.55, width: "100%" },
  asOf: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    letterSpacing: 0.5,
    marginBottom: spacing.sm,
  },
  shotActions: { flexDirection: "row", alignItems: "center", gap: spacing.md },
  shotLoading: {
    ...StyleSheet.absoluteFillObject,
    alignItems: "center",
    justifyContent: "center",
  },
  liveBtn: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.xs,
    paddingHorizontal: spacing.md,
    minHeight: 44,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  liveBtnOn: { borderColor: colors.primary, backgroundColor: colors.primaryGhost },
  liveText: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  modalScroll: { flex: 1, width: "100%" },
  modalScrollContent: { flexGrow: 1, alignItems: "center", justifyContent: "center" },
  modalClose: {
    position: "absolute",
    top: spacing.huge,
    right: spacing.xl,
    padding: spacing.sm,
    borderRadius: radius.pill,
    backgroundColor: colors.surface,
    borderWidth: 1,
    borderColor: colors.border,
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
    backgroundColor: colors.dangerGhost,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
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
