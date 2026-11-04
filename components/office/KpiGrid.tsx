import Link from "next/link";
import type { Metric } from "@/features/dashboards/data/types";

// KPI tiles (docs/demo.html dashGen() ".kpis" / "card kpi", L874-880): label, value, detail line.
// Values are dashboard Metrics (features/dashboards/data/types); this formats them as the demo
// does ("12", "67%", "34 דק׳", "4.5", "—"). A tile with `href` is a real link to the list behind
// the number (UI demo, D53); the demo's tiles are not clickable.

export type KpiTile = {
  key: string;
  label: string;
  metric: Metric;
  /** Small line under the value ("ללא ביקור חדש"). */
  detail?: string;
  /** Value colour, e.g. "var(--s-cont)". */
  color?: string;
  /** Opens the list behind the number. */
  href?: string;
};

/** The number as the demo prints it; null → "—". The unit suffix is separate (see KpiValue). */
export function formatMetricNumber(m: Metric): string {
  if (m.value == null) return "—";
  if (m.unit === "days") return m.value.toFixed(m.decimals ?? 1);
  return m.decimals === undefined ? String(m.value) : m.value.toFixed(m.decimals);
}

/** The metric as plain text ("67%", "34 דק׳"), for labels and screen readers. */
export function formatMetric(m: Metric): string {
  const n = formatMetricNumber(m);
  if (m.value == null) return n;
  if (m.unit === "percent") return `${n}%`;
  if (m.unit === "minutes") return `${n} דק׳`;
  return n;
}

/** The value with the demo's small unit ("34<small> דק׳</small>"). */
function KpiValue({ metric, color }: { metric: Metric; color?: string }) {
  const n = formatMetricNumber(metric);
  return (
    <div className="v num" style={color && metric.value != null ? { color } : undefined}>
      {n}
      {metric.value != null && metric.unit === "percent" && "%"}
      {metric.value != null && metric.unit === "minutes" && <small style={{ fontSize: 15 }}> דק׳</small>}
    </div>
  );
}

export function KpiGrid({
  tiles,
  label,
  describedBy,
}: {
  tiles: readonly KpiTile[];
  /** Accessible name of the group ("מדדי היום"). */
  label: string;
  /** Id of a note that qualifies the numbers (the "נתוני בדיקה" note, SIM-13). */
  describedBy?: string;
}) {
  return (
    <section className="kpis" aria-label={label} aria-describedby={describedBy}>
      {tiles.map((t) => {
        const body = (
          <>
            <div className="l">
              {t.label}
              {t.href && (
                <span className="od-kpi-go" aria-hidden="true">
                  {" ›"}
                </span>
              )}
            </div>
            <KpiValue metric={t.metric} color={t.color} />
            {t.detail && <div className="d">{t.detail}</div>}
          </>
        );
        return t.href ? (
          <Link key={t.key} href={t.href} prefetch={false} className="card kpi od-kpi-link">
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
