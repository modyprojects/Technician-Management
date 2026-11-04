import Link from "next/link";
import type { ReactNode } from "react";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { IsoTimestamp } from "@/features/data-access/common";
import {
  REVIEW_DECISION_LABELS,
  REVIEW_KIND_LABELS,
  type ReviewItemSummary,
  type ReviewKind,
  type ReviewPage,
} from "@/features/review/data/types";
import { DashboardSection } from "./DashboardSection";
import { ReviewClosedVisitPill, ReviewStatusPill, reviewSourceText, reviewWaitingLabel, type ReviewTimeLabel } from "./ReviewParts";

// "פריטים לבדיקה" list (D39, D44; matrix key `conflicts`). docs/demo.html has no such screen, so it
// is built in its language like "חזרו מהשטח" (card + .sec head, .pill, .sub, chips, the ib-* work
// item rows of styles/ui.css): one row per item, newest first, with the kind, the status, who may
// decide (🔒 for items that change a server-closed or cancelled visit), the source (SIM-14 "🧪
// זימון בדיקה" or the technician's device), the call and visit as links to the call card, the
// fields and conflicts, when it was received and how long it has waited; a resolved item shows the
// decision, who and when. The status filter is real links (?status=), and "פתוחים לפי סוג" counts
// the open items by kind. Server Component: navigation only; decisions are made on the item page.

/** A status filter link (the page builds the URLs). */
export type ReviewStatusLink = { key: string; label: string; count: number; href: string; on: boolean };

/** Status filter as real links in the chip look (as the back-from-field technician chips). */
export function ReviewStatusFilter({ links }: { links: readonly ReviewStatusLink[] }) {
  return (
    <div className="ib-filter" role="group" aria-labelledby="review-status-label">
      <span id="review-status-label" className="sub ib-filter-label">
        הצגה:
      </span>
      {links.map((l) => (
        <Link key={l.key} href={l.href} prefetch={false} className={l.on ? "chip on" : "chip"} aria-current={l.on ? "true" : undefined}>
          {l.label} <span className="num">· {l.count}</span>
        </Link>
      ))}
    </div>
  );
}

/** Open items of one kind. */
export type ReviewKindCount = { kind: ReviewKind; count: number };

/**
 * "פתוחים לפי סוג": the open items by kind, most first. `complete` is false when the counts come
 * from the newest part of a longer list (the caller's bounded query); the card says so.
 */
export function ReviewKindCounts({ counts, complete, total }: { counts: readonly ReviewKindCount[]; complete: boolean; total: number }) {
  const shown = counts.reduce((sum, c) => sum + c.count, 0);
  return (
    <DashboardSection
      id="review-kinds"
      title="פתוחים לפי סוג"
      hint={complete ? undefined : `לפי ${shown} הפריטים החדשים מתוך ${total} פתוחים`}
    >
      {counts.length ? (
        <ul className="rv-kinds">
          {counts.map((c) => (
            <li key={c.kind}>
              <span className="rv-kinds-l">{REVIEW_KIND_LABELS[c.kind]}</span>
              <span className="num rv-kinds-n">{c.count}</span>
            </li>
          ))}
        </ul>
      ) : (
        <div className="sub">אין פריטים פתוחים</div>
      )}
    </DashboardSection>
  );
}

