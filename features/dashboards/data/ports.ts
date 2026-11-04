// Dashboard port. Implemented by app/dev/demo/_data/adapter.ts (aggregations over fictional
// fixtures) and, later, by server-side Supabase queries. In production, test-marked records are
// never counted (SIM-08); in test environments they are, and `includesTestData` is true.
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type { AnalyticsPeriod, CsWorkQueue, ManagerAnalytics, OfficeOverview, TechnicianDetail } from "./types";

export interface DashboardQueries {
  /** Office home ("לוח בקרה") for `date`. */
  officeOverview(date: IsoDate): Promise<OfficeOverview>;
  /** Manager dashboards (matrix keys dashGen / dashTech / dashProd) for `period`. */
  managerAnalytics(period: AnalyticsPeriod): Promise<ManagerAnalytics>;
  /** Technician drill-down for `period`; null for an unknown technician. */
  technicianDetail(techId: TechnicianId, period: AnalyticsPeriod): Promise<TechnicianDetail | null>;
  /** Customer-service home ("בית") for `date`. */
  csQueue(date: IsoDate): Promise<CsWorkQueue>;
}
