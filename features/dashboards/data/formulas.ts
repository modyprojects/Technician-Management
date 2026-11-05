// Pure formulas of the manager dashboard (D57 (3)-(5); docs/design/manager-dashboard-spec.md §4-§8;
// spec-final §4.1-§4.2, §8.3). No fixtures and no I/O: the demo adapter maps its fictional records
// to MetricCall and calls these; a production adapter computes the same figures in the database
// (spec §11, §15) and these functions stay the reference for its tests.
//
// Common rules (spec-final §4.1):
// - Dates, months and "today" are Asia/Jerusalem (./time.ts); instants are compared as instants.
// - Every function takes `scope`: "production" drops test-marked calls (and their visits) before
//   any computation (SIM-08); "test-env" counts them.
// - Calls are unique by request number and visits by (call, visit number); a duplicate (a retry or
//   a repeated sync) never counts twice: the first occurrence wins (countedCalls).
// - A visit belongs to a period by the date of its scheduled start (T5). Open = scheduled, en
//   route, in progress; closed = "טופל" (done) or "המשך טיפול" (cont); a cancelled visit counts
//   nowhere.
// - The current call status follows D38 (the latest closed visit by visit number decides); the
//   historical follow-up and first-visit rules follow D57 (5) and never count visits.
// - Missing or impossible measurements are excluded and counted, never zero (T6, D57 (4)).
//   Averages are weighted means over the valid measurements, rounded half up (Math.round).
import type { CallStatus } from "@/features/calls/data/types";
import type { YearMonth } from "@/features/calendar/data/types";
import type { Bounded, IsoDate, IsoTimestamp } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type { VisitSource, VisitStatus } from "@/features/visits/data/types";
import { METRIC_DEFINITIONS, type DashboardGroupKind, type DashboardMetricKey } from "./metric-definitions";
import { beforeCoverage, completedMonths, lastDaysWindow, monthOfDate, monthPeriod, periodContains } from "./periods";
import { hoursBetween, instantMs, jerusalemDate, jerusalemMonth, minutesBetween } from "./time";
import {
  HIGHLIGHT_WINDOW_DAYS,
  NONE_GROUP_KEY,
  TOP_SKUS_LIMIT,
  TOP_SUPPLIERS_LIMIT,
  type AnalyticsPeriod,
  type DashboardScope,
  type Metric,
  type MetricUnit,
  type SkuSort,
  type TodayActivity,
  type TrendMonths,
  type TrendRow,
} from "./types";

// Inputs ------------------------------------------------------------------------------------------

/** A visit as the formulas read it: ISO instants with offsets, current values (corrections applied, D45). */
export type MetricVisit = {
  n: number;
  tech: TechnicianId;
  scheduledStart: IsoTimestamp;
  scheduledEnd: IsoTimestamp;
  status: VisitStatus;
  /** visit_time_reports "departed" / "arrived" / "ended": the latest correction, else the device report; null = no report. */
  departedAt: IsoTimestamp | null;
  arrivedAt: IsoTimestamp | null;
  endedAt: IsoTimestamp | null;
  source?: VisitSource;
};

/** Warranty of the call: "כן…" = yes, "לא" = no, empty ("לא צוין", D17) = unknown. */
export type WarrantyState = "yes" | "no" | "unknown";

/** A service call as the formulas read it. One product per call (service_calls.product_id, D19). */
export type MetricCall = {
  req: string;
  sku: string;
  /** Supplier / brand id of the call's product; NONE_GROUP_KEY when not entered. */
  supplierKey: string;
  /** "" when not entered (shown as "לא הוזן"). */
  supplierLabel: string;
  brandKey: string;
  brandLabel: string;
  warranty: WarrantyState;
  /** service_calls.opened_at. */
  openedAt: IsoTimestamp;
  /** service_calls.resolved_at: set while the D38 status is "resolved", cleared on reopening (T8). */
  resolvedAt: IsoTimestamp | null;
  isTest: boolean;
  visits: MetricVisit[];
};

/** A visit with its call. */
export type VisitRecord = { call: MetricCall; visit: MetricVisit };

// Basics ------------------------------------------------------------------------------------------

export const isOpenStatus = (s: VisitStatus): boolean => s === "new" || s === "go" || s === "work";
export const isClosedStatus = (s: VisitStatus): boolean => s === "done" || s === "cont";

/** The period date of a visit: the Asia/Jerusalem date of its scheduled start (T5). */
export const visitDate = (v: MetricVisit): IsoDate | null => jerusalemDate(v.scheduledStart);

export const countMetric = (n: number): Metric => ({ value: n, unit: "count" });

/** A metric with nothing to measure ("—"). */
export const noData = (unit: MetricUnit): Metric => ({ value: null, unit });

