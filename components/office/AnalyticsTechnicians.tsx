import Link from "next/link";
import { formatMetric, formatMetricNumber } from "@/components/office/KpiGrid";
import { Bars } from "@/components/ui/Bars";
import type { ManagerAnalytics, Metric, TechnicianVisitFilter } from "@/features/dashboards/data/types";
import type { TechnicianId } from "@/features/reference/data/types";
import { SHORT_COL } from "./AnalyticsParts";

// Manager dashboard, "טכנאים" tab (docs/demo.html dashTech(), L894-902): one card per technician
// (closed visits, טופל, המשך טיפול, first-visit fix rate, average travel and treatment time), the
// comparison bars for travel and treatment time, and follow-up reasons per technician. Every
// technician name and count links to the drill-down (shown only with the matrix key `dashTech`).

type Technicians = ManagerAnalytics["technicians"];

/** A bar row value: the minutes, or 0 with "—" when not measured. */
const minutesBar = (m: Metric) => ({ value: m.value ?? 0, display: m.value == null ? "—" : undefined });

export function AnalyticsTechnicians({
  technicians,
  techHref,
}: {
  technicians: Technicians;
  /** Drill-down link of a technician with a visit filter. */
  techHref: (id: TechnicianId, filter: TechnicianVisitFilter) => string;
}) {
  const { stats, reasonsByTechnician } = technicians;
  return (
    <>
      <div className="cols3">
        {stats.map((s) => {
          const t = s.technician;
          const counts: [number, string, string, TechnicianVisitFilter][] = [
            [s.closed, "ביקורים", "var(--ink)", "all"],
            [s.done, "טופל", "var(--s-done)", "done"],
            [s.cont, "המשך טיפול", "var(--s-cont)", "cont"],
          ];
          return (
            <section key={t.id} className="card sec" style={{ borderTop: `4px solid ${t.color}` }} aria-label={t.name}>
              <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, flexWrap: "wrap" }}>
                <Link
                  href={techHref(t.id, "all")}
                  prefetch={false}
                  className="lnk"
                  aria-label={`${t.name} · פירוט הטכנאי`}
                  style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 18 }}
                >
                  {t.name}
                  <span aria-hidden="true"> ›</span>
                </Link>
                <span className="sub">
                  <span className="num">{formatMetricNumber(s.visitsPerDay)}</span> ביקורים ליום
                </span>
              </div>
              <div style={{ display: "grid", gridTemplateColumns: "repeat(3, minmax(0, 1fr))", gap: 8, marginTop: 12, textAlign: "center" }}>
                {counts.map(([value, label, color, filter]) => (
                  <Link
                    key={filter}
                    href={techHref(t.id, filter)}
                    prefetch={false}
                    className="ma-stat"
                    aria-label={`${t.name}: ${value} ${label} · פירוט`}
                  >
                    <div className="num" style={{ fontFamily: "var(--display)", fontSize: 22, fontWeight: 600, color }}>
                      {value}
                    </div>
                    <div className="sub" style={{ fontSize: 12 }}>
                      {label}
                    </div>
                  </Link>
                ))}
              </div>
              <div className="kv" style={{ marginTop: 12, gridTemplateColumns: "1fr auto" }}>
                <span>נסגר בביקור ראשון</span>
                <b className="num">{formatMetric(s.firstVisitFixRate)}</b>
                <span>זמן נסיעה ממוצע</span>
                <b className="num">{formatMetric(s.avgTravelMinutes)}</b>
                <span>זמן טיפול ממוצע</span>
                <b className="num">{formatMetric(s.avgTreatMinutes)}</b>
              </div>
            </section>
          );
        })}
      </div>

      <div className="cols2">
        <section className="card sec" aria-labelledby="ma-travel">
          <h2 id="ma-travel">זמן נסיעה ממוצע (דק׳)</h2>
          <Bars
            rows={stats.map((s) => ({
              key: s.technician.id,
              label: s.technician.name,
              color: s.technician.color,
              ...minutesBar(s.avgTravelMinutes),
            }))}
          />
        </section>
        <section className="card sec" aria-labelledby="ma-treat">
          <h2 id="ma-treat">זמן טיפול ממוצע (דק׳)</h2>
          <Bars
            rows={stats.map((s) => ({
              key: s.technician.id,
              label: s.technician.name,
              color: s.technician.color,
              ...minutesBar(s.avgTreatMinutes),
            }))}
          />
        </section>
      </div>

      <section className="card" style={{ overflow: "hidden" }} aria-labelledby="ma-reasons-tech">
        <div className="sec" style={{ paddingBottom: 0 }}>
          <h2 id="ma-reasons-tech">סיבות להמשך טיפול לפי טכנאי</h2>
        </div>
        <div className="scrollx">
          <table aria-labelledby="ma-reasons-tech">
            <thead>
              <tr>
                <th scope="col">סיבה</th>
                {stats.map((s) => (
                  <th key={s.technician.id} scope="col" className={SHORT_COL}>
                    {s.technician.name}
                  </th>
                ))}
                <th scope="col" className={SHORT_COL}>
                  סה&quot;כ
                </th>
              </tr>
            </thead>
            <tbody>
              {reasonsByTechnician.map((r) => (
                <tr key={r.reason}>
                  <td>{r.reason}</td>
                  {stats.map((s) => (
                    <td key={s.technician.id} className={`${SHORT_COL} num`}>
                      {r.counts[s.technician.id] ?? 0}
                    </td>
                  ))}
                  <td className={`${SHORT_COL} num`}>
                    <b>{r.total}</b>
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {!reasonsByTechnician.length && <div className="empty">אין סיבות המשך טיפול להצגה</div>}
        </div>
      </section>
    </>
  );
}
