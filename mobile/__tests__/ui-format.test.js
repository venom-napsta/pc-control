import { formatBytes } from "../src/format";

describe("formatBytes", () => {
  test.each([
    [0, "0 B"],
    [512, "512 B"],
    [1023, "1023 B"],
    [1024, "1.0 KB"],
    [1536, "1.5 KB"],
    [1048576, "1.0 MB"],
    [1073741824, "1.0 GB"],
    [1099511627776, "1.0 TB"],
  ])("%p -> %p", (input, expected) => {
    expect(formatBytes(input)).toBe(expected);
  });

  test("stays in TB rather than inventing a larger unit", () => {
    expect(formatBytes(1024 * 1099511627776)).toBe("1024.0 TB");
  });

  test("per-second variant appends a rate suffix", () => {
    expect(formatBytes(1536, { perSecond: true })).toBe("1.5 KB/s");
    expect(formatBytes(0, { perSecond: true })).toBe("0 B/s");
  });

  test.each([undefined, null, NaN, Infinity, -5, "abc", {}])(
    "non-numeric or negative input %p formats as zero",
    (bad) => {
      expect(formatBytes(bad)).toBe("0 B");
    },
  );

  test("numeric strings are accepted", () => {
    expect(formatBytes("2048")).toBe("2.0 KB");
  });
});
