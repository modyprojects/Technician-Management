// URL state of the manager dashboard (D57; spec-final §6.2): every tab, chart range, technician,
// period, page, sort and the details dialog is a real link, so the server renders each view and
// the browser's back button works. Pure; unknown or malformed values fall back to the defaults, and
// defaults are left out of the URLs. The adapter validates everything again (technician id,
// period, metric key, group, sort, `now`).
// Display only (G-04): what a view offers follows the role's matrix values; enforcement is on the
// server and in the database (D33).
import { clampPage, type IsoDate } from "@/features/data-access/common";
import {
  detailOffered,
  isDashboardMetricKey,
  METRIC_DEFINITIONS,
  type DashboardMetricKey,
} from "@/features/dashboards/data/metric-definitions";
import { DEFAULT_PERIOD_KIND, isDashboardPeriodKind, type DashboardPeriodKind } from "@/features/dashboards/data/periods";
import {
  DEFAULT_SKU_SORT,
  DEFAULT_TREND_MONTHS,
  isSkuSort,
  isTechnicianVisitFilter,
  isTrendMonths,
  type SkuSort,
  type TechnicianVisitFilter,
  type TrendMonths,
} from "@/features/dashboards/data/types";
import { offers } from "@/features/reference/data/permissions";
import type { PermissionKey, RolePermissions, Technician } from "@/features/reference/data/types";
import { isTechnicianId } from "@/features/reference/data/validate";

/** The dashboard's three tabs and the matrix key that offers each (D57 (3)). */
export const ANALYTICS_TABS = [
  { key: "gen", label: "כללי", permission: "dashGen" },
  { key: "tech", label: "טכנאים", permission: "dashTech" },
  { key: "prod", label: "מוצרים וספקים", permission: "dashProd" },
] as const satisfies readonly { key: string; label: string; permission: PermissionKey }[];

export type AnalyticsTab = (typeof ANALYTICS_TABS)[number]["key"];

const isAnalyticsTab = (v: unknown): v is AnalyticsTab => ANALYTICS_TABS.some((t) => t.key === v);

/** The tabs the role's matrix values offer, in tab order (display only). */
export const offeredAnalyticsTabs = (permissions: RolePermissions): AnalyticsTab[] =>
  ANALYTICS_TABS.filter((t) => offers(permissions, t.permission)).map((t) => t.key);

/** Longest accepted dialog group (a supplier or brand key, an SKU or "YYYY-MM"). */
export const MAX_GROUP_LENGTH = 64;

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export type AnalyticsState = {
  /** Requested tab; "gen" when missing or unknown (the page falls back to the first offered tab). */
  tab: AnalyticsTab;
  /** General chart: 3, 6 (default) or 12 completed months. */
  months: TrendMonths;
  /** Technicians tab: the requested technician; null = the first one. */
  tech: string | null;
  /** Technicians tab: the period as requested (resolved against the server's date by resolveDashboardPeriod). */
  period: DashboardPeriodKind;
  offset: string | undefined;
  from: IsoDate | undefined;
  to: IsoDate | undefined;
  /** Technicians tab: "reports" opens "דוחות הביקורים". */
  view: "reports" | null;
  /** Reports view: the visit filter and its page. */
  filter: TechnicianVisitFilter;
  page: number;
  /** Products tab: the SKU table's page and sort. */
  spage: number;
  sort: SkuSort;
  /** Details dialog: the metric key, its group and the dialog page. */
  detail: DashboardMetricKey | null;
  group: string | null;
  dpage: number;
};

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseAnalyticsState(sp: SearchParamsLike): AnalyticsState {
  const tab = first(sp.tab);
  const months = Number(first(sp.months));
  const tech = first(sp.tech);
  const period = first(sp.period);
  const from = first(sp.from);
  const to = first(sp.to);
  const filter = first(sp.filter);
  const sort = first(sp.sort);
  const detail = first(sp.detail);
  const group = first(sp.group);
  const kind = isDashboardPeriodKind(period) ? period : DEFAULT_PERIOD_KIND;
  return {
    tab: isAnalyticsTab(tab) ? tab : "gen",
    months: isTrendMonths(months) ? months : DEFAULT_TREND_MONTHS,
    tech: isTechnicianId(tech) ? tech : null,
    period: kind,
    offset: first(sp.offset),
    // A custom range keeps what was typed (as text; the resolver accepts valid dates only).
    from: kind === "custom" && typeof from === "string" && from.length <= 10 ? from : undefined,
    to: kind === "custom" && typeof to === "string" && to.length <= 10 ? to : undefined,
    view: first(sp.view) === "reports" ? "reports" : null,
    filter: isTechnicianVisitFilter(filter) ? filter : "all",
    page: clampPage(first(sp.page)),
    spage: clampPage(first(sp.spage)),
    sort: isSkuSort(sort) ? sort : DEFAULT_SKU_SORT,
    detail: isDashboardMetricKey(detail) ? detail : null,
    group: typeof group === "string" && group !== "" && group.length <= MAX_GROUP_LENGTH ? group : null,
    dpage: clampPage(first(sp.dpage)),
  };
}

