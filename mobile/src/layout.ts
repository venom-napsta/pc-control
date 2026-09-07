import { useWindowDimensions } from "react-native";

// Android's own tablet threshold is a 600dp short side (sw600dp).
export const TABLET_MIN_SHORT_SIDE = 600;
// Cap content width on tablets so a 13" landscape screen does not stretch a
// phone layout edge to edge.
export const CONTENT_MAX_WIDTH = 720;
// A two-column layout needs roughly two single-column widths to breathe, so
// the cap is raised when the window is wide enough to hold both.
export const CONTENT_MAX_WIDTH_WIDE = 1040;
export const TAB_BAR_MAX_WIDTH = 560;

export interface WindowSize {
  width: number;
  height: number;
}

export interface WindowClass {
  isTablet: boolean;
  isLandscape: boolean;
  columns: 1 | 2;
  contentMaxWidth: number | null;
  tabBarMaxWidth: number | null;
}

// Number of content columns a screen should lay itself out in. Only a tablet
// in landscape has the width for two; phones and portrait tablets stay at one.
export function columnsFor(
  { isTablet, isLandscape }: { isTablet: boolean; isLandscape: boolean },
): 1 | 2 {
  return isTablet && isLandscape ? 2 : 1;
}

export function classifyWindow({ width, height }: WindowSize): WindowClass {
  const shortSide = Math.min(width, height);
  const isTablet = shortSide >= TABLET_MIN_SHORT_SIDE;
  const isLandscape = width > height;
  const columns = columnsFor({ isTablet, isLandscape });
  return {
    isTablet,
    isLandscape,
    columns,
    contentMaxWidth: isTablet
      ? (columns === 2 ? CONTENT_MAX_WIDTH_WIDE : CONTENT_MAX_WIDTH)
      : null,
    tabBarMaxWidth: isTablet ? TAB_BAR_MAX_WIDTH : null,
  };
}

export interface LoginChrome {
  /** Vertically centre the form. Off once the keyboard needs the room. */
  centered: boolean;
  /** The decorative orbit rings, first thing sacrificed for vertical space. */
  showOrbit: boolean;
}

// What the sign-in screen may afford to show. An open keyboard takes roughly
// half the screen, and in landscape that leaves too little height for a
// centred form -- the password field ends up behind the keyboard. So the form
// moves to the top and the rings go away, rather than relying on the window
// being resized: edge-to-edge Android does not resize it.
export function loginChrome(
  { keyboardVisible, isLandscape }: { keyboardVisible: boolean; isLandscape: boolean },
): LoginChrome {
  if (!keyboardVisible) return { centered: true, showOrbit: true };
  return { centered: false, showOrbit: !isLandscape };
}

// Re-renders on rotation, unlike Dimensions.get().
export function useLayout(): WindowSize & WindowClass {
  const { width, height } = useWindowDimensions();
  return { width, height, ...classifyWindow({ width, height }) };
}