function ReviewRow({
  item,
  itemHref,
  callHref,
  visitHref,
  timeLabel,
  waitingDays,
}: {
  item: ReviewItemSummary;
  itemHref: string;
  callHref: string;
  visitHref: string | null;
  timeLabel: ReviewTimeLabel;
  waitingDays: number;
}) {
  const headingId = `rv-${item.id}`;
  const kind = REVIEW_KIND_LABELS[item.kind];
  const r = item.resolution;
  return (
    <li className="ib-item ib-act" aria-labelledby={headingId}>
      <div className="ib-main">
        <div className="ib-head">
          <h3 id={headingId} className="ib-title">
            <bdi>{kind}</bdi>
          </h3>
          <ReviewStatusPill status={item.status} />
          {item.authority === "closed-visit" && <ReviewClosedVisitPill />}
        </div>
        <div className="sub ib-meta">
          <span>
            <Link className="lnk" href={callHref} prefetch={false} aria-label={`כרטיס הקריאה · פנייה ${item.call.req}`}>
              פנייה <span className="num">{item.call.req}</span>
            </Link>{" "}
            · <bdi>{item.call.customerName}</bdi>
            {item.call.isTest && (
              <>
                {" "}
                <TestBadge />
              </>
            )}
          </span>
          {item.visit && visitHref ? (
            <span className="rv-visit">
              <Link className="lnk" href={visitHref} prefetch={false} aria-label={`ביקור ${item.visit.n} בכרטיס הקריאה ${item.call.req}`}>
                ביקור <span className="num">{item.visit.n}</span>
              </Link>{" "}
              <StatusPill status={item.visit.status} />
            </span>
          ) : (
            <span>ברמת הקריאה</span>
          )}
          <span>{reviewSourceText(item.source)}</span>
          <span>
            <span className="num">{item.fieldCount}</span> {item.fieldCount === 1 ? "שדה" : "שדות"}
            {item.conflictCount > 0 && (
              <>
                {" · "}
                <span className="rv-conflict-text">
                  <span className="num">{item.conflictCount}</span> {item.conflictCount === 1 ? "התנגשות" : "התנגשויות"}
                </span>
              </>
            )}
          </span>
        </div>
        {r && (
          <p className="ib-text">
            <b>הוחלט:</b> {REVIEW_DECISION_LABELS[r.decision]} · {r.by.name} · <span className="num">{timeLabel(r.at)}</span>
            {r.note && (
              <>
                {" · "}
                <bdi>{r.note}</bdi>
              </>
            )}
          </p>
        )}
      </div>
      <div className="ib-side">
        {item.status === "open" ? (
          <span className="ib-wait">{reviewWaitingLabel(waitingDays)}</span>
        ) : (
          <span className="ib-wait">טופל</span>
        )}
        <span className="sub num">התקבל {timeLabel(item.receivedAt)}</span>
        <Link className={item.status === "open" ? "btn pri" : "btn"} href={itemHref} prefetch={false} aria-label={`${item.status === "open" ? "לטיפול בפריט" : "לצפייה בפריט"} · ${kind} · פנייה ${item.call.req}`}>
          {item.status === "open" ? "לטיפול בפריט ›" : "לצפייה ›"}
        </Link>
      </div>
    </li>
  );
}

export function ReviewList({
  id,
  title,
  page,
  itemHref,
  callHref,
  visitHref,
  timeLabel,
  waitingDays,
  emptyText,
  emptyAction,
  footer,
}: {
  /** Section anchor and heading id prefix. */
  id: string;
  title: string;
  page: ReviewPage;
  /** The item page. */
  itemHref: (id: string) => string;
  /** The call card of a request number. */
  callHref: (req: string) => string;
  /** The visit on the call card. */
  visitHref: (req: string, n: number) => string;
  timeLabel: ReviewTimeLabel;
  /** Whole days an item has waited since it was received. */
  waitingDays: (iso: IsoTimestamp) => number;
  emptyText: string;
  /** A way out of an empty filtered list. */
  emptyAction?: ReactNode;
  /** Paging links, after "מציג X מתוך Y". */
  footer?: ReactNode;
}) {
  return (
    <DashboardSection id={id} flush title={title} count={page.total} hint="החדשים קודם · כל פריט נפתח לשתי הגרסאות לפי שדה ולהחלטה">
      {page.items.length ? (
        <>
          <ul className="ib-list" aria-label={title}>
            {page.items.map((item) => (
              <ReviewRow
                key={item.id}
                item={item}
                itemHref={itemHref(item.id)}
                callHref={callHref(item.call.req)}
                visitHref={item.visit ? visitHref(item.call.req, item.visit.n) : null}
                timeLabel={timeLabel}
                waitingDays={waitingDays(item.receivedAt)}
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