/** "הגדרה ממתינה": no approved formula. Never carries a value. */
export const pending = (unit: MetricUnit): Metric => ({ value: null, unit, state: "pendingDefinition" });

/** "לא זמין": an approved definition whose data does not exist. Never carries a value. */
export const unavailable = (unit: MetricUnit): Metric => ({ value: null, unit, state: "unavailable" });

/** part ÷ whole as a whole percent; null when the population is empty (never 0). */
export function percentMetric(part: number, whole: number): Metric {
  return whole > 0 ? { value: Math.round((part / whole) * 100), unit: "percent", basis: whole } : { value: null, unit: "percent", basis: 0 };
}

const byText = (a: string, b: string): number => (a < b ? -1 : a > b ? 1 : 0);

/**
 * The population the formulas count: calls unique by request number and visits unique by visit
 * number within their call (first occurrence wins), visits in visit-number order; in "production"
 * without test-marked calls.
 */
export function countedCalls(calls: readonly MetricCall[], scope: DashboardScope): MetricCall[] {
  const seen = new Set<string>();
  const out: MetricCall[] = [];
  for (const c of calls) {
    if (seen.has(c.req)) continue;
    seen.add(c.req);
    if (scope === "production" && c.isTest) continue;
    const numbers = new Set<number>();
    const visits: MetricVisit[] = [];
    for (const v of c.visits) {
      if (numbers.has(v.n)) continue;
      numbers.add(v.n);
      visits.push(v);
    }
    out.push({ ...c, visits: visits.sort((a, b) => a.n - b.n) });
  }
  return out;
}

/** Whether test-marked records are counted (then the screen shows "נתוני בדיקה", SIM-13). */
export const includesTestData = (calls: readonly MetricCall[], scope: DashboardScope): boolean =>
  scope === "test-env" && countedCalls(calls, scope).some((c) => c.isTest);

/**
 * coverageStart: the Asia/Jerusalem date of the earliest opened_at in the counted population
 * (opened by `now` when given); null when there is no call. Computed, never configured.
 */
export function coverageStartOf(calls: readonly MetricCall[], scope: DashboardScope, now?: IsoTimestamp): IsoDate | null {
  const limit = now === undefined ? null : instantMs(now);
  let first: IsoDate | null = null;
  for (const c of countedCalls(calls, scope)) {
    const ms = instantMs(c.openedAt);
    if (ms === null || (limit !== null && ms > limit)) continue;
    const d = jerusalemDate(c.openedAt);
    if (d !== null && (first === null || d < first)) first = d;
  }
  return first;
}

const visitsOf = (calls: readonly MetricCall[]): VisitRecord[] => calls.flatMap((call) => call.visits.map((visit) => ({ call, visit })));

const startMs = (r: VisitRecord): number => instantMs(r.visit.scheduledStart) ?? 0;

/** Scheduled order: start, then request number, then visit number. */
const byScheduledStart = (a: VisitRecord, b: VisitRecord): number =>
  startMs(a) - startMs(b) || byText(a.call.req, b.call.req) || a.visit.n - b.visit.n;

function assertAsOf(now: IsoTimestamp): { asOf: IsoDate; nowMs: number } {
  const asOf = jerusalemDate(now);
  const nowMs = instantMs(now);
  if (asOf === null || nowMs === null) throw new RangeError("Invalid instant");
  return { asOf, nowMs };
}

// Today (General "פעילות היום") ---------------------------------------------------------------------

export type TodayVisits = { asOf: IsoDate; planned: VisitRecord[]; done: VisitRecord[]; pending: VisitRecord[]; missed: VisitRecord[] };

/**
 * Today's visits (T1): scheduled today (Asia/Jerusalem), cancelled excluded. Closed ones are done
 * whenever they closed (a late closure is done, not missed); an open visit is missed when `now` is
 * after its scheduled end, otherwise pending (`now` = scheduled end is not overdue). An open visit
 * from an earlier day is on no card. planned = done + pending + missed, in scheduled order.
 */
export function todayVisits(calls: readonly MetricCall[], now: IsoTimestamp, scope: DashboardScope): TodayVisits {
  const { asOf, nowMs } = assertAsOf(now);
  const planned = visitsOf(countedCalls(calls, scope))
    .filter((r) => r.visit.status !== "cancel" && visitDate(r.visit) === asOf)
    .sort(byScheduledStart);
  const isMissed = (r: VisitRecord): boolean => {
    const end = instantMs(r.visit.scheduledEnd);
    return end !== null && nowMs > end;
  };
  const open = planned.filter((r) => isOpenStatus(r.visit.status));
  return {
    asOf,
    planned,
    done: planned.filter((r) => isClosedStatus(r.visit.status)),
    pending: open.filter((r) => !isMissed(r)),
    missed: open.filter(isMissed),
  };
}

