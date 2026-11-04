// FICTITIOUS DATA ONLY: the calendar read models (features/calendar/data) over the seeded
// fixtures: the office "יומן טכנאים" (docs/demo.html offCal() L752-802) and the technician's "היומן
// שלי" (techCalendar() L603-643), plus the technician profile's week figures (techProfile()).
// Used only by adapter.ts, which validates the inputs first. Allowed only under app/dev (G-05).
// Cancelled visits are never on a calendar (the demo's inF / myVisits). Every list is bounded.
import "server-only";
import {
  CALENDAR_LANE_LIMIT,
  CALENDAR_WEEK_DAY_LIMIT,
  type NormalizedCalendarFilter,
  type OfficeCalendarDay,
  type OfficeCalendarMonth,
  type OfficeCalendarWeek,
  type TechMonth,
  type TechWeek,
  type YearMonth,
} from "@/features/calendar/data/types";
import { boundedOf, MAX_PAGE_LIMIT, type IsoDate } from "@/features/data-access/common";
import { addDays, toMin, weekStart } from "./dates";
import { calendarVisit, techRef } from "./mappers";
import { ALL_VISITS, laneLayout, visitsForTechOnDate, workWeek, type CallVisit } from "./queries";
import { TECHS } from "./reference";
import type { TechId } from "./types";

/** D47: every demo record is test data, so every calendar includes test data. */
const INCLUDES_TEST_DATA = true;

/** Visits the filter keeps (cancelled never). */
const keep =
  (f: NormalizedCalendarFilter) =>
  (x: CallVisit): boolean =>
    x.v.status !== "cancel" &&
    (f.technicianId === null || x.v.tech === f.technicianId) &&
    (f.statuses.length === 0 || (f.statuses as readonly string[]).includes(x.v.status));

/** Technicians in the filter, Settings order (none for an unknown id). */
const techniciansIn = (f: NormalizedCalendarFilter) =>
  (f.technicianId === null ? TECHS : TECHS.filter((t) => t.id === f.technicianId)).slice(0, MAX_PAGE_LIMIT);

/** By start time, then technician id (the demo's week order). */
const byStartThenTech = (a: CallVisit, b: CallVisit): number => toMin(a.v.start) - toMin(b.v.start) || a.v.tech.localeCompare(b.v.tech);

/** Every date of `month`, in order. */
function daysOfMonth(month: YearMonth): IsoDate[] {
  const out: IsoDate[] = [];
  for (let d = `${month}-01`; d.startsWith(month); d = addDays(d, 1)) out.push(d);
  return out;
}

export function officeDay(date: IsoDate, f: NormalizedCalendarFilter): OfficeCalendarDay {
  const day = ALL_VISITS.filter((x) => x.v.date === date && keep(f)(x));
  const lanes = techniciansIn(f).map((t) => {
    const placed = laneLayout(day.filter((x) => x.v.tech === t.id).map(calendarVisit)).map(({ item, lane, lanes: n }) => ({
      ...item,
      lane,
      lanes: n,
    }));
    return { technician: techRef(t.id), visits: boundedOf(placed, CALENDAR_LANE_LIMIT) };
  });
  return { date, filter: f, includesTestData: INCLUDES_TEST_DATA, lanes, total: day.length };
}

export function officeWeek(weekOf: IsoDate, f: NormalizedCalendarFilter): OfficeCalendarWeek {
  const start = weekStart(weekOf);
  const days = workWeek(start).map((date) => {
    const vs = ALL_VISITS.filter((x) => x.v.date === date && keep(f)(x)).sort(byStartThenTech);
    return { date, visits: boundedOf(vs.map(calendarVisit), CALENDAR_WEEK_DAY_LIMIT) };
  });
  return {
    weekStart: start,
    filter: f,
    includesTestData: INCLUDES_TEST_DATA,
    days,
    total: days.reduce((sum, d) => sum + d.visits.total, 0),
  };
}

export function officeMonth(month: YearMonth, f: NormalizedCalendarFilter): OfficeCalendarMonth {
  const inMonth = ALL_VISITS.filter((x) => x.v.date.startsWith(`${month}-`) && keep(f)(x));
  const techs = techniciansIn(f);
  const days = daysOfMonth(month).map((date) => {
    const vs = inMonth.filter((x) => x.v.date === date);
    return {
      date,
      total: vs.length,
      byTechnician: techs
        .map((t) => ({ technician: { id: t.id, name: t.name, color: t.color }, count: vs.filter((x) => x.v.tech === t.id).length }))
        .filter((row) => row.count > 0),
      followups: vs.filter((x) => x.v.status === "cont").length,
    };
  });
  return { month, filter: f, includesTestData: INCLUDES_TEST_DATA, days, total: inMonth.length };
}

export function techWeek(techId: TechId, weekOf: IsoDate): TechWeek {
  const start = weekStart(weekOf);
  const days = workWeek(start).map((date) => ({
    date,
    visits: boundedOf(visitsForTechOnDate(techId, date).map(calendarVisit), CALENDAR_LANE_LIMIT),
  }));
  return { technician: techRef(techId), weekStart: start, days, total: days.reduce((sum, d) => sum + d.visits.total, 0) };
}

export function techMonth(techId: TechId, month: YearMonth): TechMonth {
  const days = daysOfMonth(month).map((date) => ({ date, count: visitsForTechOnDate(techId, date).length }));
  return { technician: techRef(techId), month, days, total: days.reduce((sum, d) => sum + d.count, 0) };
}

/** The profile's "ביקורים השבוע" and "טופלו" (demo techProfile()), cancelled excluded. */
export function techWeekFigures(techId: TechId, date: IsoDate): { weekStart: IsoDate; visits: number; done: number } {
  const start = weekStart(date);
  const vs = workWeek(start).flatMap((d) => visitsForTechOnDate(techId, d));
  return { weekStart: start, visits: vs.length, done: vs.filter((x) => x.v.status === "done").length };
}
