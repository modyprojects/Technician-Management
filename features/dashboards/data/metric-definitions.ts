// Metric registry of the manager dashboard (D57 (4); docs/design/manager-dashboard-spec.md as
// amended by D57; spec-final §4.2-§4.4). One entry per dashboard metric: its tab, Hebrew label,
// unit, owner category, the records behind it and its definition. Screens read labels, states and
// definitions only from here; swapping a definition changes one entry and its formula
// (./formulas.ts). Pure: no data.
//
// Owner categories (D57 (4)): every metric is exactly one of
// - "approved": an approved definition, computed;
// - "pendingDefinition": no approved formula yet, shown as "הגדרה ממתינה" (only "עמידה בתכנון");
// - "approvedDataUnavailable": an approved definition whose data does not exist, shown as "לא זמין"
//   (only "תקלה נפוצה": there is no structured issue category, docs/database-schema.md).
// `temporary` lists the TEMPORARY interpretations a formula applies (T1-T8, T12, T13; open #20,
// docs/demo-deviations.md OF-20). T9 was withdrawn by D57 (5) and is never used.
import { offers } from "@/features/reference/data/permissions";
import type { RolePermissions } from "@/features/reference/data/types";
import type { MetricState, MetricUnit } from "./types";

export const DASHBOARD_METRIC_KEYS = [
  "today.planned",
  "today.done",
  "today.pending",
  "today.missed",
  "today.progress",
  "service.treat",
  "service.travel",
  "service.firstVisit",
  "service.closeTime",
  "top.suppliers",
  "top.skus",
  "trend.opened",
  "trend.closed",
  "tech.planned",
  "tech.done",
  "tech.closedCalls",
  "tech.treat",
  "tech.travel",
  "tech.firstVisit",
  "tech.closeTime",
  "tech.planAdherence",
  "prod.bySupplier",
  "prod.byBrand",
  "prod.skuCalls",
  "prod.warrantyRate",
  "prod.followupRate",
  "prod.topIssue",
] as const;

export type DashboardMetricKey = (typeof DASHBOARD_METRIC_KEYS)[number];

export const isDashboardMetricKey = (value: unknown): value is DashboardMetricKey =>
  typeof value === "string" && (DASHBOARD_METRIC_KEYS as readonly string[]).includes(value);

/** The dashboard tabs (matrix keys dashGen / dashTech / dashProd). */
export type DashboardTabKey = "gen" | "tech" | "prod";

export type MetricCategory = "approved" | "pendingDefinition" | "approvedDataUnavailable";

/** Units of the registry (every MetricUnit). */
export type DashboardMetricUnit = MetricUnit;

/** TEMPORARY interpretations under open #20 (spec-final §2.5). T9 is withdrawn (D57 (5)). */
export type TemporaryInterpretation = "T1" | "T2" | "T3" | "T4" | "T5" | "T6" | "T7" | "T8" | "T12" | "T13";

/** What a grouped metric is grouped by: supplier, brand, SKU, or month ("YYYY-MM"). */
export type DashboardGroupKind = "supplier" | "brand" | "sku" | "month";

export type MetricDefinition = {
  key: DashboardMetricKey;
  tab: DashboardTabKey;
  /** The label the detailed spec names (rule (c) of spec-final). */
  label: string;
  /** The reference design's text, where it differs (docs/design/manager-dashboard-demo.html; C21). */
  referenceLabel?: string;
  /** "count" also for "תקלה נפוצה", whose value (when it exists) is a category with its count. */
  unit: DashboardMetricUnit;
  category: MetricCategory;
  /** The records the details dialog lists; null = no dialog. */
  records: "visits" | "calls" | null;
  /** Whether the dialog lists one group (supplier, brand, SKU or month) of the metric. */
  grouped: boolean;
  /** The group kind of a grouped metric; null otherwise. */
  groupBy: DashboardGroupKind | null;
  /** Hebrew, shown as the dialog's description. */
  definition: string;
  /** Where the definition comes from. */
  source: string;
  temporary: readonly TemporaryInterpretation[];
};

type Entry = Omit<MetricDefinition, "key" | "grouped" | "groupBy"> & { groupBy?: DashboardGroupKind };

