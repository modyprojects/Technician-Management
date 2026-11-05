import { expect, test } from "@playwright/test";
import { formatMetric, formatMetricNumber } from "@/components/office/KpiGrid";
import {
  ANALYTICS_TABS,
  analyticsHref,
  effectiveAnalyticsView,
  groupFitsMetric,
  offeredAnalyticsTabs,
  parseAnalyticsState,
  reportsColumnsOffered,
  reportsRowsOffered,
  selectedTechnician,
} from "@/app/dev/demo/office/[role]/analytics/_state";
import {
  closedVisitsIn,
  closeTime,
  completedCallsIn,
  countedCalls,
  detailRecords,
  firstVisitCalls,
  generalMetrics,
  pending,
  productMetrics,
  technicianMetrics,
  todayVisits,
  trendMembers,
  unavailable,
  type DetailRecords,
  type MetricCall,
  type MetricVisit,
  type VisitRecord,
  type WarrantyState,
} from "@/features/dashboards/data/formulas";
import {
  DASHBOARD_METRIC_KEYS,
  detailOffered,
  detailRowsOffered,
  durationDisplay,
  isDashboardMetricKey,
  METRIC_DEFINITIONS,
} from "@/features/dashboards/data/metric-definitions";
import {
  beforeCoverage,
  completedMonths,
  MIN_OFFSET,
  monthPeriod,
  resolveDashboardPeriod,
} from "@/features/dashboards/data/periods";
import { atJerusalem, isIsoInstant, jerusalemDate, jerusalemMonth, minutesBetween } from "@/features/dashboards/data/time";
import { NONE_GROUP_KEY, type AnalyticsPeriod, type DashboardScope, type Metric } from "@/features/dashboards/data/types";
import { DASHBOARD_PERMISSION_KEYS } from "@/features/reference/data/permissions";
import { PERMISSION_KEYS, type PermissionKey, type RolePermissions } from "@/features/reference/data/types";
import type { VisitStatus } from "@/features/visits/data/types";
import { gridStep } from "@/components/office/GroupedBars";
import { onlyInProject } from "./helpers";

// Unit tests of the manager dashboard's pure data layer (D57; spec-final §10.1): the formulas, the
// metric registry, the period resolver and the Asia/Jerusalem time helpers.
// Dataset S is synthetic and fictional: an input to pure functions only; no record is created
// anywhere and no fixture module is imported (eslint.config.mjs). Every expected value below was
// worked out by hand (the arithmetic is in the comments) and re-checked by an independent script
// (spec-final §10.1). `now` is 2027-03-15 12:00 in Asia/Jerusalem standard time (+02:00; DST starts
// 26.3.2027); 2027-03-14 is a Sunday.

// Dataset S ----------------------------------------------------------------------------------------

/** Local Asia/Jerusalem standard time (+02:00) on a date. */
const J = (d: string, t: string): string => `${d}T${t}:00+02:00`;

/** P-1 ספק א / מותג א; P-2 no supplier, no brand; P-3 ספק ב / מותג ב; P-4 no supplier / מותג ב. */
const PRODUCT: Record<string, [supplier: string, brand: string]> = {
  "P-1": ["ספק א", "מותג א"],
  "P-2": ["", ""],
  "P-3": ["ספק ב", "מותג ב"],
  "P-4": ["", "מותג ב"],
};

/** A visit on date `d`: scheduled `s`–`e`; departed / arrived / ended at those times (null = no report). */
function V(
  n: number,
  tech: string,
  d: string,
  s: string,
  e: string,
  status: VisitStatus,
  times: [dep: string | null, arr: string | null, end: string | null] = [null, null, null],
  overrides: Partial<MetricVisit> = {},
): MetricVisit {
  const [dep, arr, end] = times;
  return {
    n,
    tech,
    scheduledStart: J(d, s),
    scheduledEnd: J(d, e),
    status,
    departedAt: dep ? J(d, dep) : null,
    arrivedAt: arr ? J(d, arr) : null,
    endedAt: end ? J(d, end) : null,
    source: "simulator",
    ...overrides,
  };
}

function C(
  req: string,
  sku: string,
  warranty: WarrantyState,
  openedAt: string,
  resolvedAt: string | null,
  visits: MetricVisit[],
  isTest = true,
): MetricCall {
  const [supplier, brand] = PRODUCT[sku] as [string, string];
  return {
    req,
    sku,
    supplierKey: supplier || NONE_GROUP_KEY,
    supplierLabel: supplier,
    brandKey: brand || NONE_GROUP_KEY,
    brandLabel: brand,
    warranty,
    openedAt,
    resolvedAt,
    isTest,
    visits,
  };
}

function datasetS(): MetricCall[] {
  return [
    C("S1", "P-1", "yes", J("2027-03-01", "08:00"), J("2027-03-10", "10:00"), [
      V(1, "t1", "2027-03-01", "09:00", "10:30", "cont", ["08:00", "08:30", "09:30"]),
      V(2, "t1", "2027-03-05", "09:00", "10:30", "cont", ["08:00", "08:20", "09:20"]),
      V(3, "t1", "2027-03-10", "09:00", "10:30", "done", ["08:00", "08:40", "10:00"]),
    ]),
    C("S2", "P-1", "no", J("2027-03-02", "08:00"), J("2027-03-06", "11:00"), [
      V(1, "t1", "2027-03-02", "09:00", "10:30", "cont", ["09:00", "09:20", "10:20"]),
      V(2, "t2", "2027-03-06", "10:00", "11:30", "done", ["10:00", "10:30", "11:00"]),
    ]),
    // A stale open visit from yesterday (S3/2): on no General card (T1), in t2's planned count (T12).
    C("S3", "P-2", "unknown", J("2027-03-03", "08:00"), null, [
      V(1, "t2", "2027-03-03", "09:00", "10:00", "cancel"),
      V(2, "t2", "2027-03-14", "09:00", "10:00", "go", ["08:40", null, null]),
    ]),
    C("S4", "P-4", "yes", J("2027-03-04", "08:00"), J("2027-03-08", "10:50"), [
      V(1, "t2", "2027-03-04", "09:00", "10:00", "cancel"),
      V(2, "t2", "2027-03-08", "10:00", "11:00", "done", [null, "10:00", "10:50"]),
    ]),
    // Closed at 09:10, after its 09:00 scheduled end: done, never missed (T1).
    C("S5", "P-3", "yes", J("2027-03-14", "16:00"), J("2027-03-15", "09:10"), [
      V(1, "t1", "2027-03-15", "08:00", "09:00", "done", ["07:40", null, "09:10"]),
    ]),
    C("S6", "P-3", "no", J("2027-03-15", "11:00"), null, [V(1, "t1", "2027-03-16", "09:00", "10:00", "new")]),
    C("S7", "P-1", "yes", J("2027-02-14", "08:00"), J("2027-02-14", "09:00"), [
      V(1, "t2", "2027-02-14", "08:00", "09:30", "done", ["08:00", "08:20", "09:00"]),
    ]),
    C("S8", "P-4", "yes", J("2027-02-13", "08:00"), J("2027-02-13", "09:05"), [
      V(1, "t2", "2027-02-13", "08:00", "09:30", "done", ["08:00", "08:30", "09:05"]),
    ]),
    // Reopened (T8: resolved_at cleared): resolved on its first visit, a new visit scheduled later today.
    C("S9", "P-3", "unknown", J("2027-03-07", "08:00"), null, [
      V(1, "t1", "2027-03-07", "08:00", "09:00", "done", ["08:00", "08:15", "08:46"]),
      V(2, "t1", "2027-03-15", "13:00", "14:00", "new"),
    ]),
    // Travel −10 minutes (arrived before departing): invalid, excluded (T6).
    C("S10", "P-1", "no", J("2027-03-09", "08:00"), J("2027-03-09", "10:40"), [
      V(1, "t2", "2027-03-09", "10:00", "11:00", "done", ["10:00", "09:50", "10:40"]),
    ]),
    C("S11", "P-3", "yes", J("2027-03-15", "07:00"), null, [V(1, "t2", "2027-03-15", "09:00", "11:00", "work", ["09:00", "09:20", null])]),
    C("S12", "P-2", "unknown", J("2027-03-15", "07:30"), null, [V(1, "t1", "2027-03-15", "10:00", "11:00", "cancel")]),
    // Day boundary, written as UTC instants (as a database returns timestamptz), so taking the date
    // from the string instead of converting to Asia/Jerusalem fails: opened 1.3 00:30 Jerusalem
    // (28.2 22:30 UTC); visit on 15.3 00:30–01:30 Jerusalem (14.3 22:30–23:30 UTC); closed 15.3 01:00.
    C("S13", "P-1", "yes", "2027-02-28T22:30:00Z", "2027-03-14T23:00:00Z", [
      V(1, "t2", "2027-03-15", "00:30", "01:30", "done", [null, null, null], {
        scheduledStart: "2027-03-14T22:30:00Z",
        scheduledEnd: "2027-03-14T23:30:00Z",
        departedAt: "2027-03-14T22:00:00Z",
        arrivedAt: "2027-03-14T22:20:00Z",
        endedAt: "2027-03-14T23:00:00Z",
      }),
    ]),
    // Closed on 1.3 00:10 Jerusalem (28.2 22:10 UTC, written as UTC): a March closure; visit 2
    // crosses midnight (23:00 → 00:10 Jerusalem = 70 min).
    C("S14", "P-4", "yes", J("2027-02-26", "08:00"), "2027-02-28T22:10:00Z", [
      V(1, "t1", "2027-02-26", "08:00", "09:30", "cont", ["08:00", "08:30", "09:30"]),
      V(2, "t1", "2027-02-28", "23:00", "00:30", "done", ["22:40", "23:00", null], {
        scheduledEnd: "2027-02-28T22:30:00Z",
        endedAt: "2027-02-28T22:10:00Z",
      }),
    ]),
  ];
}

