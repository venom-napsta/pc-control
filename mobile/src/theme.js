import { Platform } from "react-native";

export const colors = {
  primary: "#00D9C4",           // luminous cyan-teal — Spindle bright end
  primaryDark: "#00A896",       // rich deep teal
  primaryDim: "#094A52",        // muted teal for subtle elements
  primaryGhost: "rgba(0,217,196,0.10)", // soft teal glow
  danger: "#EF5350",
  warning: "#FF9800",
  success: "#4CAF50",
  purple: "#9C27B0",
  blue: "#5C7CF5",              // indigo-blue — Spindle wireframe accent
  yellow: "#FFEB3B",

  bg: "#0B1420",                // deep navy-black
  surface: "#111D2B",           // dark navy surface
  surfaceHi: "#182A3A",        // elevated navy
  border: "#1A3444",            // subtle navy-teal edge

  text: "#FFFFFF",
  textMuted: "#5E8899",         // cool blue-teal muted
  textDim: "#2A3D4A",          // navy dim
};

export const spacing = {
  xs: 4,
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  xxl: 24,
  xxxl: 32,
  huge: 40,
};

export const radius = {
  sm: 8,
  md: 12,
  lg: 16,
  xl: 20,
  pill: 999,
};

export const font = {
  xs: 11,
  sm: 13,
  md: 15,
  lg: 16,
  xl: 20,
  xxl: 28,
  hero: 48,
};

export const mono = Platform.OS === "ios" ? "Menlo" : "monospace";
