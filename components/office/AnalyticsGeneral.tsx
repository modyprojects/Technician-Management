import Link from "next/link";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { DashboardRow } from "@/components/office/DashboardRow";
import { Bars } from "@/components/ui/Bars";
import { CallStatusPill } from "@/components/ui/CallStatusPill";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { ManagerAnalytics, TechnicianLane } from "@/features/dashboards/data/types";
import type { TechnicianId } from "@/features/reference/data/types";
import { daysOpenLabel, SHORT_COL, TechName } from "./AnalyticsParts";

// Manager dashboard, "כללי" tab (docs/demo.html dashGen(), L872-893): KPIs, "עכשיו בשטח",
// closed visits per technician and outcome, follow-up reasons, visits per week and the oldest
// follow-up calls. Presentational Server Component over the ManagerAnalytics DTO; the page builds
// the links. Technician names link to the drill-down only when `techHref` is given (matrix key
// `dashTech`, display only).

type General = ManagerAnalytics["general"];

/** "27.9–3.10", "4–10.10" (the demo's week labels, L877; dynamic weeks per G-01 / OF-11). */
function weekLabel(start: string, end: string): string {
  const [, m1 = 0, d1 = 0] = start.split("-").map(Number);
  const [, m2 = 0, d2 = 0] = end.split("-").map(Number);
  return m1 === m2 ? `${d1}–${d2}.${m2}` : `${d1}.${m1}–${d2}.${m2}`;
}

function LiveCard({ lane, techHref }: { lane: TechnicianLane; techHref: string | null }) {
  const { technician: t, current, next } = lane;
  return (
    <div className="card" style={{ padding: "12px 14px", borderRight: `4px solid ${t.color}` }}>
      <div style={{ display: "flex", justifyContent: "space-between", gap: 6 }}>
        <TechName technician={t} href={techHref} dot={false} />
        {current ? (
          <StatusPill status={current.status} />
        ) : (
          <span className="pill" style={{ background: "var(--bg)", color: "var(--muted)" }}>
            פנוי
          </span>
        )}
      </div>
      <div className="sub" style={{ marginTop: 4 }}>
        {current ? (
          `${current.customerName}, ${current.city}`
        ) : next ? (
          <>
            הבא: {next.customerName} <span className="num">{next.start}</span>
          </>
        ) : (
          "אין עוד ביקורים היום"
        )}
      </div>
      <div style={{ fontSize: 13, marginTop: 6 }}>
        היום:{" "}
        <span className="num">
          {lane.completed}/{lane.total}
        </span>{" "}
        הושלמו
      </div>
    </div>
  );
}

function Weekly({ weeks }: { weeks: General["weekly"] }) {
  if (!weeks.length) return <div className="sub">אין נתונים להצגה</div>;
  const rows = weeks.map((w) => ({ key: w.weekStart, label: weekLabel(w.weekStart, w.weekEnd), visits: w.visits }));
  const max = Math.max(1, ...rows.map((r) => r.visits));
  return (
    <div role="img" aria-label={`ביקורים לפי שבוע: ${rows.map((r) => `${r.label}: ${r.visits}`).join(", ")}`}>
      <div
        aria-hidden="true"
        style={{
          display: "flex",
          alignItems: "flex-end",
          gap: 18,
          height: 170,
          borderBottom: "1px solid var(--line)",
          padding: "0 6px",
        }}
      >
        {rows.map((r) => (
          <div key={r.key} style={{ flex: 1, display: "flex", flexDirection: "column", alignItems: "center", gap: 4 }}>
            <span className="num" style={{ fontSize: 12 }}>
              {r.visits}
            </span>
            <div
              style={{
                width: "100%",
                maxWidth: 70,
                height: (r.visits / max) * 140,
                background: "var(--accent)",
                borderRadius: "4px 4px 0 0",
              }}
            />
          </div>
        ))}
      </div>
      <div
        aria-hidden="true"
        style={{ display: "flex", gap: 18, padding: "6px 6px 0", fontSize: 12, color: "var(--muted)", textAlign: "center" }}
      >
        {rows.map((r) => (
          <span key={r.key} className="num" style={{ flex: 1, minWidth: 0 }}>
            {r.label}
          </span>
        ))}
      </div>
    </div>
  );
}