/** Variant S-P: only S7 and S13 are test-marked. */
const datasetSP = (): MetricCall[] => datasetS().map((c) => ({ ...c, isTest: c.req === "S7" || c.req === "S13" }));

/** Variant S-D: S13/1 twice inside S13, and the whole S2 record twice. */
function datasetSD(): MetricCall[] {
  const calls = datasetS();
  const s13 = calls.find((c) => c.req === "S13") as MetricCall;
  s13.visits.push({ ...(s13.visits[0] as MetricVisit) });
  calls.push(structuredClone(calls.find((c) => c.req === "S2") as MetricCall));
  return calls;
}

const NOW = J("2027-03-15", "12:00");
const TEST_ENV: DashboardScope = "test-env";
const MARCH: AnalyticsPeriod = { from: "2027-03-01", to: "2027-03-31" };
const FEBRUARY: AnalyticsPeriod = { from: "2027-02-01", to: "2027-02-28" };
const JANUARY: AnalyticsPeriod = { from: "2027-01-01", to: "2027-01-31" };
const day = (d: string): AnalyticsPeriod => ({ from: d, to: d });

const refs = (rs: readonly VisitRecord[]): string[] => rs.map((r) => `${r.call.req}/${r.visit.n}`);
const reqs = (found: DetailRecords | null): string[] => (found ? found.rows.map((r) => r.call.req).sort() : []);
const v = (m: Metric): number | null => m.value;
/** A duration as the screen shows it: T7 over the unrounded mean (`durationHours`), rounded once. */
const shown = (m: Metric): string | null => (m.value === null ? null : durationDisplay(m.durationHours ?? m.value).text);

// 1-10: dataset S --------------------------------------------------------------------------------

