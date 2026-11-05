// Dashboard DTOs: office home (Customer Service "לוח בקרה" with dashGen), customer-service work
// queue ("בית") and the manager dashboard (D57; docs/design/manager-dashboard-spec.md: כללי /
// טכנאים / מוצרים וספקים). Values are raw numbers; screens own the Hebrew labels and formatting
// (the metric registry, ./metric-definitions.ts). In test environments they include test data and
// screens show "נתוני בדיקה" (SIM-08, SIM-13): see `includesTestData`. Missing measurements are
// null, never 0 (D57 (4)).
// Every list is bounded (docs/security.md: query bounds): lists that grow with the data are
// Bounded<T> with a fixed cap (below) or a Page<T>; the rest are bounded by design (one row per
// technician, per follow-up reason, per week of a period of at most 366 days or per month of at
// most 12 completed months).
import type { YearMonth } from "@/features/calendar/data/types";
import type { Bounded, HourMinute, IsoDate, IsoTimestamp, Page, PageRequest, TestMarker } from "@/features/data-access/common";
import type { Product, TechnicianId, TechnicianRef } from "@/features/reference/data/types";
import type { CallStatus } from "@/features/calls/data/types";
import type { VisitRef, VisitSource, VisitStatus } from "@/features/visits/data/types";
import type { DashboardMetricKey } from "./metric-definitions";

/**
 * Fixed cap of the growing dashboard lists (attention and work-queue lists, recently closed,
 * SKUs, brand and supplier bars). `total` on each Bounded<T> is the full count, so a screen can
 * add "ועוד X" and link to the calls list.
 */
export const DASHBOARD_LIST_LIMIT = 20;

/**
 * How a number is shown: "12", "67%", "34 דק׳", and a duration in hours that the screen shows as
 * "47 שעות" below 48 hours, otherwise "3.8 ימים" (T7, `durationDisplay` in ./metric-definitions).
 */
export type MetricUnit = "count" | "percent" | "minutes" | "duration";

/** States of a metric that carries no number (D57 (4)). */
export type MetricState = "pendingDefinition" | "unavailable";

/**
 * One KPI tile value ("card kpi"). `value` null = nothing to measure (shown as "—" with
 * "אין מספיק נתונים"); never 0 for a missing measurement (D57 (4)).
 */
export type Metric = {
  value: number | null;
  unit: MetricUnit;
  decimals?: number;
  /**
   * "pendingDefinition": no approved formula ("הגדרה ממתינה"); "unavailable": an approved
   * definition whose data does not exist ("לא זמין"). Either way `value` is null.
   */
  state?: MetricState;
  /** Number of valid measurements or records behind an average or percentage (its denominator). */
  basis?: number;
  /** Measurements left out of an average: missing reports, and impossible sequences (T6). */
  excluded?: { missing: number; invalid: number };
  /** unit "duration": the mean in hours (two decimals), the same number as `value`. */
  durationHours?: number;
};

/** The key of the group of calls without a brand or supplier (shown as "לא הוזן", OF-12). */
export const NONE_GROUP_KEY = "__none__";

/** One horizontal bar row (".bar"). */
export type BarRow = {
  /** Stable key (technician id, reason, brand or supplier id, SKU; NONE_GROUP_KEY when not entered). */
  key: string;
  /** "" when the grouped value was not entered (brand / supplier: shown as "לא הוזן", OF-12). */
  label: string;
  value: number;
  /** Data colour (a technician's colour); the chart's default when missing. */
  color?: string;
  /** Product name of an SKU row (shown where space allows, spec §5). */
  name?: string;
  /** SIM-17: the row is a test product ("🧪"). */
  isTest?: boolean;
};

/** A visit as the lanes and lists show it. */
export type LaneVisit = TestMarker &
  VisitRef & {
    start: HourMinute;
    end: HourMinute;
    status: VisitStatus;
    source: VisitSource;
    customerName: string;
    city: string;
  };

/** One technician's day ("עכשיו בשטח" card). */
export type TechnicianLane = {
  technician: TechnicianRef;
  /** In progress, else en route; null = "פנוי". */
  current: LaneVisit | null;
  /** First scheduled visit; null = "אין עוד ביקורים היום". */
  next: LaneVisit | null;
  /** Today's visits, cancelled excluded, by start time. */
  visits: LaneVisit[];
  /** Closed today ("טופל" / "המשך טיפול"). */
  completed: number;
  /** Today's visits, cancelled excluded ("היום: completed/total הושלמו"). */
  total: number;
};

