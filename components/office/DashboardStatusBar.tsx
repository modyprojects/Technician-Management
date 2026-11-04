import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { VisitStatus } from "@/features/visits/data/types";

// A day's visits by visit status: one stacked track (the demo's .track with several fills, L885)
// and the day calendar's status legend with counts (offCal() legend, L812: square dot + label).
// Cancelled visits are not part of the day (dashboards DTO: lanes exclude them).

const ORDER: readonly VisitStatus[] = ["new", "go", "work", "done", "cont"];

export function DashboardStatusBar({ visits }: { visits: readonly { status: VisitStatus }[] }) {
  const counts = ORDER.map((status) => ({ status, n: visits.filter((v) => v.status === status).length }));
  const total = counts.reduce((a, c) => a + c.n, 0);
  if (!total) return <div className="sub">אין ביקורים היום</div>;
  return (
    <div className="od-status">
      <div className="track od-stack" aria-hidden="true">
        {counts
          .filter((c) => c.n)
          .map((c) => (
            <span key={c.status} title={`${VISIT_STATUSES[c.status].label}: ${c.n}`} style={{ width: `${(c.n / total) * 100}%`, background: VISIT_STATUSES[c.status].c }} />
          ))}
      </div>
      <ul className="od-legend" aria-label="ביקורים היום לפי סטטוס">
        {counts.map((c) => (
          <li key={c.status}>
            <span className="dot" style={{ background: VISIT_STATUSES[c.status].c, borderRadius: 3 }} aria-hidden="true" />{" "}
            {VISIT_STATUSES[c.status].label} <b className="num">{c.n}</b>
          </li>
        ))}
      </ul>
    </div>
  );
}