/** "פעילות היום" and its progress bar, from one set of visits. */
export function todayActivity(calls: readonly MetricCall[], now: IsoTimestamp, scope: DashboardScope): TodayActivity {
  const t = todayVisits(calls, now, scope);
  return {
    planned: countMetric(t.planned.length),
    done: countMetric(t.done.length),
    pending: countMetric(t.pending.length),
    missed: countMetric(t.missed.length),
    progress: percentMetric(t.done.length, t.planned.length),
  };
}

// Visits of a period ------------------------------------------------------------------------------

/** Non-cancelled visits scheduled in the period (T5), optionally one technician's, newest first. */
export function periodVisits(
  calls: readonly MetricCall[],
  period: AnalyticsPeriod,
  scope: DashboardScope,
  tech?: TechnicianId,
): VisitRecord[] {
  return visitsOf(countedCalls(calls, scope))
    .filter((r) => r.visit.status !== "cancel" && periodContains(period, visitDate(r.visit)) && (tech === undefined || r.visit.tech === tech))
    .sort((a, b) => byScheduledStart(b, a));
}

/** Closed visits ("טופל" / "המשך טיפול") scheduled in the period, newest first. */
export const closedVisitsIn = (calls: readonly MetricCall[], period: AnalyticsPeriod, scope: DashboardScope, tech?: TechnicianId): VisitRecord[] =>
  periodVisits(calls, period, scope, tech).filter((r) => isClosedStatus(r.visit.status));

// Time measurements (D45, T6) ---------------------------------------------------------------------

/** A measured duration in minutes; `problem` says why it is excluded (missing report or impossible sequence). */
export type Measurement = { minutes: number | null; problem: "missing" | "invalid" | null };

function measure(from: IsoTimestamp | null, to: IsoTimestamp | null): Measurement {
  if (!from || !to) return { minutes: null, problem: "missing" };
  const m = minutesBetween(from, to);
  return m === null || m < 0 ? { minutes: null, problem: "invalid" } : { minutes: m, problem: null };
}

/** Treatment: "הגעתי" → end of treatment. */
export const treatMeasurement = (v: MetricVisit): Measurement => measure(v.arrivedAt, v.endedAt);

/** Travel: start of navigation → "הגעתי". */
export const travelMeasurement = (v: MetricVisit): Measurement => measure(v.departedAt, v.arrivedAt);

function averageMinutes(ms: readonly Measurement[]): Metric {
  const valid = ms.flatMap((m) => (m.minutes === null ? [] : [m.minutes]));
  const excluded = { missing: ms.filter((m) => m.problem === "missing").length, invalid: ms.filter((m) => m.problem === "invalid").length };
  const value = valid.length ? Math.round(valid.reduce((a, b) => a + b, 0) / valid.length) : null;
  return { value, unit: "minutes", basis: valid.length, excluded };
}

/** "זמן טיפול ממוצע" over the given visits (normally closedVisitsIn). */
export const avgTreat = (records: readonly VisitRecord[]): Metric => averageMinutes(records.map((r) => treatMeasurement(r.visit)));

/** "זמן נסיעה ממוצע" over the given visits (normally closedVisitsIn). */
export const avgTravel = (records: readonly VisitRecord[]): Metric => averageMinutes(records.map((r) => travelMeasurement(r.visit)));

// Call status, first-visit resolution and closure (D38, D57 (5), T2, T3, T7, T8) ------------------

/** The call's first performed visit: its closed visit with the lowest visit number (T3); null when none. */
export function firstPerformedVisit(call: MetricCall): MetricVisit | null {
  return [...call.visits].filter((v) => isClosedStatus(v.status)).sort((a, b) => a.n - b.n)[0] ?? null;
}

/**
 * The visit that resolved the call (D38): with no open visit, the latest closed visit by visit
 * number, when its outcome is "טופל"; otherwise null (the call is not resolved).
 */
export function resolvingVisit(call: MetricCall): MetricVisit | null {
  if (call.visits.some((v) => isOpenStatus(v.status))) return null;
  const latest = [...call.visits].filter((v) => isClosedStatus(v.status)).sort((a, b) => b.n - a.n)[0];
  return latest?.status === "done" ? latest : null;
}

/** The current service-call status (D38): open visit → open; else the latest closed visit; else awaiting. */
export function currentCallStatus(call: MetricCall): CallStatus {
  if (call.visits.some((v) => isOpenStatus(v.status))) return "open";
  const latest = [...call.visits].filter((v) => isClosedStatus(v.status)).sort((a, b) => b.n - a.n)[0];
  if (latest) return latest.status === "done" ? "resolved" : "followup";
  return "awaiting";
}