/** A call that needs the office: a follow-up without a new visit, or every visit cancelled. */
export type CallAttentionItem = TestMarker & {
  req: string;
  status: Extract<CallStatus, "followup" | "awaiting">;
  customerName: string;
  city: string;
  productName: string;
  /** Follow-up reason (status "followup"). */
  reason: string | null;
  /** Technician of the latest visit. */
  technician: TechnicianRef;
  /** Date of the latest visit. */
  since: IsoDate;
  /** Whole days from `since` to the queried date (0 = today). */
  daysOpen: number;
  representative: string;
};

/** A visit closed by a technician. */
export type ClosedVisitItem = TestMarker &
  VisitRef & {
    date: IsoDate;
    endAt: HourMinute | null;
    status: Extract<VisitStatus, "done" | "cont">;
    reason: string | null;
    customerName: string;
    city: string;
    technician: TechnicianRef;
    representative: string;
  };

/** Office home for a date. */
export type OfficeOverview = {
  date: IsoDate;
  includesTestData: boolean;
  kpis: {
    /** Visits today, cancelled excluded. */
    visitsToday: Metric;
    /** Closed today. */
    completedToday: Metric;
    /** En route or in progress now. */
    inFieldNow: Metric;
    /** Still scheduled today. */
    remainingToday: Metric;
    /** Calls in "המשך טיפול" without a new visit. */
    openFollowups: Metric;
    /** Calls in "ממתינה לשיבוץ". */
    awaitingScheduling: Metric;
  };
  lanes: TechnicianLane[];
  /** Calls that need the office: awaiting scheduling first, then follow-ups; oldest first within each (at most DASHBOARD_LIST_LIMIT). */
  attention: Bounded<CallAttentionItem>;
};

/** Customer-service work queue ("בית") for a date. */
export type CsWorkQueue = {
  date: IsoDate;
  includesTestData: boolean;
  /** Calls whose every visit was cancelled, oldest first (at most DASHBOARD_LIST_LIMIT). */
  awaitingScheduling: Bounded<CallAttentionItem>;
  /** "המשך טיפול" calls that need a new visit, oldest first (at most DASHBOARD_LIST_LIMIT). */
  followupsNeedingVisit: Bounded<CallAttentionItem>;
  /** Today's visits by technician. */
  todayByTechnician: TechnicianLane[];
  /** Visits closed on the date and the work day before, newest first (at most DASHBOARD_LIST_LIMIT). */
  recentlyClosed: Bounded<ClosedVisitItem>;
};

/** Dashboard period, inclusive (the demo shows one month: "אוקטובר 2026"). */
export type AnalyticsPeriod = { from: IsoDate; to: IsoDate };

/** One technician's figures for a period (part of TechnicianDetail; the D57 tab reads TechnicianDashboard). */
export type TechnicianStats = {
  technician: TechnicianRef;
  /** Closed visits. */
  closed: number;
  done: number;
  cont: number;
  /** % of the technician's first visits closed as "טופל". */
  firstVisitFixRate: Metric;
  avgTravelMinutes: Metric;
  avgTreatMinutes: Metric;
  /** Closed visits per work day with visits (one decimal). */
  visitsPerDay: Metric;
};

/**
 * "תקלה נפוצה": only from a structured issue category (D57 (4)); never inferred from the free-text
 * fault description. No such category exists yet, so it is always "unavailable" ("לא זמין").
 */
export type SkuTopIssue = { state: "unavailable" } | { state: "computed"; value: string };

/** One row of "מק״טים עם הכי הרבה קריאות" (spec §8.3). Unique calls, never visits (D57 (3)). */
export type SkuStats = {
  product: Product;
  /** Unique service calls of the SKU. */
  calls: number;
  /** "באחריות": calls under warranty ÷ calls whose warranty is known ("לא צוין" left out, D17). */
  warrantyRate: Metric;
  /**
   * "% המשך טיפול" (D57 (5)): calls with at least one visit closed as "המשך טיפול" (closed later
   * included) ÷ calls with at least one performed visit. Never from the number of visits.
   */
  followupRate: Metric;
  topIssue: SkuTopIssue;
};

/** A row of a technician's "דוחות הביקורים" table (dashTech; rows need `calls`, spec-final §6.6). */
export type TechnicianVisitRow = TestMarker &
  VisitRef & {
    date: IsoDate;
    start: HourMinute;
    status: VisitStatus;
    reason: string | null;
    customerName: string;
    city: string;
    product: Pick<Product, "sku" | "name">;
    travelMinutes: number | null;
    treatMinutes: number | null;
    mediaCount: number;
    hasRecording: boolean;
    hasSummary: boolean;
    signed: boolean;
  };

/** Visit filter of the technician drill-down (the demo's chips: הכל / פתוחים / טופל / המשך טיפול / בוטלה). */
export const TECHNICIAN_VISIT_FILTER_VALUES = ["all", "open", "done", "cont", "cancel"] as const;
export type TechnicianVisitFilter = (typeof TECHNICIAN_VISIT_FILTER_VALUES)[number];

