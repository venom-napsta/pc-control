const UNITS = ["B", "KB", "MB", "GB", "TB"] as const;

export interface FormatBytesOptions {
  perSecond?: boolean;
}

// "512 B", "1.5 KB", "2.0 GB" — or with { perSecond: true } "1.5 KB/s".
// Anything that is not a positive finite number formats as "0 B".
export function formatBytes(bytes: unknown, { perSecond = false }: FormatBytesOptions = {}): string {
  const n = Number(bytes);
  let value = Number.isFinite(n) && n > 0 ? n : 0;
  let unit = 0;
  while (value >= 1024 && unit < UNITS.length - 1) {
    value /= 1024;
    unit += 1;
  }
  const num = unit === 0 ? String(Math.round(value)) : value.toFixed(1);
  return `${num} ${UNITS[unit]}${perSecond ? "/s" : ""}`;
}
