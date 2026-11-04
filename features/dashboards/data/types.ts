// Dashboard DTOs: office home (manager "לוח בקרה"), customer-service work queue ("בית") and the
// manager dashboards (docs/demo.html offDash(): כללי / טכנאים / מוצרים וספקים, OF-11 to OF-13).
// Values are raw numbers; screens own the Hebrew labels and formatting. In test environments
// they include test data and screens show "נתוני בדיקה" (SIM-08, SIM-13): see `includesTestData`.
// Every list is bounded (docs/security.md: query bounds): lists that grow with the data are
// Bounded<T> with a fixed cap (below) or a Page<T>; the rest are bounded by design (one row per
// technician, per follow-up reason or per week of a period of at most 366 days).
import type { Bounded, HourMinute, IsoDate, Page, PageRequest, TestMarker } from "@/features/data-access/common";
import type { Product, TechnicianId, TechnicianRef } from "@/features/reference/data/types";
import type { CallStatus } from "@/features/calls/data/types";
import type { VisitRef, VisitSource, VisitStatus } from "@/features/visits/data/types";

/**
 * Fixed cap of the growing dashboard lists (attention and work-queue lists, recently closed,
 * SKUs, brand and supplier bars). `total` on each Bounded<T> is the full count, so a screen can
 * add "ועוד X" and link to the calls list.
 */
export const DASHBOARD_LIST_LIMIT = 20;

/** "המשך טיפול – הכי ותיקים" shows the demo's 6 rows. */
export const OLDEST_FOLLOWUPS_LIMIT = 6;

/** How a number is shown: "12", "67%", "34 דק׳", "4.5" (days). */
export type MetricUnit = "count" | "percent" | "minutes" | "days";

/** One KPI tile value ("card kpi"). `value` null = nothing to measure (shown as "—"). */
export type Metric = { value: number | null; unit: MetricUnit; decimals?: number };

/** One horizontal bar row (".bar"). */
export type BarRow = {
  /** Stable key (technician id, reason, brand ...). */
  key: string;
  /** "" when the grouped value was not entered (brand / supplier: shown as "לא הוזן", OF-12). */
  label: string;
  value: number;
  /** Data colour (a technician's colour); the chart's default when missing. */
  color?: string;
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
  /** Calls that need the office, oldest first (at most DASHBOARD_LIST_LIMIT). */
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

/** One technician's figures (טכנאים tab). */
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

/** Manager dashboards for a period. */
export type ManagerAnalytics = {
  period: AnalyticsPeriod;
  /** The date "today" figures ("עכשיו בשטח", "פתוח X ימים") are measured on. */
  asOf: IsoDate;
  includesTestData: boolean;
  general: {
    kpis: {
      /** Visits in the period, scheduled included. */
      visits: Metric;
      /** % of visited calls closed on the first visit. */
      firstVisitFixRate: Metric;
      /** Calls in "המשך טיפול" without a new visit. */
      openFollowups: Metric;
      /** Waze → הגעתי. */
      avgTravelMinutes: Metric;
      /** הגעתי → סיום. */
      avgTreatMinutes: Metric;
      /** First visit → second visit, average days. */
      avgDaysToFollowup: Metric;
    };
    /** "עכשיו בשטח". */
    live: TechnicianLane[];
    /** "ביקורים לפי טכנאי ותוצאה": closed visits split into done and cont. */
    outcomesByTechnician: { technician: TechnicianRef; done: number; cont: number }[];
    /** "סיבות להמשך טיפול". */
    followupReasons: BarRow[];
    /** "ביקורים לפי שבוע" (Sunday–Saturday weeks overlapping the period). */
    weekly: { weekStart: IsoDate; weekEnd: IsoDate; visits: number }[];
    /** "המשך טיפול – הכי ותיקים", oldest first (at most OLDEST_FOLLOWUPS_LIMIT). */
    oldestFollowups: Bounded<CallAttentionItem>;
  };
  technicians: {
    stats: TechnicianStats[];
    /** "סיבות להמשך טיפול לפי טכנאי". */
    reasonsByTechnician: { reason: string; counts: Record<TechnicianId, number>; total: number }[];
  };
  products: {
    /** "קריאות לפי מותג" / "לפי ספק", most calls first (label "" = not entered, OF-12; at most DASHBOARD_LIST_LIMIT). */
    byBrand: Bounded<BarRow>;
    bySupplier: Bounded<BarRow>;
    /** "מק״טים עם הכי הרבה קריאות", most calls first (at most DASHBOARD_LIST_LIMIT). */
    skus: Bounded<SkuStats>;
  };
};

/** One row of "מק״טים עם הכי הרבה קריאות". */
export type SkuStats = {
  product: Product;
  calls: number;
  /** % of the SKU's calls under warranty. */
  warrantyRate: Metric;
  /** % of the SKU's closed visits that ended in follow-up (red above 40%). */
  followupRate: Metric;
  /** Most common fault description; null when no calls. */
  topIssue: string | null;
};

/** A row of the technician drill-down table (dashTechDetail). */
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

/** Technician drill-down ("פירוט הטכנאי"). */
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
