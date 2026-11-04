import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DashboardTestNote } from "@/components/office/DashboardTestNote";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { ReviewKindCounts, ReviewList, ReviewStatusFilter, type ReviewKindCount, type ReviewStatusLink } from "@/components/office/ReviewList";
import { Pager } from "@/components/ui/Pager";
import { MAX_PAGE_LIMIT } from "@/features/data-access/common";
import type { OfficeRole } from "@/features/reference/data/types";
import { parseReviewListState, reviewListQueryOf, type ReviewListState } from "@/features/review/data/search-params";
import { REVIEW_KIND_VALUES, type ReviewKind } from "@/features/review/data/types";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { daysBetween, jerusalemDateTime, notificationTimeLabel, TODAY } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, reviewItemsOffered, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder } from "../_Placeholder";

// Every office role is built: a role without `conflicts` gets "אין הרשאה" instead of a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/review">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `פריטים לבדיקה · ${VIEWPOINTS[role].label} · הדגמה` };
}

/** The demo's 40-row page (OF-04). */
const PAGE_SIZE = 40;

const LIST_TITLES: Readonly<Record<ReviewListState["status"], string>> = {
  open: "פריטים פתוחים",
  resolved: "פריטים שטופלו",
  all: "כל הפריטים",
};

const EMPTY_TEXTS: Readonly<Record<ReviewListState["status"], string>> = {
  open: "אין פריטים שממתינים לבדיקה",
  resolved: "עדיין לא טופלו פריטים",
  all: "אין פריטים לבדיקה",
};

/** Whole days since an item was received (Asia/Jerusalem dates, G-01), to the demo's today. */
function waitingDays(iso: string): number {
  const local = jerusalemDateTime(iso);
  return local ? Math.max(0, daysBetween(local.date, TODAY)) : 0;
}

// "פריטים לבדיקה" (D39, D44; matrix key `conflicts`: Manager on, Customer Service off, the Creator
// fixed). Reads only through the layer: review.list with the URL state (?status=open|resolved|all,
// &page=; 40 per page, OF-04) and its counts per status; the counters by kind come from one
// bounded query of the open items (at most 100, newest first; the card says so when there are
// more). A role without `conflicts` gets "אין הרשאה" and no item is read. Display only (G-04):
// the server reads `review_items` with `card` and checks every resolution itself. Decisions are
// made on the item page (review/[id]).
export default async function OfficeReviewPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/review">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = reviewItemsOffered(permissions);

  return (
    <DemoOfficeFrame role={role} active="review">
      <div className="ptitle">
        <div>
          <h1>פריטים לבדיקה</h1>
          <div className="sub">
            שינויים שלא הוחלו אוטומטית: זימונים לביקור שכבר בדרך או בטיפול, שינויי זיהוי בקריאה קיימת, והגשות מהמכשיר שמתנגשות עם
            המערכת. שתי הגרסאות נשמרות, ושום ערך לא נדרס בשקט.
          </div>
        </div>
      </div>
      {offered ? (
        <ReviewBody role={role} state={parseReviewListState(await searchParams)} />
      ) : (
        <NoAccessPlaceholder
          id="review-no-access"
          text="לתפקיד הזה אין גישה לפריטים לבדיקה."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      )}
    </DemoOfficeFrame>
  );
}

/** The screen body for a role with `conflicts`: counters, status filter and the list. */
async function ReviewBody({ role, state }: { role: OfficeRole; state: ReviewListState }) {
  const [page, open] = await Promise.all([
    demoDataAccess.review.list(reviewListQueryOf(state, PAGE_SIZE)),
    demoDataAccess.review.list({ status: "open", limit: MAX_PAGE_LIMIT }),
  ]);
  const byKind = new Map<ReviewKind, number>();
  for (const x of open.items) byKind.set(x.kind, (byKind.get(x.kind) ?? 0) + 1);
  const kindCounts: ReviewKindCount[] = REVIEW_KIND_VALUES.flatMap((kind) => {
    const count = byKind.get(kind) ?? 0;
    return count ? [{ kind, count }] : [];
  }).sort((a, b) => b.count - a.count);
  const closedVisitOpen = open.items.filter((x) => x.authority === "closed-visit").length;
  const countsComplete = open.items.length >= open.total;
  const includesTestData = page.items.some((x) => x.isTest) || open.items.some((x) => x.isTest);
  const all = page.counts.open + page.counts.resolved;

  const statusLinks: ReviewStatusLink[] = [
    { key: "open", label: "פתוחים", count: page.counts.open, href: demoHref.review(role), on: state.status === "open" },
    { key: "resolved", label: "טופלו", count: page.counts.resolved, href: demoHref.review(role, { status: "resolved" }), on: state.status === "resolved" },
    { key: "all", label: "הכל", count: all, href: demoHref.review(role, { status: "all" }), on: state.status === "all" },
  ];
  const tiles: KpiTile[] = [
    {
      key: "open",
      label: "פתוחים",
      metric: { value: page.counts.open, unit: "count" },
      detail: "ממתינים להחלטה",
      color: page.counts.open ? "var(--s-work)" : undefined,
    },
    {
      key: "closed-visit",
      label: "מנהל או יוצר בלבד",
      metric: { value: countsComplete ? closedVisitOpen : null, unit: "count" },
      detail: "משנים ביקור סגור או מבוטל",
    },
    {
      key: "resolved",
      label: "טופלו",
      metric: { value: page.counts.resolved, unit: "count" },
      detail: "שתי הגרסאות נשמרו",
    },
  ];
  const href = (p: number) => demoHref.review(role, { status: state.status, page: p });

  return (
    <>
      {includesTestData && <DashboardTestNote id="review-test-note" />}
      <div className="rv-top">
        <div className="ib-kpis">
          <KpiGrid label="מוני פריטים לבדיקה" describedBy={includesTestData ? "review-test-note" : undefined} tiles={tiles} />
        </div>
        <ReviewKindCounts counts={kindCounts} complete={countsComplete} total={open.total} />
      </div>
      <ReviewStatusFilter links={statusLinks} />
      <ReviewList
        id="review-list"
        title={LIST_TITLES[state.status]}
        page={page}
        itemHref={(id) => demoHref.reviewItem(role, id)}
        callHref={(req) => demoHref.call(role, req)}
        visitHref={(req, n) => `${demoHref.call(role, req)}#visit-${n}`}
        timeLabel={notificationTimeLabel}
        waitingDays={waitingDays}
        emptyText={EMPTY_TEXTS[state.status]}
        emptyAction={
          state.status !== "all" ? (
            <Link className="lnk" href={demoHref.review(role, { status: "all" })} prefetch={false}>
              להצגת כל הפריטים ›
            </Link>
          ) : undefined
        }
        footer={
          <Pager
            page={page.page}
            pageCount={page.pageCount}
            prevHref={page.page > 1 ? href(page.page - 1) : null}
            nextHref={page.page < page.pageCount ? href(page.page + 1) : null}
            label="עמודי הפריטים לבדיקה"
          />
        }
      />
    </>
  );
}
