// FICTITIOUS DATA ONLY: dashboard aggregations over the demo's seeded calls, shaped as the DTOs in
// features/dashboards/data/types. Server-side; used only by adapter.ts. Allowed only under app/dev
// (G-05). A Supabase adapter computes the same figures in SQL.
// - The manager dashboard (D57): generalDashboard / technicianDashboard / productDashboard /
//   dashboardDetail map the fixtures to MetricCall and apply the pure formulas
//   (features/dashboards/data/formulas.ts), always with scope "test-env" (every fixture is test data).
// - The office home and work queue (officeOverview, csQueue) and the technician reports
//   (technicianDetail) are ported from docs/demo.html (L867-935).
// - managerAnalytics is the pre-D57 dashboard, kept only until the screen switches to the
//   tab-scoped methods (spec-final §8.5, PR-D); its products part already uses the D57 formulas.
import type { CallStatus } from "@/features/calls/data/types";
import { boundedOf, pageOf, type Bounded, type IsoDate } from "@/features/data-access/common";
import {
  detailRecords,
  generalMetrics,
  groupUniqueCalls,
  productMetrics,
  skuStats as skuRows,
  sortSkuRows,
  technicianMetrics,
  type GroupRow,
  type MetricCall,
  type MetricVisit,
  type SkuRow,
  type WarrantyState,
} from "@/features/dashboards/data/formulas";
import type { DashboardMetricKey } from "@/features/dashboards/data/metric-definitions";
import { jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";
import {
  DASHBOARD_DETAIL_PAGE_LIMIT,
  DASHBOARD_LIST_LIMIT,
  NONE_GROUP_KEY,
  OLDEST_FOLLOWUPS_LIMIT,
  type AnalyticsPeriod as Period,
  type BarRow,
  type CallAttentionItem,
  type ClosedVisitItem,
  type CsWorkQueue,
  type DashboardDetail,
  type DashboardDetailRow,
  type DashboardScope,
  type GeneralDashboard,
  type ManagerAnalytics,
  type Metric,
  type MetricUnit,
  type OfficeOverview,
  type ProductDashboard,
  type SkuSort,
  type SkuStats,
  type TechnicianDashboard,
  type TechnicianDetail,
  type TechnicianDetailQuery,
  type TechnicianStats,
  type TechnicianVisitFilter,
  type TrendMonths,
} from "@/features/dashboards/data/types";
import { addDays, atJerusalem, daysBetween, shiftWorkDay, weekStart } from "./dates";
import { callStatus, isClosedVisit, isOpenVisit } from "./status";
import { followupReasonOf, productDto, techRef, technicianLanes } from "./mappers";
import { ALL_VISITS, avg, CALLS, lastVisit, travelOf, treatOf, type CallVisit } from "./queries";
import { prod, REASONS, TECH_IDS, TECHS } from "./reference";
import type { Call, TechId, Visit } from "./types";

const metric = (value: number | null, unit: MetricUnit, decimals?: number): Metric =>
  decimals === undefined ? { value, unit } : { value, unit, decimals };

const pct = (part: number, whole: number): number | null => (whole ? Math.round((part / whole) * 100) : null);

/** Rounded average, or null for an empty list (the demo shows 0; screens show "—"). */
const avgOrNull = (xs: readonly number[]): number | null => (xs.length ? avg(xs) : null);

/** The first DASHBOARD_LIST_LIMIT items and the full count. */
const capped = <T>(all: readonly T[]): Bounded<T> => boundedOf(all, DASHBOARD_LIST_LIMIT);

const nonNull = (xs: readonly (number | null)[]): number[] => xs.filter((x): x is number => x != null);

const inRange = (date: IsoDate, p: Period): boolean => date >= p.from && date <= p.to;

const firstVisit = (c: Call): Visit => c.visits[0] as Visit;

/** Calls whose first visit is in the period. */
const callsIn = (p: Period): Call[] => CALLS.filter((c) => inRange(firstVisit(c).date, p));

function attentionItem(c: Call, status: Extract<CallStatus, "followup" | "awaiting">, asOf: IsoDate): CallAttentionItem {
  const v = lastVisit(c);
  return {
    req: c.req,
    status,
    customerName: c.customer,
    city: c.city,
    productName: prod(c.sku).name,
    reason: followupReasonOf(c, status),
    technician: techRef(v.tech),
    since: v.date,
    daysOpen: Math.max(0, daysBetween(v.date, asOf)),
    representative: c.rep,
    isTest: true,
  };
}

/** Calls in "המשך טיפול" or "ממתינה לשיבוץ", oldest first. */
function attention(asOf: IsoDate, which: readonly CallStatus[]): CallAttentionItem[] {
  return CALLS.map((c) => ({ c, status: callStatus(c) }))
    .filter((x): x is { c: Call; status: "followup" | "awaiting" } => which.includes(x.status))
    .map(({ c, status }) => attentionItem(c, status, asOf))
    .sort((a, b) => a.since.localeCompare(b.since) || a.req.localeCompare(b.req));
}

const visitsOn = (date: IsoDate): CallVisit[] => ALL_VISITS.filter((x) => x.v.date === date);

/** Office home ("לוח בקרה"). */
export function officeOverview(date: IsoDate): OfficeOverview {
  const today = visitsOn(date).filter((x) => x.v.status !== "cancel");
  const statuses = CALLS.map(callStatus);
  return {
    date,
    includesTestData: true,
    kpis: {
      visitsToday: metric(today.length, "count"),
      completedToday: metric(today.filter((x) => isClosedVisit(x.v)).length, "count"),
      inFieldNow: metric(today.filter((x) => x.v.status === "go" || x.v.status === "work").length, "count"),
      remainingToday: metric(today.filter((x) => x.v.status === "new").length, "count"),
      openFollowups: metric(statuses.filter((s) => s === "followup").length, "count"),
      awaitingScheduling: metric(statuses.filter((s) => s === "awaiting").length, "count"),
    },
    lanes: technicianLanes(today),
    // Awaiting-scheduling calls first, so the cap never hides them behind older follow-ups.
    attention: capped([...attention(date, ["awaiting"]), ...attention(date, ["followup"])]),
  };
}

/** Customer-service home ("בית"). */
export function csQueue(date: IsoDate): CsWorkQueue {
  const from = shiftWorkDay(date, -1);
  const recentlyClosed: ClosedVisitItem[] = ALL_VISITS.filter((x) => isClosedVisit(x.v) && x.v.date >= from && x.v.date <= date)
    .sort((a, b) => (b.v.date + (b.v.endAt ?? "")).localeCompare(a.v.date + (a.v.endAt ?? "")))
    .map(({ c, v }) => ({
      req: c.req,
      n: v.n,
      date: v.date,
      endAt: v.endAt,
      status: v.status === "done" ? "done" : "cont",
      reason: v.reason,
      customerName: c.customer,
      city: c.city,
      technician: techRef(v.tech),
      representative: c.rep,
      isTest: true,
    }));
  return {
    date,
    includesTestData: true,
    awaitingScheduling: capped(attention(date, ["awaiting"])),
    followupsNeedingVisit: capped(attention(date, ["followup"])),
    todayByTechnician: technicianLanes(visitsOn(date)),
    recentlyClosed: capped(recentlyClosed),
  };
}

function techStats(id: TechId, closed: readonly CallVisit[], calls: readonly Call[]): TechnicianStats {
  const m = closed.filter((x) => x.v.tech === id);
  const firsts = calls.filter((c) => firstVisit(c).tech === id && isClosedVisit(firstVisit(c)));
  const days = new Set(m.map((x) => x.v.date)).size;
  return {
    technician: techRef(id),
    closed: m.length,
    done: m.filter((x) => x.v.status === "done").length,
    cont: m.filter((x) => x.v.status === "cont").length,
    firstVisitFixRate: metric(pct(firsts.filter((c) => firstVisit(c).status === "done").length, firsts.length), "percent"),
    avgTravelMinutes: metric(avgOrNull(nonNull(m.map((x) => travelOf(x.v)))), "minutes"),
    avgTreatMinutes: metric(avgOrNull(nonNull(m.map((x) => treatOf(x.v)))), "minutes"),
    visitsPerDay: metric(days ? Math.round((m.length / days) * 10) / 10 : null, "count", 1),
  };
}

/**
 * The pre-D57 manager dashboards: כללי / טכנאים / מוצרים וספקים. `asOf` is the demo's today.
 * @deprecated Kept only until the dashboard screen switches to generalDashboard /
 * technicianDashboard / productDashboard (spec-final §8.5, PR-D). Its products part already counts
 * unique calls with the D57 formulas (no visit-based rates, no free-text "תקלה נפוצה").
 */
export function managerAnalytics(period: Period, asOf: IsoDate): ManagerAnalytics {
  const visits = ALL_VISITS.filter((x) => inRange(x.v.date, period) && x.v.status !== "cancel");
  const closed = visits.filter((x) => isClosedVisit(x.v));
  const calls = callsIn(period);

  const firsts = calls.filter((c) => isClosedVisit(firstVisit(c)));
  const gaps = calls
    .filter((c) => c.visits.length > 1)
    .map((c) => daysBetween(firstVisit(c).date, (c.visits[1] as Visit).date));
  const followups = attention(asOf, ["followup"]);

  // Sunday–Saturday weeks from the period start up to the week of `asOf` (or the period end).
  const lastDay = asOf < period.to ? asOf : period.to;
  const weekly: ManagerAnalytics["general"]["weekly"] = [];
  for (let s = weekStart(period.from); s <= lastDay; s = addDays(s, 7)) {
    const e = addDays(s, 6);
    weekly.push({ weekStart: s, weekEnd: e, visits: ALL_VISITS.filter((x) => x.v.date >= s && x.v.date <= e && x.v.status !== "cancel").length });
  }

  const reasonCount = (name: string, techId?: TechId): number =>
    closed.filter((x) => x.v.reason === name && (techId === undefined || x.v.tech === techId)).length;

  return {
    period,
    asOf,
    includesTestData: true,
    general: {
      kpis: {
        visits: metric(visits.length, "count"),
        firstVisitFixRate: metric(pct(firsts.filter((c) => firstVisit(c).status === "done").length, firsts.length), "percent"),
        openFollowups: metric(followups.length, "count"),
        avgTravelMinutes: metric(avgOrNull(nonNull(closed.map((x) => travelOf(x.v)))), "minutes"),
        avgTreatMinutes: metric(avgOrNull(nonNull(closed.map((x) => treatOf(x.v)))), "minutes"),
        avgDaysToFollowup: metric(
          gaps.length ? Math.round((gaps.reduce((a, b) => a + b, 0) / gaps.length) * 10) / 10 : null,
          "days",
          1,
        ),
      },
      live: technicianLanes(visitsOn(asOf)),
      outcomesByTechnician: TECHS.map((t) => ({
        technician: techRef(t.id),
        done: closed.filter((x) => x.v.tech === t.id && x.v.status === "done").length,
        cont: closed.filter((x) => x.v.tech === t.id && x.v.status === "cont").length,
      })),
      followupReasons: REASONS.map((r) => ({ key: r.name, label: r.name, value: reasonCount(r.name) })),
      weekly,
      oldestFollowups: boundedOf(followups, OLDEST_FOLLOWUPS_LIMIT),
    },
    technicians: {
      stats: TECHS.map((t) => techStats(t.id, closed, calls)),
      reasonsByTechnician: REASONS.map((r) => {
        const counts = Object.fromEntries(TECHS.map((t) => [t.id, reasonCount(r.name, t.id)])) as Record<TechId, number>;
        return { reason: r.name, counts, total: reasonCount(r.name) };
      }),
    },
    products: legacyProducts(calls),
  };
}

/** The pre-D57 products tab for the period's calls, counted with the D57 formulas (unique calls). */
function legacyProducts(calls: readonly Call[]): ManagerAnalytics["products"] {
  const mc = calls.map(metricCallOf);
  return {
    byBrand: groupBars(groupUniqueCalls(mc, "brand", SCOPE), "brand"),
    bySupplier: groupBars(groupUniqueCalls(mc, "supplier", SCOPE), "supplier"),
    skus: capped(skuRows(mc, SCOPE).map(skuStatsDto)),
  };
}

/** Whether a visit matches a drill-down chip (the demo's tdFilter). */
function matchesVisitFilter(v: Visit, filter: TechnicianVisitFilter): boolean {
  if (filter === "all") return true;
  return filter === "open" ? isOpenVisit(v) : v.status === filter;
}

/** Technician drill-down ("פירוט הטכנאי"): rows filtered by the chip and paged. */
export function technicianDetail(
  id: TechId,
  period: Period,
  query: TechnicianDetailQuery & { filter: TechnicianVisitFilter },
): TechnicianDetail {
  const all = ALL_VISITS.filter((x) => x.v.tech === id && inRange(x.v.date, period)).sort((a, b) =>
    (b.v.date + b.v.start).localeCompare(a.v.date + a.v.start),
  );
  const closed = all.filter((x) => isClosedVisit(x.v));
  const calls = callsIn(period);
  const firsts = calls.filter((c) => firstVisit(c).tech === id && isClosedVisit(firstVisit(c)));
  const top = REASONS.map((r) => [r.name, closed.filter((x) => x.v.reason === r.name).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])[0];
  const count = (f: TechnicianVisitFilter): number => all.filter((x) => matchesVisitFilter(x.v, f)).length;
  // pageOf() clamps page and limit (default 40, at most 100).
  const page = pageOf(
    all.filter((x) => matchesVisitFilter(x.v, query.filter)),
    query.page,
    query.limit,
  );
  return {
    stats: techStats(id, closed, calls),
    filter: query.filter,
    visitCounts: { all: all.length, open: count("open"), done: count("done"), cont: count("cont"), cancel: count("cancel") },
    visits: {
      ...page,
      items: page.items.map(({ c, v }) => {
        const p = prod(c.sku);
        return {
          req: c.req,
          n: v.n,
          date: v.date,
          start: v.start,
          status: v.status,
          reason: v.reason,
          customerName: c.customer,
          city: c.city,
          product: { sku: p.sku, name: p.name },
          travelMinutes: travelOf(v),
          treatMinutes: treatOf(v),
          mediaCount: v.media.length,
          hasRecording: v.rec > 0,
          hasSummary: v.summary.trim() !== "",
          signed: v.signer !== null,
          isTest: true,
        };
      }),
    },
    topReason: top ? top[0] : null,
    firstVisitCalls: firsts.length,
    includesTestData: true,
  };
}

// ---------------------------------------------------------------------------------------------
// Manager dashboard (D57): the fixtures as MetricCall, and the four tab-scoped methods.

/** Every fixture is test data (D47): the demo always counts it and says so (SIM-08, SIM-13). */
const SCOPE: DashboardScope = "test-env";

/** "כן…" → yes, "לא" → no, empty ("לא צוין", D17) or anything else → unknown (never inferred). */
function warrantyState(text: string): WarrantyState {
  const t = text.trim();
  if (t.startsWith("כן")) return "yes";
  return t === "לא" ? "no" : "unknown";
}

/** A fixture visit as the formulas read it: Asia/Jerusalem instants of its date and times (current values). */
function metricVisit(v: Visit): MetricVisit {
  const at = (hm: string | null) => (hm ? atJerusalem(v.date, hm) : null);
  return {
    n: v.n,
    tech: v.tech,
    scheduledStart: atJerusalem(v.date, v.start),
    scheduledEnd: atJerusalem(v.date, v.end),
    status: v.status,
    departedAt: at(v.departAt),
    arrivedAt: at(v.arriveAt),
    endedAt: at(v.endAt),
    source: v.source,
  };
}

/** A fixture call as the formulas read it (supplier and brand of its one product; the demo's ids are the names). */
function metricCallOf(c: Call): MetricCall {
  const p = prod(c.sku);
  return {
    req: c.req,
    sku: c.sku,
    supplierKey: p.sup || NONE_GROUP_KEY,
    supplierLabel: p.sup,
    brandKey: p.brand || NONE_GROUP_KEY,
    brandLabel: p.brand,
    warranty: warrantyState(c.warranty),
    openedAt: c.openedAt,
    resolvedAt: c.resolvedAt,
    isTest: c.isTest,
    visits: c.visits.map(metricVisit),
  };
}

/** Every demo call (office view: corrections applied), computed once. */
const METRIC_CALLS: readonly MetricCall[] = CALLS.map(metricCallOf);

const CALL_BY_REQ: ReadonlyMap<string, Call> = new Map(CALLS.map((c) => [c.req, c]));

const isTechIdValue = (id: string): id is TechId => (TECH_IDS as readonly string[]).includes(id);

/** A group as a bar row ("" label = "לא הוזן"); SKU rows carry the product name and the test marker (SIM-17). */
function groupBar(g: GroupRow, kind: "supplier" | "brand" | "sku"): BarRow {
  if (kind !== "sku") return { key: g.key, label: g.label, value: g.value };
  const p = productDto(g.key);
  return { key: g.key, label: g.key, value: g.value, name: p.name, isTest: p.isTest };
}

/**
 * Supplier or brand bars, at most DASHBOARD_LIST_LIMIT ranked rows; the "לא הוזן" row is never
 * silently removed (spec §8.2): beyond the cap it is appended after the capped rows.
 */
function groupBars(rows: readonly GroupRow[], kind: "supplier" | "brand"): Bounded<BarRow> {
  const bars = rows.map((g) => groupBar(g, kind));
  const capped = boundedOf(bars, DASHBOARD_LIST_LIMIT);
  const none = bars.find((b) => b.key === NONE_GROUP_KEY);
  if (none && !capped.items.includes(none)) capped.items.push(none);
  return capped;
}

/** A SKU row of the table; "תקלה נפוצה" is unavailable (no structured issue category, D57 (4)). */
const skuStatsDto = (r: SkuRow): SkuStats => ({
  product: productDto(r.sku),
  calls: r.calls,
  warrantyRate: r.warrantyRate,
  followupRate: r.followupRate,
  topIssue: { state: "unavailable" },
});

/** General tab (dashGen) at `now`. */
export function generalDashboard(now: string, months: TrendMonths): GeneralDashboard {
  const g = generalMetrics(METRIC_CALLS, now, months, SCOPE);
  const bars = (b: Bounded<GroupRow>, kind: "supplier" | "sku"): Bounded<BarRow> => ({ ...b, items: b.items.map((r) => groupBar(r, kind)) });
  return {
    now,
    asOf: g.asOf,
    coverageStart: g.coverageStart,
    includesTestData: g.includesTestData,
    today: g.today,
    service: g.service,
    highlights: { period: g.highlights.period, suppliers: bars(g.highlights.suppliers, "supplier"), skus: bars(g.highlights.skus, "sku") },
    trend: g.trend,
  };
}

/** Technicians tab (dashTech): one technician for a period at `now`. */
export function technicianDashboard(id: TechId, period: Period, now: string): TechnicianDashboard {
  const t = technicianMetrics(METRIC_CALLS, id, period, now, SCOPE);
  return { technician: techRef(id), period, ...t };
}

/** Products & Suppliers tab (dashProd): all calls opened by `now`; the SKU table sorted and paged. */
export function productDashboard(now: string, page: number | undefined, sort: SkuSort): ProductDashboard {
  const m = productMetrics(METRIC_CALLS, now, SCOPE);
  const skus = pageOf(sortSkuRows(m.skus, sort), page, DASHBOARD_LIST_LIMIT);
  return {
    includesTestData: m.includesTestData,
    bySupplier: groupBars(m.bySupplier, "supplier"),
    byBrand: groupBars(m.byBrand, "brand"),
    skus: { ...skus, items: skus.items.map(skuStatsDto) },
    sort,
  };
}

/**
 * The records behind a metric for the details dialog (null: no records for that key or group).
 * The page calls it only when the role is offered the tab and `calls` (spec-final §6.2).
 */
export function dashboardDetail(query: {
  key: DashboardMetricKey;
  now: string;
  period?: Period;
  techId?: TechId;
  group?: string;
  page?: number;
  limit?: number;
}): DashboardDetail | null {
  const found = detailRecords(METRIC_CALLS, query.key, { now: query.now, period: query.period, tech: query.techId, group: query.group }, SCOPE);
  if (!found) return null;
  const rows: DashboardDetailRow[] =
    found.records === "visits"
      ? found.rows.map((r) => {
          const c = CALL_BY_REQ.get(r.call.req) as Call;
          const p = productDto(c.sku);
          const row: DashboardDetailRow = {
            req: c.req,
            n: r.visit.n,
            date: jerusalemDate(r.visit.scheduledStart) ?? "",
            start: jerusalemTime(r.visit.scheduledStart) ?? "",
            end: jerusalemTime(r.visit.scheduledEnd) ?? "",
            customerName: c.customer,
            city: c.city,
            technician: isTechIdValue(r.visit.tech) ? techRef(r.visit.tech) : null,
            product: { sku: p.sku, name: p.name },
            status: { kind: "visit", value: r.visit.status },
            ...(r.visit.source ? { source: r.visit.source } : {}),
            ...(r.minutes !== undefined ? { minutes: r.minutes } : {}),
            isTest: c.isTest,
          };
          return row;
        })
      : found.rows.map((r) => {
          const c = CALL_BY_REQ.get(r.call.req) as Call;
          const p = productDto(c.sku);
          const row: DashboardDetailRow = {
            req: c.req,
            n: null,
            date: r.date,
            openedAt: c.openedAt,
            resolvedAt: c.resolvedAt,
            customerName: c.customer,
            city: c.city,
            technician: r.technician !== null && isTechIdValue(r.technician) ? techRef(r.technician) : null,
            product: { sku: p.sku, name: p.name },
            status: { kind: "call", value: r.status },
            ...(r.durationHours !== undefined ? { durationHours: r.durationHours } : {}),
            ...(r.firstVisitResolved !== undefined ? { firstVisitResolved: r.firstVisitResolved } : {}),
            ...(r.followupRequired !== undefined ? { followupRequired: r.followupRequired } : {}),
            isTest: c.isTest,
          };
          return row;
        });
  return {
    key: query.key,
    records: found.records,
    rows: pageOf(rows, query.page, query.limit ?? DASHBOARD_DETAIL_PAGE_LIMIT),
    includesTestData: SCOPE === "test-env" && rows.some((r) => r.isTest),
  };
}