const SPEC = "docs/design/manager-dashboard-spec.md";

const ENTRIES: Readonly<Record<DashboardMetricKey, Entry>> = {
  // General ("כללי") -----------------------------------------------------------------------------
  "today.planned": {
    tab: "gen",
    label: "מתוכננים",
    referenceLabel: "ביקורים מתוכננים",
    unit: "count",
    category: "approved",
    records: "visits",
    definition: "ביקורים שמתוכננים להיום לפי מועד ההתחלה המתוכנן (שעון ישראל), ללא ביקורים שבוטלו.",
    source: `${SPEC} §4.2; D57 (3); T1, T5 (#20)`,
    temporary: ["T1", "T5"],
  },
  "today.done": {
    tab: "gen",
    label: "בוצעו",
    referenceLabel: "ביקורים שבוצעו",
    unit: "count",
    category: "approved",
    records: "visits",
    definition: "ביקורים מתוכננים להיום שנסגרו בתוצאה \"טופל\" או \"המשך טיפול\", גם אם נסגרו אחרי מועד הסיום המתוכנן.",
    source: `${SPEC} §4.2; T1, T5 (#20)`,
    temporary: ["T1", "T5"],
  },
  "today.pending": {
    tab: "gen",
    label: "טרם בוצעו",
    unit: "count",
    category: "approved",
    records: "visits",
    definition: "ביקורים מתוכננים להיום שעדיין פתוחים ומועד הסיום המתוכנן שלהם טרם עבר, כולל ביקורים מאוחר יותר היום.",
    source: `${SPEC} §4.2; T1, T5 (#20)`,
    temporary: ["T1", "T5"],
  },
  "today.missed": {
    tab: "gen",
    label: "לא בוצעו במועד",
    unit: "count",
    category: "approved",
    records: "visits",
    definition: "ביקורים מתוכננים להיום שעדיין פתוחים אחרי מועד הסיום המתוכנן שלהם. ביקור מאוחר יותר היום לעולם אינו נספר כאן.",
    source: `${SPEC} §4.2; D57 (4); T1, T5 (#20)`,
    temporary: ["T1", "T5"],
  },
  "today.progress": {
    tab: "gen",
    label: "התקדמות הביקורים",
    unit: "percent",
    category: "approved",
    records: null,
    definition: "הביקורים שבוצעו מתוך הביקורים המתוכננים להיום.",
    source: `${SPEC} §4.3; T1, T5 (#20)`,
    temporary: ["T1", "T5"],
  },
  "service.treat": {
    tab: "gen",
    label: "זמן טיפול ממוצע",
    unit: "minutes",
    category: "approved",
    records: "visits",
    definition:
      "ממוצע הזמן מ\"הגעתי\" ועד סיום הטיפול, בביקורים שנסגרו ומתוכננים בחודש הנוכחי. מדידות חסרות או בלתי אפשריות אינן נכללות.",
    source: `${SPEC} §4.4; D56 (2); T5, T6 (#20)`,
    temporary: ["T5", "T6"],
  },
  "service.travel": {
    tab: "gen",
    label: "זמן נסיעה ממוצע",
    unit: "minutes",
    category: "approved",
    records: "visits",
    definition:
      "ממוצע הזמן מתחילת הנסיעה ועד \"הגעתי\", בביקורים שנסגרו ומתוכננים בחודש הנוכחי. מדידות חסרות או בלתי אפשריות אינן נכללות.",
    source: `${SPEC} §4.4; D56 (2); T5, T6 (#20)`,
    temporary: ["T5", "T6"],
  },
  "service.firstVisit": {
    tab: "gen",
    label: "פתרון בביקור ראשון",
    unit: "percent",
    category: "approved",
    records: "calls",
    definition:
      "קריאות שהביקור הראשון שבוצע בהן הסתיים בתוצאה \"טופל\", מתוך הקריאות שהביקור הראשון שבוצע בהן היה בחודש הנוכחי. \"המשך טיפול\" בביקור הראשון אינו נחשב, ומספר הביקורים אינו קובע.",
    source: `${SPEC} §4.4; D56 (2); D57 (5); T3, T5 (#20)`,
    temporary: ["T3", "T5"],
  },
  "service.closeTime": {
    tab: "gen",
    label: "זמן סגירת קריאה",
    referenceLabel: "זמן ממוצע לסגירת קריאה",
    unit: "duration",
    category: "approved",
    records: "calls",
    definition: "ממוצע הזמן מפתיחת הקריאה ועד סגירתה, בקריאות שנסגרו בחודש הנוכחי ושיש להן זמן פתיחה וזמן סגירה תקינים.",
    source: `${SPEC} §4.4; D56 (2); D57 (4); T7, T8 (#20)`,
    temporary: ["T7", "T8"],
  },
  "top.suppliers": {
    tab: "gen",
    label: "3 ספקים מובילים",
    referenceLabel: "3 ספקים עם הכי הרבה קריאות",
    unit: "count",
    category: "approved",
    records: "calls",
    groupBy: "supplier",
    definition:
      "הספקים עם הכי הרבה קריאות שירות שנפתחו ב-30 הימים האחרונים. כל קריאה נספרת פעם אחת; קריאות של מוצר בלי ספק אינן מדורגות.",
    source: `${SPEC} §5; D57 (3); T4, T13 (#20)`,
    temporary: ["T4", "T13"],
  },
  "top.skus": {
    tab: "gen",
    label: "5 מק״טים מובילים",
    referenceLabel: "5 מק״טים עם הכי הרבה קריאות",
    unit: "count",
    category: "approved",
    records: "calls",
    groupBy: "sku",
    definition: "המק״טים עם הכי הרבה קריאות שירות שנפתחו ב-30 הימים האחרונים. כל קריאה נספרת פעם אחת, גם אם היו בה כמה ביקורים.",
    source: `${SPEC} §5; D57 (3); T4 (#20)`,
    temporary: ["T4"],
  },
  "trend.opened": {
    tab: "gen",
    label: "נפתחו",
    unit: "count",
    category: "approved",
    records: "calls",
    groupBy: "month",
    definition: "קריאות שירות שנפתחו בחודש, לפי תאריך הפתיחה.",
    source: `${SPEC} §6`,
    temporary: [],
  },
  "trend.closed": {
    tab: "gen",
    label: "נסגרו",
    unit: "count",
    category: "approved",
    records: "calls",
    groupBy: "month",
    definition: "קריאות שירות שנסגרו בחודש, לפי תאריך הסגירה. אינן בהכרח אותן קריאות שנפתחו באותו חודש.",
    source: `${SPEC} §6; T8 (#20)`,
    temporary: ["T8"],
  },

  // Technicians ("טכנאים") ------------------------------------------------------------------------
  "tech.planned": {
    tab: "tech",
    label: "ביקורים מתוכננים",
    unit: "count",
    category: "approved",
    records: "visits",
    definition:
      "ביקורי הטכנאי שמתוכננים בתקופה, ללא ביקורים שבוטלו. כולל ביקורים שכבר בוצעו, ובתקופה הנוכחית גם ביקורים שמתוכננים עד סוף התקופה.",
    source: `${SPEC} §7.3; D57 (3); T5, T12 (#20)`,
    temporary: ["T5", "T12"],
  },
  "tech.done": {
    tab: "tech",
    label: "ביקורים שבוצעו",
    unit: "count",
    category: "approved",
    records: "visits",
    definition: "ביקורי הטכנאי שמתוכננים בתקופה ונסגרו בתוצאה \"טופל\" או \"המשך טיפול\".",
    source: `${SPEC} §7.3; D57 (3); T5 (#20)`,
    temporary: ["T5"],
  },
  "tech.closedCalls": {
    tab: "tech",
    label: "קריאות שנסגרו",
    unit: "count",
    category: "approved",
    records: "calls",
    definition: "קריאות שירות שנסגרו בתקופה, שהביקור שסגר אותן (\"טופל\") היה של הטכנאי.",
    source: `${SPEC} §7.3; D57 (3); D38; T2, T8 (#20)`,
    temporary: ["T2", "T8"],
  },
  "tech.treat": {
    tab: "tech",
    label: "זמן טיפול ממוצע",
    unit: "minutes",
    category: "approved",
    records: "visits",
    definition:
      "ממוצע הזמן מ\"הגעתי\" ועד סיום הטיפול, בביקורי הטכנאי שנסגרו ומתוכננים בתקופה. מדידות חסרות או בלתי אפשריות אינן נכללות.",
    source: `${SPEC} §7.4; T5, T6 (#20)`,
    temporary: ["T5", "T6"],
  },
  "tech.travel": {
    tab: "tech",
    label: "זמן נסיעה ממוצע",
    unit: "minutes",
    category: "approved",
    records: "visits",
    definition:
      "ממוצע הזמן מתחילת הנסיעה ועד \"הגעתי\", בביקורי הטכנאי שנסגרו ומתוכננים בתקופה. מדידות חסרות או בלתי אפשריות אינן נכללות.",
    source: `${SPEC} §7.4; T5, T6 (#20)`,
    temporary: ["T5", "T6"],
  },
  "tech.firstVisit": {
    tab: "tech",
    label: "פתרון בביקור ראשון",
    unit: "percent",
    category: "approved",
    records: "calls",
    definition:
      "קריאות שהביקור הראשון שבוצע בהן היה של הטכנאי, בתקופה, והסתיים בתוצאה \"טופל\", מתוך כל הקריאות שהביקור הראשון שבוצע בהן היה של הטכנאי בתקופה.",
    source: `${SPEC} §7.4; D57 (5); T3, T5 (#20)`,
    temporary: ["T3", "T5"],
  },
  "tech.closeTime": {
    tab: "tech",
    label: "זמן סגירת קריאה ממוצע",
    referenceLabel: "זמן סגירת קריאה",
    unit: "duration",
    category: "approved",
    records: "calls",
    definition: "ממוצע הזמן מפתיחת הקריאה ועד סגירתה, בקריאות שנסגרו בתקופה ונזקפו לטכנאי לפי הביקור שסגר אותן.",
    source: `${SPEC} §7.4; D57 (4); T2, T7, T8 (#20)`,
    temporary: ["T2", "T7", "T8"],
  },
  "tech.planAdherence": {
    tab: "tech",
    label: "עמידה בתכנון",
    unit: "percent",
    category: "pendingDefinition",
    records: null,
    definition: "ההגדרה של המדד ממתינה לאישור הבעלים, ולכן הוא אינו מחושב.",
    source: `${SPEC} §7.4 (owner clarification: "הגדרה ממתינה"); D57 (4); open #20`,
    temporary: [],
  },

  // Products & Suppliers ("מוצרים וספקים") ---------------------------------------------------------
  "prod.bySupplier": {
    tab: "prod",
    label: "קריאות לפי ספק",
    unit: "count",
    category: "approved",
    records: "calls",
    groupBy: "supplier",
    definition: "קריאות שירות לפי ספק המוצר, מאז תחילת השימוש במערכת. כל קריאה נספרת פעם אחת; מוצר בלי ספק נספר תחת \"לא הוזן\".",
    source: `${SPEC} §8.2; D57 (3); OF-12`,
    temporary: [],
  },
  "prod.byBrand": {
    tab: "prod",
    label: "קריאות לפי מותג",
    unit: "count",
    category: "approved",
    records: "calls",
    groupBy: "brand",
    definition: "קריאות שירות לפי מותג המוצר, מאז תחילת השימוש במערכת. כל קריאה נספרת פעם אחת; מוצר בלי מותג נספר תחת \"לא הוזן\".",
    source: `${SPEC} §8.2; D57 (3); OF-12`,
    temporary: [],
  },
  "prod.skuCalls": {
    tab: "prod",
    label: "קריאות",
    unit: "count",
    category: "approved",
    records: "calls",
    groupBy: "sku",
    definition: "קריאות השירות של המק״ט, מאז תחילת השימוש במערכת. ביקור המשך נספר כחלק מאותה קריאה.",
    source: `${SPEC} §8.3; D57 (3)`,
    temporary: [],
  },
  "prod.warrantyRate": {
    tab: "prod",
    label: "באחריות",
    referenceLabel: "% אחריות",
    unit: "percent",
    category: "approved",
    records: null,
    definition: "קריאות באחריות מתוך הקריאות שמצב האחריות שלהן ידוע. קריאה בלי מצב אחריות (\"לא צוין\") אינה נכללת, ואחריות לעולם אינה מוסקת מגיל המוצר.",
    source: `${SPEC} §8.3; owner message 3 B ("missing never counts as zero"); D17`,
    temporary: [],
  },
  "prod.followupRate": {
    tab: "prod",
    label: "% המשך טיפול",
    unit: "percent",
    category: "approved",
    records: null,
    definition:
      "קריאות שהיה בהן לפחות ביקור אחד שנסגר בתוצאה \"המשך טיפול\", כולל קריאות שנסגרו אחר כך, מתוך הקריאות שבוצע בהן לפחות ביקור אחד. כל קריאה נספרת פעם אחת, ומספר הביקורים אינו קובע.",
    source: `${SPEC} §8.3; D57 (5)`,
    temporary: [],
  },
  "prod.topIssue": {
    tab: "prod",
    label: "תקלה נפוצה",
    unit: "count",
    category: "approvedDataUnavailable",
    records: null,
    definition: "אין במערכת סיווג תקלות מובנה, ולכן הנתון אינו זמין. הוא לעולם אינו מוסק מתיאור התקלה החופשי.",
    source: `${SPEC} §8.3 (owner clarification); D57 (4); docs/database-schema.md (service_calls.fault_description is free text)`,
    temporary: [],
  },
};

