import { classifyWindow, CONTENT_MAX_WIDTH, CONTENT_MAX_WIDTH_WIDE, TAB_BAR_MAX_WIDTH } from "../src/layout";

describe("classifyWindow", () => {
  test("phone portrait is not a tablet and gets no width cap", () => {
    expect(classifyWindow({ width: 390, height: 844 })).toEqual({
      isTablet: false, isLandscape: false, columns: 1, contentMaxWidth: null, tabBarMaxWidth: null,
    });
  });
  test("phone landscape is still a phone", () => {
    expect(classifyWindow({ width: 844, height: 390 })).toMatchObject({ isTablet: false, isLandscape: true });
  });
  test("Galaxy Tab S11 portrait is a tablet with capped content", () => {
    expect(classifyWindow({ width: 800, height: 1280 })).toEqual({
      isTablet: true, isLandscape: false, columns: 1, contentMaxWidth: CONTENT_MAX_WIDTH, tabBarMaxWidth: TAB_BAR_MAX_WIDTH,
    });
  });
  test("Galaxy Tab S11 landscape keeps the cap", () => {
    expect(classifyWindow({ width: 1280, height: 800 })).toMatchObject({ isTablet: true, isLandscape: true, contentMaxWidth: CONTENT_MAX_WIDTH_WIDE });
  });
  test("600dp short side is the tablet boundary", () => {
    expect(classifyWindow({ width: 600, height: 900 }).isTablet).toBe(true);
    expect(classifyWindow({ width: 599, height: 900 }).isTablet).toBe(false);
  });
});
