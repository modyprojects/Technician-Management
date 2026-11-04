// Calendar URL state ↔ query arguments. Pure: used by the calendar pages on the server (to query
// the layer) and by the browser (to build links), so a Supabase adapter receives exactly the same
// arguments. Unknown or malformed values fall back to the defaults.
//   Office:     ?view=day|week|month&date=YYYY-MM-DD&tech=<id>&req=<request>&n=<visit>  (req+n = open drawer)
//   Technician: ?view=day|week|month&date=YYYY-MM-DD
import { clampInt, isIsoDate, isRecordKey, type IsoDate } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import { isTechnicianId } from "@/features/reference/data/validate";
import type { VisitRef } from "@/features/visits/data/types";
import { isCalendarView, type CalendarView, type OfficeCalendarFilter } from "./types";

export const ALL = "all";

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const reader = (sp: SearchParamsLike | URLSearchParams) => (k: string) =>
  sp instanceof URLSearchParams ? (sp.get(k) ?? undefined) : first(sp[k]);

/** What the technician calendar shows. */
export type TechCalendarState = {
  view: CalendarView;
  /** The chosen day (day view), a day of the week (week view) or of the month (month view). */
  date: IsoDate;
};

/** What the office calendar shows. */
export type OfficeCalendarState = TechCalendarState & {
  /** "all" or one technician id (filter chips). */
  tech: typeof ALL | TechnicianId;
  /** The visit whose drawer is open; null when closed. */
  visit: VisitRef | null;
};

export function parseTechCalendarState(sp: SearchParamsLike | URLSearchParams, today: IsoDate): TechCalendarState {
  const get = reader(sp);
  const view = get("view");
  const date = get("date");
  return { view: isCalendarView(view) ? view : "day", date: isIsoDate(date) ? date : today };
}

export function parseOfficeCalendarState(sp: SearchParamsLike | URLSearchParams, today: IsoDate): OfficeCalendarState {
  const get = reader(sp);
  const tech = get("tech");
  const req = get("req");
  const n = clampInt(get("n"), 0, 999, 0);
  return {
    ...parseTechCalendarState(sp, today),
    tech: tech && tech !== ALL && isTechnicianId(tech) ? tech : ALL,
    visit: isRecordKey(req) && n >= 1 ? { req, n } : null,
  };
}

/** The filter the layer receives for this state. */
export const officeCalendarFilterOf = (state: Pick<OfficeCalendarState, "tech">): OfficeCalendarFilter => ({
  technicianId: state.tech === ALL ? undefined : state.tech,
});

function viewParams(state: Partial<TechCalendarState>): URLSearchParams {
  const sp = new URLSearchParams();
  if (state.view && state.view !== "day" && isCalendarView(state.view)) sp.set("view", state.view);
  if (isIsoDate(state.date)) sp.set("date", state.date);
  return sp;
}

const withQuery = (pathname: string, sp: URLSearchParams): string => {
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
};

/** `pathname?view=…&date=…` with defaults (day view, no date) left out. */
export const techCalendarHref = (pathname: string, state: Partial<TechCalendarState> = {}): string =>
  withQuery(pathname, viewParams(state));

/** `pathname?view=…&date=…&tech=…&req=…&n=…` with defaults (day view, no date, every technician, drawer closed) left out. */
export function officeCalendarHref(pathname: string, state: Partial<OfficeCalendarState> = {}): string {
  const sp = viewParams(state);
  if (state.tech && state.tech !== ALL && isTechnicianId(state.tech)) sp.set("tech", state.tech);
  const v = state.visit;
  if (v && isRecordKey(v.req) && Number.isInteger(v.n) && v.n >= 1 && v.n <= 999) {
    sp.set("req", v.req);
    sp.set("n", String(v.n));
  }
  return withQuery(pathname, sp);
}
