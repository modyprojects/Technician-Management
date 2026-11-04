// Grid and label helpers of the technician calendar screens ("היומן שלי", docs/demo.html
// techCalendar() L603-643; TE-27). The date helpers themselves (day names, addDays, ddmm, the arrows'
// shiftCalendarDate and their names) are the shared set in features/calendar/data/dates.ts.
// No data and no clock: "today" always comes from the caller (G-01). Dates are "YYYY-MM-DD",
// times "HH:MM".
import { addDays, dayName, ddmm, monthLabel, pad, toMinutes, weekdayOf, weekStartOf } from "@/features/calendar/data/dates";
import type { CalendarView } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";

/** The grid of the day and week views: 08:00 to 18:00 (the demo's field day). */
export const GRID_START_MIN = 8 * 60;
export const GRID_END_MIN = 18 * 60;
export const GRID_HOURS = (GRID_END_MIN - GRID_START_MIN) / 60;

/** "08:00" for the 0-based hour row of the grid. */
export const gridHourLabel = (row: number): string => `${pad(GRID_START_MIN / 60 + row)}:00`;

/**
 * A visit's place on the 08:00-18:00 grid, in minutes from 08:00. A visit outside the grid is
 * clamped to its edge (at least 30 minutes tall), so it is never hidden. (The office day grid
 * widens instead, components/office/CalendarParts hourRange: its columns have room to grow.)
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
