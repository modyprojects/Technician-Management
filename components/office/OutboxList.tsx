import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { IsoTimestamp } from "@/features/data-access/common";
import { OUTBOX_DELIVERY_LABELS, type OutboxId, type OutboxPage } from "@/features/outbox/data/types";

// The mock outbox's list (developer tool behind /dev, X-06; docs/demo.html mailsHtml() L1056-1063:
// the ".mailbox" list of ".mailitem" rows). Same look: subject in bold and a muted line under it.
// Changes: the row is a link (the selected row is URL state, `?id=`), with `aria-current` on the
// selected one; the line under the subject carries the request and visit numbers and when the row
// was written (with the server's acceptance of the closure, EM-05) instead of "time · אל …"; pills
// for the outcome, the delivery state ("לא יישלח · נתוני בדיקה", never "sent": every row is test
// data, SIM-09), a row held for an approved summary and the 🧪 marker (D47). Newest first, paged
// (40, at most 100; the caller passes the pager).
// Server Component: OutboxSummary DTOs, the selected id, the row links and the time format.

export function OutboxList({
  page,
  selectedId,
  hrefOf,
  timeLabel,
  pager,
}: {
  page: OutboxPage;
  selectedId: OutboxId | null;
  /** The viewer with this row selected. */
  hrefOf: (id: OutboxId) => string;
  timeLabel: (iso: IsoTimestamp) => string;
  pager?: ReactNode;
}) {
  return (
    <section className="ob-list" aria-labelledby="ob-list-title">
      <h2 id="ob-list-title" className="sr-only">
        רשומות בתור הדואר
      </h2>
      {page.items.length ? (
        <ul className="ob-items">
          {page.items.map((item) => {
            const current = item.id === selectedId;
            return (
              <li key={item.id}>
                <Link
                  className={current ? "mailitem on ob-item" : "mailitem ob-item"}
                  href={hrefOf(item.id)}
                  prefetch={false}
                  scroll={false}
                  aria-current={current ? "true" : undefined}
                >
                  <b className="ob-subject">{item.subject}</b>
                  <span className="sub">
                    פנייה {item.req} · ביקור {item.n} · {timeLabel(item.createdAt)}
                  </span>
                  <span className="ob-tags">
                    <StatusPill status={item.outcome} />
                    <span className="pill ob-delivery">{OUTBOX_DELIVERY_LABELS[item.delivery]}</span>
                    {item.release === "held" && <span className="pill ob-held">מוחזק · אין סיכום מאושר</span>}
                    {item.isTest && <TestBadge />}
                  </span>
                </Link>
              </li>
            );
          })}
        </ul>
      ) : (
        <div className="empty">אין רשומות בתור הדואר</div>
      )}
      {pager && <div className="ob-pager">{pager}</div>}
    </section>
  );
}
