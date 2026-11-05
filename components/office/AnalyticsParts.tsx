import type { IsoDate } from "@/features/data-access/common";

// Small building blocks shared by the manager dashboard (Analytics*.tsx, DashboardDetailTable;
// docs/demo.html offDash(), L860-935). Presentational and server-safe.

/** Short table columns: centred and sized to their content (design-system.md "Tables", G-07). */
export const SHORT_COL = "col-center col-fit";

/** "21.10" (the demo's ddmm). */
export const ddmm = (date: IsoDate): string => `${date.slice(8, 10)}.${date.slice(5, 7)}`;

/** Minutes as the demo's tables print them ("34 דק׳"; "—" when not measured). */
export const minutesLabel = (m: number | null): string => (m == null ? "—" : `${m} דק׳`);