/** Historical (D57 (5)): at least one visit closed as "המשך טיפול", closed calls included. */
export const followupRequired = (call: MetricCall): boolean => call.visits.some((v) => v.status === "cont");

/** At least one performed (closed) visit. */
export const hasPerformedVisit = (call: MetricCall): boolean => call.visits.some((v) => isClosedStatus(v.status));

export type FirstVisitRecord = { call: MetricCall; visit: MetricVisit; resolved: boolean };

/**
 * The first-visit population (D57 (5), T3): calls whose first performed visit is scheduled in the
 * period (and is the technician's, when given); `resolved` = that visit's outcome was "טופל".
 * Newest first. Never decided by the number of visits.
 */
export function firstVisitCalls(
  calls: readonly MetricCall[],
  period: AnalyticsPeriod,
  scope: DashboardScope,
  tech?: TechnicianId,
): FirstVisitRecord[] {
  return countedCalls(calls, scope)
    .flatMap((call) => {
      const visit = firstPerformedVisit(call);
      if (!visit || !periodContains(period, visitDate(visit)) || (tech !== undefined && visit.tech !== tech)) return [];
      return [{ call, visit, resolved: visit.status === "done" }];
    })
    .sort((a, b) => (instantMs(b.visit.scheduledStart) ?? 0) - (instantMs(a.visit.scheduledStart) ?? 0) || byText(a.call.req, b.call.req));
}

/** "פתרון בביקור ראשון". */
export function firstVisitResolution(calls: readonly MetricCall[], period: AnalyticsPeriod, scope: DashboardScope, tech?: TechnicianId): Metric {
  const population = firstVisitCalls(calls, period, scope, tech);
  return percentMetric(population.filter((r) => r.resolved).length, population.length);
}

/** A completed call (T8): resolved by D38 with a valid resolved_at. */
const isCompleted = (call: MetricCall): boolean => instantMs(call.resolvedAt) !== null && resolvingVisit(call) !== null;

export type ClosedCallRecord = {
  call: MetricCall;
  /** The D38 resolving visit; its technician is credited with the call (T2). */
  visit: MetricVisit;
  /** resolved_at − opened_at; null when not measurable. */
  hours: number | null;
  problem: "missing" | "invalid" | null;
};

/**
 * Completed calls whose resolved_at date is in the period (credited to the technician of the
 * resolving visit, when given; T2), newest closure first.
 */
export function completedCallsIn(
  calls: readonly MetricCall[],
  period: AnalyticsPeriod,
  scope: DashboardScope,
  tech?: TechnicianId,
): ClosedCallRecord[] {
  return countedCalls(calls, scope)
    .flatMap((call): ClosedCallRecord[] => {
      const visit = resolvingVisit(call);
      if (!visit || !isCompleted(call) || !periodContains(period, jerusalemDate(call.resolvedAt))) return [];
      if (tech !== undefined && visit.tech !== tech) return [];
      if (instantMs(call.openedAt) === null) return [{ call, visit, hours: null, problem: "missing" }];
      const hours = hoursBetween(call.openedAt, call.resolvedAt);
      return hours === null || hours < 0 ? [{ call, visit, hours: null, problem: "invalid" }] : [{ call, visit, hours, problem: null }];
    })
    .sort((a, b) => (instantMs(b.call.resolvedAt) ?? 0) - (instantMs(a.call.resolvedAt) ?? 0) || byText(a.call.req, b.call.req));
}

/** Hours rounded to two decimals. */
const hours2 = (h: number): number => Math.round(h * 100) / 100;

/**
 * "זמן סגירת קריאה": mean (resolved_at − opened_at) in hours over the completed calls with both
 * timestamps and resolved_at ≥ opened_at. The screen shows it per T7 (durationDisplay).
 */
export function closeTime(calls: readonly MetricCall[], period: AnalyticsPeriod, scope: DashboardScope, tech?: TechnicianId): Metric {
  const rs = completedCallsIn(calls, period, scope, tech);
  const valid = rs.flatMap((r) => (r.hours === null ? [] : [r.hours]));
  const excluded = { missing: rs.filter((r) => r.problem === "missing").length, invalid: rs.filter((r) => r.problem === "invalid").length };
  if (!valid.length) return { value: null, unit: "duration", basis: 0, excluded };
  const mean = hours2(valid.reduce((a, b) => a + b, 0) / valid.length);
  return { value: mean, unit: "duration", decimals: 2, basis: valid.length, excluded, durationHours: mean };
}