export function AnalyticsGeneral({
  general,
  techHref,
  callHref,
  followupsHref,
  describedBy,
}: {
  general: General;
  /** Drill-down link of a technician; null when the role is not offered the technician dashboard. */
  techHref: ((id: TechnicianId) => string) | null;
  /** Call card link. */
  callHref: (req: string) => string;
  /** Calls list filtered to "המשך טיפול" (the open follow-ups tile). */
  followupsHref?: string;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  const k = general.kpis;
  const tiles: KpiTile[] = [
    { key: "visits", label: "ביקורים החודש", metric: k.visits, detail: "כולל מתוכננים" },
    { key: "fix", label: "נסגר בביקור ראשון", metric: k.firstVisitFixRate, detail: "מתוך קריאות שבוקרו" },
    {
      key: "followups",
      label: "המשך טיפול פתוחים",
      metric: k.openFollowups,
      color: "var(--s-cont)",
      detail: "ללא ביקור חדש",
      href: followupsHref,
    },
    { key: "travel", label: "זמן נסיעה ממוצע", metric: k.avgTravelMinutes, detail: "Waze → הגעתי" },
    { key: "treat", label: "זמן טיפול ממוצע", metric: k.avgTreatMinutes, detail: "הגעתי → סיום" },
    { key: "gap", label: "ימים עד ביקור המשך", metric: k.avgDaysToFollowup, detail: "ממוצע" },
  ];
  const linkOf = (id: TechnicianId): string | null => (techHref ? techHref(id) : null);
  const oldest = general.oldestFollowups.items;

  return (
    <>
      <KpiGrid tiles={tiles} label="מדדים כלליים" describedBy={describedBy} />

      <section className="card sec" aria-labelledby="ma-live">
        <h2 id="ma-live">עכשיו בשטח</h2>
        {general.live.length ? (
          <div className="cols3">
            {general.live.map((lane) => (
              <LiveCard key={lane.technician.id} lane={lane} techHref={linkOf(lane.technician.id)} />
            ))}
          </div>
        ) : (
          <div className="sub">אין טכנאים פעילים</div>
        )}
      </section>

      <div className="cols2">
        <section className="card sec" aria-labelledby="ma-outcomes">
          <h2 id="ma-outcomes">ביקורים לפי טכנאי ותוצאה</h2>
          <Bars
            rows={general.outcomesByTechnician.map((o) => ({
              key: o.technician.id,
              label: <TechName technician={o.technician} href={linkOf(o.technician.id)} />,
              value: o.done + o.cont,
              segments: [
                { label: "טופל", value: o.done, color: "var(--s-done)" },
                { label: "המשך טיפול", value: o.cont, color: "var(--s-cont)" },
              ],
            }))}
          />
          <div aria-hidden="true" style={{ display: "flex", gap: 14, fontSize: 12, marginTop: 8 }}>
            <span>
              <span className="dot" style={{ background: "var(--s-done)" }} /> טופל
            </span>
            <span>
              <span className="dot" style={{ background: "var(--s-cont)" }} /> המשך טיפול
            </span>
          </div>
        </section>
        <section className="card sec" aria-labelledby="ma-reasons">
          <h2 id="ma-reasons">סיבות להמשך טיפול</h2>
          <Bars
            color="var(--s-cont)"
            rows={general.followupReasons.map((r) => ({ key: r.key, label: r.label, value: r.value, color: r.color }))}
          />
        </section>
      </div>

      <section className="card sec" aria-labelledby="ma-weekly">
        <h2 id="ma-weekly">ביקורים לפי שבוע</h2>
        <Weekly weeks={general.weekly} />
      </section>

      <section className="card" style={{ overflow: "hidden" }} aria-labelledby="ma-oldest">
        <div className="sec" style={{ paddingBottom: 0 }}>
          <h2 id="ma-oldest">המשך טיפול – הכי ותיקים</h2>
        </div>
        {oldest.length ? (
          <div className="scrollx">
            <table aria-labelledby="ma-oldest">
              <thead>
                <tr>
                  <th scope="col" className={SHORT_COL}>
                    פנייה
                  </th>
                  <th scope="col">לקוח</th>
                  <th scope="col" className={SHORT_COL}>
                    טכנאי אחרון
                  </th>
                  <th scope="col" className={SHORT_COL}>
                    סיבה
                  </th>
                  <th scope="col" className={SHORT_COL}>
                    פתוח
                  </th>
                  <th scope="col" className="col-fit">
                    נציגה
                  </th>
                </tr>
              </thead>
              <tbody>
                {oldest.map((c) => (
                  <DashboardRow key={c.req} href={callHref(c.req)}>
                    <td className={SHORT_COL}>
                      <Link href={callHref(c.req)} prefetch={false} className="lnk num" aria-label={`פנייה ${c.req} · ${c.customerName}`}>
                        {c.req}
                      </Link>
                    </td>
                    <td>
                      <b>{c.customerName}</b>
                      {c.isTest && (
                        <>
                          {" "}
                          <TestBadge />
                        </>
                      )}
                    </td>
                    <td className={SHORT_COL}>{c.technician.name}</td>
                    <td className={SHORT_COL}>
                      <CallStatusPill status={c.status} extra={c.reason ? ` · ${c.reason}` : ""} />
                    </td>
                    <td
                      className={`${SHORT_COL} num`}
                      style={c.daysOpen > 7 ? { color: "var(--danger)", fontWeight: 700 } : undefined}
                    >
                      {daysOpenLabel(c.daysOpen)}
                    </td>
                    <td className="col-fit">{c.representative}</td>
                  </DashboardRow>
                ))}
              </tbody>
            </table>
          </div>
        ) : (
          <div className="empty">אין קריאות בהמשך טיפול</div>
        )}
      </section>
    </>
  );
}
