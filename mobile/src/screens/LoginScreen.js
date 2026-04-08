import { useRef, useEffect } from "react";
import {
  View, Text, TextInput, Animated, Pressable,
  ActivityIndicator, Easing, StyleSheet,
} from "react-native";
import { Ionicons } from "@expo/vector-icons";
import { useAuth } from "../context/AuthContext";
import { ScreenShell } from "../components/ScreenShell";
import { OrbitRing } from "../components/OrbitRing";
import { colors, spacing, radius, font, mono } from "../theme";

export function LoginScreen() {
  const { password, setPassword, loading, authenticate, authError } = useAuth();

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

  const canSubmit = password.length > 0;

  return (
    <ScreenShell centered>
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

      {/* Dual orbit rings + logo */}
      <View style={styles.logoContainer}>
        <OrbitRing size={140} dotCount={10} dotSize={3} duration={8000} opacity={0.4}>
          <OrbitRing size={105} dotCount={6} dotSize={3} duration={6000} reverse opacity={0.6}>
            <Animated.View style={[styles.logoRing, { opacity: glow }]}>
              <Ionicons name="desktop-outline" size={36} color={colors.primary} />
            </Animated.View>
          </OrbitRing>
        </OrbitRing>
      </View>

      <Animated.View style={{ opacity: titleFade, transform: [{ translateY: titleSlide }] }}>
        <Text style={styles.title}>PC Control</Text>
        <Text style={styles.subtitle}>
          <Text style={styles.subtitlePrefix}>{"//"} </Text>
          enter credentials
        </Text>
      </Animated.View>

      <Animated.View style={{ opacity: inputFade, transform: [{ translateY: inputSlide }], width: 260 }}>
        <TextInput
          style={styles.input}
          secureTextEntry
          value={password}
          onChangeText={setPassword}
          placeholder="password"
          placeholderTextColor={colors.primaryDim}
          selectionColor={colors.primary}
          cursorColor={colors.primary}
          autoCapitalize="none"
          autoCorrect={false}
          onSubmitEditing={authenticate}
          returnKeyType="go"
        />
      </Animated.View>

      <Animated.View style={{ opacity: btnFade, transform: [{ translateY: btnSlide }] }}>
        <Pressable
          onPress={authenticate}
          disabled={loading || !canSubmit}
          style={({ pressed }) => [
            styles.authBtn,
            !canSubmit && styles.authBtnDisabled,
            pressed && canSubmit && styles.authBtnPressed,
          ]}
        >
          {loading
            ? <ActivityIndicator color={colors.bg} />
            : <Text style={styles.authText}>Connect</Text>}
        </Pressable>
      </Animated.View>

      {/* Auth error */}
      {authError && (
        <Animated.View style={[styles.errorRow, { opacity: btnFade }]}>
          <Ionicons name="alert-circle" size={14} color={colors.danger} />
          <Text style={styles.errorText}>{authError}</Text>
        </Animated.View>
      )}

      {/* Version badge */}
      <Animated.Text style={[styles.version, { opacity: btnFade }]}>
        v1.1.1 // secure link
      </Animated.Text>
    </ScreenShell>
  );
}

const styles = StyleSheet.create({
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
    fontSize: 14,
    color: colors.textMuted,
    marginBottom: 36,
    textAlign: "center",
    fontFamily: mono,
  },
  subtitlePrefix: {
    color: colors.primaryDim,
  },
  input: {
    backgroundColor: colors.surface,
    color: colors.text,
    fontSize: font.lg,
    padding: 14,
    borderRadius: radius.lg,
    width: 260,
    textAlign: "center",
    marginBottom: spacing.xxl,
    borderWidth: 1,
    borderColor: colors.border,
  },
  authBtn: {
    backgroundColor: colors.primary,
    paddingHorizontal: 56,
    paddingVertical: spacing.lg,
    borderRadius: radius.lg,
  },
  authBtnDisabled: { opacity: 0.4 },
  authBtnPressed: { opacity: 0.85, transform: [{ scale: 0.97 }] },
  authText: {
    color: colors.bg,
    fontSize: font.lg,
    fontWeight: "700",
    textAlign: "center",
  },
  errorRow: {
    flexDirection: "row",
    alignItems: "center",
    gap: spacing.sm,
    marginTop: spacing.lg,
    paddingHorizontal: spacing.lg,
    paddingVertical: spacing.sm,
    backgroundColor: "rgba(239,83,80,0.1)",
    borderRadius: radius.md,
    borderWidth: 1,
    borderColor: "rgba(239,83,80,0.25)",
  },
  errorText: {
    color: colors.danger,
    fontSize: font.xs,
    fontFamily: mono,
    fontWeight: "600",
    flex: 1,
  },
  version: {
    color: colors.textDim,
    fontSize: font.xs,
    fontFamily: mono,
    marginTop: spacing.xxl,
    letterSpacing: 1,
  },
});
