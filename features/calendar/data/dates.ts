// Pure calendar date helpers: the one set shared by the office "יומן טכנאים" (OF-03), the
// technician's "היומן שלי" (TE-27), the closed-visit views and the demo fixtures
// (app/dev/demo/_data/dates.ts re-exports them). Ported from docs/demo.html "helpers" (L238-252)
// and its calDay / calShift actions.
// No data and no clock: "today" always comes from the caller (G-01: production passes the current
// date in Asia/Jerusalem). Dates are "YYYY-MM-DD" strings computed at UTC noon, so the result never
// depends on the server or browser time zone. Times are "HH:MM".
import type { HourMinute, IsoDate } from "@/features/data-access/common";
import type { CalendarView, YearMonth } from "./types";

/** The demo's DAYS (Sunday first). */
export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
/** The demo's DAYS_S. */
export const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;
export const MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

/** Two-digit zero padding. */
export const pad = (n: number): string => String(n).padStart(2, "0");

const at = (s: IsoDate): Date => new Date(`${s}T12:00:00Z`);
const iso = (d: Date): IsoDate => `${d.getUTCFullYear()}-${pad(d.getUTCMonth() + 1)}-${pad(d.getUTCDate())}`;

/** `s` plus `n` days (negative goes back). */
export function addDays(s: IsoDate, n: number): IsoDate {
  const d = at(s);
  d.setUTCDate(d.getUTCDate() + n);
  return iso(d);
}

/** Day of week, 0 = Sunday. */
export const weekdayOf = (s: IsoDate): number => at(s).getUTCDay();

/** Work day: Sunday to Thursday (the demo's isWork). */
export const isWorkDay = (s: IsoDate): boolean => weekdayOf(s) <= 4;

/** Sunday of the week of `s` (the demo's weekStart). */
export const weekStartOf = (s: IsoDate): IsoDate => addDays(s, -weekdayOf(s));

/** The next (`dir` 1) or previous (`dir` -1) work day, Friday and Saturday skipped. */
export function shiftWorkDay(s: IsoDate, dir: 1 | -1): IsoDate {
  let d = addDays(s, dir);
  while (!isWorkDay(d)) d = addDays(d, dir);
  return d;
}

/** "21.10" (the demo's ddmm). */
export const ddmm = (s: IsoDate): string => `${s.slice(8, 10)}.${s.slice(5, 7)}`;

/** "רביעי". */
export const dayName = (s: IsoDate): string => DAY_NAMES[weekdayOf(s)] ?? "";

/** "ד׳". */
export const dayShort = (s: IsoDate): string => DAY_SHORT[weekdayOf(s)] ?? "";

/** 21 for "2026-10-21". */
export const dayOfMonth = (s: IsoDate): number => Number(s.slice(8, 10));

/** "אוקטובר" for "2026-10". */
export const monthName = (month: YearMonth): string => MONTH_NAMES[Number(month.slice(5, 7)) - 1] ?? "";

/** "אוקטובר 2026". */
export const monthLabel = (month: YearMonth): string => `${monthName(month)} ${month.slice(0, 4)}`;

/** "HH:MM" → minutes since midnight (0 for a malformed value). */
export function toMinutes(t: HourMinute): number {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return Number.isFinite(h) && Number.isFinite(m) ? h * 60 + m : 0;
}

/** Minutes since midnight → "HH:MM". */
export const fromMinutes = (m: number): HourMinute => `${pad(Math.floor(m / 60))}:${pad(m % 60)}`;

/** "ביקור אחד" / "3 ביקורים" (the demo always wrote "N ביקורים"). */
export const visitCountLabel = (n: number): string => (n === 1 ? "ביקור אחד" : `${n} ביקורים`);

/**
 * Accessible names of the previous / next arrows, the same in both calendars. The day arrows say
 * "יום העבודה" because they skip Friday and Saturday (and so "היום הבא" is not confused with the
 * "היום" control).
 */
export const CALENDAR_SHIFT_LABELS: Record<CalendarView, { prev: string; next: string }> = {
  day: { prev: "יום העבודה הקודם", next: "יום העבודה הבא" },
  week: { prev: "השבוע הקודם", next: "השבוע הבא" },
  month: { prev: "החודש הקודם", next: "החודש הבא" },
};

/**
 * The date the previous (`dir` -1) or next (`dir` 1) arrow opens, in both calendars (the demo's
 * calDay / calShift): the previous or next work day (Friday and Saturday skipped), the same weekday
 * a week earlier or later, or the neighbouring month. The demo's month view had data for October
 * only and refused to move; with dynamic dates (TE-27, G-01) it moves to the neighbouring month: to
 * `today` when that is the month of today, otherwise to the month's first work day, so a switch to
 * the day view never lands on a weekend.
 */
export function shiftCalendarDate(view: CalendarView, date: IsoDate, dir: 1 | -1, today: IsoDate): IsoDate {
  if (view === "week") return addDays(date, 7 * dir);
  if (view === "day") return shiftWorkDay(date, dir);
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + dir;
  const month = `${y + Math.floor(m / 12)}-${pad((((m % 12) + 12) % 12) + 1)}`;
  if (today.startsWith(`${month}-`)) return today;
  let d = `${month}-01`;
  while (!isWorkDay(d)) d = addDays(d, 1);
  return d;
}