test.describe("manager dashboard formulas: dataset S (spec-final §10.1)", () => {
  onlyInProject("desktop");

  test("1. today: planned / done / pending / missed partition today's visits (T1), Asia/Jerusalem day", () => {
    const t = todayVisits(datasetS(), NOW, TEST_ENV);
    expect(t.asOf).toBe("2027-03-15");
    // S13/1 counts on 15.3 although its UTC date is 14.3; scheduled order.
    expect(refs(t.planned)).toEqual(["S13/1", "S5/1", "S11/1", "S9/2"]);
    // S5/1 closed at 09:10 after its 09:00 end: done, not missed.
    expect(refs(t.done)).toEqual(["S13/1", "S5/1"]);
    expect(refs(t.pending)).toEqual(["S9/2"]);
    expect(refs(t.missed)).toEqual(["S11/1"]);
    // On no card: S12/1 (cancelled), S6/1 (16.3), S3/2 (open, scheduled yesterday).
    const all = [...t.planned, ...t.done, ...t.pending, ...t.missed].map((r) => r.call.req);
    expect(all).not.toContain("S12");
    expect(all).not.toContain("S6");
    expect(all).not.toContain("S3");

    const g = generalMetrics(datasetS(), NOW, 6, TEST_ENV);
    expect([v(g.today.planned), v(g.today.done), v(g.today.pending), v(g.today.missed)]).toEqual([4, 2, 1, 1]);
    expect(g.today.progress).toMatchObject({ value: 50, unit: "percent", basis: 4 });

    // now = scheduled end is not overdue: at 11:00 S11/1 (09:00–11:00) is still pending.
    const at11 = todayVisits(datasetS(), J("2027-03-15", "11:00"), TEST_ENV);
    expect([at11.missed.length, at11.pending.length]).toEqual([0, 2]);
    const at0830 = todayVisits(datasetS(), J("2027-03-15", "08:30"), TEST_ENV);
    expect([at0830.missed.length, at0830.pending.length]).toEqual([0, 2]);
  });

  test("2. service metrics over the current calendar month (D56 (2)): weighted means, first-visit rule, closure", () => {
    const s = generalMetrics(datasetS(), NOW, 6, TEST_ENV).service;
    expect(s.period).toEqual(MARCH);
    // 10 closed visits in March. Travel: 30+20+40 (S1) + 20+30 (S2) + 15 (S9) + 20 (S13) = 175 ÷ 7 = 25;
    // missing 2 (S4/2 no departure, S5/1 no arrival), invalid 1 (S10/1: −10).
    expect(closedVisitsIn(datasetS(), MARCH, TEST_ENV)).toHaveLength(10);
    expect(s.travel).toMatchObject({ value: 25, unit: "minutes", basis: 7, excluded: { missing: 2, invalid: 1 } });
    // Treatment: 60+60+80 + 60+30 + 50 (S4) + 31 (S9) + 50 (S10) + 40 (S13) = 461 ÷ 9 = 51.2 → 51; missing 1 (S5/1).
    expect(s.treat).toMatchObject({ value: 51, basis: 9, excluded: { missing: 1, invalid: 0 } });
    // First performed visit (D57 (5)): S4, S5, S9, S10, S13 "טופל"; S1, S2 "המשך טיפול" → 5 of 7 = 71%.
    // S9 qualifies although a later visit is scheduled; S4's first performed visit is visit 2 (visit 1 cancelled).
    expect(s.firstVisit).toMatchObject({ value: 71, basis: 7 });
    const fv = firstVisitCalls(datasetS(), MARCH, TEST_ENV);
    expect(fv.filter((r) => r.resolved).map((r) => r.call.req).sort()).toEqual(["S10", "S13", "S4", "S5", "S9"]);
    expect(fv.filter((r) => !r.resolved).map((r) => r.call.req).sort()).toEqual(["S1", "S2"]);
    expect(fv.find((r) => r.call.req === "S4")?.visit.n).toBe(2);
    // Closure: S1 218 h, S2 99, S4 98.83, S5 17.17, S10 2.67, S13 336.5, S14 64.17 → 836.33 ÷ 7 = 119.48 h = "5.0 ימים".
    // S14 counts in March by its Jerusalem date although its UTC date is 28.2.
    // `value` to two decimals; `durationHours` unrounded (836.33… ÷ 7 = 119.476…), shown per T7.
    expect(s.closeTime).toMatchObject({ value: 119.48, unit: "duration", basis: 7, durationHours: expect.closeTo(119.476, 3) });
    expect(shown(s.closeTime)).toBe("5.0 ימים");
    expect(completedCallsIn(datasetS(), MARCH, TEST_ENV).map((r) => r.call.req).sort()).toEqual(["S1", "S10", "S13", "S14", "S2", "S4", "S5"]);
  });

  test("3. highlights: the last 30 days by opening date, unique calls; calls without a supplier are not ranked (T4, T13)", () => {
    const h = generalMetrics(datasetS(), NOW, 6, TEST_ENV).highlights;
    // 14.2–15.3 (S8, opened 13.2, is outside).
    expect(h.period).toEqual({ from: "2027-02-14", to: "2027-03-15" });
    // S3, S4, S12, S14 have no supplier: not ranked.
    expect(h.suppliers.items).toEqual([
      { key: "ספק א", label: "ספק א", value: 5 },
      { key: "ספק ב", label: "ספק ב", value: 4 },
    ]);
    expect(h.suppliers.total).toBe(2);
    // P-2 and P-4 tie at 2: SKU order.
    expect(h.skus.items.map((r) => [r.key, r.value])).toEqual([
      ["P-1", 5],
      ["P-3", 4],
      ["P-2", 2],
      ["P-4", 2],
    ]);
    expect(reqs(detailRecords(datasetS(), "top.suppliers", { now: NOW, group: "ספק ב" }, TEST_ENV))).toEqual(["S11", "S5", "S6", "S9"]);
    // "לא הוזן" is not a ranked supplier, so it has no dialog on the General tab.
    expect(detailRecords(datasetS(), "top.suppliers", { now: NOW, group: NONE_GROUP_KEY }, TEST_ENV)).toBeNull();
  });

  test("4. trend: completed months, opened by opening date and closed by closing date, Asia/Jerusalem months", () => {
    const g = generalMetrics(datasetS(), NOW, 6, TEST_ENV);
    expect(g.coverageStart).toBe("2027-02-13");
    expect(g.trend.rows).toEqual([
      { month: "2026-09", opened: null, closed: null },
      { month: "2026-10", opened: null, closed: null },
      { month: "2026-11", opened: null, closed: null },
      { month: "2026-12", opened: null, closed: null },
      { month: "2027-01", opened: null, closed: null },
      // S7, S8, S14 opened; S7, S8 closed. S13 (opened 1.3 Jerusalem) and S14's closure (1.3 Jerusalem) are March.
      { month: "2027-02", opened: 3, closed: 2 },
    ]);
    expect(trendMembers(datasetS(), "2027-03", "opened", TEST_ENV)).toHaveLength(11);
    expect(trendMembers(datasetS(), "2027-03", "closed", TEST_ENV)).toHaveLength(7);
    expect(generalMetrics(datasetS(), NOW, 3, TEST_ENV).trend.rows.map((r) => r.month)).toEqual(["2026-12", "2027-01", "2027-02"]);
    const twelve = generalMetrics(datasetS(), NOW, 12, TEST_ENV).trend.rows;
    expect([twelve.length, twelve[0]?.month, twelve[11]?.month]).toEqual([12, "2026-03", "2027-02"]);
    // Dialog: a completed month only; the current month or a malformed group has none.
    expect(reqs(detailRecords(datasetS(), "trend.opened", { now: NOW, group: "2027-02" }, TEST_ENV))).toEqual(["S14", "S7", "S8"]);
    expect(reqs(detailRecords(datasetS(), "trend.closed", { now: NOW, group: "2027-02" }, TEST_ENV))).toEqual(["S7", "S8"]);
    expect(detailRecords(datasetS(), "trend.opened", { now: NOW, group: "2027-03" }, TEST_ENV)).toBeNull();
    expect(detailRecords(datasetS(), "trend.opened", { now: NOW, group: "2027-2" }, TEST_ENV)).toBeNull();
    expect(detailRecords(datasetS(), "trend.opened", { now: NOW, group: "2026-12" }, TEST_ENV)).toEqual({ records: "calls", rows: [] });
  });

  test("5. technician t1, March: planned includes performed and later visits (T12); closures by resolving visit (T2)", () => {
    const t = technicianMetrics(datasetS(), "t1", MARCH, NOW, TEST_ENV);
    // Planned 8: S1 ×3, S2/1, S5/1, S6/1 (16.3), S9 ×2; not S12/1 (cancelled) nor S14/2 (28.2).
    expect([v(t.activity.planned), v(t.activity.done), v(t.activity.closedCalls)]).toEqual([8, 6, 3]);
    // Closed calls S1, S5, S14 (S2's resolving visit is t2's).
    expect(reqs(detailRecords(datasetS(), "tech.closedCalls", { now: NOW, period: MARCH, tech: "t1" }, TEST_ENV))).toEqual(["S1", "S14", "S5"]);
    // Treatment 60+60+80+60+31 = 291 ÷ 5 = 58; travel 30+20+40+20+15 = 125 ÷ 5 = 25.
    expect([v(t.performance.treat), v(t.performance.travel)]).toEqual([58, 25]);
    // First visit S5, S9 of S1, S2, S5, S9 = 50%; closure (218 + 17.17 + 64.17) ÷ 3 = 99.78 h = "4.2 ימים".
    expect(t.performance.firstVisit).toMatchObject({ value: 50, basis: 4 });
    expect(t.performance.closeTime).toMatchObject({ value: 99.78, basis: 3 });
    expect(shown(t.performance.closeTime)).toBe("4.2 ימים");
    expect(t.performance.planAdherence).toEqual({ value: null, unit: "percent", state: "pendingDefinition" });
  });

  test("6. technician t2, March and a day with only a stale open visit", () => {
    const t = technicianMetrics(datasetS(), "t2", MARCH, NOW, TEST_ENV);
    // Planned 6 includes the stale S3/2 on 14.3; closed calls S2, S4, S10, S13.
    expect([v(t.activity.planned), v(t.activity.done), v(t.activity.closedCalls)]).toEqual([6, 4, 4]);
    // Treatment 30+50+50+40 = 170 ÷ 4 = 42.5 → 43 (half up); travel 30+20 = 50 ÷ 2 = 25 (missing 1, invalid 1).
    expect(t.performance.treat).toMatchObject({ value: 43, basis: 4 });
    expect(t.performance.travel).toMatchObject({ value: 25, basis: 2, excluded: { missing: 1, invalid: 1 } });
    // First visit 3/3 (S4, S10, S13); closure (99 + 98.83 + 2.67 + 336.5) ÷ 4 = 134.25 h = "5.6 ימים".
    expect(t.performance.firstVisit).toMatchObject({ value: 100, basis: 3 });
    expect(t.performance.closeTime).toMatchObject({ value: 134.25, basis: 4 });
    expect(shown(t.performance.closeTime)).toBe("5.6 ימים");

    const d14 = technicianMetrics(datasetS(), "t2", day("2027-03-14"), NOW, TEST_ENV);
    expect([v(d14.activity.planned), v(d14.activity.done), v(d14.activity.closedCalls)]).toEqual([1, 0, 0]);
    expect([v(d14.performance.treat), v(d14.performance.travel), v(d14.performance.firstVisit), v(d14.performance.closeTime)]).toEqual([
      null,
      null,
      null,
      null,
    ]);
  });

  test("7. technician t1 in other periods: missing measurements, empty days, weeks, month boundaries, before coverage", () => {
    const d15 = technicianMetrics(datasetS(), "t1", day("2027-03-15"), NOW, TEST_ENV);
    expect([v(d15.activity.planned), v(d15.activity.done), v(d15.activity.closedCalls)]).toEqual([2, 1, 1]);
    // S5/1 has no arrival report: both averages "—" (never 0), basis 0, one missing measurement each.
    expect(d15.performance.treat).toMatchObject({ value: null, basis: 0, excluded: { missing: 1, invalid: 0 } });
    expect(d15.performance.travel).toMatchObject({ value: null, basis: 0, excluded: { missing: 1, invalid: 0 } });
    expect(v(d15.performance.firstVisit)).toBe(100);
    // 17.17 h: whole hours below 48 (T7).
    expect(d15.performance.closeTime.value).toBe(17.17);
    expect(shown(d15.performance.closeTime)).toBe("17 שעות");

    // 3.3 is inside coverage with no t1 visit: real zeros for counts, "—" for averages and rates.
    const d3 = technicianMetrics(datasetS(), "t1", day("2027-03-03"), NOW, TEST_ENV);
    expect([v(d3.activity.planned), v(d3.activity.done), v(d3.activity.closedCalls)]).toEqual([0, 0, 0]);
    expect([v(d3.performance.treat), v(d3.performance.travel), v(d3.performance.firstVisit), v(d3.performance.closeTime)]).toEqual([
      null,
      null,
      null,
      null,
    ]);

    // Week 14–20.3 (Sunday start): S5/1, S9/2, S6/1.
    const week = resolveDashboardPeriod({ kind: "week" }, "2027-03-15");
    expect(week.period).toEqual({ from: "2027-03-14", to: "2027-03-20" });
    const w = technicianMetrics(datasetS(), "t1", week.period, NOW, TEST_ENV);
    expect([v(w.activity.planned), v(w.activity.done)]).toEqual([3, 1]);

    // February: S14 closed in March (closure date, not visit date); S14/2 crosses midnight (23:00 → 00:10 = 70 min).
    const feb = technicianMetrics(datasetS(), "t1", FEBRUARY, NOW, TEST_ENV);
    expect([v(feb.activity.planned), v(feb.activity.done), v(feb.activity.closedCalls)]).toEqual([2, 2, 0]);
    // Treatment (60 + 70) ÷ 2 = 65; travel (30 + 20) ÷ 2 = 25; S14's first performed visit was "המשך טיפול": 0%.
    expect([v(feb.performance.treat), v(feb.performance.travel)]).toEqual([65, 25]);
    expect(feb.performance.firstVisit).toMatchObject({ value: 0, basis: 1 });

    // January ends before the first call (13.2): every metric is "no data", counts included.
    const jan = technicianMetrics(datasetS(), "t1", JANUARY, NOW, TEST_ENV);
    for (const m of [...Object.values(jan.activity), jan.performance.treat, jan.performance.travel, jan.performance.firstVisit, jan.performance.closeTime]) {
      expect(m.value).toBeNull();
    }
    expect(jan.performance.planAdherence.state).toBe("pendingDefinition");
    expect(detailRecords(datasetS(), "tech.planned", { now: NOW, period: JANUARY, tech: "t1" }, TEST_ENV)).toEqual({ records: "visits", rows: [] });
  });

  test("8. products: unique calls (never visits), known warranty only, follow-up per D57 (5)", () => {
    const p = productMetrics(datasetS(), NOW, TEST_ENV);
    // "לא הוזן" is kept in the totals; among equals it comes last.
    expect(p.bySupplier.map((r) => [r.key, r.value])).toEqual([
      ["ספק א", 5],
      [NONE_GROUP_KEY, 5],
      ["ספק ב", 4],
    ]);
    expect(p.bySupplier[1]?.label).toBe("");
    expect(p.byBrand.map((r) => [r.key, r.value])).toEqual([
      ["מותג ב", 7],
      ["מותג א", 5],
      [NONE_GROUP_KEY, 2],
    ]);
    // P-1: 5 calls (8 closed visits). Warranty 3/5 = 60%; P-3 2/3 = 67%; P-4 3/3 = 100%; P-2 unknown only: "—".
    // Follow-up: P-1 S1, S2 of S1, S2, S7, S10, S13 = 40% (a visit-based rate would be 38%); P-3 0% (S9's two
    // visits are not a follow-up; S6 and S11 have no performed visit); P-4 S14 of S4, S8, S14 = 33%; P-2 "—".
    expect(p.skus.map((r) => [r.sku, r.calls, v(r.warrantyRate), v(r.followupRate)])).toEqual([
      ["P-1", 5, 60, 40],
      ["P-3", 4, 67, 0],
      ["P-4", 3, 100, 33],
      ["P-2", 2, null, null],
    ]);
    const p1 = detailRecords(datasetS(), "prod.skuCalls", { now: NOW, group: "P-1" }, TEST_ENV);
    expect(reqs(p1)).toEqual(["S1", "S10", "S13", "S2", "S7"]);
    // Historical follow-up although S1 and S2 are now closed ("טופלה").
    const rows = p1?.records === "calls" ? p1.rows : [];
    expect(rows.filter((r) => r.followupRequired).map((r) => [r.call.req, r.status]).sort()).toEqual([
      ["S1", "resolved"],
      ["S2", "resolved"],
    ]);
    expect(reqs(detailRecords(datasetS(), "prod.bySupplier", { now: NOW, group: NONE_GROUP_KEY }, TEST_ENV))).toEqual(["S12", "S14", "S3", "S4", "S8"]);
    // "תקלה נפוצה" has no records and never a value.
    expect(detailRecords(datasetS(), "prod.topIssue", { now: NOW }, TEST_ENV)).toBeNull();
  });

  test("9. production scope drops test-marked calls before any computation (SIM-08)", () => {
    const g = generalMetrics(datasetSP(), NOW, 6, "production");
    expect(g.includesTestData).toBe(false);
    expect(g.coverageStart).toBe("2027-02-13");
    // S13/1 excluded: 3 / 1 / 1 / 1, 33%.
    expect([v(g.today.planned), v(g.today.done), v(g.today.pending), v(g.today.missed), v(g.today.progress)]).toEqual([3, 1, 1, 1, 33]);
    // Travel 155 ÷ 6 = 25.8 → 26; treatment 421 ÷ 8 = 52.6 → 53; first visit 4 of 6 = 67%; closure 499.83 ÷ 6 = 83.31 h.
    expect([v(g.service.travel), v(g.service.treat), v(g.service.firstVisit), v(g.service.closeTime)]).toEqual([26, 53, 67, 83.31]);
    expect(shown(g.service.closeTime)).toBe("3.5 ימים");
    expect(g.highlights.suppliers.items.map((r) => [r.key, r.value])).toEqual([
      ["ספק ב", 4],
      ["ספק א", 3],
    ]);
    expect(g.highlights.skus.items.map((r) => [r.key, r.value])).toEqual([
      ["P-3", 4],
      ["P-1", 3],
      ["P-2", 2],
      ["P-4", 2],
    ]);
    expect(g.trend.rows.at(-1)).toEqual({ month: "2027-02", opened: 2, closed: 1 });
    const p1 = productMetrics(datasetSP(), NOW, "production").skus.find((r) => r.sku === "P-1");
    expect([p1?.calls, p1 && v(p1.warrantyRate), p1 && v(p1.followupRate)]).toEqual([3, 33, 67]);

    // The same variant in a test environment gives the values of items 1-8.
    const t = generalMetrics(datasetSP(), NOW, 6, TEST_ENV);
    expect(t.includesTestData).toBe(true);
    expect([v(t.today.planned), v(t.today.done), v(t.today.pending), v(t.today.missed)]).toEqual([4, 2, 1, 1]);
    expect([v(t.service.travel), v(t.service.treat), v(t.service.firstVisit), v(t.service.closeTime)]).toEqual([25, 51, 71, 119.48]);
    expect(generalMetrics(datasetS(), NOW, 6, TEST_ENV).includesTestData).toBe(true);
  });

  test("10. no double counting: a repeated visit or call record counts once (first occurrence wins)", () => {
    expect(countedCalls(datasetSD(), TEST_ENV)).toHaveLength(14);
    const g = generalMetrics(datasetSD(), NOW, 6, TEST_ENV);
    expect([v(g.today.planned), v(g.today.done), v(g.today.pending), v(g.today.missed)]).toEqual([4, 2, 1, 1]);
    expect([v(g.service.travel), v(g.service.treat)]).toEqual([25, 51]);
    expect(g.service.closeTime).toMatchObject({ value: 119.48, basis: 7 });
    expect(shown(g.service.closeTime)).toBe("5.0 ימים");
    const p = productMetrics(datasetSD(), NOW, TEST_ENV);
    const p1 = p.skus.find((r) => r.sku === "P-1");
    expect([p1?.calls, p1 && v(p1.followupRate)]).toEqual([5, 40]);
    expect(p.bySupplier.find((r) => r.key === "ספק א")?.value).toBe(5);
    expect(technicianMetrics(datasetSD(), "t1", MARCH, NOW, TEST_ENV).activity.planned.value).toBe(8);
  });
});

