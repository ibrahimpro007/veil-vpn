/** Formatting helpers (all times are Unix epoch seconds per the spec). */

export function fmtDateTime(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) return "—";
  return new Date(epochSeconds * 1000).toLocaleString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
    hour: "2-digit",
    minute: "2-digit",
  });
}

export function fmtDate(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) return "—";
  return new Date(epochSeconds * 1000).toLocaleDateString(undefined, {
    year: "numeric",
    month: "short",
    day: "numeric",
  });
}

export function fmtMoney(
  cents: number | null | undefined,
  currency?: string | null,
): string {
  if (cents === null || cents === undefined) return "—";
  const cur = (currency ?? "USD").toUpperCase();
  return new Intl.NumberFormat(undefined, {
    style: "currency",
    currency: cur,
  }).format(cents / 100);
}

/** "abc123…" short id for table display. */
export function shortId(id: string, len = 8): string {
  return id.length > len ? `${id.slice(0, len)}…` : id;
}

/** Human "x min ago" for epoch seconds. */
export function timeAgo(epochSeconds: number | null | undefined): string {
  if (epochSeconds === null || epochSeconds === undefined) return "—";
  const s = Math.floor(Date.now() / 1000) - epochSeconds;
  if (s < 60) return `${s}s ago`;
  const m = Math.floor(s / 60);
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  const d = Math.floor(h / 24);
  return `${d}d ago`;
}

/** YYYYMMDD day-granularity integer → readable date (devices.lastSeenDay). */
export function fmtSeenDay(day: number | null | undefined): string {
  if (day === null || day === undefined) return "never";
  const s = String(day);
  if (s.length !== 8) return "—";
  return `${s.slice(0, 4)}-${s.slice(4, 6)}-${s.slice(6, 8)}`;
}

/** Convert a datetime-local input value to epoch seconds. */
export function datetimeLocalToEpoch(value: string): number | undefined {
  if (!value) return undefined;
  const ms = new Date(value).getTime();
  return Number.isNaN(ms) ? undefined : Math.floor(ms / 1000);
}

/** Convert epoch seconds to a datetime-local input value. */
export function epochToDatetimeLocal(
  epochSeconds: number | null | undefined,
): string {
  if (!epochSeconds) return "";
  const d = new Date(epochSeconds * 1000);
  const pad = (n: number) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(
    d.getHours(),
  )}:${pad(d.getMinutes())}`;
}
