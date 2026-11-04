// FICTITIOUS DATA ONLY: demo calendar helpers. Allowed only under app/dev (G-05).
// Ported from docs/demo.html "helpers" (L238-252). The demo's date is fixed (G-01: production
// uses dynamic dates in Asia/Jerusalem). Dates are "YYYY-MM-DD" strings, times "HH:MM".
// Calculations use UTC noon, so the result never depends on the server or browser time zone.

/** The demo's "today" (Wednesday 21.10.2026). */
export const TODAY = "2026-10-21";

export const DAYS = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
export const DAYS_S = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;
export const MONTHS = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

/** Two-digit zero padding. */
export const pad = (n: number): string => String(n).padStart(2, "0");

/** "HH:MM" → minutes since midnight. */
export function toMin(t: string): number {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
}

/** Minutes since midnight → "HH:MM". */
export const fromMin = (m: number): string => pad(Math.floor(m / 60)) + ":" + pad(m % 60);

const D = (s: string): Date => new Date(s + "T12:00:00Z");
const iso = (d: Date): string => d.getUTCFullYear() + "-" + pad(d.getUTCMonth() + 1) + "-" + pad(d.getUTCDate());

/** Date string plus `n` days (negative goes back). */
export function addDays(s: string, n: number): string {
  const d = D(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Day of week, 0 = Sunday. */
export const weekday = (s: string): number => D(s).getUTCDay();

/** "21.10" (the demo's day.month). */
export const ddmm = (s: string): string => s.slice(8) + "." + s.slice(5, 7);

/** "רביעי". */
export const dayName = (s: string): string => DAYS[weekday(s)] ?? "";

/** "ד׳". */
export const dayShort = (s: string): string => DAYS_S[weekday(s)] ?? "";

/** Work day: Sunday to Thursday (the demo's isWork). */
export const isWork = (s: string): boolean => weekday(s) <= 4;

/** Sunday of the week of `s` (the demo's weekStart). */
export const weekStart = (s: string): string => addDays(s, -weekday(s));

/** Next (`dir` 1) or previous (`dir` -1) work day, skipping Friday and Saturday. */
export function shiftWorkDay(s: string, dir: 1 | -1): string {
  let d = addDays(s, dir);
  while (!isWork(d)) d = addDays(d, dir);
  return d;
}

/** "היום" for TODAY, otherwise "21.10" (calls list, call card). */
export const dayLabel = (s: string): string => (s === TODAY ? "היום" : ddmm(s));

/** "רביעי 21.10". */
export const dayAndDate = (s: string): string => `${dayName(s)} ${ddmm(s)}`;

/** Whole days from `a` to `b` (b - a). */
export const daysBetween = (a: string, b: string): number => Math.round((D(b).getTime() - D(a).getTime()) / 864e5);

/** Recording length in seconds → "1:05". */
export const recLabel = (sec: number): string => `${Math.floor(sec / 60)}:${pad(sec % 60)}`;

/** Current clock time "HH:MM" for simulated actions. Client-side only (never during render). */
export function nowHM(): string {
  const d = new Date();
  return pad(d.getHours()) + ":" + pad(d.getMinutes());
}

const JERUSALEM_PARTS = new Intl.DateTimeFormat("en-CA", {
  timeZone: "Asia/Jerusalem",
  year: "numeric",
  month: "2-digit",
  day: "2-digit",
  hour: "2-digit",
  minute: "2-digit",
  hourCycle: "h23",
});

/** ISO timestamp → local date "YYYY-MM-DD" and time "HH:MM" in Asia/Jerusalem (G-01); null if invalid. */
export function jerusalemDateTime(iso: string): { date: string; time: string } | null {
  const ms = Date.parse(iso);
  if (Number.isNaN(ms)) return null;
  const p = Object.fromEntries(JERUSALEM_PARTS.formatToParts(ms).map((x) => [x.type, x.value]));
  return { date: `${p.year}-${p.month}-${p.day}`, time: `${p.hour}:${p.minute}` };
}

/** Notification time (AppNotification.time, ISO) as the demo shows it: "היום 09:10", "אתמול 17:05" or "19.10 08:00". */
export function notificationTimeLabel(iso: string): string {
  const local = jerusalemDateTime(iso);
  if (!local) return "";
  const day = local.date === TODAY ? "היום" : local.date === addDays(TODAY, -1) ? "אתמול" : ddmm(local.date);
  return `${day} ${local.time}`;
}
