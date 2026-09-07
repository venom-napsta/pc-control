import { useRef, useEffect, useState } from "react";
import {
  View, Text, Animated, Pressable, Switch, Easing, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { ScreenShell } from "../components/ScreenShell";
import { Input } from "../components/Input";
import { PrimaryButton } from "../components/Button";
import { OrbitRing } from "../components/OrbitRing";
import { ServerSettingsSheet } from "../components/ServerSettingsSheet";
import { loginChrome, useLayout } from "../layout";
import { useKeyboardVisible } from "../keyboard";
import { colors, spacing, radius, font, mono } from "../theme";
import { APP_VERSION } from "../config";
import { serverLabel, isTailscaleAddress } from "../servers";

function targetText({ loading, server, lastGood, servers }) {
  const n = servers.length;
  const plural = n === 1 ? "address" : "addresses";
  if (loading) return `searching ${n} ${plural}…`;
  const target = server || lastGood;
  if (target) return serverLabel(target) + (isTailscaleAddress(target) ? "  //  via tailscale" : "");
  return n === 0 ? "no server addresses" : `${n} saved ${plural}`;
}

export function LoginScreen() {
  const {
    password, setPassword, loading, authenticate, authError,
    server, lastGood, servers,
    biometrics = { available: false, saved: false },
    remember = false, setRememberPassword, unlockWithBiometrics,
  } = useAuth();
  const [settingsOpen, setSettingsOpen] = useState(false);
  // Unmask the password. Off by default; the eye is the only way to turn it on,
  // and it resets on every mount so a revealed password never outlives a visit
  // to this screen.
  const [reveal, setReveal] = useState(false);

  // Logo glow
  const glow = useRef(new Animated.Value(0.4)).current;
  // Title slide in
  const titleSlide = useRef(new Animated.Value(20)).current;
  const titleFade = useRef(new Animated.Value(0)).current;
  // Input slide in
  const inputSlide = useRef(new Animated.Value(30)).current;
  const inputFade = useRef(new Animated.Value(0)).current;
  // Button slide in
  const btnSlide = useRef(new Animated.Value(30)).current;
  const btnFade = useRef(new Animated.Value(0)).current;
  // Scanline
  const scanY = useRef(new Animated.Value(0)).current;

  useEffect(() => {
    const glowAnim = Animated.loop(
      Animated.sequence([
        Animated.timing(glow, { toValue: 1, duration: 2000, useNativeDriver: true }),
        Animated.timing(glow, { toValue: 0.4, duration: 2000, useNativeDriver: true }),
      ])
    );
    glowAnim.start();

    const staggerAnim = Animated.stagger(150, [
      Animated.parallel([
        Animated.timing(titleFade, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(titleSlide, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(inputFade, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(inputSlide, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
      Animated.parallel([
        Animated.timing(btnFade, { toValue: 1, duration: 500, useNativeDriver: true }),
        Animated.timing(btnSlide, { toValue: 0, duration: 500, useNativeDriver: true }),
      ]),
    ]);
    staggerAnim.start();

    const scanAnim = Animated.loop(
      Animated.timing(scanY, {
        toValue: 1,
        duration: 4000,
        easing: Easing.linear,
        useNativeDriver: true,
      })
    );
    scanAnim.start();

    return () => { glowAnim.stop(); staggerAnim.stop(); scanAnim.stop(); };
  }, [glow, titleFade, titleSlide, inputFade, inputSlide, btnFade, btnSlide, scanY]);

  const { isLandscape } = useLayout();
  const keyboardVisible = useKeyboardVisible();
  const chrome = loginChrome({ keyboardVisible, isLandscape });

  const canSubmit = password.length > 0;
  const target = server || lastGood;
  const viaTailscale = target ? isTailscaleAddress(target) : servers.some(isTailscaleAddress);

  return (
    <ScreenShell centered style={chrome.centered ? null : styles.topAligned}>
      {/* CRT Scanline */}
      <Animated.View
        pointerEvents="none"
        style={[
          styles.scanline,
          {
            transform: [{
              translateY: scanY.interpolate({
                inputRange: [0, 1],
                outputRange: [-300, 600],
              }),
            }],
          },
        ]}
      />

      {/* Dual orbit rings + logo. Dropped when the keyboard needs the height. */}
      {chrome.showOrbit ? (
        <View style={styles.logoContainer}>
          <OrbitRing size={140} dotCount={10} dotSize={3} duration={8000} opacity={0.4}>
            <OrbitRing size={105} dotCount={6} dotSize={3} duration={6000} reverse opacity={0.6}>
              <Animated.View style={[styles.logoRing, { opacity: glow }]}>
                <Ionicons name="desktop-outline" size={36} color={colors.primary} />
              </Animated.View>
            </OrbitRing>
          </OrbitRing>
        </View>
      ) : null}

      <Animated.View style={{ opacity: titleFade, transform: [{ translateY: titleSlide }] }}>
        <Text style={styles.title}>PC Control</Text>
        <Text style={styles.subtitle}>
          <Text style={styles.subtitlePrefix}>{"//"} </Text>
          enter credentials
        </Text>
      </Animated.View>

      <Animated.View style={{ opacity: inputFade, transform: [{ translateY: inputSlide }], width: 260 }}>
        <View style={styles.inputWrap}>
          <Input
            style={styles.input}
            secureTextEntry={!reveal}
            value={password}
            onChangeText={setPassword}
            placeholder="password"
            autoCapitalize="none"
            autoCorrect={false}
            textContentType="password"
            onSubmitEditing={() => authenticate()}
            returnKeyType="go"
            accessibilityLabel="Password"
          />
          <Pressable
            onPress={() => setReveal((v) => !v)}
            style={styles.reveal}
            hitSlop={10}
            accessibilityRole="button"
            accessibilityLabel={reveal ? "Hide password" : "Show password"}
          >
            <Ionicons
              name={reveal ? "eye-off-outline" : "eye-outline"}
              size={18}
              color={reveal ? colors.primary : colors.textMuted}
            />
          </Pressable>
        </View>
      </Animated.View>

      <Animated.View style={{ opacity: btnFade, transform: [{ translateY: btnSlide }] }}>
        <PrimaryButton
          title="Connect"
          onPress={() => authenticate()}
          disabled={!canSubmit}
          loading={loading}
          style={styles.authBtn}
          accessibilityLabel="Connect to PC"
        />
      </Animated.View>

      {/* Unlock with the saved password, once there is one to unlock */}
      {biometrics.available && biometrics.saved && (
        <Animated.View style={{ opacity: btnFade, transform: [{ translateY: btnSlide }] }}>
          <PrimaryButton
            title="Unlock"
            icon="finger-print-outline"
            variant="outline"
            onPress={unlockWithBiometrics}
            disabled={loading}
            style={styles.unlockBtn}
            accessibilityLabel="Unlock with fingerprint or face"
          />
        </Animated.View>
      )}

      {/* Offer to remember only where the password can be protected */}
      {biometrics.available && (
        <Animated.View style={[styles.rememberRow, { opacity: btnFade }]}>
          <Text style={styles.rememberText}>Remember password on this device</Text>
          <Switch
            value={remember}
            onValueChange={setRememberPassword}
            trackColor={{ false: colors.switchTrackOff, true: colors.primaryDark }}
            thumbColor={remember ? colors.primary : colors.switchThumbOff}
            accessibilityLabel="Remember password on this device"
          />
        </Animated.View>
      )}

      {/* Auth error */}
      {authError && (
        <Animated.View style={[styles.errorRow, { opacity: btnFade }]}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{authError}</Text>
        </Animated.View>
      )}

      {/* Server target — tap to manage addresses */}
      <Animated.View style={{ opacity: btnFade }}>
        <Pressable
          onPress={() => setSettingsOpen(true)}
          style={({ pressed }) => [styles.targetRow, pressed && { opacity: 0.7 }]}
          hitSlop={12}
          accessibilityRole="button"
          accessibilityLabel="Server settings"
        >
          <Ionicons
            name={viaTailscale ? "shield-checkmark-outline" : "wifi-outline"}
            size={12}
            color={colors.textMuted}
          />
          <Text style={styles.targetText}>{targetText({ loading, server, lastGood, servers })}</Text>
          <Ionicons name="settings-outline" size={12} color={colors.textMuted} />
        </Pressable>
      </Animated.View>

      {/* Version badge */}
      <Animated.Text style={[styles.version, { opacity: btnFade }]}>
        v{APP_VERSION}{" // secure link"}
      </Animated.Text>

      <ServerSettingsSheet visible={settingsOpen} onClose={() => setSettingsOpen(false)} />
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
  // Overrides ScreenShell's vertical centring while keeping it horizontal, so
  // the field sits at the top of whatever height the keyboard leaves.
  topAligned: {
    justifyContent: "flex-start",
    paddingTop: spacing.xl,
  },
  scanline: {
    position: "absolute",
    left: 0,
    right: 0,
    height: 1,
    backgroundColor: colors.primary,
    opacity: 0.06,
    zIndex: 10,
  },
  logoContainer: {
    marginBottom: spacing.xl,
    alignItems: "center",
  },
  logoRing: {
    width: 76,
    height: 76,
    borderRadius: 38,
    borderWidth: 2,
    borderColor: colors.primary,
    alignItems: "center",
    justifyContent: "center",
    backgroundColor: colors.surface,
  },
  title: {
    fontSize: font.xxl,
    fontWeight: "800",
    color: colors.text,
    letterSpacing: 1,
    marginBottom: 6,
    textAlign: "center",
  },
  subtitle: {
    fontSize: font.sm,
    color: colors.textMuted,
    marginBottom: 36,
    textAlign: "center",
    fontFamily: mono,
  },
  subtitlePrefix: {
    color: colors.primaryDim,
  },
  inputWrap: {
    width: 260,
    marginBottom: spacing.xxl,
    justifyContent: "center",
  },
  input: {
    backgroundColor: colors.surface,
    borderRadius: radius.lg,
    width: 260,
    textAlign: "center",
    // Symmetric room for the reveal button, so the centred text stays centred
    // and a long password never runs underneath the eye.
    paddingLeft: 44,
    paddingRight: 44,
  },
  reveal: {
    position: "absolute",
    right: 2,
    height: "100%",
    width: 42,
    alignItems: "center",
    justifyContent: "center",
  },
  authBtn: { width: 260 },
  unlockBtn: { width: 260, marginTop: spacing.md },
  rememberRow: {
    flexDirection: "row",
    alignItems: "center",
    justifyContent: "space-between",
    gap: spacing.md,
    width: 260,
    marginTop: spacing.lg,
  },
  rememberText: {
    flex: 1,
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    maxWidth: 320,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: colors.dangerGhost,
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: colors.dangerBorder,
  },
  errorText: {
    color: colors.danger,
    fontSize: font.xs,
    fontFamily: mono,
    fontWeight: "600",
    flex: 1,
  },
  targetRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: 6,
    marginTop: spacing.xxl,
    paddingHorizontal: spacing.md,
    paddingVertical: spacing.xs,
    borderRadius: radius.pill,
    borderWidth: 1,
    borderColor: colors.border,
  },
  targetText: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    letterSpacing: 0.5,
  },
  version: {
    color: colors.textMuted,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: spacing.md,
    letterSpacing: 1,
  },
});
