// Asia/Jerusalem time helpers of the manager dashboard (D57; docs/design/manager-dashboard-spec.md
// §4.2: "Use the Asia/Jerusalem timezone when determining today's operational date"). Pure: `Intl`
// only, no data and no clock (the caller passes `now`, G-01). Timestamps are compared as instants,
// so durations stay correct across midnight and the daylight-saving changes; only the calendar
// date, month and clock time are read in Asia/Jerusalem.
import { isIsoDate, type HourMinute, type IsoDate, type IsoTimestamp } from "@/features/data-access/common";
import type { YearMonth } from "@/features/calendar/data/types";

export const JERUSALEM = "Asia/Jerusalem";

const PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: JERUSALEM,
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

const OFFSET = new Intl.DateTimeFormat("en-US", { timeZone: JERUSALEM, timeZoneName: "longOffset" });

/** An instant with an explicit offset: "2026-10-21T12:45:00+03:00", "…Z", seconds and milliseconds optional. */
const ISO_INSTANT = /^(\d{4}-\d{2}-\d{2})T([01]\d|2[0-3]):[0-5]\d(:[0-5]\d(\.\d{1,3})?)?(Z|[+-](0\d|1[0-4]):[0-5]\d)$/;

/**
 * Whether `value` is an ISO 8601 instant with an explicit offset (never a local time, whose meaning
 * would depend on the server's time zone) on a date that exists.
 */
export function isIsoInstant(value: unknown): value is IsoTimestamp {
  if (typeof value !== "string") return false;
  const m = ISO_INSTANT.exec(value);
  return m !== null && isIsoDate(m[1]) && !Number.isNaN(Date.parse(value));
}

/** Milliseconds since the epoch, or null for anything that is not an ISO instant. */
export function instantMs(iso: string | null | undefined): number | null {
  return isIsoInstant(iso) ? Date.parse(iso) : null;
}

function partsOf(iso: string | null | undefined): Record<string, string> | null {
  const ms = instantMs(iso);
  if (ms === null) return null;
  return Object.fromEntries(PARTS.formatToParts(ms).map((p) => [p.type, p.value]));
}

/** The Asia/Jerusalem calendar date of an instant ("2026-10-21"); null when invalid. */
export function jerusalemDate(iso: string | null | undefined): IsoDate | null {
  const p = partsOf(iso);
  return p ? `${p.year}-${p.month}-${p.day}` : null;
}

/** The Asia/Jerusalem month of an instant ("2026-10"); null when invalid. */
export function jerusalemMonth(iso: string | null | undefined): YearMonth | null {
  return jerusalemDate(iso)?.slice(0, 7) ?? null;
}

/** The Asia/Jerusalem clock time of an instant ("12:45"); null when invalid. */
export function jerusalemTime(iso: string | null | undefined): HourMinute | null {
  const p = partsOf(iso);
  return p ? `${p.hour}:${p.minute}` : null;
}

/** Minutes from `a` to `b` (negative when `b` is earlier); null when either is missing or invalid. */
export function minutesBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const x = instantMs(a);
  const y = instantMs(b);
  return x === null || y === null ? null : (y - x) / 60_000;
}

/** Hours from `a` to `b` (negative when `b` is earlier); null when either is missing or invalid. */
export function hoursBetween(a: string | null | undefined, b: string | null | undefined): number | null {
  const m = minutesBetween(a, b);
  return m === null ? null : m / 60;
}

/** Asia/Jerusalem offset from UTC at an instant, in minutes (+180 in summer, +120 in winter). */
function offsetMinutesAt(ms: number): number {
  const name = OFFSET.formatToParts(ms).find((p) => p.type === "timeZoneName")?.value ?? "GMT";
  const m = /^GMT(?:([+-])(\d{1,2})(?::?(\d{2}))?)?$/.exec(name);
  if (!m || !m[1]) return 0;
  return (m[1] === "-" ? -1 : 1) * (Number(m[2]) * 60 + Number(m[3] ?? 0));
}

const pad2 = (n: number): string => String(n).padStart(2, "0");

/**
 * The instant of a local Asia/Jerusalem date and time, as ISO with that date's offset
 * ("2026-10-21T12:45:00+03:00", "2027-01-10T08:00:00+02:00"). The offset comes from `Intl`, never a
 * hard-coded "+03:00". A local time inside the spring-forward gap resolves to the later offset.
 */
export function atJerusalem(date: IsoDate, hm: HourMinute): IsoTimestamp {
  const [y = 0, mo = 1, d = 1] = date.split("-").map(Number);
  const [h = 0, mi = 0] = hm.split(":").map(Number);
  const localAsUtc = Date.UTC(y, mo - 1, d, h, mi);
  // Two passes: the offset at a guess of the instant, then at the instant that offset gives.
  let offset = offsetMinutesAt(localAsUtc - 120 * 60_000);
  offset = offsetMinutesAt(localAsUtc - offset * 60_000);
  const sign = offset < 0 ? "-" : "+";
  const abs = Math.abs(offset);
  return `${date}T${pad2(h)}:${pad2(mi)}:00${sign}${pad2(Math.floor(abs / 60))}:${pad2(abs % 60)}`;
}