/** "קריאות שנסגרו" of a technician: completed calls closed in the period by the technician's visit (T2). */
export const closedCallsOf = (calls: readonly MetricCall[], period: AnalyticsPeriod, scope: DashboardScope, tech: TechnicianId): Metric =>
  countMetric(completedCallsIn(calls, period, scope, tech).length);

// Trend (General "מגמת קריאות שירות") ---------------------------------------------------------------

/** Calls opened in the month (by opened_at), or completed in it (by resolved_at, T8). */
export function trendMembers(calls: readonly MetricCall[], month: YearMonth, which: "opened" | "closed", scope: DashboardScope): MetricCall[] {
  return countedCalls(calls, scope).filter((c) =>
    which === "opened" ? jerusalemMonth(c.openedAt) === month : isCompleted(c) && jerusalemMonth(c.resolvedAt) === month,
  );
}

/**
 * Opened vs closed per completed month, oldest first (spec §6): not the same cohort. A month
 * entirely before `coverageStart` is null ("אין נתונים"), never 0.
 */
export function monthlyTrend(
  calls: readonly MetricCall[],
  asOf: IsoDate,
  months: TrendMonths,
  coverageStart: IsoDate | null,
  scope: DashboardScope,
): TrendRow[] {
  const counted = countedCalls(calls, scope);
  return completedMonths(asOf, months).map((month) =>
    beforeCoverage(monthPeriod(month), coverageStart)
      ? { month, opened: null, closed: null }
      : { month, opened: trendMembers(counted, month, "opened", scope).length, closed: trendMembers(counted, month, "closed", scope).length },
  );
}

// Groups (suppliers, brands, SKUs) ----------------------------------------------------------------

export type GroupKind = Exclude<DashboardGroupKind, "month">;

/** Unique calls of one group. `label` "" = not entered ("לא הוזן"). */
export type GroupRow = { key: string; label: string; value: number };

export function groupOf(call: MetricCall, kind: GroupKind): { key: string; label: string } {
  if (kind === "supplier") return { key: call.supplierKey || NONE_GROUP_KEY, label: call.supplierLabel };
  if (kind === "brand") return { key: call.brandKey || NONE_GROUP_KEY, label: call.brandLabel };
  return { key: call.sku, label: call.sku };
}

/** Most calls first; "לא הוזן" last among equals; then by label (Hebrew collation), then key. */
const compareGroups = (a: GroupRow, b: GroupRow): number =>
  b.value - a.value ||
  Number(a.key === NONE_GROUP_KEY) - Number(b.key === NONE_GROUP_KEY) ||
  a.label.localeCompare(b.label, "he") ||
  byText(a.key, b.key);

/** Unique calls per group, the NONE_GROUP_KEY group kept (spec §8.2: unknown values are never silently removed). */
export function groupUniqueCalls(calls: readonly MetricCall[], kind: GroupKind, scope: DashboardScope): GroupRow[] {
  const groups = new Map<string, GroupRow>();
  for (const c of countedCalls(calls, scope)) {
    const g = groupOf(c, kind);
    const row = groups.get(g.key);
    if (row) row.value += 1;
    else groups.set(g.key, { key: g.key, label: g.label, value: 1 });
  }
  return [...groups.values()].sort(compareGroups);
}

/** Calls whose opened_at date (Asia/Jerusalem) is in the window. */
export const openedWithin = (calls: readonly MetricCall[], window: AnalyticsPeriod): MetricCall[] =>
  calls.filter((c) => periodContains(window, jerusalemDate(c.openedAt)));

/** Calls opened at or before `now` (the Products tab's population, spec-final §4.2). */
export function openedBy(calls: readonly MetricCall[], now: IsoTimestamp): MetricCall[] {
  const limit = instantMs(now);
  if (limit === null) throw new RangeError("Invalid instant");
  return calls.filter((c) => {
    const ms = instantMs(c.openedAt);
    return ms !== null && ms <= limit;
  });
}

/**
 * The top `n` groups of the calls opened in the window (spec §5, T4). With `excludeNone` calls
 * without the grouped value are not ranked (T13, suppliers). `total` counts the ranked groups.
 */
export function topGroups(
  calls: readonly MetricCall[],
  window: AnalyticsPeriod,
  kind: GroupKind,
  n: number,
  opts: { excludeNone?: boolean },
  scope: DashboardScope,
): Bounded<GroupRow> {
  const rows = groupUniqueCalls(openedWithin(countedCalls(calls, scope), window), kind, scope);
  const ranked = opts.excludeNone ? rows.filter((r) => r.key !== NONE_GROUP_KEY) : rows;
  return { items: ranked.slice(0, n), total: ranked.length, limit: n };
}

