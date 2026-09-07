import {
  imageExtension, isSupportedImage, splitDataUri, base64Bytes, imageFileName, describeImage,
} from "../src/images";

describe("imageExtension", () => {
  test("maps the formats the PC can paste", () => {
    expect(imageExtension("image/png")).toBe("png");
    expect(imageExtension("image/jpeg")).toBe("jpg");
    expect(imageExtension("image/jpg")).toBe("jpg");
    expect(imageExtension("image/gif")).toBe("gif");
    expect(imageExtension("image/webp")).toBe("webp");
    expect(imageExtension("image/bmp")).toBe("bmp");
    expect(imageExtension("image/tiff")).toBe("tiff");
  });

  test("tolerates the casing and padding a picker might hand over", () => {
    expect(imageExtension("IMAGE/PNG")).toBe("png");
    expect(imageExtension("  image/jpeg  ")).toBe("jpg");
  });

  test("refuses anything else, including near-misses", () => {
    // image/svg+xml is an image to a browser but not something GdkPixbuf will
    // put on a clipboard as pixels.
    expect(imageExtension("image/svg+xml")).toBeNull();
    expect(imageExtension("application/pdf")).toBeNull();
    expect(imageExtension("text/plain")).toBeNull();
    expect(imageExtension("")).toBeNull();
    expect(imageExtension(null)).toBeNull();
    expect(imageExtension(undefined)).toBeNull();
  });

  test("isSupportedImage mirrors it", () => {
    expect(isSupportedImage("image/png")).toBe(true);
    expect(isSupportedImage("image/svg+xml")).toBe(false);
    expect(isSupportedImage(undefined)).toBe(false);
  });
});

describe("splitDataUri", () => {
  // expo-clipboard returns the payload already wrapped in a data URI, and
  // writeAsStringAsync needs it unwrapped.
  test("separates the mime from the payload", () => {
    expect(splitDataUri("data:image/png;base64,iVBORw0KGgo=")).toEqual({
      mime: "image/png",
      base64: "iVBORw0KGgo=",
    });
  });

  test("handles jpeg and lowercases the mime", () => {
    expect(splitDataUri("data:IMAGE/JPEG;base64,/9j/4AAQ")).toEqual({
      mime: "image/jpeg",
      base64: "/9j/4AAQ",
    });
  });

  test("survives extra parameters before the base64 marker", () => {
    expect(splitDataUri("data:image/png;charset=utf-8;base64,AAAA")).toEqual({
      mime: "image/png",
      base64: "AAAA",
    });
  });

  test("keeps payloads containing newlines intact", () => {
    const out = splitDataUri("data:image/png;base64,AAAA\nBBBB");
    expect(out.base64).toBe("AAAA\nBBBB");
  });

  test("returns null for anything that is not a base64 data URI", () => {
    expect(splitDataUri("file:///tmp/a.png")).toBeNull();
    expect(splitDataUri("data:image/png,notbase64")).toBeNull();
    expect(splitDataUri("")).toBeNull();
    expect(splitDataUri(null)).toBeNull();
  });

  test("returns null when the payload is empty", () => {
    // A prefix with nothing after it would otherwise write a 0-byte file and
    // fail confusingly at the server's sniff instead of here.
    expect(splitDataUri("data:image/png;base64,")).toBeNull();
    expect(splitDataUri("data:image/png;base64,   ")).toBeNull();
  });
});

describe("base64Bytes", () => {
  test("counts three bytes for every four characters", () => {
    expect(base64Bytes("AAAA")).toBe(3);
    expect(base64Bytes("AAAAAAAA")).toBe(6);
  });

  test("discounts the padding", () => {
    expect(base64Bytes("AAA=")).toBe(2);
    expect(base64Bytes("AA==")).toBe(1);
  });

  test("ignores whitespace and handles nothing at all", () => {
    expect(base64Bytes("AA AA\n")).toBe(3);
    expect(base64Bytes("")).toBe(0);
    expect(base64Bytes(null)).toBe(0);
  });

  test("agrees with a real encoding round-trip", () => {
    const bytes = 300;
    const b64 = globalThis.Buffer.alloc(bytes, 7).toString("base64");
    expect(base64Bytes(b64)).toBe(bytes);
  });
});

describe("imageFileName", () => {
  const at = new Date(2026, 8, 7, 16, 54, 9); // 2026-09-07 16:54:09 local

  test("stamps the time and uses the extension for the mime", () => {
    expect(imageFileName("image/png", at)).toBe("clipboard-20260907-165409.png");
    expect(imageFileName("image/jpeg", at)).toBe("clipboard-20260907-165409.jpg");
  });

  test("zero-pads every field", () => {
    expect(imageFileName("image/png", new Date(2026, 0, 2, 3, 4, 5)))
      .toBe("clipboard-20260102-030405.png");
  });

  test("falls back to png for an unknown mime, rather than no extension", () => {
    expect(imageFileName("application/octet-stream", at)).toBe("clipboard-20260907-165409.png");
    expect(imageFileName(undefined, at)).toBe("clipboard-20260907-165409.png");
  });
});

describe("describeImage", () => {
  test("shows dimensions and size together", () => {
    expect(describeImage({ width: 1080, height: 2400, size: 1536 })).toBe("1080 × 2400  ·  1.5 KB");
  });

  test("drops whichever half is unknown", () => {
    expect(describeImage({ width: 800, height: 600 })).toBe("800 × 600");
    expect(describeImage({ size: 2048 })).toBe("2.0 KB");
    // A picker gives a size but no dimensions; the clipboard gives both.
    expect(describeImage({ width: 800, size: 2048 })).toBe("2.0 KB");
  });

  test("is empty rather than misleading when nothing is known", () => {
    expect(describeImage({})).toBe("");
    expect(describeImage()).toBe("");
    expect(describeImage({ width: 0, height: 0, size: 0 })).toBe("");
    expect(describeImage({ width: NaN, height: NaN, size: NaN })).toBe("");
  });

  test("rounds fractional dimensions", () => {
    expect(describeImage({ width: 100.4, height: 200.6 })).toBe("100 × 201");
  });
});
