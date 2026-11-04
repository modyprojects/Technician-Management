import Link from "next/link";
import type { ReactNode } from "react";
import { TestBadge, VISIT_SOURCE_LABELS } from "@/components/ui/TestBadge";
import { ddmm } from "@/features/calendar/data/dates";
import type { BackFromFieldItem, BackFromFieldPage } from "@/features/calls/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { DashboardSection } from "./DashboardSection";

// "חזרו מהשטח" (spec office screens, OF-16; docs/demo.html has no such screen, so it is designed
// in the demo's language: card + .sec head, .pill, .sub, .btn, .note, chips). One row per service
// call in "המשך טיפול" without a next visit (D38, features/calls/data/types BackFromFieldItem),
// oldest first: customer and city, the reason pill, request, visit, technician, closing date,
// product, invitation source (SIM-14), the summary excerpt and the next-visit note (TE-21), days
// waiting (red after LATE_AFTER_DAYS, as the demo's "המשך טיפול – הכי ותיקים" table, L889), a link
// to the call card and the row action "זימון ביקור חדש ב-Outlook". Until Microsoft 365 is
// connected (D23, `outlookConnected` false) the action is a disabled button described by one
// visible hint; it never fakes an Outlook link (OF-08). A list of rows rather than a table: each
// row carries free text (summary, next-visit note) and an action, so it stacks at phone width
// instead of scrolling sideways (styles/ui.css "intake-backfield").
// Server Component: no state; navigation is links, the only action is disabled.

/** Days after which the wait is shown in red (docs/demo.html L889: `days > 7`). */
export const LATE_AFTER_DAYS = 7;

/** "ממתינה מהיום", "ממתינה יום אחד", "ממתינה 12 ימים". */
export function waitingLabel(days: number): string {
  if (days <= 0) return "ממתינה מהיום";
  if (days === 1) return "ממתינה יום אחד";
  return `ממתינה ${days} ימים`;
}

/** "בוטל ביקור המשך אחד", "בוטלו 2 ביקורי המשך". */
function cancelledLabel(n: number): string {
  return n === 1 ? "בוטל ביקור המשך אחד" : `בוטלו ${n} ביקורי המשך`;
}

/** A technician filter link ("כל הטכנאים" first). The page builds the URLs (?tech=). */
export type BackFromFieldTechLink = {
  key: string;
  label: string;
  /** Technician colour (not on "כל הטכנאים"). */
  color?: string;
  href: string;
  /** The filter shown now. */
  on: boolean;
};

/** Technician filter as real links in the demo's chip look (as the office calendar's chips, OF-03). */
export function BackFromFieldTechFilter({ links }: { links: readonly BackFromFieldTechLink[] }) {
  return (
    <div className="ib-filter" role="group" aria-labelledby="bff-tech-label">
      <span id="bff-tech-label" className="sub ib-filter-label">
        טכנאי:
      </span>
      {links.map((l) => (
        <Link key={l.key} href={l.href} prefetch={false} className={l.on ? "chip on" : "chip"} aria-current={l.on ? "true" : undefined}>
          {l.color && <span className="dot" style={{ background: l.color }} aria-hidden="true" />}
          {l.color && " "}
          {l.label}
        </Link>
      ))}
    </div>
  );
}

