import Link from "next/link";
import { durationDisplay, METRIC_STATE_TEXT } from "@/features/dashboards/data/metric-definitions";
import type { Metric } from "@/features/dashboards/data/types";

// KPI tiles (docs/demo.html dashGen() ".kpis" / "card kpi", L874-880): label, value, detail line.
// Values are dashboard Metrics (features/dashboards/data/types); this formats them as the demo
// does ("12", "67%", "34 דק׳", "—"), plus the manager dashboard's units and states (D57 (4);
// spec-final §4.4): a closure time in hours or days (T7, "47 שעות" / "3.8 ימים"), "הגדרה ממתינה"
// and "לא זמין". A tile with `href` is a real link to the list behind the number (UI demo, D53);
// with `detailKey` too, the link opens the manager dashboard's details dialog (the URL keeps the
// scroll position and focus returns to the tile through data-detail-key). The demo's tiles are not
// clickable; tiles without records ("הגדרה ממתינה", "לא זמין") never are (spec-final C28).

export type KpiTile = {
  key: string;
  label: string;
  metric: Metric;
  /** Small line under the value ("ללא ביקור חדש"). */
  detail?: string;
  /** Muted caption under the value (manager dashboard: what the number includes). */
  caption?: string;
  /** Value colour, e.g. "var(--s-cont)"; only for a number. */
  color?: string;
  /** Opens the list behind the number. */
  href?: string;
  /** Manager dashboard: the metric key (and group) the link opens in the details dialog. */
  detailKey?: string;
};

const NUMBER = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });

/** A duration's hours for display: the unrounded mean when the metric carries it, so T7 rounds once. */
const hoursOf = (m: Metric, value: number): number => m.durationHours ?? value;

/** The number as the demo prints it; null → "—"; a state → its text. The unit suffix is separate (see KpiValue). */
export function formatMetricNumber(m: Metric): string {
  if (m.state) return METRIC_STATE_TEXT[m.state];
  if (m.value == null) return "—";
  if (m.unit === "duration") return durationDisplay(hoursOf(m, m.value)).amount;
  if (m.decimals !== undefined) return m.value.toFixed(m.decimals);
  return NUMBER.format(m.value);
}

/** The metric as plain text ("67%", "34 דק׳", "3.8 ימים", "הגדרה ממתינה"), for labels and screen readers. */
export function formatMetric(m: Metric): string {
  const n = formatMetricNumber(m);
  if (m.state || m.value == null) return n;
  if (m.unit === "percent") return `${n}%`;
  if (m.unit === "minutes") return `${n} דק׳`;
  if (m.unit === "duration") return durationDisplay(hoursOf(m, m.value)).text;
  return n;
}

/**
 * The value with the demo's small unit ("34<small> דק׳</small>"). "—" carries visually hidden text
 * (`noDataText`) when the caller gives one, so it has an accessible name (spec-final §4.1).
 */
function KpiValue({ metric, color, noDataText }: { metric: Metric; color?: string; noDataText?: string }) {
  if (metric.state) return <div className="v ma-state">{METRIC_STATE_TEXT[metric.state]}</div>;
  if (metric.value == null) {
    if (!noDataText) return <div className="v num">—</div>;
    return (
      <div className="v ma-state ma-none">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{noDataText}</span>
      </div>
    );
  }
  const unit = metric.unit === "minutes" ? "דק׳" : metric.unit === "duration" ? durationDisplay(hoursOf(metric, metric.value)).unit : null;
  return (
    <div className="v num" style={color ? { color } : undefined}>
      {formatMetricNumber(metric)}
      {metric.unit === "percent" && <span className="kpi-pct">%</span>}
      {unit && <small> {unit}</small>}
    </div>
  );
}

export function KpiGrid({
  tiles,
  label,
  describedBy,
  className,
  noDataText,
}: {
  tiles: readonly KpiTile[];
  /** Accessible name of the group ("מדדי היום"). */
  label: string;
  /** Id of a note that qualifies the numbers (the "נתוני בדיקה" note, SIM-13). */
  describedBy?: string;
  /** Extra grid classes (the manager dashboard's "ma-kpis"). */
  className?: string;
  /**
   * Manager dashboard: the hidden text and visible caption of a "—" value ("אין מספיק נתונים", or
   * "אין נתונים" before the first recorded call). Other screens keep the plain "—".
   */
  noDataText?: string;
}) {
  return (
    <section className={className ? `kpis ${className}` : "kpis"} aria-label={label} aria-describedby={describedBy}>
      {tiles.map((t) => {
        const empty = noDataText !== undefined && !t.metric.state && t.metric.value == null;
        const caption = empty ? noDataText : t.caption;
        // Tiles without records never link (there is no dialog behind "הגדרה ממתינה" / "לא זמין").
        const href = t.metric.state ? undefined : t.href;
        const body = (
          <>
            <div className="l">
              {t.label}
              {href && (
                <span className="od-kpi-go" aria-hidden="true">
                  {" ›"}
                </span>
              )}
            </div>
            <KpiValue metric={t.metric} color={t.color} noDataText={noDataText} />
            {t.detail && <div className="d">{t.detail}</div>}
            {caption && (
              <div className="d" aria-hidden={empty ? true : undefined}>
                {caption}
              </div>
            )}
          </>
        );
        if (href && t.detailKey) {
          return (
            <Link
              key={t.key}
              href={href}
              prefetch={false}
              scroll={false}
              className="card kpi od-kpi-link"
              aria-haspopup="dialog"
              data-detail-key={t.detailKey}
            >
              {body}
            </Link>
          );
        }
        return href ? (
          <Link key={t.key} href={href} prefetch={false} className="card kpi od-kpi-link">
            {body}
          </Link>
        ) : (
          <div key={t.key} className="card kpi">
            {body}
          </div>
        );
      })}
    </section>
  );
}
