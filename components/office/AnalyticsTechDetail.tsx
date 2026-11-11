import Link from "next/link";
import { DashboardRow } from "@/components/office/DashboardRow";
import { Pager } from "@/components/ui/Pager";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianDetail, TechnicianVisitFilter } from "@/features/dashboards/data/types";
import { ddmm, minutesLabel, SHORT_COL } from "./AnalyticsParts";

// "דוחות הביקורים" of one technician (D57 (3); spec-final §6.6; was docs/demo.html dashTechDetail(),
// L904-925): the technician's visits in the selected period, filtered by chips, one server page,
// each row opening the call card (visit details, summaries, photos and results; spec §7.5). The
// toolbar above it selects the technician and the period. No KPI tiles, no technician chips and no
// counts on the filter chips (D57 (2)-(3)).
// Data keys (display only, G-04; no matrix value changes): the rows are visit records, so they need
// `calls` (without it the page shows only a sentence and reads no rows); "תיעוד" and "חתימה" describe
// report content and need `card`; the 🎙 marker additionally needs `recordings` (as the call card).

const FILTERS: readonly (readonly [TechnicianVisitFilter, string])[] = [
  ["all", "הכל"],
  ["open", "פתוחים / מתוכננים"],
  ["done", "טופל"],
  ["cont", "המשך טיפול"],
  ["cancel", "בוטלה"],
];

export type TechReportsRows = {
  detail: TechnicianDetail;
  filterHref: (filter: TechnicianVisitFilter) => string;
  pageHref: (page: number) => string;
  callHref: (req: string) => string;
  columns: { documentation: boolean; signature: boolean; recording: boolean };
};

export function AnalyticsTechDetail({
  name,
  periodLabel,
  today,
  backHref,
  rows,
  describedBy,
}: {
  name: string;
  /** "אוקטובר 2026", "18.10–24.10.2026", … */
  periodLabel: string;
  /** Rows on this date show "היום". */
  today: IsoDate;
  /** Back to the technician's metrics (same technician and period). */
  backHref: string;
  /** The visit rows; null when the role is not offered `calls` (no rows are read). */
  rows: TechReportsRows | null;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  return (
    <section className="ma-section" aria-labelledby="ma-reports-h" aria-describedby={describedBy}>
      <div className="ma-sec-head">
        <h2 id="ma-reports-h">
          דוחות הביקורים של {name} · <span className="num">{periodLabel}</span>
        </h2>
        <Link className="ma-link" href={backHref} prefetch={false}>
          <span aria-hidden="true">›&nbsp;</span>
          חזרה למדדי הטכנאי
        </Link>
      </div>
      {rows ? <ReportsTable name={name} today={today} {...rows} /> : <div className="ma-card ma-empty">פירוט הרשומות אינו מוצג לתפקיד הזה.</div>}
    </section>
  );
}

function ReportsTable({
  name,
  today,
  detail,
  filterHref,
  pageHref,
  callHref,
  columns,
}: TechReportsRows & { name: string; today: IsoDate }) {
  const { visits } = detail;
  const first = (visits.page - 1) * visits.limit + 1;
  const last = first + visits.items.length - 1;
  return (
    <>
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
            {label}
          </Link>
        ))}
      </nav>

      <section className="card" style={{ overflow: "hidden" }}>
        <div className="scrollx">
          <table aria-label={`הביקורים של ${name}`}>
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
                {columns.documentation && (
                  <th scope="col" className={SHORT_COL}>
                    תיעוד
                  </th>
                )}
                {columns.signature && (
                  <th scope="col" className={SHORT_COL}>
                    חתימה
                  </th>
                )}
              </tr>
            </thead>
            <tbody>
              {visits.items.map((v) => (
                <DashboardRow key={`${v.req}-${v.n}`} href={callHref(v.req)}>
                  <td className={`${SHORT_COL} num`}>{v.date === today ? "היום" : ddmm(v.date)}</td>
                  <td className={`${SHORT_COL} num`}>{v.start}</td>
                  <td className={SHORT_COL}>
                    <Link href={callHref(v.req)} prefetch={false} className="lnk num" aria-label={`פנייה ${v.req} · ${v.customerName}`}>
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
                  {columns.documentation && (
                    <td className={`${SHORT_COL} sub`}>
                      {v.mediaCount > 0 && (
                        <span role="img" aria-label={`${v.mediaCount} תמונות וסרטונים`} title="תמונות וסרטונים">
                          📷 <span className="num">{v.mediaCount}</span>
                        </span>
                      )}
                      {columns.recording && v.hasRecording && (
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
                  )}
                  {columns.signature && (
                    <td className={SHORT_COL}>
                      {v.signed && (
                        <span role="img" aria-label="נחתם" title="נחתם">
                          ✓
                        </span>
                      )}
                    </td>
                  )}
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