// Focused rules (review findings MC-2 to MC-7): small synthetic sets beside dataset S ---------------

test.describe("manager dashboard formulas: focused rules", () => {
  onlyInProject("desktop");

  /** A March call with one performed visit on 10.3. */
  const X = (req: string, openedAt: string, resolvedAt: string | null, visits?: MetricVisit[]): MetricCall =>
    C(req, "P-1", "yes", openedAt, resolvedAt, visits ?? [V(1, "t1", "2027-03-10", "09:00", "10:00", "done", ["08:00", "08:30", "09:30"])]);

  test("closure time: resolved_at before opened_at is invalid and a missing opened_at is missing; both excluded, never averaged (T6)", () => {
    const calls = [
      X("X1", J("2027-03-10", "08:00"), J("2027-03-10", "18:00")),
      // Resolved one hour before it was opened (clock skew, a bad import): an impossible sequence.
      X("X2", J("2027-03-10", "19:00"), J("2027-03-10", "18:00")),
    ];
    expect(closeTime(calls, MARCH, TEST_ENV)).toMatchObject({ value: 10, basis: 1, excluded: { missing: 0, invalid: 1 } });
    calls.push(X("X3", "", J("2027-03-10", "18:00")));
    expect(closeTime(calls, MARCH, TEST_ENV)).toMatchObject({ value: 10, basis: 1, excluded: { missing: 1, invalid: 1 } });
    // Only X1 is measured; the dialog still lists all three, the unmeasurable ones without a duration.
    expect(completedCallsIn(calls, MARCH, TEST_ENV).map((r) => [r.call.req, r.problem])).toEqual([
      ["X1", null],
      ["X2", "invalid"],
      ["X3", "missing"],
    ]);
  });

  test("only calls resolved now (D38) count as closed, even with a resolved_at left set (T8)", () => {
    // R1: resolved on visit 1, then visit 2 closed "המשך טיפול": the call is awaiting follow-up now.
    const r1 = X("R1", J("2027-03-02", "08:00"), J("2027-03-05", "10:00"), [
      V(1, "t1", "2027-03-05", "09:00", "10:00", "done", ["08:00", "08:30", "10:00"]),
      V(2, "t1", "2027-03-08", "09:00", "10:00", "cont", ["08:00", "08:30", "09:30"]),
    ]);
    // R2: resolved on visit 1, then reopened by a new visit (still open).
    const r2 = X("R2", J("2027-03-02", "08:00"), J("2027-03-05", "10:00"), [
      V(1, "t1", "2027-03-05", "09:00", "10:00", "done", ["08:00", "08:30", "10:00"]),
      V(2, "t1", "2027-03-16", "09:00", "10:00", "new"),
    ]);
    // R3: resolved and still resolved (the control).
    const r3 = X("R3", J("2027-03-02", "08:00"), J("2027-03-05", "10:00"), [
      V(1, "t1", "2027-03-05", "09:00", "10:00", "done", ["08:00", "08:30", "10:00"]),
    ]);
    const calls = [r1, r2, r3];
    expect(trendMembers(calls, "2027-03", "closed", TEST_ENV).map((c) => c.req)).toEqual(["R3"]);
    expect(completedCallsIn(calls, MARCH, TEST_ENV).map((r) => r.call.req)).toEqual(["R3"]);
    // 2.3 08:00 → 5.3 10:00 = 74 h.
    expect(closeTime(calls, MARCH, TEST_ENV)).toMatchObject({ value: 74, basis: 1 });
    expect(v(technicianMetrics(calls, "t1", MARCH, NOW, TEST_ENV).activity.closedCalls)).toBe(1);
  });

  test("30-day highlights count calls by opening date, not by closing date (T4)", () => {
    // Opened 10.2 (before the 14.2–15.3 window), closed inside it on 20.2.
    const early = C("S15", "P-1", "yes", J("2027-02-10", "08:00"), J("2027-02-20", "10:00"), [
      V(1, "t2", "2027-02-20", "09:00", "10:00", "done", ["08:00", "08:30", "10:00"]),
    ]);
    const calls = [...datasetS(), early];
    const h = generalMetrics(calls, NOW, 6, TEST_ENV).highlights;
    expect(h.skus.items.find((r) => r.key === "P-1")?.value).toBe(5);
    expect(h.suppliers.items.find((r) => r.key === "ספק א")?.value).toBe(5);
    expect(reqs(detailRecords(calls, "top.skus", { now: NOW, group: "P-1" }, TEST_ENV))).not.toContain("S15");
  });

  test("a call stamped after `now` (clock skew) is counted nowhere: products, coverage, highlights", () => {
    // Opened 13:00 on 15.3, an hour after NOW; a visit tomorrow.
    const late = C("S16", "P-3", "yes", J("2027-03-15", "13:00"), null, [V(1, "t1", "2027-03-16", "09:00", "10:00", "new")]);
    const calls = [...datasetS(), late];
    const p = productMetrics(calls, NOW, TEST_ENV);
    expect(p.skus.find((r) => r.sku === "P-3")?.calls).toBe(4);
    expect(p.bySupplier.find((r) => r.key === "ספק ב")?.value).toBe(4);
    const g = generalMetrics(calls, NOW, 6, TEST_ENV);
    expect(g.coverageStart).toBe("2027-02-13");
    expect(g.highlights.suppliers.items.find((r) => r.key === "ספק ב")?.value).toBe(4);
    expect(g.highlights.skus.items.find((r) => r.key === "P-3")?.value).toBe(4);
    expect(reqs(detailRecords(calls, "top.suppliers", { now: NOW, group: "ספק ב" }, TEST_ENV))).toEqual(["S11", "S5", "S6", "S9"]);
    expect(reqs(detailRecords(calls, "prod.skuCalls", { now: NOW, group: "P-3" }, TEST_ENV))).not.toContain("S16");
  });

  test("chart gridlines: whole-number steps, the scale four steps (never \"12.5\")", () => {
    // [largest value, step]: 28 → 10 (10 / 20 / 30, scale 40); 2 → 1; 1 → 1; 10 → 5; 50 → 20; 100 → 25; 0 → 1.
    for (const [max, step] of [
      [28, 10],
      [2, 1],
      [1, 1],
      [10, 5],
      [50, 20],
      [100, 25],
      [0, 1],
    ] as const) {
      expect(gridStep(max), String(max)).toBe(step);
      expect(Number.isInteger(gridStep(max)) && 4 * gridStep(max) >= max, String(max)).toBe(true);
    }
  });

  test("closure time is rounded once for display (T7): 47.496 h reads \"47 שעות\", not \"2.0 ימים\"", () => {
    // 47 h 29 min 45 s = 47.4958 h: rounding to two decimals first would give 47.50 → 48 → "2.0 ימים".
    const calls = [X("D1", "2027-03-08T08:00:00+02:00", "2027-03-10T07:29:45+02:00")];
    const m = closeTime(calls, MARCH, TEST_ENV);
    expect(m.value).toBe(47.5);
    expect(m.durationHours).toBeCloseTo(47.4958, 4);
    expect(shown(m)).toBe("47 שעות");
    // The KPI tile formats from the unrounded hours too (verify follow-up 2: a tile that used the
    // rounded value would read "2.0 ימים").
    expect(formatMetric(m)).toBe("47 שעות");
    expect(formatMetricNumber(m)).toBe("47");
    // A dialog row carries the unrounded hours too.
    const rows = detailRecords(calls, "service.closeTime", { now: NOW }, TEST_ENV);
    const row = rows?.records === "calls" ? rows.rows[0] : undefined;
    expect(row?.durationHours).toBeCloseTo(47.4958, 4);
    expect(durationDisplay(row?.durationHours ?? 0).text).toBe("47 שעות");
  });
});

