import Link from "next/link";
import { DashboardRow } from "@/components/office/DashboardRow";
import { CallStatusPill } from "@/components/ui/CallStatusPill";
import { Pager } from "@/components/ui/Pager";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge, VISIT_SOURCE_LABELS } from "@/components/ui/TestBadge";
import { durationDisplay, type DashboardMetricKey } from "@/features/dashboards/data/metric-definitions";
import { dateLabel } from "@/features/dashboards/data/periods";
import { jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";
import type { DashboardDetail, DashboardDetailRow } from "@/features/dashboards/data/types";
import { SHORT_COL } from "./AnalyticsParts";
import { TimeRange } from "@/components/ui/TimeRange";

// The rows of the manager dashboard's details dialog (spec-final §6.9): the visits or service calls
// behind one metric, one page of up to 50, each row linking to the call card. Server Component;
// rendered only when the role is offered `calls` (the page never asks for rows otherwise).
// Visit rows: request, visit, date, planned hours, customer, technician, SKU, visit status, source
// (SIM-14) and, for the time metrics, the visit's minutes. Call rows: request, opened, closed and
// duration (closure metrics), customer, SKU, the current call status (D38) and, per metric, whether
// the first performed visit resolved the call or whether a visit required follow-up (historical,
// D57 (5)). 🧪 on test rows (SIM-15 to SIM-17).

/** Metrics whose call rows show when the call was closed. */
const CLOSED_KEYS: readonly DashboardMetricKey[] = ["service.closeTime", "tech.closeTime", "tech.closedCalls", "trend.closed"];
const DURATION_KEYS: readonly DashboardMetricKey[] = ["service.closeTime", "tech.closeTime"];
const FIRST_VISIT_KEYS: readonly DashboardMetricKey[] = ["service.firstVisit", "tech.firstVisit"];
const MINUTES_KEYS: readonly DashboardMetricKey[] = ["service.treat", "service.travel", "tech.treat", "tech.travel"];

/** "19.10.2026 11:21" (Asia/Jerusalem); "—" when missing. */
function instantLabel(iso: string | null | undefined): string {
  const d = jerusalemDate(iso);
  const t = jerusalemTime(iso);
  return d && t ? `${dateLabel(d)} ${t}` : "—";
}

const yesNo = (v: boolean | undefined): string => (v === undefined ? "—" : v ? "כן" : "לא");

function Customer({ row }: { row: DashboardDetailRow }) {
  return (
    <>
      <b>{row.customerName}</b>
      {row.isTest && (
        <>
          {" "}
          <TestBadge />
        </>
      )}
    </>
  );
}

export function DashboardDetailTable({
  detail,
  label,
  callHref,
  pageHref,
}: {
  detail: DashboardDetail;
  /** Accessible name of the table region ("רשומות · לא בוצעו במועד"). */
  label: string;
  callHref: (req: string) => string;
  pageHref: (page: number) => string;
}) {
  const { key, rows } = detail;
  const items = rows.items;
  if (!items.length) return <div className="ma-empty">אין רשומות להצגה</div>;
  const first = (rows.page - 1) * rows.limit + 1;
  const last = first + items.length - 1;
  const visits = detail.records === "visits";
  const minutes = visits && MINUTES_KEYS.includes(key);
  const closed = !visits && CLOSED_KEYS.includes(key);
  const duration = !visits && DURATION_KEYS.includes(key);
  const firstVisit = !visits && FIRST_VISIT_KEYS.includes(key);
  const followup = !visits && key.startsWith("prod.");
  const what = visits ? "ביקורים" : "קריאות";

  return (
    <>
      <div className="scrollx ma-table-wrap" tabIndex={0} role="region" aria-label={label}>
        <table aria-label={label}>
          <thead>
            <tr>
              <th scope="col" className={SHORT_COL}>
                פנייה
              </th>
              {visits ? (
                <>
                  <th scope="col" className={SHORT_COL}>
                    ביקור
                  </th>
                  <th scope="col" className={SHORT_COL}>
                    תאריך
                  </th>
                  <th scope="col" className={SHORT_COL}>
                    שעות מתוכננות
                  </th>
                </>
              ) : (
                <>
                  <th scope="col" className={SHORT_COL}>
                    נפתחה
                  </th>
                  {closed && (
                    <th scope="col" className={SHORT_COL}>
                      נסגרה
                    </th>
                  )}
                  {duration && (
                    <th scope="col" className={SHORT_COL}>
                      משך
                    </th>
                  )}
                </>
              )}
              <th scope="col">לקוח</th>
              {visits && (
                <th scope="col" className="col-fit">
                  טכנאי
                </th>
              )}
              <th scope="col" className={SHORT_COL}>
                מק״ט
              </th>
              <th scope="col" className={SHORT_COL}>
                {visits ? "סטטוס" : "סטטוס קריאה"}
              </th>
              {visits && <th scope="col">מקור</th>}
              {minutes && (
                <th scope="col" className={SHORT_COL}>
                  דק׳
                </th>
              )}
              {firstVisit && (
                <th scope="col" className={SHORT_COL}>
                  בביקור ראשון
                </th>
              )}
              {followup && (
                <th scope="col" className={SHORT_COL}>
                  נדרש המשך טיפול
                </th>
              )}
            </tr>
          </thead>
          <tbody>
            {items.map((r) => (
              <DashboardRow key={`${r.req}-${r.n ?? "c"}`} href={callHref(r.req)}>
                <td className={SHORT_COL}>
                  <Link href={callHref(r.req)} prefetch={false} className="lnk num" aria-label={`פנייה ${r.req} · ${r.customerName}`}>
                    {r.req}
                  </Link>
                </td>
                {visits ? (
                  <>
                    <td className={`${SHORT_COL} num`}>{r.n}</td>
                    <td className={`${SHORT_COL} num`}>{r.date ? dateLabel(r.date) : "—"}</td>
                    <td className={`${SHORT_COL} num`}>{r.start && r.end ? <TimeRange start={r.start} end={r.end} /> : "—"}</td>
                  </>
                ) : (
                  <>
                    <td className={`${SHORT_COL} num`}>{instantLabel(r.openedAt)}</td>
                    {closed && <td className={`${SHORT_COL} num`}>{instantLabel(r.resolvedAt)}</td>}
                    {duration && (
                      <td className={`${SHORT_COL} num`}>{r.durationHours == null ? "—" : durationDisplay(r.durationHours).text}</td>
                    )}
                  </>
                )}
                <td>
                  <Customer row={r} />
                  <div className="sub">{r.city}</div>
                </td>
                {visits && <td className="col-fit">{r.technician?.name ?? "—"}</td>}
                <td className={SHORT_COL} dir="ltr">
                  {r.product.sku}
                </td>
                <td className={SHORT_COL}>
                  {r.status.kind === "visit" ? <StatusPill status={r.status.value} /> : <CallStatusPill status={r.status.value} />}
                </td>
                {visits && <td className="sub">{r.source ? VISIT_SOURCE_LABELS[r.source] : "—"}</td>}
                {minutes && <td className={`${SHORT_COL} num`}>{r.minutes == null ? "—" : r.minutes}</td>}
                {firstVisit && <td className={SHORT_COL}>{yesNo(r.firstVisitResolved)}</td>}
                {followup && <td className={SHORT_COL}>{yesNo(r.followupRequired)}</td>}
              </DashboardRow>
            ))}
          </tbody>
        </table>
      </div>
      <div className="ma-foot">
        <span className="ma-mini">
          {rows.pageCount > 1 ? (
            <>
              מציג <span className="num">{first}</span>–<span className="num">{last}</span> מתוך <span className="num">{rows.total}</span> {what}
            </>
          ) : (
            <>
              <span className="num">{rows.total}</span> {what}
            </>
          )}{" "}
          · לחיצה על שורה פותחת את כרטיס הקריאה
        </span>
        <Pager
          page={rows.page}
          pageCount={rows.pageCount}
          prevHref={rows.page > 1 ? pageHref(rows.page - 1) : null}
          nextHref={rows.page < rows.pageCount ? pageHref(rows.page + 1) : null}
          label="עמודי הרשומות"
        />
      </div>
    </>
  );
}