/** The calls of one group. */
export const groupMembers = (calls: readonly MetricCall[], kind: GroupKind, key: string, scope: DashboardScope): MetricCall[] =>
  countedCalls(calls, scope).filter((c) => groupOf(c, kind).key === key);

// SKU table (Products & Suppliers) ----------------------------------------------------------------

export type SkuRow = { sku: string; calls: number; warrantyRate: Metric; followupRate: Metric };

/**
 * One row per SKU with calls (spec §8.3): unique calls; "באחריות" = yes ÷ (yes + no), unknown
 * excluded and never inferred (D17, owner message 3 B); "% המשך טיפול" per D57 (5) = calls with a
 * "המשך טיפול" outcome ÷ calls with a performed visit. Most calls first, ties by SKU.
 */
export function skuStats(calls: readonly MetricCall[], scope: DashboardScope): SkuRow[] {
  const bySku = new Map<string, MetricCall[]>();
  for (const c of countedCalls(calls, scope)) bySku.set(c.sku, [...(bySku.get(c.sku) ?? []), c]);
  const rows = [...bySku.entries()].map(([sku, cs]): SkuRow => {
    const yes = cs.filter((c) => c.warranty === "yes").length;
    const no = cs.filter((c) => c.warranty === "no").length;
    const performed = cs.filter(hasPerformedVisit);
    return {
      sku,
      calls: cs.length,
      warrantyRate: percentMetric(yes, yes + no),
      followupRate: percentMetric(performed.filter(followupRequired).length, performed.length),
    };
  });
  return sortSkuRows(rows, "calls-desc");
}

/** "calls-desc" (default) or "calls-asc"; ties by SKU ascending either way. */
export const sortSkuRows = (rows: readonly SkuRow[], sort: SkuSort): SkuRow[] =>
  [...rows].sort((a, b) => (sort === "calls-asc" ? a.calls - b.calls : b.calls - a.calls) || byText(a.sku, b.sku));

// Tab assemblies ----------------------------------------------------------------------------------

export type GeneralMetrics = {
  asOf: IsoDate;
  coverageStart: IsoDate | null;
  includesTestData: boolean;
  today: TodayActivity;
  service: { period: AnalyticsPeriod; treat: Metric; travel: Metric; firstVisit: Metric; closeTime: Metric };
  highlights: { period: AnalyticsPeriod; suppliers: Bounded<GroupRow>; skus: Bounded<GroupRow> };
  trend: { months: TrendMonths; rows: TrendRow[] };
};

/** The General tab's numbers (spec §4-§6; D56 (2): service metrics over the current calendar month). */
export function generalMetrics(calls: readonly MetricCall[], now: IsoTimestamp, months: TrendMonths, scope: DashboardScope): GeneralMetrics {
  const { asOf } = assertAsOf(now);
  const counted = countedCalls(calls, scope);
  const coverageStart = coverageStartOf(counted, scope, now);
  const month = monthPeriod(monthOfDate(asOf));
  const closed = closedVisitsIn(counted, month, scope);
  const window = lastDaysWindow(asOf, HIGHLIGHT_WINDOW_DAYS);
  return {
    asOf,
    coverageStart,
    includesTestData: includesTestData(counted, scope),
    today: todayActivity(counted, now, scope),
    service: {
      period: month,
      treat: avgTreat(closed),
      travel: avgTravel(closed),
      firstVisit: firstVisitResolution(counted, month, scope),
      closeTime: closeTime(counted, month, scope),
    },
    highlights: {
      period: window,
      suppliers: topGroups(counted, window, "supplier", TOP_SUPPLIERS_LIMIT, { excludeNone: true }, scope),
      skus: topGroups(counted, window, "sku", TOP_SKUS_LIMIT, {}, scope),
    },
    trend: { months, rows: monthlyTrend(counted, asOf, months, coverageStart, scope) },
  };
}

export type TechnicianMetrics = {
  asOf: IsoDate;
  coverageStart: IsoDate | null;
  includesTestData: boolean;
  activity: { planned: Metric; done: Metric; closedCalls: Metric };
  performance: { treat: Metric; travel: Metric; firstVisit: Metric; closeTime: Metric; planAdherence: Metric };
};

/**
 * One technician's numbers for a period (spec §7.3-§7.4). A period entirely before the first
 * recorded call gives null everywhere ("אין נתונים"), counts included; "עמידה בתכנון" is always
 * "הגדרה ממתינה".
 */