// Details dialog: keys, groups and context -----------------------------------------------------------

test.describe("manager dashboard details: records only for approved keys with a valid group", () => {
  onlyInProject("desktop");

  test("records per key; null for pending, unavailable and record-less keys, wrong groups and missing context", () => {
    const S = datasetS();
    const planned = detailRecords(S, "today.planned", { now: NOW }, TEST_ENV);
    expect(planned?.records).toBe("visits");
    expect(planned?.records === "visits" ? planned.rows.map((r) => `${r.call.req}/${r.visit.n}`) : []).toEqual(["S13/1", "S5/1", "S11/1", "S9/2"]);
    const missed = detailRecords(S, "today.missed", { now: NOW }, TEST_ENV);
    expect(missed?.records === "visits" ? missed.rows.map((r) => r.visit.source) : []).toEqual(["simulator"]);
    // Treatment rows carry their whole minutes; a missing measurement is null, never 0.
    const treat = detailRecords(S, "service.treat", { now: NOW }, TEST_ENV);
    const s5 = treat?.records === "visits" ? treat.rows.find((r) => r.call.req === "S5") : undefined;
    expect(s5?.minutes).toBeNull();
    // First-visit rows say whether the first performed visit resolved the call.
    const fv = detailRecords(S, "service.firstVisit", { now: NOW }, TEST_ENV);
    expect(fv?.records === "calls" ? fv.rows.find((r) => r.call.req === "S1")?.firstVisitResolved : undefined).toBe(false);
    // Closure rows carry the duration and the credited technician (T2).
    const close = detailRecords(S, "service.closeTime", { now: NOW }, TEST_ENV);
    const s2 = close?.records === "calls" ? close.rows.find((r) => r.call.req === "S2") : undefined;
    expect([s2?.durationHours, s2?.technician]).toEqual([99, "t2"]);

    for (const key of ["tech.planAdherence", "prod.topIssue", "today.progress", "prod.warrantyRate", "prod.followupRate"] as const) {
      expect(detailRecords(S, key, { now: NOW }, TEST_ENV)).toBeNull();
    }
    // A grouped key needs a known group; an ungrouped key takes none.
    expect(detailRecords(S, "prod.skuCalls", { now: NOW }, TEST_ENV)).toBeNull();
    expect(detailRecords(S, "prod.skuCalls", { now: NOW, group: "BOGUS" }, TEST_ENV)).toBeNull();
    expect(detailRecords(S, "today.done", { now: NOW, group: "P-1" }, TEST_ENV)).toBeNull();
    // Technicians keys need the technician and the period.
    expect(detailRecords(S, "tech.done", { now: NOW }, TEST_ENV)).toBeNull();
    expect(detailRecords(S, "tech.done", { now: NOW, tech: "t1" }, TEST_ENV)).toBeNull();
    expect(reqs(detailRecords(S, "tech.done", { now: NOW, period: day("2027-03-15"), tech: "t1" }, TEST_ENV))).toEqual(["S5"]);
    // An invalid `now` is refused.
    expect(() => detailRecords(S, "today.planned", { now: "2027-03-15 12:00" }, TEST_ENV)).toThrow(RangeError);
  });
});

