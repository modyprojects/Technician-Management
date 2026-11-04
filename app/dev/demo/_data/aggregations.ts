// FICTITIOUS DATA ONLY: dashboard aggregations over the demo's seeded calls, ported from
// docs/demo.html dashGen() / dashTech() / dashTechDetail() / dashProd() (L867-935) and shaped as
// the DTOs in features/dashboards/data/types. Server-side; used only by adapter.ts.
// Allowed only under app/dev (G-05). A Supabase adapter computes the same figures in SQL.
import type { CallStatus } from "@/features/calls/data/types";
import type { IsoDate } from "@/features/data-access/common";
import type {
  AnalyticsPeriod as Period,
  BarRow,
  CallAttentionItem,
  ClosedVisitItem,
  CsWorkQueue,
  ManagerAnalytics,
  Metric,
  MetricUnit,
  OfficeOverview,
  TechnicianDetail,
  TechnicianStats,
} from "@/features/dashboards/data/types";
import { addDays, daysBetween, shiftWorkDay, weekStart } from "./dates";
import { callStatus, isClosedVisit } from "./status";
import { followupReasonOf, productDto, techRef, technicianLanes } from "./mappers";
import { ALL_VISITS, avg, CALLS, lastVisit, travelOf, treatOf, type CallVisit } from "./queries";
import { PRODUCTS, prod, REASONS, TECHS } from "./reference";
import type { Call, TechId, Visit } from "./types";

const metric = (value: number | null, unit: MetricUnit, decimals?: number): Metric =>
  decimals === undefined ? { value, unit } : { value, unit, decimals };

const pct = (part: number, whole: number): number | null => (whole ? Math.round((part / whole) * 100) : null);

/** Rounded average, or null for an empty list (the demo shows 0; screens show "—"). */
const avgOrNull = (xs: readonly number[]): number | null => (xs.length ? avg(xs) : null);

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
    attention: attention(date, ["awaiting", "followup"]),
  };
}

/** Customer-service home ("בית"). */
export function csQueue(date: IsoDate): CsWorkQueue {
  const from = shiftWorkDay(date, -1);
  const recentlyClosed: ClosedVisitItem[] = ALL_VISITS.filter((x) => isClosedVisit(x.v) && x.v.date >= from && x.v.date <= date)
    .sort((a, b) => (b.v.date + (b.v.endAt ?? "")).localeCompare(a.v.date + (a.v.endAt ?? "")))
    .slice(0, 20)
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
    awaitingScheduling: attention(date, ["awaiting"]),
    followupsNeedingVisit: attention(date, ["followup"]),
    todayByTechnician: technicianLanes(visitsOn(date)),
    recentlyClosed,
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

function groupCount(calls: readonly Call[], key: (c: Call) => string): BarRow[] {
  const counts = new Map<string, number>();
  for (const c of calls) counts.set(key(c), (counts.get(key(c)) ?? 0) + 1);
  return [...counts.entries()]
    .sort((a, b) => b[1] - a[1])
    .map(([label, value]) => ({ key: label || "—", label, value }));
}

/** Manager dashboards: כללי / טכנאים / מוצרים וספקים. `asOf` is the demo's today. */
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
      oldestFollowups: followups.slice(0, 6),
    },
    technicians: {
      stats: TECHS.map((t) => techStats(t.id, closed, calls)),
      reasonsByTechnician: REASONS.map((r) => {
        const counts = Object.fromEntries(TECHS.map((t) => [t.id, reasonCount(r.name, t.id)])) as Record<TechId, number>;
        return { reason: r.name, counts, total: reasonCount(r.name) };
      }),
    },
    products: {
      byBrand: groupCount(calls, (c) => prod(c.sku).brand),
      bySupplier: groupCount(calls, (c) => prod(c.sku).sup),
      skus: PRODUCTS.map((p) => {
        const cs = calls.filter((c) => c.sku === p.sku);
        const vs = cs.flatMap((c) => c.visits).filter(isClosedVisit);
        const issues = new Map<string, number>();
        for (const c of cs) issues.set(c.desc, (issues.get(c.desc) ?? 0) + 1);
        const top = [...issues.entries()].sort((a, b) => b[1] - a[1])[0];
        return {
          product: productDto(p.sku),
          calls: cs.length,
          warrantyRate: metric(pct(cs.filter((c) => c.warranty.startsWith("כן")).length, cs.length), "percent"),
          followupRate: metric(pct(vs.filter((v) => v.status === "cont").length, vs.length), "percent"),
          topIssue: top ? top[0] : null,
        };
      }).sort((a, b) => b.calls - a.calls),
    },
  };
}

/** Technician drill-down ("פירוט הטכנאי"). */
export function technicianDetail(id: TechId, period: Period): TechnicianDetail {
  const all = ALL_VISITS.filter((x) => x.v.tech === id && inRange(x.v.date, period)).sort((a, b) =>
    (b.v.date + b.v.start).localeCompare(a.v.date + a.v.start),
  );
  const closed = all.filter((x) => isClosedVisit(x.v));
  const calls = callsIn(period);
  const firsts = calls.filter((c) => firstVisit(c).tech === id && isClosedVisit(firstVisit(c)));
  const top = REASONS.map((r) => [r.name, closed.filter((x) => x.v.reason === r.name).length] as const)
    .filter(([, n]) => n > 0)
    .sort((a, b) => b[1] - a[1])[0];
  return {
    stats: techStats(id, closed, calls),
    visits: all.map(({ c, v }) => {
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
    topReason: top ? top[0] : null,
    firstVisitCalls: firsts.length,
    includesTestData: true,
  };
}
