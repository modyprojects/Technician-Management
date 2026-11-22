// FAKE data of the manager dashboard skeleton (D81 skeleton, approved under D96): fixed, fictional,
// test-marked values in the real dashboard DTO shapes (features/dashboards/data/types), so the real
// screen can be reviewed before any data access exists. Nothing here is read from the database,
// computed from records or configured; every name, SKU and number is invented ("נתוני בדיקה",
// D47). When the dashboard is wired, the page reads the same shapes through the data-access layer
// and this file goes.
import type { IsoDate, IsoTimestamp } from "@/features/data-access/common";
import type {
  BarRow,
  GeneralDashboard,
  Metric,
  ProductDashboard,
  SkuStats,
  TechnicianDashboard,
  TrendMonths,
  TrendRow,
} from "@/features/dashboards/data/types";
import { DASHBOARD_LIST_LIMIT, NONE_GROUP_KEY } from "@/features/dashboards/data/types";

/** The skeleton's fixed instant and date (Asia/Jerusalem); never the clock, so the screen is stable. */
export const SKELETON_NOW: IsoTimestamp = "2026-11-22T10:45:00+02:00";
export const SKELETON_AS_OF: IsoDate = "2026-11-22";

/**
 * HARD-CODED fake permission set (skeleton only): the three dashboard tab keys of the permission
 * matrix (dashGen / dashTech / dashProd), all offered. The real screen takes them from
 * reference.permissions for the signed-in role (display only, G-04; the server enforces access).
 */
export const SKELETON_PERMISSIONS = { dashGen: true, dashTech: true, dashProd: true } as const;

const count = (value: number): Metric => ({ value, unit: "count" });
const minutes = (value: number, basis: number): Metric => ({ value, unit: "minutes", basis });
const percent = (value: number, basis: number): Metric => ({ value, unit: "percent", basis });
const hours = (h: number, basis: number): Metric => ({ value: Math.round(h * 100) / 100, unit: "duration", durationHours: h, basis });

/** Fictional technicians (names only; no record behind them). */
export const SKELETON_TECHNICIANS = [
  { id: "skel-t1", name: "יורם", color: "var(--t-y)", phone: "", active: true },
  { id: "skel-t2", name: "ארז", color: "var(--t-e)", phone: "", active: true },
  { id: "skel-t3", name: "שמואל", color: "var(--t-s)", phone: "", active: true },
  { id: "skel-t4", name: "דניאל", color: "var(--t-y)", phone: "", active: true },
] as const;

const TREND_12: TrendRow[] = [
  { month: "2025-11", opened: 38, closed: 35 },
  { month: "2025-12", opened: 41, closed: 39 },
  { month: "2026-01", opened: 47, closed: 44 },
  { month: "2026-02", opened: 39, closed: 42 },
  { month: "2026-03", opened: 52, closed: 48 },
  { month: "2026-04", opened: 44, closed: 46 },
  { month: "2026-05", opened: 49, closed: 45 },
  { month: "2026-06", opened: 55, closed: 51 },
  { month: "2026-07", opened: 61, closed: 58 },
  { month: "2026-08", opened: 57, closed: 60 },
  { month: "2026-09", opened: 50, closed: 49 },
  { month: "2026-10", opened: 53, closed: 52 },
];

const supplierBars: BarRow[] = [
  { key: "skel-sup-1", label: "ספק לדוגמה א׳", value: 46 },
  { key: "skel-sup-2", label: "ספק לדוגמה ב׳", value: 31 },
  { key: "skel-sup-3", label: "ספק לדוגמה ג׳", value: 18 },
];

const skuBars: BarRow[] = [
  { key: "KT-2041", label: "KT-2041", name: "ברז מטבח נשלף", value: 22, isTest: true },
  { key: "BT-1120", label: "BT-1120", name: "ברז אמבטיה רב-דרך", value: 17, isTest: true },
  { key: "WC-300", label: "WC-300", name: "מיכל הדחה סמוי", value: 13, isTest: true },
  { key: "SH-510", label: "SH-510", name: "מערכת מקלחת תרמוסטטית", value: 9, isTest: true },
  { key: "KT-1800", label: "KT-1800", name: "ברז מטבח פרח", value: 7, isTest: true },
];

/** "כללי" (dashGen) on fake data. The trend rows are the last `months` completed months. */
export function skeletonGeneral(months: TrendMonths): GeneralDashboard {
  return {
    now: SKELETON_NOW,
    asOf: SKELETON_AS_OF,
    coverageStart: "2025-11-02",
    includesTestData: true,
    today: {
      planned: count(24),
      done: count(14),
      pending: count(8),
      missed: count(2),
      // Not shown: the progress bar is removed (D60 (6), QA-10); kept only because the DTO has it.
      progress: percent(58, 24),
    },
    service: {
      period: { from: "2026-11-01", to: "2026-11-30" },
      treat: minutes(47, 132),
      travel: minutes(32, 128),
      firstVisit: percent(71, 96),
      closeTime: hours(91.2, 88),
    },
    highlights: {
      period: { from: "2026-10-24", to: SKELETON_AS_OF },
      suppliers: { items: supplierBars, total: supplierBars.length, limit: 3 },
      skus: { items: skuBars, total: skuBars.length, limit: 5 },
    },
    trend: { months, rows: TREND_12.slice(TREND_12.length - months) },
  };
}

