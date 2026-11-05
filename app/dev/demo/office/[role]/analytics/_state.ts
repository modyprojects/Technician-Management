// URL state of the manager dashboards (?tab=&tech=&filter=&page=): tabs and the technician
// drill-down are real links (UI demo, D53; the demo keeps them in memory as S.dashTab,
// S.techDetail and S.tdFilter, docs/demo.html L1150-1153). Pure; unknown or malformed values fall
// back to the defaults. The adapter validates the technician id and the filter again.
import { monthLabel, monthName } from "@/features/calendar/data/dates";
import { clampPage, type IsoDate } from "@/features/data-access/common";
import { monthOfDate, monthPeriod } from "@/features/dashboards/data/periods";
import { isTechnicianVisitFilter, type AnalyticsPeriod, type TechnicianVisitFilter } from "@/features/dashboards/data/types";
import type { PermissionKey } from "@/features/reference/data/types";
import { isTechnicianId } from "@/features/reference/data/validate";

/** The demo's tabs and the matrix key that offers each (offDash(), L861). */
export const ANALYTICS_TABS = [
  { key: "gen", label: "כללי", permission: "dashGen" },
  { key: "tech", label: "טכנאים", permission: "dashTech" },
  { key: "prod", label: "מוצרים וספקים", permission: "dashProd" },
] as const satisfies readonly { key: string; label: string; permission: PermissionKey }[];

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]["key"];

const isAnalyticsTab = (v: unknown): v is AnalyticsTab => ANALYTICS_TABS.some((t) => t.key === v);

export type AnalyticsState = {
  /** Requested tab; "gen" when missing or unknown (the page falls back to the first offered tab). */
  tab: AnalyticsTab;
  /** Technician of the drill-down; null = no drill-down. */
  tech: string | null;
  filter: TechnicianVisitFilter;
  page: number;
};

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseAnalyticsState(sp: SearchParamsLike): AnalyticsState {
  const tab = first(sp.tab);
  const tech = first(sp.tech);
  const filter = first(sp.filter);
  return {
    tab: isAnalyticsTab(tab) ? tab : "gen",
    tech: isTechnicianId(tech) ? tech : null,
    filter: isTechnicianVisitFilter(filter) ? filter : "all",
    page: clampPage(first(sp.page)),
  };
}

/** `base?tab=…&tech=…&filter=…&page=…` with defaults left out. */
export function analyticsHref(
  base: string,
  s: { tab: AnalyticsTab; tech?: string | null; filter?: TechnicianVisitFilter; page?: number },
): string {
  const sp = new URLSearchParams();
  if (s.tab !== "gen") sp.set("tab", s.tab);
  if (s.tech) {
    sp.set("tech", s.tech);
    if (s.filter && s.filter !== "all") sp.set("filter", s.filter);
    if (s.page && s.page > 1) sp.set("page", String(s.page));
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/**
 * The calendar month of `date` as a dashboard period, with its Hebrew names ("אוקטובר 2026"); the
 * period resolver's month rule (features/dashboards/data/periods.ts).
 */
export function monthOf(date: IsoDate): { period: AnalyticsPeriod; name: string; label: string } {
  const month = monthOfDate(date);
  return { period: monthPeriod(month), name: monthName(month), label: monthLabel(month) };
}
