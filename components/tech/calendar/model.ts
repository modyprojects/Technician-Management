import { addDays, weekStartOf } from "@/features/calendar/data/dates";
import type { IsoDate } from "@/features/data-access/common";
import type { CalDay, CalVisit, TechCalView } from "./types";

// The technician calendar's rules (D85, D89, D79), pure: "today" always comes from the caller
// (production: the Asia/Jerusalem date of the request, features/visits/data/today.ts). Unit-tested in
// tests/e2e/tech-calendar-logic.spec.ts.
// - Weekly: a calendar week, Sunday to Saturday; the current week and the next only (D89 (a)).
// - Daily: today and the next 6 days, no past days (D85 (c), D89 (c)).
// - Past days of the current week: only visits closed on them, in the reduced view; a visit left
//   open on a previous day is not shown (D79 (1), D89 (b)).

/** The days the calendar reads: Sunday of the current week to Saturday of the next (14 days). */
export function calendarWindow(today: IsoDate): { from: IsoDate; to: IsoDate } {
  const from = weekStartOf(today);
  return { from, to: addDays(from, 13) };
}

const isClosed = (v: Pick<CalVisit, "status">): boolean => v.status === "done" || v.status === "cont";

/**
 * Whether a visit is shown at all: never a cancelled one (D60 (1)); on a day before today only a
 * closed one (D79 (1)); everything else on today and later days.
 */
export function isShown(v: Pick<CalVisit, "date" | "status">, today: IsoDate): boolean {
  if (v.status === "cancel") return false;
  return v.date >= today || isClosed(v);
}

/** The 14 days of the window, each with its shown visits in start order. */
export function calendarDays(visits: readonly CalVisit[], today: IsoDate): CalDay[] {
  const { from } = calendarWindow(today);
  const days: CalDay[] = Array.from({ length: 14 }, (_, i) => ({ date: addDays(from, i), visits: [] }));
  const byDate = new Map(days.map((d) => [d.date, d]));
  for (const v of visits) {
    if (!isShown(v, today)) continue;
    byDate.get(v.date)?.visits.push(v);
  }
  for (const d of days) d.visits.sort((a, b) => (a.start < b.start ? -1 : a.start > b.start ? 1 : 0));
  return days;
}

export type CalendarModel = {
  view: TechCalView;
  /** Daily: the selected day (today .. today + 6). */
  date: IsoDate;
  strip: CalDay[];
  day: CalDay;
  /** Weekly: the shown week's Sunday, its 7 days, and whether it is the next week. */
  weekStart: IsoDate;
  week: CalDay[];
  isNextWeek: boolean;
  thisWeek: IsoDate;
  nextWeek: IsoDate;
  lastStripDay: IsoDate;
};

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/**
 * The calendar for `?view=&date=` (anything else falls back to the daily view of today). A date
 * outside the daily strip selects today; a weekly date selects the next week only when it falls in
 * it, else the current week.
 */
export function calendarModel(params: { view?: string; date?: string }, today: IsoDate, visits: readonly CalVisit[]): CalendarModel {
  const all = calendarDays(visits, today);
  const view: TechCalView = params.view === "week" ? "week" : "day";
  const wanted = params.date && ISO.test(params.date) ? params.date : today;

  const lastStripDay = addDays(today, 6);
  const strip = all.filter((d) => d.date >= today && d.date <= lastStripDay);
  const date = strip.some((d) => d.date === wanted) ? wanted : today;
  const day = strip.find((d) => d.date === date) ?? { date, visits: [] };

  const thisWeek = weekStartOf(today);
  const nextWeek = addDays(thisWeek, 7);
  const isNextWeek = weekStartOf(wanted) === nextWeek;
  const weekStart = isNextWeek ? nextWeek : thisWeek;
  const week = all.filter((d) => d.date >= weekStart && d.date <= addDays(weekStart, 6));
  return { view, date, strip, day, weekStart, week, isNextWeek, thisWeek, nextWeek, lastStripDay };
}
