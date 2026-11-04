// Pure date helpers of the technician calendar screens ("היומן שלי", docs/demo.html
// techCalendar() L603-643 and its "calShift" / "techCalDay" actions L1136-1137; TE-27).
// No data and no clock: "today" always comes from the caller (G-01: production passes the
// current date in Asia/Jerusalem). Dates are "YYYY-MM-DD" strings, computed at UTC noon so the
// result never depends on the server or browser time zone. Times are "HH:MM".
import type { CalendarView, YearMonth } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";

export const DAY_NAMES = ["ראשון", "שני", "שלישי", "רביעי", "חמישי", "שישי", "שבת"] as const;
export const DAY_SHORT = ["א׳", "ב׳", "ג׳", "ד׳", "ה׳", "ו׳", "ש׳"] as const;
const MONTH_NAMES = [
  "ינואר", "פברואר", "מרץ", "אפריל", "מאי", "יוני",
  "יולי", "אוגוסט", "ספטמבר", "אוקטובר", "נובמבר", "דצמבר",
] as const;

/** The grid of the day and week views: 08:00 to 18:00 (the demo's field day). */
export const GRID_START_MIN = 8 * 60;
export const GRID_END_MIN = 18 * 60;
export const GRID_HOURS = (GRID_END_MIN - GRID_START_MIN) / 60;

const pad = (n: number): string => String(n).padStart(2, "0");
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

/** Sunday of the week of `s`. */
export const weekStartOf = (s: IsoDate): IsoDate => addDays(s, -weekdayOf(s));

/** "21.10". */
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

/** "HH:MM" → minutes since midnight. */
export function toMinutes(t: string): number {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
}

/** "08:00" for the 0-based hour row of the grid. */
export const gridHourLabel = (row: number): string => `${pad(GRID_START_MIN / 60 + row)}:00`;

/**
 * A visit's place on the 08:00-18:00 grid, in minutes from 08:00. A visit outside the grid is
 * clamped to its edge (at least 30 minutes tall), so it is never hidden.
 */
export function gridSpan(start: string, end: string): { from: number; to: number } {
  const span = GRID_END_MIN - GRID_START_MIN;
  const from = Math.min(Math.max(toMinutes(start) - GRID_START_MIN, 0), span - 30);
  const to = Math.min(Math.max(toMinutes(end) - GRID_START_MIN, from + 30), span);
  return { from, to };
}

/** The header label: "רביעי 21.10" (day), "18.10–22.10" (week, Sunday to Thursday), "אוקטובר 2026" (month). */
export function calendarLabel(view: CalendarView, date: IsoDate): string {
  if (view === "day") return `${dayName(date)} ${ddmm(date)}`;
  if (view === "week") {
    const start = weekStartOf(date);
    return `${ddmm(start)}–${ddmm(addDays(start, 4))}`;
  }
  return monthLabel(date.slice(0, 7));
}

/** Accessible names of the "‹" / "›" arrows. */
export const SHIFT_LABELS: Record<CalendarView, { prev: string; next: string }> = {
  day: { prev: "היום הקודם", next: "היום הבא" },
  week: { prev: "השבוע הקודם", next: "השבוע הבא" },
  month: { prev: "החודש הקודם", next: "החודש הבא" },
};

/**
 * The date the "‹" (`dir` -1) or "›" (`dir` 1) arrow opens (the demo's calShift): the previous or
 * next work day (Friday and Saturday skipped), the same weekday a week earlier or later, or the
 * neighbouring month. The demo's month view had data for October only and refused to move;
 * with dynamic dates (TE-27, G-01) it moves to the neighbouring month: to `today` when that is
 * the month of today, otherwise to the month's first work day.
 */
export function shiftCalendarDate(view: CalendarView, date: IsoDate, dir: 1 | -1, today: IsoDate): IsoDate {
  if (view === "week") return addDays(date, 7 * dir);
  if (view === "day") {
    let d = addDays(date, dir);
    while (!isWorkDay(d)) d = addDays(d, dir);
    return d;
  }
  const y = Number(date.slice(0, 4));
  const m = Number(date.slice(5, 7)) - 1 + dir;
  const month = `${y + Math.floor(m / 12)}-${pad((((m % 12) + 12) % 12) + 1)}`;
  if (today.startsWith(`${month}-`)) return today;
  let d = `${month}-01`;
  while (!isWorkDay(d)) d = addDays(d, 1);
  return d;
}

/** The month view's cells: whole weeks from the Sunday on or before the 1st (the demo's 5 rows for October 2026). */
export function monthCells(days: readonly IsoDate[]): { date: IsoDate; inMonth: boolean }[] {
  const first = days[0];
  if (!first) return [];
  const inMonth = new Set(days);
  const lead = weekdayOf(first);
  const count = Math.ceil((lead + days.length) / 7) * 7;
  const start = addDays(first, -lead);
  return Array.from({ length: count }, (_, i) => {
    const date = addDays(start, i);
    return { date, inMonth: inMonth.has(date) };
  });
}

/** "ביקור אחד" / "4 ביקורים" (the demo always wrote "N ביקורים"). */
export const visitsCountLabel = (n: number): string => (n === 1 ? "ביקור אחד" : `${n} ביקורים`);