function BackFromFieldRow({
  item,
  today,
  callHref,
  actionHintId,
  outlookConnected,
}: {
  item: BackFromFieldItem;
  today: IsoDate;
  callHref: string;
  actionHintId: string;
  outlookConnected: boolean;
}) {
  const headingId = `bff-${item.req}-${item.n}`;
  const closedDay = item.date === today ? "היום" : ddmm(item.date);
  const late = item.daysWaiting > LATE_AFTER_DAYS;
  return (
    <li className="ib-item ib-act" aria-labelledby={headingId}>
      <div className="ib-main">
        <div className="ib-head">
          <h3 id={headingId} className="ib-title">
            <bdi>{item.customer.name}</bdi>
          </h3>
          <span className="sub">{item.city}</span>
          <span className="pill ib-reason">
            <span className="sr-only">סיבת המשך טיפול: </span>
            {item.reason}
          </span>
        </div>
        <div className="sub ib-meta">
          <span>
            פנייה <span className="num">{item.req}</span>
            {item.isTest && (
              <>
                {" "}
                <TestBadge />
              </>
            )}
          </span>
          <span>
            ביקור <span className="num">{item.n}</span>
          </span>
          <span>
            <span className="dot" aria-hidden="true" style={{ background: item.technician.color }} /> {item.technician.name}
          </span>
          <span className="num">
            נסגר {closedDay}
            {item.endAt && ` ${item.endAt}`}
          </span>
          <span>
            {item.product.name} ·{" "}
            <bdi dir="ltr" className="num">
              {item.product.sku}
            </bdi>
          </span>
          <span>{VISIT_SOURCE_LABELS[item.source]}</span>
        </div>
        {item.summaryExcerpt ? (
          <p className="ib-text">
            <b>סיכום הביקור:</b> {item.summaryExcerpt}
          </p>
        ) : (
          <p className="ib-text sub">לא נכתב סיכום בביקור</p>
        )}
        {item.nextNote && (
          <p className="ib-text">
            <b>לביקור הבא:</b> {item.nextNote}
          </p>
        )}
        {item.cancelledLaterVisits > 0 && <p className="ib-text sub">{cancelledLabel(item.cancelledLaterVisits)} · הקריאה חזרה לרשימה</p>}
      </div>
      <div className="ib-side">
        <span className={late ? "ib-wait ib-late" : "ib-wait"}>{waitingLabel(item.daysWaiting)}</span>
        <Link className="btn" href={callHref} prefetch={false} aria-label={`לכרטיס הקריאה ${item.req} · ${item.customer.name}`}>
          לכרטיס הקריאה ›
        </Link>
        {!outlookConnected && (
          // D23: no Microsoft 365 connection yet. A disabled button with the visible hint (OF-08
          // pattern); never a fake Outlook link. TODO(Microsoft 365): when `outlookConnected` is
          // true, the action needs its own port (a new invitation for this call); none exists yet.
          <button
            type="button"
            className="btn"
            disabled
            aria-describedby={actionHintId}
            aria-label={`זימון ביקור חדש ב-Outlook · פנייה ${item.req}`}
          >
            זימון ביקור חדש ב-Outlook
          </button>
        )}
      </div>
    </li>
  );
}

export function BackFromFieldList({
  id,
  page,
  today,
  callHref,
  emptyText,
  emptyAction,
  footer,
}: {
  /** Section anchor and heading id prefix. */
  id: string;
  page: BackFromFieldPage;
  /** The date the waiting days count to: its closings show "היום". */
  today: IsoDate;
  /** Call card URL of a request number. */
  callHref: (req: string) => string;
  emptyText: string;
  /** A way out of an empty filtered list (for example "כל הטכנאים"). */
  emptyAction?: ReactNode;
  /** Paging links, after "מציג X מתוך Y". */
  footer?: ReactNode;
}) {
  const hintId = `${id}-outlook-hint`;
  return (
    <DashboardSection
      id={id}
      flush
      title="המשך טיפול – צריך ביקור חדש"
      count={page.total}
      hint="הוותיקות קודם · ביקור חדש שנקלט מוריד את הקריאה מהרשימה, ביקור שבוטל מחזיר אותה"
    >
      {!page.outlookConnected && (
        <p id={hintId} className="note ib-note">
          <b>זימון ביקור חדש ב-Outlook</b> יהיה זמין אחרי חיבור Microsoft 365 (D23).
        </p>
      )}
      {page.items.length ? (
        <>
          <ul className="ib-list" aria-label="ביקורים שחזרו מהשטח">
            {page.items.map((item) => (
              <BackFromFieldRow
                key={`${item.req}-${item.n}`}
                item={item}
                today={today}
                callHref={callHref(item.req)}
                actionHintId={hintId}
                outlookConnected={page.outlookConnected}
              />
            ))}
          </ul>
          <div className="sub od-table-foot">
            <span>
              מציג <span className="num">{page.items.length}</span> מתוך <span className="num">{page.total}</span>
            </span>
            {footer}
          </div>
        </>
      ) : (
        <div className="empty ib-empty">
          <span>{emptyText}</span>
          {emptyAction}
        </div>
      )}
    </DashboardSection>
  );
}
