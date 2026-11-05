// Dashboard port. Implemented by app/dev/demo/_data/adapter.ts (aggregations over fictional
// fixtures) and, later, by server-side Supabase queries. In production, test-marked records are
// never counted (SIM-08); in test environments they are, and `includesTestData` is true.
// List sizes are fixed by DASHBOARD_LIST_LIMIT, TOP_SUPPLIERS_LIMIT, TOP_SKUS_LIMIT (./types) or paged.
//
// The manager dashboard (D57) reads one method per tab plus the details dialog. Rules every
// implementation keeps (existing decisions; no new mechanism):
// - `now` comes from the trusted server caller (the page), never from the URL; "today", the
//   current month and the 30-day window are its Asia/Jerusalem date.
// - A production adapter authorizes each method on the server by its tab's matrix key (dashGen,
//   dashTech, dashProd), and `dashboardDetail` rows additionally by the data key `calls`, enforced
//   in RLS (D33, G-04). A hidden link is not access control.
// - Aggregation runs in the database (manager-dashboard-spec §11, §15): no history download to the
//   browser and no media reads.
// - Test-marked rows are never counted in production (SIM-08): the adapter passes the formulas'
//   scope (the demo adapter: "test-env"); the testing-period Production question is open #21.
import type { IsoDate, IsoTimestamp } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type {
  AnalyticsPeriod,
  CsWorkQueue,
  DashboardDetail,
  DashboardDetailQuery,
  GeneralDashboard,
  OfficeOverview,
  ProductDashboard,
  SkuSort,
  TechnicianDashboard,
  TechnicianDetail,
  TechnicianDetailQuery,
  TrendMonths,
} from "./types";

export interface DashboardQueries {
  /** Office home ("לוח בקרה", Customer Service with dashGen) for `date`. */
  officeOverview(date: IsoDate): Promise<OfficeOverview>;
  /**
   * General tab (dashGen) at `now`: today's activity, the current month's service metrics, the
   * 30-day highlights and the trend over `months` completed months (3, 6 or 12; default 6).
   */
  generalDashboard(now: IsoTimestamp, opts?: { months?: TrendMonths }): Promise<GeneralDashboard>;
  /** Technicians tab (dashTech): one technician for `period` at `now`; null for an unknown technician. */
  technicianDashboard(techId: TechnicianId, period: AnalyticsPeriod, now: IsoTimestamp): Promise<TechnicianDashboard | null>;
  /** Products & Suppliers tab (dashProd): every call opened by `now`; the SKU table paged and sorted. */
  productDashboard(now: IsoTimestamp, opts?: { page?: number; sort?: SkuSort }): Promise<ProductDashboard>;
  /** Technician reports ("דוחות הביקורים", dashTech) for `period` (rows filtered and paged by `query`); null for an unknown technician. */
  technicianDetail(techId: TechnicianId, period: AnalyticsPeriod, query?: TechnicianDetailQuery): Promise<TechnicianDetail | null>;
  /**
   * The records behind one metric (details dialog): needs the metric's tab key AND `calls`. Null
   * for an unknown, pending or unavailable key, a key without records, or an unknown group.
   */
  dashboardDetail(query: DashboardDetailQuery): Promise<DashboardDetail | null>;
  /** Customer-service home ("בית") for `date`. */
  csQueue(date: IsoDate): Promise<CsWorkQueue>;
}