export const isTechnicianVisitFilter = (value: unknown): value is TechnicianVisitFilter =>
  typeof value === "string" && (TECHNICIAN_VISIT_FILTER_VALUES as readonly string[]).includes(value);

/** What the drill-down asks for: the chip filter and the page of rows (default 40, at most 100). */
export type TechnicianDetailQuery = PageRequest & {
  /** Default "all"; unknown values fall back to "all". */
  filter?: TechnicianVisitFilter;
};

/** A technician's visit reports ("דוחות הביקורים", dashTech); the screen shows no counts or KPIs from it (D57 (3)). */
export type TechnicianDetail = {
  stats: TechnicianStats;
  /** The filter applied to `visits`. */
  filter: TechnicianVisitFilter;
  /** The period's visits per chip ("הכל" includes every status; "open" = scheduled, en route, in progress). */
  visitCounts: Record<TechnicianVisitFilter, number>;
  /** The period's visits matching `filter`, newest first, one page. */
  visits: Page<TechnicianVisitRow>;
  /** Most frequent follow-up reason; null when none. */
  topReason: string | null;
  /** Calls whose first visit was this technician's and is closed ("מתוך X קריאות"). */
  firstVisitCalls: number;
  includesTestData: boolean;
};

// ---------------------------------------------------------------------------------------------
// Manager dashboard (D57): one DTO per tab, read by tab-scoped port methods (./ports.ts). The
// metric definitions are in ./metric-definitions.ts (registry) and ./formulas.ts (pure formulas).

/**
 * Whether test-marked records count (SIM-08): "test-env" counts them (the page shows "נתוני
 * בדיקה"); "production" drops test-marked calls and their visits before any computation, and
 * `includesTestData` is false. The demo adapter always passes "test-env".
 */
export type DashboardScope = "test-env" | "production";

/** Months of the General chart (spec §6): 3, 6 (default) or 12 completed months. */
export const TREND_MONTH_OPTIONS = [3, 6, 12] as const;
export type TrendMonths = (typeof TREND_MONTH_OPTIONS)[number];
export const DEFAULT_TREND_MONTHS: TrendMonths = 6;

export const isTrendMonths = (value: unknown): value is TrendMonths =>
  typeof value === "number" && (TREND_MONTH_OPTIONS as readonly number[]).includes(value);

/** Rows of the General highlights (spec §5): 3 suppliers and 5 SKUs over the last 30 days (T4). */
export const TOP_SUPPLIERS_LIMIT = 3;
export const TOP_SKUS_LIMIT = 5;
export const HIGHLIGHT_WINDOW_DAYS = 30;

/** Rows per page of the details dialog (spec-final §6.9). */
export const DASHBOARD_DETAIL_PAGE_LIMIT = 50;

/** One month of "מגמת קריאות שירות"; null = the month is entirely before the first recorded call ("אין נתונים"). */
export type TrendRow = { month: YearMonth; opened: number | null; closed: number | null };

/** "פעילות היום": planned = done + pending + missed (no visit in two categories). */
export type TodayActivity = {
  /** Today's visits, cancelled excluded (by scheduled start, Asia/Jerusalem). */
  planned: Metric;
  /** Of those, closed ("טופל" / "המשך טיפול"), whenever closed. */
  done: Metric;
  /** Of those, open and not past their scheduled end (later today included). */
  pending: Metric;
  /** Of those, open after their scheduled end (T1). */
  missed: Metric;
  /** done ÷ planned (percent); null when nothing is planned today. */
  progress: Metric;
};

/** General tab ("כללי", matrix key dashGen). */
export type GeneralDashboard = {
  /** The instant the figures are measured at (from the trusted server caller, never the URL). */
  now: IsoTimestamp;
  /** The Asia/Jerusalem date of `now`. */
  asOf: IsoDate;
  /** Date of the first recorded call (computed, never configured); null when there is none. */
  coverageStart: IsoDate | null;
  includesTestData: boolean;
  today: TodayActivity;
  /** "מדדי שירות" over the current calendar month (D56 (2)). */
  service: { period: AnalyticsPeriod; treat: Metric; travel: Metric; firstVisit: Metric; closeTime: Metric };
  /** "מוצרים וספקים מובילים" over the last 30 days by opening date (T4). */
  highlights: {
    period: AnalyticsPeriod;
    /** At most TOP_SUPPLIERS_LIMIT rows; calls without a supplier are not ranked (T13). */
    suppliers: Bounded<BarRow>;
    /** At most TOP_SKUS_LIMIT rows (`name` = product name, `isTest` per SIM-17). */
    skus: Bounded<BarRow>;
  };
  /** "מגמת קריאות שירות": opened by opening date, closed by closing date, oldest month first. */
  trend: { months: TrendMonths; rows: TrendRow[] };
};

