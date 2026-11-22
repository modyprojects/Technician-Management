import type { Metric } from "@/features/dashboards/data/types";

// The service metrics' names and units after QA corrections 01 (D60 (6); qa-corrections-01 chapter
// 3 §2): renamed, and each tile says its unit and the period it covers. Used on "כללי" ("מדדי
// שירות") and, for the same four metrics, on "טכנאים" ("מדדי ביצועים"; open question to the owner).
export const SERVICE_LABELS = {
  treat: "ממוצע זמן טיפול",
  travel: "ממוצע זמן נסיעה",
  firstVisit: "אחוז התקלות שנפתרו בביקור הראשון",
  closeTime: "ממוצע זמן סגירת קריאה",
} as const;

/** "בדקות", "באחוזים", "בשעות" / "בימים" (T7: below 48 hours in hours, otherwise days). */
export function unitText(m: Metric): string {
  if (m.unit === "minutes") return "בדקות";
  if (m.unit === "percent") return "באחוזים";
  if (m.unit === "duration") return (m.durationHours ?? m.value ?? 0) < 48 ? "בשעות" : "בימים";
  return "";
}

/** The tile caption: unit and period ("בדקות · נובמבר 2026"). */
export const serviceCaption = (m: Metric, period: string): string => `${unitText(m)} · ${period}`;
