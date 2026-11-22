import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { METRIC_DEFINITIONS, NOT_ENOUGH_DATA_TEXT, type DashboardMetricKey } from "@/features/dashboards/data/metric-definitions";
import type { TechnicianDashboard } from "@/features/dashboards/data/types";
import { SERVICE_LABELS, serviceCaption } from "./service-labels";

// The real "דשבורד" › "טכנאים" tab body (D57 (3); spec §7.3-§7.4), ported from the demo's
// AnalyticsTechnicians (components/office/AnalyticsTechnicians.tsx, left unchanged for /dev/demo):
// one technician at a time, no comparison and no trend charts. Activity: "ביקורים מתוכננים",
// "ביקורים שבוצעו", "קריאות שנסגרו" (owner order, no "דרשו המשך טיפול"). Performance: the four
// service metrics under their D60 (6) names, with unit and period; "עמידה בתכנון" is removed
// (D60 (6)). The toolbar (DashboardPeriodControls) is above it.
// Skeleton (D96): the tiles are not links and the per-technician visit reports are wired later.

const LABEL = (key: DashboardMetricKey): string => METRIC_DEFINITIONS[key].label;

export function DashboardTechnician({
  dashboard,
  periodLabel,
  describedBy,
}: {
  dashboard: TechnicianDashboard;
  /** "נובמבר 2026", "22.11.2026", … */
  periodLabel: string;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  const { technician: t, activity, performance } = dashboard;

  const activityTiles: KpiTile[] = [
    { key: "planned", label: LABEL("tech.planned"), metric: activity.planned },
    { key: "done", label: LABEL("tech.done"), metric: activity.done },
    { key: "closed", label: LABEL("tech.closedCalls"), metric: activity.closedCalls },
  ];
  const performanceTiles: KpiTile[] = (["treat", "travel", "firstVisit", "closeTime"] as const).map((k) => ({
    key: k,
    label: SERVICE_LABELS[k],
    metric: performance[k],
    caption: serviceCaption(performance[k], periodLabel),
  }));

  return (
    <>
      <section className="ma-section">
        <div className="ma-sec-head">
          <h2 id="ma-tech-act-h">פעילות — {t.name}</h2>
          <span className="ma-label num">{periodLabel}</span>
        </div>
        <KpiGrid
          tiles={activityTiles}
          label={`פעילות — ${t.name}`}
          describedBy={describedBy}
          className="ma-kpis ma-kpis-3"
          noDataText={NOT_ENOUGH_DATA_TEXT}
        />
      </section>

      <section className="ma-section">
        <div className="ma-sec-head">
          <h2 id="ma-tech-perf-h">מדדי ביצועים — {t.name}</h2>
          <span className="ma-label">ללא השוואה בין טכנאים</span>
        </div>
        <KpiGrid
          tiles={performanceTiles}
          label={`מדדי ביצועים — ${t.name}`}
          describedBy={describedBy}
          className="ma-kpis"
          noDataText={NOT_ENOUGH_DATA_TEXT}
        />
      </section>
    </>
  );
}