/** Technicians tab ("טכנאים", matrix key dashTech): one technician only, no comparison (D57 (3)). */
export type TechnicianDashboard = {
  technician: TechnicianRef;
  period: AnalyticsPeriod;
  /** The Asia/Jerusalem date of `now`. */
  asOf: IsoDate;
  coverageStart: IsoDate | null;
  includesTestData: boolean;
  /** Owner order: planned, done, closed calls. Null counts when the period is before coverage. */
  activity: { planned: Metric; done: Metric; closedCalls: Metric };
  /** `planAdherence` is always "pendingDefinition" ("הגדרה ממתינה", #20). */
  performance: { treat: Metric; travel: Metric; firstVisit: Metric; closeTime: Metric; planAdherence: Metric };
};

/** Sort of the SKU table (spec §8.3): by calls, ties by SKU ascending. */
export const SKU_SORT_VALUES = ["calls-desc", "calls-asc"] as const;
export type SkuSort = (typeof SKU_SORT_VALUES)[number];
export const DEFAULT_SKU_SORT: SkuSort = "calls-desc";

export const isSkuSort = (value: unknown): value is SkuSort =>
  typeof value === "string" && (SKU_SORT_VALUES as readonly string[]).includes(value);

/** Products & Suppliers tab ("מוצרים וספקים", matrix key dashProd): all time, no date filter (spec §8.1). */
export type ProductDashboard = {
  includesTestData: boolean;
  /**
   * Unique calls per supplier / brand, most first (at most DASHBOARD_LIST_LIMIT ranked rows). The
   * NONE_GROUP_KEY row ("לא הוזן") is never silently removed (spec §8.2): when it falls beyond the
   * cap it is appended after the capped rows, so `items` may hold one row more than `limit`.
   */
  bySupplier: Bounded<BarRow>;
  byBrand: Bounded<BarRow>;
  /** SKUs with at least one call, sorted by `sort`, DASHBOARD_LIST_LIMIT rows per page. */
  skus: Page<SkuStats>;
  sort: SkuSort;
};

/** What the details dialog asks for (spec-final §6.9). */
export type DashboardDetailQuery = {
  key: DashboardMetricKey;
  /** The trusted server instant (as for the tab methods). */
  now: IsoTimestamp;
  /** Technicians keys: the selected period and technician. */
  period?: AnalyticsPeriod;
  techId?: TechnicianId;
  /** Grouped keys: supplier / brand key, SKU or month ("YYYY-MM"). */
  group?: string;
  /** 1-based page; DASHBOARD_DETAIL_PAGE_LIMIT rows per page by default. */
  page?: number;
  limit?: number;
};

/** One record behind a metric: a visit (`n` set) or a service call (`n` null). */
export type DashboardDetailRow = TestMarker & {
  req: string;
  /** Visit number; null on call rows. */
  n: number | null;
  /** Visit rows: the scheduled date; call rows: the opening date (Asia/Jerusalem). */
  date: IsoDate;
  /** Visit rows: scheduled start and end ("HH:MM", Asia/Jerusalem). */
  start?: HourMinute;
  end?: HourMinute;
  /** Call rows: service_calls.opened_at / resolved_at. */
  openedAt?: IsoTimestamp;
  resolvedAt?: IsoTimestamp | null;
  /** Closure keys: resolved_at − opened_at in hours; null when not measurable. */
  durationHours?: number | null;
  /** First-visit keys: the first performed visit's outcome was "טופל" (D57 (5)). */
  firstVisitResolved?: boolean;
  /** Products keys: a visit was closed as "המשך טיפול", historical (D57 (5)). */
  followupRequired?: boolean;
  customerName: string;
  city: string;
  /** The visit's technician, or the technician a call is credited to (T2, T3); null otherwise. */
  technician: TechnicianRef | null;
  product: Pick<Product, "sku" | "name">;
  /** Visit rows: the visit status; call rows: the current D38 call status. */
  status: { kind: "visit"; value: VisitStatus } | { kind: "call"; value: CallStatus };
  /** Visit rows: where the visit came from (SIM-14). */
  source?: VisitSource;
  /** Treatment / travel keys: the visit's minutes; null when missing or invalid (T6). */
  minutes?: number | null;
};

/** The records behind one metric (or one group of it), paged. */
export type DashboardDetail = {
  key: DashboardMetricKey;
  records: "visits" | "calls";
  rows: Page<DashboardDetailRow>;
  includesTestData: boolean;
};
