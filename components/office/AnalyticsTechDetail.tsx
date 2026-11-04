import Link from "next/link";
import { DashboardRow } from "@/components/office/DashboardRow";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { Pager } from "@/components/ui/Pager";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianDetail, TechnicianVisitFilter } from "@/features/dashboards/data/types";
import type { TechnicianId, TechnicianRef } from "@/features/reference/data/types";
import { ddmm, minutesLabel, SHORT_COL } from "./AnalyticsParts";

// Technician drill-down (docs/demo.html dashTechDetail(), L904-925): the technician's figures for
// the period, chips to switch technician and filter the visits, and the visits table (a row opens
// the call card). Here the technician, the filter and the page are in the URL and every chip is a
// real link (UI demo, D53); the rows are one server page (TechnicianDetail.visits, at most 100).

const FILTERS: readonly (readonly [TechnicianVisitFilter, string])[] = [
  ["all", "הכל"],
  ["open", "פתוחים / מתוכננים"],
  ["done", "טופל"],
  ["cont", "המשך טיפול"],
  ["cancel", "בוטלה"],
];

const count = (value: number) => ({ value, unit: "count" as const });

export function AnalyticsTechDetail({
  detail,
  technicians,
  today,
  periodName,
  backHref,
  techHref,
  filterHref,
  pageHref,
  callHref,
  describedBy,
}: {
  detail: TechnicianDetail;
  /** The technicians offered as chips (switching keeps the filter). */
  technicians: readonly Pick<TechnicianRef, "id" | "name">[];
  /** Rows on this date show "היום". */
  today: IsoDate;
  /** Period name for the visits tile ("אוקטובר"). */
  periodName: string;
  /** Back to the dashboard tab. */
  backHref: string;
  techHref: (id: TechnicianId, filter: TechnicianVisitFilter) => string;
  filterHref: (filter: TechnicianVisitFilter) => string;
  pageHref: (page: number) => string;
  callHref: (req: string) => string;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  const { stats, visitCounts: counts, visits } = detail;
  const t = stats.technician;
  const closedRate = stats.closed ? Math.round((stats.done / stats.closed) * 100) : null;
  const tiles: KpiTile[] = [
    { key: "all", label: "ביקורים", metric: count(counts.all), detail: `${periodName}, כולל מתוכננים` },
    {
      key: "done",
      label: "טופל",
      metric: count(counts.done),
      color: "var(--s-done)",
      detail: closedRate == null ? "אין עדיין ביקורים שנסגרו" : `${closedRate}% מהביקורים שנסגרו`,
    },
    {
      key: "cont",
      label: "המשך טיפול",
      metric: count(counts.cont),
      color: "var(--s-cont)",
      detail: `סיבה מובילה: ${detail.topReason ?? "—"}`,
    },
    {
      key: "fix",
      label: "נסגר בביקור ראשון",
      metric: stats.firstVisitFixRate,
      detail: `מתוך ${detail.firstVisitCalls} קריאות`,
    },
    { key: "travel", label: "זמן נסיעה ממוצע", metric: stats.avgTravelMinutes },
    { key: "treat", label: "זמן טיפול ממוצע", metric: stats.avgTreatMinutes },
  ];
  const first = (visits.page - 1) * visits.limit + 1;
  const last = first + visits.items.length - 1;

  return (
    <>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10, flexWrap: "wrap" }}>
        <div style={{ display: "flex", alignItems: "center", gap: 12, flexWrap: "wrap" }}>
          <Link className="btn" href={backHref} prefetch={false}>
            <span aria-hidden="true">› </span>
            חזרה לדשבורד
          </Link>
          <h2 style={{ fontSize: 22 }}>
            <span className="dot" aria-hidden="true" style={{ background: t.color, width: 12, height: 12 }} /> {t.name} · כל
            הביקורים
          </h2>
        </div>
        <nav aria-label="מעבר לטכנאי אחר" style={{ display: "flex", gap: 6, flexWrap: "wrap" }}>
          {technicians.map((x) => (
            <Link
              key={x.id}
              href={techHref(x.id, detail.filter)}
              prefetch={false}
              scroll={false}
              className={x.id === t.id ? "chip on" : "chip"}
              aria-current={x.id === t.id ? "page" : undefined}
            >
              {x.name}
            </Link>
          ))}
        </nav>
      </div>

      <KpiGrid tiles={tiles} label={`מדדי ${t.name}`} describedBy={describedBy} />

      <nav aria-label="סינון הביקורים" style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        {FILTERS.map(([key, label]) => (
          <Link
            key={key}
            href={filterHref(key)}
            prefetch={false}
            scroll={false}
            className={detail.filter === key ? "chip on" : "chip"}
            aria-current={detail.filter === key ? "true" : undefined}
          >
            {label}{" "}
            <span className="num" style={{ opacity: 0.6 }}>
              {counts[key]}
            </span>
          </Link>
        ))}
      </nav>

      <section className="card" style={{ overflow: "hidden" }}>
        <div className="scrollx">
          <table aria-label={`הביקורים של ${t.name}`}>
            <thead>
              <tr>
                <th scope="col" className={SHORT_COL}>
                  תאריך
                </th>
                <th scope="col" className={SHORT_COL}>
                  שעה
                </th>
                <th scope="col" className={SHORT_COL}>
                  פנייה
                </th>
                <th scope="col" className={SHORT_COL}>
                  ביקור
                </th>
                <th scope="col">לקוח</th>
                <th scope="col" className="col-fit">
                  עיר
                </th>
                <th scope="col">מוצר</th>
                <th scope="col" className={SHORT_COL}>
                  מק&quot;ט
                </th>
                <th scope="col" className={SHORT_COL}>
                  סטטוס
                </th>
                <th scope="col" className={SHORT_COL}>
                  נסיעה
                </th>
                <th scope="col" className={SHORT_COL}>
                  טיפול
                </th>
                <th scope="col" className={SHORT_COL}>
                  תיעוד
                </th>
                <th scope="col" className={SHORT_COL}>
                  חתימה
                </th>
              </tr>
            </thead>
            <tbody>
              {visits.items.map((v) => (
                <DashboardRow key={`${v.req}-${v.n}`} href={callHref(v.req)}>
                  <td className={`${SHORT_COL} num`}>{v.date === today ? "היום" : ddmm(v.date)}</td>
                  <td className={`${SHORT_COL} num`}>{v.start}</td>
                  <td className={SHORT_COL}>
                    <Link
                      href={callHref(v.req)}
                      prefetch={false}
                      className="lnk num"
                      aria-label={`פנייה ${v.req} · ${v.customerName}`}
                    >
                      {v.req}
                    </Link>
                  </td>
                  <td className={`${SHORT_COL} num`}>{v.n}</td>
                  <td>
                    <b>{v.customerName}</b>
                    {v.isTest && (
                      <>
                        {" "}
                        <TestBadge />
                      </>
                    )}
                  </td>
                  <td className="col-fit">{v.city}</td>
                  <td>{v.product.name}</td>
                  <td className={SHORT_COL} dir="ltr">
                    {v.product.sku}
                  </td>
                  <td className={SHORT_COL}>
                    <StatusPill status={v.status} extra={v.reason ? ` · ${v.reason}` : ""} />
                  </td>
                  <td className={`${SHORT_COL} num`}>{minutesLabel(v.travelMinutes)}</td>
                  <td className={`${SHORT_COL} num`}>{minutesLabel(v.treatMinutes)}</td>
                  <td className={`${SHORT_COL} sub`}>
                    {v.mediaCount > 0 && (
                      <span role="img" aria-label={`${v.mediaCount} תמונות וסרטונים`} title="תמונות וסרטונים">
                        📷 <span className="num">{v.mediaCount}</span>
                      </span>
                    )}
                    {v.hasRecording && (
                      <span role="img" aria-label="הקלטה" title="הקלטה">
                        {" "}
                        🎙
                      </span>
                    )}
                    {v.hasSummary && (
                      <span role="img" aria-label="סיכום טיפול" title="סיכום טיפול">
                        {" "}
                        ✎
                      </span>
                    )}
                  </td>
                  <td className={SHORT_COL}>
                    {v.signed && (
                      <span role="img" aria-label="נחתם" title="נחתם">
                        ✓
                      </span>
                    )}
                  </td>
                </DashboardRow>
              ))}
            </tbody>
          </table>
          {visits.items.length ? (
            <div className="sub" style={{ padding: "10px 14px" }}>
              {visits.pageCount > 1 ? (
                <>
                  מציג <span className="num">{first}</span>–<span className="num">{last}</span> מתוך{" "}
                  <span className="num">{visits.total}</span> ביקורים
                </>
              ) : (
                <>
                  <span className="num">{visits.total}</span> ביקורים
                </>
              )}{" "}
              · לחיצה על שורה פותחת את כרטיס הקריאה
            </div>
          ) : (
            <div className="empty">אין ביקורים בסינון הזה</div>
          )}
        </div>
        {visits.pageCount > 1 && (
          <div style={{ padding: "0 14px 12px" }}>
            <Pager
              page={visits.page}
              pageCount={visits.pageCount}
              prevHref={visits.page > 1 ? pageHref(visits.page - 1) : null}
              nextHref={visits.page < visits.pageCount ? pageHref(visits.page + 1) : null}
              label="עמודי הביקורים"
            />
          </div>
        )}
      </section>
    </>
  );
}
