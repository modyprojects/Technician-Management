import Link from "next/link";
import type { ReactNode } from "react";
import { CallStatusPill } from "@/components/ui/CallStatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { Bounded } from "@/features/data-access/common";
import type { CallAttentionItem } from "@/features/dashboards/data/types";
import { DashboardRow } from "./DashboardRow";

// Calls that need the office ("המשך טיפול" without a new visit, or every visit cancelled), as the
// demo's "המשך טיפול – הכי ותיקים" table (dashGen(), L889): request, customer, last technician,
// status with the follow-up reason, days open (red after 7 days), rep. Adds the city and the
// 🧪 badge on test calls (SIM-15). The status pill is the service-call status (OF-17).
// Columns follow design-system.md "Tables" (G-07). The list is capped (Bounded): the footer says
// "מציג X מתוך Y" and the caller adds links to the full lists.

// Short columns: centred and sized to their content (G-07).
const SHORT = "col-center col-fit";

/** "היום", "יום אחד", "12 ימים". */
export function daysOpenLabel(days: number): string {
  if (days <= 0) return "היום";
  if (days === 1) return "יום אחד";
  return `${days} ימים`;
}

export function WorkQueueCalls({
  list,
  callHref,
  label,
  sinceHeader = "פתוח",
  emptyText,
  footer,
}: {
  list: Bounded<CallAttentionItem>;
  /** Call card URL of a request number. */
  callHref: (req: string) => string;
  /** Accessible name of the table. */
  label: string;
  /** Header of the days column. */
  sinceHeader?: string;
  emptyText: string;
  /** Links to the full lists, after "מציג X מתוך Y". */
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
                פנייה
              </th>
              <th scope="col">לקוח</th>
              <th scope="col" className="col-fit">
                עיר
              </th>
              <th scope="col" className={SHORT}>
                סטטוס
              </th>
              <th scope="col" className={SHORT}>
                טכנאי אחרון
              </th>
              <th scope="col" className={SHORT}>
                {sinceHeader}
              </th>
              <th scope="col" className="col-fit">
                נציגה
              </th>
            </tr>
          </thead>
          <tbody>
            {list.items.map((c) => {
              const href = callHref(c.req);
              return (
                <DashboardRow key={c.req} href={href}>
                  <td className={SHORT}>
                    <Link href={href} prefetch={false} className="lnk num" aria-label={`פנייה ${c.req} · ${c.customerName}`}>
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
                  <td className="col-fit">{c.city}</td>
                  <td className={SHORT}>
                    <CallStatusPill status={c.status} extra={c.reason ? ` · ${c.reason}` : ""} />
                  </td>
                  <td className={SHORT}>
                    <span className="dot" aria-hidden="true" style={{ background: c.technician.color }} /> {c.technician.name}
                  </td>
                  <td
                    className={`${SHORT} num`}
                    style={c.daysOpen > 7 ? { color: "var(--danger)", fontWeight: 700 } : undefined}
                  >
                    {daysOpenLabel(c.daysOpen)}
                  </td>
                  <td className="col-fit">{c.representative}</td>
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