// Registry ---------------------------------------------------------------------------------------

test.describe("manager dashboard metric registry (D57 (4))", () => {
  onlyInProject("desktop");

  const perms = (on: readonly PermissionKey[]): RolePermissions => ({
    role: "mgr",
    status: "temporary",
    values: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, on.includes(k)])) as Record<PermissionKey, boolean>,
  });

  test("every key has a tab, unit, category, definition and source; the owner categories", () => {
    expect(Object.keys(METRIC_DEFINITIONS)).toEqual([...DASHBOARD_METRIC_KEYS]);
    for (const key of DASHBOARD_METRIC_KEYS) {
      const d = METRIC_DEFINITIONS[key];
      expect(d.key).toBe(key);
      expect(["gen", "tech", "prod"]).toContain(d.tab);
      expect(key.startsWith(d.tab === "gen" ? "" : `${d.tab}.`)).toBe(true);
      expect(["count", "percent", "minutes", "duration"]).toContain(d.unit);
      expect(d.label.trim()).not.toBe("");
      expect(d.definition.trim()).not.toBe("");
      expect(d.source.trim()).not.toBe("");
      expect(d.grouped).toBe(d.groupBy !== null);
      // T9 was withdrawn by D57 (5).
      expect(d.temporary as readonly string[]).not.toContain("T9");
      // A metric without an approved definition has no records behind it.
      if (d.category !== "approved") expect(d.records).toBeNull();
    }
    const of = (c: string) => DASHBOARD_METRIC_KEYS.filter((k) => METRIC_DEFINITIONS[k].category === c);
    expect(of("pendingDefinition")).toEqual(["tech.planAdherence"]);
    expect(of("approvedDataUnavailable")).toEqual(["prod.topIssue"]);
    // "לא בוצעו במועד" and both closure times are approved and computed (D57 (4)).
    for (const key of ["today.missed", "service.closeTime", "tech.closeTime"] as const) expect(METRIC_DEFINITIONS[key].category).toBe("approved");
    expect(isDashboardMetricKey("today.missed")).toBe(true);
    expect(isDashboardMetricKey("bogus")).toBe(false);
    expect(isDashboardMetricKey("toString")).toBe(false);
  });

  test("pending() and unavailable() never carry a value", () => {
    for (const unit of ["count", "percent", "minutes", "duration"] as const) {
      expect(pending(unit)).toEqual({ value: null, unit, state: "pendingDefinition" });
      expect(unavailable(unit)).toEqual({ value: null, unit, state: "unavailable" });
    }
  });

  test("the dashboard tabs are exactly the dashboard matrix keys (the landing never redirects to a page with no tab)", () => {
    expect(ANALYTICS_TABS.map((t) => t.permission)).toEqual([...DASHBOARD_PERMISSION_KEYS]);
  });

  test("detailOffered: approved keys with records on their own tab; rows need `calls`", () => {
    expect(detailOffered("today.missed", "gen")).toBe(true);
    expect(detailOffered("tech.done", "gen")).toBe(false);
    expect(detailOffered("tech.done", "tech")).toBe(true);
    expect(detailOffered("tech.planAdherence", "tech")).toBe(false);
    expect(detailOffered("prod.topIssue", "prod")).toBe(false);
    expect(detailOffered("today.progress", "gen")).toBe(false);
    expect(detailRowsOffered(perms(["dashGen", "dashTech", "dashProd"]))).toBe(false);
    expect(detailRowsOffered(perms(["dashGen", "calls"]))).toBe(true);
  });

  test("closure time display (T7): whole hours below 48, otherwise days with one decimal", () => {
    expect(durationDisplay(46.77).text).toBe("47 שעות");
    expect(durationDisplay(17.17)).toEqual({ amount: "17", unit: "שעות", text: "17 שעות" });
    expect(durationDisplay(47.6).text).toBe("2.0 ימים");
    expect(durationDisplay(90.98).text).toBe("3.8 ימים");
    expect(durationDisplay(50.02).text).toBe("2.1 ימים");
  });
});

