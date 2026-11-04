import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { Bounded, IsoDate } from "@/features/data-access/common";
import type { ClosedVisitItem } from "@/features/dashboards/data/types";
import { DashboardRow } from "./DashboardRow";

// Visits the technicians closed recently, newest first: customer service informs the customer.
// Same table language as the demo's dashboard tables (dashGen() L889 / dashTechDetail() L913):
// when closed, request, visit number, customer, city, technician, result (the visit pill with the
// follow-up reason) and rep. Test records carry the 🧪 badge (D47). Columns follow G-07.

const SHORT = "col-center col-fit";

/** "היום 08:52" on the queue's date, otherwise "20.10 16:10". */
function closedAt(item: ClosedVisitItem, today: IsoDate): string {
  const day = item.date === today ? "היום" : `${item.date.slice(8)}.${item.date.slice(5, 7)}`;
  return item.endAt ? `${day} ${item.endAt}` : day;
}

export function WorkQueueClosed({
  list,
  today,
  callHref,
  label,
  emptyText,
  footer,
}: {
  list: Bounded<ClosedVisitItem>;
  /** The queue's date: its closings show "היום". */
  today: IsoDate;
  /** Call card URL of a request number. */
  callHref: (req: string) => string;
  /** Accessible name of the table. */
  label: string;
  emptyText: string;
  footer?: ReactNode;
}) {
  if (!list.items.length) return <div className="empty">{emptyText}</div>;
  return (
    <>
      <div className="scrollx">
        <table aria-label={label}>
          <thead>
            <tr>
              <th scope="col" className={SHORT}>
                נסגר
              </th>
              <th scope="col" className={SHORT}>
                פנייה
              </th>
              <th scope="col" className={SHORT}>
                ביקור
              </th>
              <th scope="col">לקוח</th>
              <th scope="col" className="col-fit">
                עיר
              </th>
              <th scope="col" className={SHORT}>
                טכנאי
              </th>
              <th scope="col" className={SHORT}>
                תוצאה
              </th>
              <th scope="col" className="col-fit">
                נציגה
              </th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((v) => {
              const href = callHref(v.req);
              return (
                <DashboardRow key={`${v.req}-${v.n}`} href={href}>
                  <td className={`${SHORT} num`}>{closedAt(v, today)}</td>
                  <td className={SHORT}>
                    <Link href={href} prefetch={false} className="lnk num" aria-label={`פנייה ${v.req} · ${v.customerName}`}>
                      {v.req}
                    </Link>
                  </td>
                  <td className={`${SHORT} num`}>{v.n}</td>
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
                  <td className={SHORT}>
                    <span className="dot" aria-hidden="true" style={{ background: v.technician.color }} /> {v.technician.name}
                  </td>
                  <td className={SHORT}>
                    <StatusPill status={v.status} extra={v.reason ? ` · ${v.reason}` : ""} />
                  </td>
                  <td className="col-fit">{v.representative}</td>
                </DashboardRow>
              );
            })}
          </tbody>
        </table>
      </div>
      <div className="sub od-table-foot">
        <span>
          מציג <span className="num">{list.items.length}</span> מתוך <span className="num">{list.total}</span>
        </span>
        {footer}
      </div>
    </>
  );
}