/** The registry, in DASHBOARD_METRIC_KEYS order. */
export const METRIC_DEFINITIONS: Readonly<Record<DashboardMetricKey, MetricDefinition>> = Object.fromEntries(
  DASHBOARD_METRIC_KEYS.map((key) => {
    const { groupBy, ...rest } = ENTRIES[key];
    return [key, { key, ...rest, grouped: groupBy !== undefined, groupBy: groupBy ?? null }];
  }),
) as Record<DashboardMetricKey, MetricDefinition>;

export const metricDefinition = (key: DashboardMetricKey): MetricDefinition => METRIC_DEFINITIONS[key];

/** The definitions of one tab, in registry order. */
export const metricsOfTab = (tab: DashboardTabKey): MetricDefinition[] =>
  DASHBOARD_METRIC_KEYS.map((key) => METRIC_DEFINITIONS[key]).filter((d) => d.tab === tab);

/**
 * Whether a metric opens the details dialog on the shown tab: an approved definition with records
 * behind it, on its own tab. "הגדרה ממתינה" and "לא זמין" have no records (spec §14).
 */
export function detailOffered(key: DashboardMetricKey, shownTab: DashboardTabKey): boolean {
  const d = METRIC_DEFINITIONS[key];
  return d.category === "approved" && d.records !== null && d.tab === shownTab;
}

