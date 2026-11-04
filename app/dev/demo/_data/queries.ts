// FICTITIOUS DATA ONLY: lookups over the demo's seeded calls. Allowed only under app/dev (G-05).
// Server-side, and only for the fixture adapter (adapter.ts, aggregations.ts, mappers.ts):
// screens read through demoDataAccess (eslint.config.mjs blocks direct imports).
import "server-only";
import { applyCorrections } from "./corrections";
import { addDays, toMin } from "./dates";
import { CALLS as SEEDED_CALLS } from "./seed";
import { isClosedVisit, isOpenVisit } from "./status";
import type { Call, TechId, Visit } from "./types";

/**
 * Every demo call as the server holds it now: the seeded calls with the audited corrections of
 * closed visits applied (corrections.ts: the current value is the latest correction; the originals
 * stay in the history). Treat as read-only.
 */
export const CALLS: readonly Call[] = applyCorrections(SEEDED_CALLS);

/**
 * TEMPORARY (owner question, phase G; docs/architecture-data-access.md): the technician's visit
 * reads (visits.get, history, doneVisit) show the values as the technicians closed the visits,
 * without office corrections. The schema gives technicians no read on `visit_corrections`, so
 * until the owner decides they neither see a corrected value nor that a correction exists (deny by
 * default). Office reads use CALLS.
 */
export const CALLS_AS_CLOSED: readonly Call[] = SEEDED_CALLS;

/** Visit `n` of call `req` as the technician closed it (no office corrections; see CALLS_AS_CLOSED). */
export function findVisitAsClosed(req: string, n: number): CallVisit | undefined {
  const c = CALLS_AS_CLOSED.find((x) => x.req === req);
  const v = c?.visits.find((x) => x.n === n);
  return c && v ? { c, v } : undefined;
}

/** A visit together with its call (the demo's { c, v }). */
export type CallVisit = { c: Call; v: Visit };

/** Call by request number. */
export const findCall = (req: string): Call | undefined => CALLS.find((c) => c.req === req);

/** Visit `n` of call `req`. */
export function findVisit(req: string, n: number): CallVisit | undefined {
  const c = findCall(req);
  const v = c?.visits.find((x) => x.n === n);
  return c && v ? { c, v } : undefined;
}

/** The call's last visit by visit number. */
export const lastVisit = (c: Call): Visit => c.visits[c.visits.length - 1] as Visit;

/** The call's first visit. */
export const firstVisit = (c: Call): Visit => c.visits[0] as Visit;

/** Every visit of every call. */
export const ALL_VISITS: readonly CallVisit[] = CALLS.flatMap((c) => c.visits.map((v) => ({ c, v })));

const byStart = (a: CallVisit, b: CallVisit): number => toMin(a.v.start) - toMin(b.v.start);

/** A technician's visits on a date, cancelled excluded, by start time (the demo's myVisits). */
export function visitsForTechOnDate(tech: TechId, date: string): CallVisit[] {
  return ALL_VISITS.filter((x) => x.v.tech === tech && x.v.date === date && x.v.status !== "cancel").sort(byStart);
}

/** All technicians' visits on a date, cancelled excluded, by start time (office calendar). */
export function visitsOnDate(date: string): CallVisit[] {
  return ALL_VISITS.filter((x) => x.v.date === date && x.v.status !== "cancel").sort(byStart);
}

/** Visits between two dates inclusive, cancelled excluded (week and month views). */
export function visitsBetween(from: string, to: string): CallVisit[] {
  return ALL_VISITS.filter((x) => x.v.date >= from && x.v.date <= to && x.v.status !== "cancel");
}

/** Week of `sunday`: the five work days Sunday to Thursday. */
export const workWeek = (sunday: string): string[] => [0, 1, 2, 3, 4].map((i) => addDays(sunday, i));

/**
 * Earlier closed visits of the same call, oldest first: what a technician on visit `n` may see
 * (TE-06, D36). Never includes visit `n` itself, later visits or open visits.
 */
export const previousVisits = (c: Call, n: number): Visit[] => c.visits.filter((x) => x.n < n && isClosedVisit(x));

/** Other calls of the same customer (same phone or customer number), newest first. */
export function customerCalls(c: Call): Call[] {
  return sortCalls(CALLS.filter((x) => x.req !== c.req && (x.phone === c.phone || x.customerNo === c.customerNo)));
}

/** Calls for the same SKU, newest first, optionally without one request. */
export function productCalls(sku: string, exceptReq?: string): Call[] {
  return sortCalls(CALLS.filter((x) => x.sku === sku && x.req !== exceptReq));
}

/** The demo's calls-list order: last visit date and start time, newest first. */
export function sortCalls(calls: readonly Call[]): Call[] {
  const key = (c: Call): string => lastVisit(c).date + lastVisit(c).start;
  return [...calls].sort((a, b) => key(b).localeCompare(key(a)));
}

/** Open visits (scheduled, en route, in progress). */
export const openVisits = (): CallVisit[] => ALL_VISITS.filter((x) => isOpenVisit(x.v));

/** Closed visits ("טופל" or "המשך טיפול"), the dashboards' closedV(). */
export const closedVisits = (): CallVisit[] => ALL_VISITS.filter((x) => isClosedVisit(x.v));

/** Travel minutes (Waze → הגעתי), or null. */
export const travelOf = (v: Visit): number | null => (v.departAt && v.arriveAt ? toMin(v.arriveAt) - toMin(v.departAt) : null);

/** Treatment minutes (הגעתי → סיום), or null. */
export const treatOf = (v: Visit): number | null => (v.arriveAt && v.endAt ? toMin(v.endAt) - toMin(v.arriveAt) : null);

/** Rounded average; 0 for an empty list. */
export const avg = (a: readonly number[]): number => (a.length ? Math.round(a.reduce((x, y) => x + y, 0) / a.length) : 0);

/**
 * Side-by-side lanes for overlapping visits (the demo's laneLayout for the office day view):
 * `lane` is the item's column, `lanes` the column count of its overlap cluster.
 */
export function laneLayout<T extends { start: string; end: string }>(items: readonly T[]): { item: T; lane: number; lanes: number }[] {
  const xs = items.map((item) => ({ item, s: toMin(item.start), e: toMin(item.end), lane: 0 })).sort((a, b) => a.s - b.s);
  const out: { item: T; lane: number; lanes: number }[] = [];
  let cluster: typeof xs = [];
  let end = -1;
  const flush = () => {
    const lanes: number[] = [];
    for (const it of cluster) {
      let i = lanes.findIndex((l) => l <= it.s);
      if (i < 0) {
        i = lanes.length;
        lanes.push(0);
      }
      lanes[i] = it.e;
      it.lane = i;
    }
    for (const it of cluster) out.push({ item: it.item, lane: it.lane, lanes: lanes.length });
    cluster = [];
  };
  for (const it of xs) {
    if (it.s >= end && cluster.length) flush();
    cluster.push(it);
    end = Math.max(end, it.e);
  }
  if (cluster.length) flush();
  return out;
}
