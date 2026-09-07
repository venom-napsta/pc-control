import { formatBytes } from "./format";

// mime -> extension, limited to what the PC's clipboard can actually take.
// GPaste hands the file to GdkPixbuf, and the server sniffs the same set from
// the bytes, so anything outside this list is refused before it leaves the
// phone rather than after a pointless upload.
const MIME_EXT: Record<string, string> = {
  "image/png": "png",
  "image/jpeg": "jpg",
  "image/jpg": "jpg",
  "image/gif": "gif",
  "image/webp": "webp",
  "image/bmp": "bmp",
  "image/tiff": "tiff",
};

export function imageExtension(mime: unknown): string | null {
  return MIME_EXT[String(mime ?? "").toLowerCase().trim()] ?? null;
}

export function isSupportedImage(mime: unknown): boolean {
  return imageExtension(mime) !== null;
}

export interface DataUriParts {
  mime: string;
  base64: string;
}

// expo-clipboard returns a whole data URI ("data:image/png;base64,iVBOR…"),
// but writeAsStringAsync wants the payload on its own and the file needs a name
// derived from the mime — so split the two apart rather than trusting either.
export function splitDataUri(dataUri: unknown): DataUriParts | null {
  const m = /^data:([^;,]+)(?:;[^,]*)?;base64,(.*)$/s.exec(String(dataUri ?? ""));
  if (!m) return null;
  const base64 = m[2].trim();
  if (!base64) return null;
  return { mime: m[1].toLowerCase(), base64 };
}

// Byte count for a base64 payload, so an image can be measured and rejected
// before it is written to disk: 4 characters carry 3 bytes, less the padding.
export function base64Bytes(base64: unknown): number {
  const s = String(base64 ?? "").replace(/\s/g, "");
  if (!s) return 0;
  const pad = (s.match(/=+$/) ?? [""])[0].length;
  return Math.max(0, Math.floor((s.length * 3) / 4) - pad);
}

// "clipboard-20260907-165430.png" — a timestamp, because a clipboard image has
// no name of its own and the PC must not have to invent one.
export function imageFileName(mime: unknown, at: Date = new Date()): string {
  const ext = imageExtension(mime) ?? "png";
  const p = (n: number) => String(n).padStart(2, "0");
  const day = `${at.getFullYear()}${p(at.getMonth() + 1)}${p(at.getDate())}`;
  const time = `${p(at.getHours())}${p(at.getMinutes())}${p(at.getSeconds())}`;
  return `clipboard-${day}-${time}.${ext}`;
}

export interface ImageMeta {
  width?: unknown;
  height?: unknown;
  size?: unknown;
}

// "1080 × 2400  ·  1.2 MB", dropping whichever half is unknown.
export function describeImage({ width, height, size }: ImageMeta = {}): string {
  const parts: string[] = [];
  const w = Number(width);
  const h = Number(height);
  if (Number.isFinite(w) && w > 0 && Number.isFinite(h) && h > 0) {
    parts.push(`${Math.round(w)} × ${Math.round(h)}`);
  }
  const n = Number(size);
  if (Number.isFinite(n) && n > 0) parts.push(formatBytes(n));
  return parts.join("  ·  ");
}