/**
 * Whether the dialog lists the records: they are call and visit data, so they need the data key
 * `calls` (D33: dash keys are screen keys). Display only; a production adapter enforces it on the
 * server and in RLS.
 */
export const detailRowsOffered = (permissions: RolePermissions): boolean => offers(permissions, "calls");

/** The texts of a metric without a number (D57 (4); spec-final §4.4). */
export const METRIC_STATE_TEXT: Readonly<Record<MetricState, string>> = {
  pendingDefinition: "הגדרה ממתינה",
  unavailable: "לא זמין",
};

/** Caption of "—": an average or percentage with no valid measurement. */
export const NOT_ENOUGH_DATA_TEXT = "אין מספיק נתונים";

/** A group without a brand or supplier (OF-12). */
export const NOT_ENTERED_LABEL = "לא הוזן";

/**
 * T7 (TEMPORARY, #20): a closure time below 48 hours in whole hours ("47 שעות"), otherwise in days
 * with one decimal ("3.8 ימים"). Presentation only.
 */
export function durationDisplay(hours: number): { amount: string; unit: "שעות" | "ימים"; text: string } {
  const wholeHours = Math.round(hours);
  // 47.6 hours would read "48 שעות"; from 48 whole hours on, the value is shown in days.
  if (wholeHours < 48) {
    const amount = String(wholeHours);
    return { amount, unit: "שעות", text: `${amount} שעות` };
  }
  const amount = (Math.round((hours / 24) * 10) / 10).toFixed(1);
  return { amount, unit: "ימים", text: `${amount} ימים` };
}