/** What a dashboard link carries. Every key is optional; defaults are left out of the URL. */
export type AnalyticsLink = {
  tab: AnalyticsTab;
  months?: TrendMonths;
  tech?: string | null;
  period?: DashboardPeriodKind;
  offset?: number;
  from?: string;
  to?: string;
  view?: "reports" | null;
  filter?: TechnicianVisitFilter;
  page?: number;
  spage?: number;
  sort?: SkuSort;
  /** Only dialog links carry detail / group / dpage (closing drops them). */
  detail?: DashboardMetricKey | null;
  group?: string | null;
  dpage?: number;
};

/** `base?tab=…&…` with defaults left out, in a fixed key order. */
export function analyticsHref(base: string, s: AnalyticsLink): string {
  const sp = new URLSearchParams();
  if (s.tab !== "gen") sp.set("tab", s.tab);
  if (s.tab === "gen" && s.months !== undefined && s.months !== DEFAULT_TREND_MONTHS) sp.set("months", String(s.months));
  if (s.tab === "tech") {
    if (s.tech) sp.set("tech", s.tech);
    if (s.period && s.period !== DEFAULT_PERIOD_KIND) sp.set("period", s.period);
    if (s.period !== "custom" && s.offset !== undefined && s.offset !== 0) sp.set("offset", String(s.offset));
    if (s.period === "custom") {
      if (s.from) sp.set("from", s.from);
      if (s.to) sp.set("to", s.to);
    }
    if (s.view === "reports") {
      sp.set("view", "reports");
      if (s.filter && s.filter !== "all") sp.set("filter", s.filter);
      if (s.page && s.page > 1) sp.set("page", String(s.page));
    }
  }
  if (s.tab === "prod") {
    if (s.spage && s.spage > 1) sp.set("spage", String(s.spage));
    if (s.sort && s.sort !== DEFAULT_SKU_SORT) sp.set("sort", s.sort);
  }
  if (s.detail) {
    sp.set("detail", s.detail);
    if (s.group) sp.set("group", s.group);
    if (s.dpage && s.dpage > 1) sp.set("dpage", String(s.dpage));
  }
  const qs = sp.toString();
  return qs ? `${base}?${qs}` : base;
}

/** Whether `group` has the shape the metric's grouping needs (the adapter checks that it exists). */
export function groupFitsMetric(key: DashboardMetricKey, group: string | null): boolean {
  const def = METRIC_DEFINITIONS[key];
  if (!def.grouped) return group === null;
  if (group === null || group.length > MAX_GROUP_LENGTH) return false;
  return def.groupBy === "month" ? YEAR_MONTH.test(group) : group.trim() !== "";
}

export type EffectiveAnalyticsView = {
  /** The tab shown: the requested one when offered, else the first offered; null when none is. */
  tab: AnalyticsTab | null;
  /** "reports" only on the Technicians tab. */
  view: "reports" | null;
  /** The dialog to open: an approved key with records on the shown tab and a group of the right shape. */
  detail: { key: DashboardMetricKey; group: string | null } | null;
};

/**
 * What the page shows for a URL (spec-final §6.2). Anything that does not fit the offered tabs is
 * ignored: no error and no data read. A dialog never opens over the reports view.
 */
export function effectiveAnalyticsView(state: AnalyticsState, offeredTabs: readonly AnalyticsTab[]): EffectiveAnalyticsView {
  const tab = offeredTabs.includes(state.tab) ? state.tab : (offeredTabs[0] ?? null);
  if (tab === null) return { tab: null, view: null, detail: null };
  const view = tab === "tech" && state.view === "reports" ? "reports" : null;
  const detail =
    view === null && state.detail !== null && detailOffered(state.detail, tab) && groupFitsMetric(state.detail, state.group)
      ? { key: state.detail, group: state.group }
      : null;
  return { tab, view, detail };
}

/** Reports view rows are visit records: they need the data key `calls`, like the dialog (D33; spec-final §6.6). */
export const reportsRowsOffered = (permissions: RolePermissions): boolean => offers(permissions, "calls");

/**
 * Reports view columns: "תיעוד" and "חתימה" describe report content, which the call card shows only
 * with `card`; the 🎙 marker additionally needs `recordings` (as the call card's recording player).
 */
export function reportsColumnsOffered(permissions: RolePermissions): { documentation: boolean; signature: boolean; recording: boolean } {
  const card = offers(permissions, "card");
  return { documentation: card, signature: card, recording: card && offers(permissions, "recordings") };
}

/** Technicians in toolbar order: active first (inactive ones stay selectable, SE-05); order kept otherwise. */
export const orderTechnicians = <T extends Pick<Technician, "active">>(list: readonly T[]): T[] => [
  ...list.filter((t) => t.active),
  ...list.filter((t) => !t.active),
];

/** The selected technician: the requested one, else the first in toolbar order; null when there is none. */
export function selectedTechnician<T extends Pick<Technician, "id" | "active">>(list: readonly T[], requested: string | null): T | null {
  const ordered = orderTechnicians(list);
  return ordered.find((t) => t.id === requested) ?? ordered[0] ?? null;
}