// View and access (display only, G-04) ------------------------------------------------------------

test.describe("manager dashboard view and access (spec-final §6.2, §6.6)", () => {
  onlyInProject("desktop");

  const perms = (on: readonly PermissionKey[]): RolePermissions => ({
    role: "mgr",
    status: "temporary",
    values: Object.fromEntries(PERMISSION_KEYS.map((k) => [k, on.includes(k)])) as Record<PermissionKey, boolean>,
  });
  const view = (query: Record<string, string>, on: readonly PermissionKey[]) =>
    effectiveAnalyticsView(parseAnalyticsState(query), offeredAnalyticsTabs(perms(on)));
  const ALL_TABS: PermissionKey[] = ["dashGen", "dashTech", "dashProd"];

  test("without dashTech: view=reports and detail=tech.* are ignored (the first offered tab is shown)", () => {
    expect(view({ tab: "tech", view: "reports" }, ["dashGen", "dashProd", "calls"])).toEqual({ tab: "gen", view: null, detail: null });
    expect(view({ tab: "tech", detail: "tech.done" }, ["dashGen", "calls"]).detail).toBeNull();
    expect(view({ tab: "tech", view: "reports" }, ALL_TABS)).toEqual({ tab: "tech", view: "reports", detail: null });
    expect(view({}, [])).toEqual({ tab: null, view: null, detail: null });
    expect(view({}, ["dashProd"]).tab).toBe("prod");
  });

  test("the dialog opens only for an approved key with records, on its own tab, with a group of the right shape", () => {
    expect(view({ detail: "today.missed" }, ALL_TABS).detail).toEqual({ key: "today.missed", group: null });
    expect(view({ detail: "tech.done" }, ALL_TABS).detail).toBeNull();
    expect(view({ tab: "tech", detail: "tech.done" }, ALL_TABS).detail).toEqual({ key: "tech.done", group: null });
    // Never over the reports view.
    expect(view({ tab: "tech", view: "reports", detail: "tech.done" }, ALL_TABS).detail).toBeNull();
    for (const detail of ["bogus", "tech.planAdherence", "prod.topIssue", "today.progress", "prod.followupRate"]) {
      expect(view({ tab: detail.startsWith("prod") ? "prod" : detail.startsWith("tech") ? "tech" : "gen", detail }, ALL_TABS).detail, detail).toBeNull();
    }
    // Groups: required for grouped keys, refused for ungrouped ones, months as "YYYY-MM".
    expect(view({ detail: "trend.opened", group: "2026-09" }, ALL_TABS).detail).toEqual({ key: "trend.opened", group: "2026-09" });
    expect(view({ detail: "trend.opened", group: "BOGUS" }, ALL_TABS).detail).toBeNull();
    expect(view({ detail: "trend.opened" }, ALL_TABS).detail).toBeNull();
    expect(view({ detail: "today.done", group: "x" }, ALL_TABS).detail).toBeNull();
    expect(view({ tab: "prod", detail: "prod.skuCalls", group: "x".repeat(65) }, ALL_TABS).detail).toBeNull();
    expect(groupFitsMetric("prod.bySupplier", "__none__")).toBe(true);
    expect(groupFitsMetric("prod.bySupplier", "  ")).toBe(false);
  });

  test("records need `calls`; report columns need `card`; the recording marker needs `recordings`", () => {
    expect(detailRowsOffered(perms(ALL_TABS))).toBe(false);
    expect(reportsRowsOffered(perms(["dashTech"]))).toBe(false);
    expect(reportsRowsOffered(perms(["dashTech", "calls"]))).toBe(true);
    expect(reportsColumnsOffered(perms(["dashTech", "calls"]))).toEqual({ documentation: false, signature: false, recording: false });
    expect(reportsColumnsOffered(perms(["dashTech", "calls", "card"]))).toEqual({ documentation: true, signature: true, recording: false });
    expect(reportsColumnsOffered(perms(["dashTech", "calls", "card", "recordings"]))).toEqual({ documentation: true, signature: true, recording: true });
    expect(reportsColumnsOffered(perms(["dashTech", "calls", "recordings"])).recording).toBe(false);
  });

  test("technician selection: none, unknown, inactive", () => {
    const list = [
      { id: "s", active: false },
      { id: "y", active: true },
      { id: "e", active: true },
    ];
    expect(selectedTechnician([], "y")).toBeNull();
    expect(selectedTechnician(list, "zz")?.id).toBe("y");
    expect(selectedTechnician(list, null)?.id).toBe("y");
    expect(selectedTechnician(list, "s")?.id).toBe("s");
  });

  test("URL state: malformed values fall back; defaults are left out; only dialog links carry detail", () => {
    const st = parseAnalyticsState({ tab: "nope", months: "7", period: "decade", sort: "x", spage: "-2", dpage: "abc", detail: "nope" });
    expect(st).toMatchObject({ tab: "gen", months: 6, period: "month", sort: "calls-desc", spage: 1, dpage: 1, detail: null });
    // A custom range keeps what was typed; other periods drop from / to.
    expect(parseAnalyticsState({ period: "week", from: "2026-10-01" }).from).toBeUndefined();
    expect(parseAnalyticsState({ period: "custom", from: "2026-10-01" }).from).toBe("2026-10-01");
    const base = "/x";
    expect(analyticsHref(base, { tab: "gen", months: 6 })).toBe("/x");
    expect(analyticsHref(base, { tab: "gen", months: 12 })).toBe("/x?months=12");
    expect(analyticsHref(base, { tab: "tech", tech: "y", period: "month", offset: 0 })).toBe("/x?tab=tech&tech=y");
    expect(analyticsHref(base, { tab: "tech", tech: "y", period: "week", offset: -1 })).toBe("/x?tab=tech&tech=y&period=week&offset=-1");
    expect(analyticsHref(base, { tab: "tech", tech: "s", period: "custom", offset: -3, from: "2026-10-01", to: "2026-10-21" })).toBe(
      "/x?tab=tech&tech=s&period=custom&from=2026-10-01&to=2026-10-21",
    );
    expect(analyticsHref(base, { tab: "prod", sort: "calls-asc", spage: 2, detail: "prod.skuCalls", group: "KT-2041", dpage: 3 })).toBe(
      "/x?tab=prod&spage=2&sort=calls-asc&detail=prod.skuCalls&group=KT-2041&dpage=3",
    );
    expect(analyticsHref(base, { tab: "prod", detail: null, group: "KT-2041", dpage: 3 })).toBe("/x?tab=prod");
  });
});

