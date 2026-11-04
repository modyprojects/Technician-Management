import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { TechDayVisit } from "@/features/visits/data/types";

// "לו"ז היום" on the technician home (docs/demo.html techHome() L510-513; TE-04 KEEP): the open
// visits as rows (time, customer, city · product or "↻ ביקור המשך", status pill), "אין עוד
// ביקורים היום" when none, and a muted "הושלמו היום: …" line for the visits closed today.
// Every row and every closed visit is a real link to its visit card (the demo's buttons opened
// the card or the "הושלמו" list); the closed visits open read-only (D14, TE-26).
// Additions: 🧪 badge on test calls (SIM-15); the visit's device sync pill when the device holds
// work of the visit (TE-23, TE-24), beside the status of an open visit and after the name of a
// closed one.
// Presentational: the caller passes the links and, optionally, a live status element and a sync
// pill per row and the "יומן ›" affordance.

export type ScheduleEntry = {
  visit: TechDayVisit;
  /** The visit card. */
  href: string;
  /** Status element; defaults to the DTO's status pill. */
  status?: ReactNode;
  /** The visit's sync pill on the device (TE-23); omitted when the device holds nothing about it. */
  sync?: ReactNode;
};

export function ScheduleList({
  open,
  closed,
  calendarAction,
}: {
  /** Open visits, by start time. */
  open: ScheduleEntry[];
  /** Visits closed today, by start time. */
  closed: ScheduleEntry[];
  /** The "יומן ›" chip (the technician calendar). */
  calendarAction?: ReactNode;
}) {
  return (
    <section className="card" aria-label='לו"ז היום'>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "center",
          padding: "10px 14px 4px",
        }}
      >
        <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 }}>
          לו&quot;ז היום
        </h2>
        {calendarAction}
      </div>
      {open.length ? (
        open.map(({ visit: v, href, status, sync }) => (
          <Link key={`${v.req}-${v.n}`} href={href} className="li">
            <span className="t num">{v.start}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{v.customerName}</b>
              {v.isTest && (
                <>
                  {" "}
                  <TestBadge />
                </>
              )}
              <div className="sub">
                {v.city} · {v.isFollowUp ? "↻ ביקור המשך" : v.productName}
              </div>
            </span>
            {sync ? (
              <span className="sy-pills">
                {status ?? <StatusPill status={v.status} />}
                {sync}
              </span>
            ) : (
              (status ?? <StatusPill status={v.status} />)
            )}
          </Link>
        ))
      ) : (
        <div className="empty">אין עוד ביקורים היום</div>
      )}
      {closed.length > 0 && (
        <div
          style={{
            borderTop: "1px solid var(--line2)",
            padding: "8px 14px",
            fontSize: 12,
            color: "var(--muted)",
          }}
        >
          הושלמו היום:{" "}
          {closed.map(({ visit: v, href, sync }, i) => (
            <span key={`${v.req}-${v.n}`}>
              {i > 0 && ", "}
              <Link href={href} className="lnk" aria-label={`${v.customerName} · ${v.start} · צפייה בלבד`}>
                {v.customerName}
              </Link>
              {sync && <> {sync}</>}
            </span>
          ))}
        </div>
      )}
    </section>
  );
}
