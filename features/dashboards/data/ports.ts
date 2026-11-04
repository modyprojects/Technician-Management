// Dashboard port. Implemented by app/dev/demo/_data/adapter.ts (aggregations over fictional
// fixtures) and, later, by server-side Supabase queries. In production, test-marked records are
// never counted (SIM-08); in test environments they are, and `includesTestData` is true.
// List sizes are fixed by DASHBOARD_LIST_LIMIT / OLDEST_FOLLOWUPS_LIMIT (./types) or paged.
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type {
  AnalyticsPeriod,
  CsWorkQueue,
  ManagerAnalytics,
  OfficeOverview,
  TechnicianDetail,
  TechnicianDetailQuery,
} from "./types";

export interface DashboardQueries {
  /** Office home ("לוח בקרה") for `date`. */
  officeOverview(date: IsoDate): Promise<OfficeOverview>;
  /** Manager dashboards (matrix keys dashGen / dashTech / dashProd) for `period`. */
  managerAnalytics(period: AnalyticsPeriod): Promise<ManagerAnalytics>;
  /** Technician drill-down for `period` (rows filtered and paged by `query`); null for an unknown technician. */
  technicianDetail(techId: TechnicianId, period: AnalyticsPeriod, query?: TechnicianDetailQuery): Promise<TechnicianDetail | null>;
  /** Customer-service home ("בית") for `date`. */
  csQueue(date: IsoDate): Promise<CsWorkQueue>;
}
