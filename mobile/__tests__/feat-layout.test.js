import {
  classifyWindow, columnsFor, loginChrome,
  CONTENT_MAX_WIDTH, CONTENT_MAX_WIDTH_WIDE, TAB_BAR_MAX_WIDTH,
  TABLET_MIN_SHORT_SIDE,
} from "../src/layout";

// Only a tablet held in landscape has the width for two columns; a portrait
// tablet is about as wide as a phone in landscape, and gets one.
describe("columnsFor", () => {
  test.each([
    [{ isTablet: true, isLandscape: true }, 2],
    [{ isTablet: true, isLandscape: false }, 1],
    [{ isTablet: false, isLandscape: true }, 1],
    [{ isTablet: false, isLandscape: false }, 1],
  ])("%p -> %p columns", (input, expected) => {
    expect(columnsFor(input)).toBe(expected);
  });
});

describe("classifyWindow columns", () => {
  test("a landscape tablet gets two columns and the wider cap", () => {
    expect(classifyWindow({ width: 1280, height: 800 })).toEqual({
      isTablet: true,
      isLandscape: true,
      columns: 2,
      contentMaxWidth: CONTENT_MAX_WIDTH_WIDE,
      tabBarMaxWidth: TAB_BAR_MAX_WIDTH,
    });
  });

  test("a portrait tablet stays single column on the narrower cap", () => {
    expect(classifyWindow({ width: 800, height: 1280 })).toMatchObject({
      columns: 1,
      contentMaxWidth: CONTENT_MAX_WIDTH,
    });
  });

  test.each([
    ["phone portrait", 390, 844],
    ["phone landscape", 844, 390],
    ["a small foldable landscape", 720, 540],
  ])("%s stays single column with no cap", (_label, width, height) => {
    expect(classifyWindow({ width, height })).toMatchObject({
      columns: 1,
      contentMaxWidth: null,
      tabBarMaxWidth: null,
    });
  });

  test("two columns are only worth having with room for both", () => {
    expect(CONTENT_MAX_WIDTH_WIDE).toBeGreaterThan(CONTENT_MAX_WIDTH);
    // Each of two 48% columns still clears the single-column phone width.
    expect(CONTENT_MAX_WIDTH_WIDE * 0.48).toBeGreaterThan(390);
  });

  test("the tablet boundary decides which cap applies, in landscape", () => {
    const short = TABLET_MIN_SHORT_SIDE;
    expect(classifyWindow({ width: 1000, height: short })).toMatchObject({
      columns: 2, contentMaxWidth: CONTENT_MAX_WIDTH_WIDE,
    });
    expect(classifyWindow({ width: 1000, height: short - 1 })).toMatchObject({
      columns: 1, contentMaxWidth: null,
    });
  });

  test("an exactly square window is not landscape, so it stays one column", () => {
    expect(classifyWindow({ width: 900, height: 900 })).toMatchObject({
      isTablet: true, isLandscape: false, columns: 1, contentMaxWidth: CONTENT_MAX_WIDTH,
    });
  });
});


// ── loginChrome ─────────────────────────────────────────

describe("loginChrome", () => {
  test("a resting screen is centred with its decoration", () => {
    expect(loginChrome({ keyboardVisible: false, isLandscape: false }))
      .toEqual({ centered: true, showOrbit: true });
    expect(loginChrome({ keyboardVisible: false, isLandscape: true }))
      .toEqual({ centered: true, showOrbit: true });
  });

  test("an open keyboard stops the form being centred", () => {
    // Centred plus a keyboard is what put the password field off screen.
    expect(loginChrome({ keyboardVisible: true, isLandscape: false }).centered).toBe(false);
    expect(loginChrome({ keyboardVisible: true, isLandscape: true }).centered).toBe(false);
  });

  test("landscape also gives up the orbit rings, portrait keeps them", () => {
    // Landscape has the least height to spare once the keyboard is up.
    expect(loginChrome({ keyboardVisible: true, isLandscape: true }).showOrbit).toBe(false);
    expect(loginChrome({ keyboardVisible: true, isLandscape: false }).showOrbit).toBe(true);
  });
});