/** Per-technician fake figures (planned, done, closed calls, treat, travel, first visit %, closure hours). */
const TECH_FIGURES: Readonly<Record<string, readonly [number, number, number, number, number, number, number]>> = {
  "skel-t1": [62, 55, 41, 44, 29, 76, 70.5],
  "skel-t2": [58, 49, 37, 51, 35, 68, 96],
  "skel-t3": [47, 44, 33, 39, 27, 81, 52.4],
  "skel-t4": [51, 42, 30, 56, 38, 64, 118],
};

/** "טכנאים" (dashTech) on fake data: one technician for November 2026. */
export function skeletonTechnician(id: string): TechnicianDashboard | null {
  const t = SKELETON_TECHNICIANS.find((x) => x.id === id);
  const f = TECH_FIGURES[id];
  if (!t || !f) return null;
  const [planned, done, closed, treat, travel, first, close] = f;
  return {
    technician: { id: t.id, name: t.name, color: t.color, phone: t.phone },
    period: { from: "2026-11-01", to: "2026-11-30" },
    asOf: SKELETON_AS_OF,
    coverageStart: "2025-11-02",
    includesTestData: true,
    activity: { planned: count(planned), done: count(done), closedCalls: count(closed) },
    performance: {
      treat: minutes(treat, done),
      travel: minutes(travel, done),
      firstVisit: percent(first, closed),
      closeTime: hours(close, closed),
      // Not shown: "עמידה בתכנון" is removed (D60 (6)); kept only because the DTO has it.
      planAdherence: { value: null, unit: "percent", state: "pendingDefinition" },
    },
  };
}

const product = (sku: string, name: string, brand: string, supplier: string) => ({ sku, name, brand, supplier, isTest: true });

const SKU_ROWS: SkuStats[] = [
  { product: product("KT-2041", "ברז מטבח נשלף", "מותג לדוגמה 1", "ספק לדוגמה א׳"), calls: 64, warrantyRate: percent(72, 58), followupRate: percent(19, 61), topIssue: { state: "unavailable" } },
  { product: product("BT-1120", "ברז אמבטיה רב-דרך", "מותג לדוגמה 1", "ספק לדוגמה א׳"), calls: 51, warrantyRate: percent(65, 49), followupRate: percent(24, 50), topIssue: { state: "unavailable" } },
  { product: product("WC-300", "מיכל הדחה סמוי", "מותג לדוגמה 2", "ספק לדוגמה ב׳"), calls: 43, warrantyRate: percent(58, 40), followupRate: percent(14, 42), topIssue: { state: "unavailable" } },
  { product: product("SH-510", "מערכת מקלחת תרמוסטטית", "מותג לדוגמה 3", "ספק לדוגמה ב׳"), calls: 29, warrantyRate: percent(81, 27), followupRate: percent(31, 29), topIssue: { state: "unavailable" } },
  { product: product("KT-1800", "ברז מטבח פרח", "", "ספק לדוגמה ג׳"), calls: 22, warrantyRate: percent(45, 20), followupRate: percent(9, 22), topIssue: { state: "unavailable" } },
  { product: product("WF-100", "מסנן מים", "מותג לדוגמה 2", ""), calls: 17, warrantyRate: { value: null, unit: "percent", basis: 0 }, followupRate: percent(12, 17), topIssue: { state: "unavailable" } },
  { product: product("BT-330", "סוללת אמבטיה", "מותג לדוגמה 3", "ספק לדוגמה ג׳"), calls: 11, warrantyRate: percent(36, 11), followupRate: percent(18, 11), topIssue: { state: "unavailable" } },
];

/** "מוצרים וספקים" (dashProd) on fake data: cumulative, no date controls (spec §8.1). */
export function skeletonProducts(sort: "calls-desc" | "calls-asc"): ProductDashboard {
  const items = sort === "calls-desc" ? SKU_ROWS : [...SKU_ROWS].reverse();
  return {
    includesTestData: true,
    bySupplier: {
      items: [
        { key: "skel-sup-1", label: "ספק לדוגמה א׳", value: 115 },
        { key: "skel-sup-2", label: "ספק לדוגמה ב׳", value: 72 },
        { key: "skel-sup-3", label: "ספק לדוגמה ג׳", value: 33 },
        { key: NONE_GROUP_KEY, label: "", value: 17 },
      ],
      total: 4,
      limit: DASHBOARD_LIST_LIMIT,
    },
    byBrand: {
      items: [
        { key: "skel-br-1", label: "מותג לדוגמה 1", value: 115 },
        { key: "skel-br-2", label: "מותג לדוגמה 2", value: 60 },
        { key: "skel-br-3", label: "מותג לדוגמה 3", value: 40 },
        { key: NONE_GROUP_KEY, label: "", value: 22 },
      ],
      total: 4,
      limit: DASHBOARD_LIST_LIMIT,
    },
    skus: { items, total: items.length, limit: DASHBOARD_LIST_LIMIT, page: 1, pageCount: 1 },
    sort,
  };
}