export function technicianMetrics(
  calls: readonly MetricCall[],
  tech: TechnicianId,
  period: AnalyticsPeriod,
  now: IsoTimestamp,
  scope: DashboardScope,
): TechnicianMetrics {
  const { asOf } = assertAsOf(now);
  const counted = countedCalls(calls, scope);
  const coverageStart = coverageStartOf(counted, scope, now);
  const base = { asOf, coverageStart, includesTestData: includesTestData(counted, scope) };
  const planAdherence = pending("percent");
  if (beforeCoverage(period, coverageStart)) {
    return {
      ...base,
      activity: { planned: noData("count"), done: noData("count"), closedCalls: noData("count") },
      performance: { treat: noData("minutes"), travel: noData("minutes"), firstVisit: noData("percent"), closeTime: noData("duration"), planAdherence },
    };
  }
  const planned = periodVisits(counted, period, scope, tech);
  const closed = planned.filter((r) => isClosedStatus(r.visit.status));
  return {
    ...base,
    activity: { planned: countMetric(planned.length), done: countMetric(closed.length), closedCalls: closedCallsOf(counted, period, scope, tech) },
    performance: {
      treat: avgTreat(closed),
      travel: avgTravel(closed),
      firstVisit: firstVisitResolution(counted, period, scope, tech),
      closeTime: closeTime(counted, period, scope, tech),
      planAdherence,
    },
  };
}

export type ProductMetrics = { includesTestData: boolean; bySupplier: GroupRow[]; byBrand: GroupRow[]; skus: SkuRow[] };

/** The Products & Suppliers tab's numbers: every call opened by `now`, no date filter (spec §8.1). */
export function productMetrics(calls: readonly MetricCall[], now: IsoTimestamp, scope: DashboardScope): ProductMetrics {
  const population = openedBy(countedCalls(calls, scope), now);
  return {
    includesTestData: includesTestData(population, scope),
    bySupplier: groupUniqueCalls(population, "supplier", scope),
    byBrand: groupUniqueCalls(population, "brand", scope),
    skus: skuStats(population, scope),
  };
}

// Details dialog ----------------------------------------------------------------------------------

export type DetailVisitRow = { kind: "visit"; call: MetricCall; visit: MetricVisit; minutes?: number | null };

export type DetailCallRow = {
  kind: "call";
  call: MetricCall;
  /** The opening date (Asia/Jerusalem). */
  date: IsoDate;
  /** The technician the call is credited to (T2 closure, T3 first visit); null otherwise. */
  technician: TechnicianId | null;
  /** The current D38 status. */
  status: CallStatus;
  durationHours?: number | null;
  firstVisitResolved?: boolean;
  followupRequired?: boolean;
};

export type DetailRecords = { records: "visits"; rows: DetailVisitRow[] } | { records: "calls"; rows: DetailCallRow[] };

/** What the dialog is opened for: the trusted `now`, and for Technicians keys the period and technician. */
export type DetailContext = { now: IsoTimestamp; period?: AnalyticsPeriod; tech?: TechnicianId; group?: string };

/** The longest trend window: a trend group must be one of these completed months. */
const MAX_TREND_MONTHS: TrendMonths = 12;

/** Visit rows; with `measure`, each row carries its whole minutes (null when missing or invalid, T6). */
function visitRows(rs: readonly VisitRecord[], measure?: (v: MetricVisit) => Measurement): DetailRecords {
  return {
    records: "visits",
    rows: rs.map((r) => {
      const row: DetailVisitRow = { kind: "visit", call: r.call, visit: r.visit };
      if (measure) {
        const m = measure(r.visit).minutes;
        row.minutes = m === null ? null : Math.round(m);
      }
      return row;
    }),
  };
}

function callRow(call: MetricCall, extra: Partial<Omit<DetailCallRow, "kind" | "call" | "date" | "status">> = {}): DetailCallRow {
  return { kind: "call", call, date: jerusalemDate(call.openedAt) ?? "", technician: null, status: currentCallStatus(call), ...extra };
}

/** Newest opening first, then request number. */
const byOpenedDesc = (a: MetricCall, b: MetricCall): number =>
  (instantMs(b.openedAt) ?? 0) - (instantMs(a.openedAt) ?? 0) || byText(a.req, b.req);

/**
 * The records behind a metric (or one group of it), for the details dialog. Null when the key has
 * no records (pending, unavailable, the progress bar, the per-SKU rates), when a grouped key has
 * no valid group or an ungrouped key has one, or when a Technicians key lacks its technician or
 * period. A Technicians period before coverage has no rows.
 */