// Periods ----------------------------------------------------------------------------------------

test.describe("manager dashboard periods (Asia/Jerusalem dates, no future navigation)", () => {
  onlyInProject("desktop");

  const ASOF = "2026-10-21";

  test("day / week (Sunday start) / month / year ranges and labels", () => {
    expect(resolveDashboardPeriod({ kind: "day" }, ASOF)).toMatchObject({ period: day(ASOF), label: "21.10.2026", canGoNext: false, canGoPrev: true });
    expect(resolveDashboardPeriod({ kind: "week" }, ASOF)).toMatchObject({ period: { from: "2026-10-18", to: "2026-10-24" }, label: "18.10–24.10.2026" });
    expect(resolveDashboardPeriod({ kind: "month" }, ASOF)).toMatchObject({ period: { from: "2026-10-01", to: "2026-10-31" }, label: "אוקטובר 2026" });
    expect(resolveDashboardPeriod({ kind: "year" }, ASOF)).toMatchObject({ period: { from: "2026-01-01", to: "2026-12-31" }, label: "2026" });
    expect(resolveDashboardPeriod({}, ASOF).kind).toBe("month");
    expect(resolveDashboardPeriod({ kind: "bogus" }, ASOF).kind).toBe("month");
    // Previous month from October.
    expect(resolveDashboardPeriod({ kind: "month", offset: -1 }, ASOF)).toMatchObject({ label: "ספטמבר 2026", canGoNext: true, period: { from: "2026-09-01", to: "2026-09-30" } });
    expect(resolveDashboardPeriod({ kind: "month", offset: "-10" }, ASOF).period).toEqual({ from: "2025-12-01", to: "2025-12-31" });
    // A week across a year boundary.
    expect(resolveDashboardPeriod({ kind: "week" }, "2027-01-01")).toMatchObject({ period: { from: "2026-12-27", to: "2027-01-02" }, label: "27.12.2026–2.1.2027" });
    expect(monthPeriod("2028-02")).toEqual({ from: "2028-02-01", to: "2028-02-29" });
  });

  test("offsets: positive or malformed → 0, below the minimum → the minimum", () => {
    for (const offset of [1, "1", "abc", 1.5, "", null, undefined]) expect(resolveDashboardPeriod({ kind: "day", offset }, ASOF).offset).toBe(0);
    expect(resolveDashboardPeriod({ kind: "day", offset: -1000 }, ASOF)).toMatchObject({ offset: MIN_OFFSET.day, canGoPrev: false, canGoNext: true });
    expect(resolveDashboardPeriod({ kind: "week", offset: -500 }, ASOF).offset).toBe(-104);
    expect(resolveDashboardPeriod({ kind: "month", offset: -30 }, ASOF).offset).toBe(-24);
    expect(resolveDashboardPeriod({ kind: "year", offset: -9 }, ASOF)).toMatchObject({ offset: -5, label: "2021" });
  });

  test("custom ranges: default, valid, and invalid (from > to, after today, longer than 366 days) with the month fallback", () => {
    expect(resolveDashboardPeriod({ kind: "custom" }, ASOF)).toMatchObject({ period: { from: "2026-10-01", to: ASOF }, label: "1.10.2026 – 21.10.2026" });
    const ok = resolveDashboardPeriod({ kind: "custom", from: "2026-10-01", to: "2026-10-21", offset: -3 }, ASOF);
    expect(ok).toMatchObject({ offset: 0, label: "1.10.2026 – 21.10.2026", canGoPrev: false, canGoNext: false });
    expect(ok.error).toBeUndefined();
    for (const [from, to] of [
      ["2026-10-10", "2026-10-01"],
      ["2026-10-01", "2026-10-22"],
      ["2025-10-20", "2026-10-21"],
      ["2026-10-01", "garbage"],
      ["2026-02-30", "2026-03-01"],
    ]) {
      const r = resolveDashboardPeriod({ kind: "custom", from, to }, ASOF);
      expect(r.error).toBe("invalid-range");
      expect(r.period).toEqual({ from: "2026-10-01", to: "2026-10-31" });
      expect(r.label).toBe("אוקטובר 2026");
    }
    // A leap year (366 days) fits.
    expect(resolveDashboardPeriod({ kind: "custom", from: "2028-01-01", to: "2028-12-31" }, "2029-01-10").error).toBeUndefined();
    expect(resolveDashboardPeriod({ kind: "custom", from: "2025-10-21", to: "2026-10-21" }, ASOF).error).toBeUndefined();
  });

  test("completed months and the coverage guard", () => {
    expect(completedMonths("2026-10-21", 6)).toEqual(["2026-04", "2026-05", "2026-06", "2026-07", "2026-08", "2026-09"]);
    expect(completedMonths("2027-01-10", 3)).toEqual(["2026-10", "2026-11", "2026-12"]);
    expect(beforeCoverage(monthPeriod("2026-06"), "2026-07-13")).toBe(true);
    expect(beforeCoverage(monthPeriod("2026-07"), "2026-07-13")).toBe(false);
    expect(beforeCoverage(monthPeriod("2026-07"), null)).toBe(true);
  });
});

// Time -------------------------------------------------------------------------------------------

test.describe("manager dashboard time helpers (Asia/Jerusalem)", () => {
  onlyInProject("desktop");

  test("the Jerusalem day boundary in winter (+02:00) and summer (+03:00)", () => {
    expect(jerusalemDate("2027-01-10T21:59:00Z")).toBe("2027-01-10");
    expect(jerusalemDate("2027-01-10T22:00:00Z")).toBe("2027-01-11");
    expect(jerusalemDate("2026-07-10T20:59:00Z")).toBe("2026-07-10");
    expect(jerusalemDate("2026-07-10T21:00:00Z")).toBe("2026-07-11");
    expect(jerusalemMonth("2027-02-28T22:10:00Z")).toBe("2027-03");
    expect(jerusalemDate("not a date")).toBeNull();
  });

  test("durations are instant differences, correct across the DST change", () => {
    expect(minutesBetween("2027-03-26T01:30:00+02:00", "2027-03-26T03:30:00+03:00")).toBe(60);
    expect(minutesBetween("2027-03-15T10:00:00+02:00", "2027-03-15T09:50:00+02:00")).toBe(-10);
    expect(minutesBetween(null, "2027-03-15T09:50:00+02:00")).toBeNull();
  });

  test("atJerusalem takes the date's offset from Intl; isIsoInstant needs an explicit offset", () => {
    expect(atJerusalem("2026-10-21", "12:45")).toBe("2026-10-21T12:45:00+03:00");
    expect(atJerusalem("2026-10-25", "12:00")).toBe("2026-10-25T12:00:00+02:00");
    expect(atJerusalem("2027-01-10", "08:00")).toBe("2027-01-10T08:00:00+02:00");
    expect(jerusalemDate(atJerusalem("2026-07-13", "00:10"))).toBe("2026-07-13");
    expect(isIsoInstant("2026-10-21T12:45:00+03:00")).toBe(true);
    expect(isIsoInstant("2026-10-21T09:45:00.000Z")).toBe(true);
    expect(isIsoInstant("2026-10-21T12:45:00")).toBe(false);
    expect(isIsoInstant("2026-02-31T10:00:00Z")).toBe(false);
    expect(isIsoInstant("2026-10-21")).toBe(false);
    expect(isIsoInstant(20261021)).toBe(false);
  });
});
