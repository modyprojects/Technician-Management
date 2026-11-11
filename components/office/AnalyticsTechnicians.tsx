import Link from "next/link";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { METRIC_DEFINITIONS, NOT_ENOUGH_DATA_TEXT, type DashboardMetricKey } from "@/features/dashboards/data/metric-definitions";
import { beforeCoverage, dateLabel } from "@/features/dashboards/data/periods";
import type { TechnicianDashboard } from "@/features/dashboards/data/types";

// Manager dashboard, "טכנאים" tab body (D57 (3); docs/design/manager-dashboard-spec.md §7;
// spec-final §6.6): the selected technician's figures for the selected period. The toolbar
// (DashboardPeriodControls) is above it. One technician only: no comparison between technicians,
// no trend graphs and no "דרשו המשך טיפול".
// - "פעילות — {name}": "ביקורים מתוכננים", "ביקורים שבוצעו", "קריאות שנסגרו", in the owner's order.
// - "מדדי ביצועים — {name}": treatment and travel time, first-visit resolution, closure time and
//   "עמידה בתכנון" ("הגדרה ממתינה": no approved formula, D57 (4); never clickable).
// - "דוחות הביקורים של {name}": the link to the reports view (the visits table, each row opening the
//   call card with its reports, summaries and photos; spec §7.5).
// A period before the first recorded call shows "אין נתונים לפני …" and no number (spec-final §4.1).

const LABEL = (key: DashboardMetricKey): string => METRIC_DEFINITIONS[key].label;

export function AnalyticsTechnicians({
  dashboard,
  periodLabel,
  detailHref,
  reportsHref,
  describedBy,
}: {
  dashboard: TechnicianDashboard;
  /** "אוקטובר 2026", "18.10–24.10.2026", … */
  periodLabel: string;
  /** Details dialog link of a metric; null when the role is not offered `calls`. */
  detailHref: ((key: DashboardMetricKey) => string) | null;
  /** The same view with "דוחות הביקורים" open. */
  reportsHref: string;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  const { technician: t, activity, performance, period, asOf, coverageStart } = dashboard;
  const before = beforeCoverage(period, coverageStart);
  const link = (key: DashboardMetricKey) => (detailHref && !before ? { href: detailHref(key), detailKey: key } : {});
  const extendsPastToday = period.to > asOf;
  const noData = before ? "אין נתונים" : NOT_ENOUGH_DATA_TEXT;

  const activityTiles: KpiTile[] = [
    {
      key: "planned",
      label: LABEL("tech.planned"),
      metric: activity.planned,
      // T12 (TEMPORARY, #20): performed visits included, and in a current period the later ones.
      caption: extendsPastToday ? "כולל ביקורים שבוצעו ומתוכננים עד סוף התקופה" : "כולל ביקורים שבוצעו",
      ...link("tech.planned"),
    },
    { key: "done", label: LABEL("tech.done"), metric: activity.done, ...link("tech.done") },
    { key: "closed", label: LABEL("tech.closedCalls"), metric: activity.closedCalls, ...link("tech.closedCalls") },
  ];
  const performanceTiles: KpiTile[] = [
    { key: "treat", label: LABEL("tech.treat"), metric: performance.treat, ...link("tech.treat") },
    { key: "travel", label: LABEL("tech.travel"), metric: performance.travel, ...link("tech.travel") },
    { key: "first", label: LABEL("tech.firstVisit"), metric: performance.firstVisit, ...link("tech.firstVisit") },
    { key: "close", label: LABEL("tech.closeTime"), metric: performance.closeTime, ...link("tech.closeTime") },
    { key: "plan", label: LABEL("tech.planAdherence"), metric: performance.planAdherence },
  ];

  return (
    <>
      {before && (
        <div className="ma-card ma-empty" role="note">
          {coverageStart ? `אין נתונים לפני ${dateLabel(coverageStart)}` : "אין עדיין קריאות שירות"}
        </div>
      )}
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
          noDataText={noData}
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
          className="ma-kpis ma-kpis-5"
          noDataText={noData}
        />
      </section>

      <section className="ma-card" aria-labelledby="ma-tech-rep-h">
        <div className="ma-card-head">
          <h2 id="ma-tech-rep-h">דוחות הביקורים של {t.name}</h2>
          <Link className="ma-link" href={reportsHref} prefetch={false}>
            הצג דוחות ‹
          </Link>
        </div>
        <p className="ma-hint">גישה מהירה לדוחות טיפול, סיכומים ותמונות.</p>
      </section>
    </>
  );
}