export function detailRecords(
  calls: readonly MetricCall[],
  key: DashboardMetricKey,
  ctx: DetailContext,
  scope: DashboardScope,
): DetailRecords | null {
  const def = METRIC_DEFINITIONS[key];
  if (!def || def.category !== "approved" || def.records === null) return null;
  const group = ctx.group === undefined || ctx.group === "" ? undefined : ctx.group;
  if (def.grouped !== (group !== undefined)) return null;
  const { asOf } = assertAsOf(ctx.now);
  const counted = countedCalls(calls, scope);
  const month = monthPeriod(monthOfDate(asOf));

  switch (key) {
    case "today.planned":
    case "today.done":
    case "today.pending":
    case "today.missed": {
      const t = todayVisits(counted, ctx.now, scope);
      const part = key === "today.planned" ? t.planned : key === "today.done" ? t.done : key === "today.pending" ? t.pending : t.missed;
      return visitRows(part);
    }
    case "service.treat":
      return visitRows(closedVisitsIn(counted, month, scope), treatMeasurement);
    case "service.travel":
      return visitRows(closedVisitsIn(counted, month, scope), travelMeasurement);
    case "service.firstVisit":
      return {
        records: "calls",
        rows: firstVisitCalls(counted, month, scope).map((r) => callRow(r.call, { technician: r.visit.tech, firstVisitResolved: r.resolved })),
      };
    case "service.closeTime":
      return {
        records: "calls",
        rows: completedCallsIn(counted, month, scope).map((r) =>
          callRow(r.call, { technician: r.visit.tech, durationHours: r.hours === null ? null : hours2(r.hours) }),
        ),
      };
    case "top.suppliers":
    case "top.skus": {
      const kind: GroupKind = key === "top.suppliers" ? "supplier" : "sku";
      const window = lastDaysWindow(asOf, HIGHLIGHT_WINDOW_DAYS);
      const inWindow = openedWithin(counted, window);
      const ranked = topGroups(inWindow, window, kind, Number.MAX_SAFE_INTEGER, { excludeNone: kind === "supplier" }, scope);
      if (!ranked.items.some((r) => r.key === group)) return null;
      return { records: "calls", rows: groupMembers(inWindow, kind, group as string, scope).sort(byOpenedDesc).map((c) => callRow(c)) };
    }
    case "trend.opened":
    case "trend.closed": {
      if (!completedMonths(asOf, MAX_TREND_MONTHS).includes(group as string)) return null;
      const m = group as YearMonth;
      if (beforeCoverage(monthPeriod(m), coverageStartOf(counted, scope, ctx.now))) return { records: "calls", rows: [] };
      const which = key === "trend.opened" ? "opened" : "closed";
      const members = trendMembers(counted, m, which, scope);
      const sorted =
        which === "opened"
          ? members.sort(byOpenedDesc)
          : members.sort((a, b) => (instantMs(b.resolvedAt) ?? 0) - (instantMs(a.resolvedAt) ?? 0) || byText(a.req, b.req));
      return { records: "calls", rows: sorted.map((c) => callRow(c)) };
    }
    case "tech.planned":
    case "tech.done":
    case "tech.closedCalls":
    case "tech.treat":
    case "tech.travel":
    case "tech.firstVisit":
    case "tech.closeTime": {
      const { period, tech } = ctx;
      if (period === undefined || tech === undefined) return null;
      if (beforeCoverage(period, coverageStartOf(counted, scope, ctx.now))) return def.records === "visits" ? { records: "visits", rows: [] } : { records: "calls", rows: [] };
      if (key === "tech.planned") return visitRows(periodVisits(counted, period, scope, tech));
      if (key === "tech.done") return visitRows(closedVisitsIn(counted, period, scope, tech));
      if (key === "tech.treat") return visitRows(closedVisitsIn(counted, period, scope, tech), treatMeasurement);
      if (key === "tech.travel") return visitRows(closedVisitsIn(counted, period, scope, tech), travelMeasurement);
      if (key === "tech.firstVisit") {
        return {
          records: "calls",
          rows: firstVisitCalls(counted, period, scope, tech).map((r) => callRow(r.call, { technician: r.visit.tech, firstVisitResolved: r.resolved })),
        };
      }
      return {
        records: "calls",
        rows: completedCallsIn(counted, period, scope, tech).map((r) =>
          callRow(r.call, {
            technician: r.visit.tech,
            ...(key === "tech.closeTime" ? { durationHours: r.hours === null ? null : hours2(r.hours) } : {}),
          }),
        ),
      };
    }
    case "prod.bySupplier":
    case "prod.byBrand":
    case "prod.skuCalls": {
      const kind: GroupKind = key === "prod.bySupplier" ? "supplier" : key === "prod.byBrand" ? "brand" : "sku";
      const population = openedBy(counted, ctx.now);
      if (!groupUniqueCalls(population, kind, scope).some((r) => r.key === group)) return null;
      return {
        records: "calls",
        rows: groupMembers(population, kind, group as string, scope)
          .sort(byOpenedDesc)
          .map((c) => callRow(c, { followupRequired: followupRequired(c) })),
      };
    }
    default:
      return null;
  }
}
