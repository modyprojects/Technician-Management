import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { parseReviewListState, reviewListQueryOf } from "@/features/review/data/search-params";
import { REVIEW_KIND_LABELS, REVIEW_STATUS_LABELS } from "@/features/review/data/types";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
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

// "פריטים לבדיקה" (D39, D44; matrix key `conflicts`: Manager on, Customer Service off, the Creator
// fixed). PLACEHOLDER (phase G ports): the screen body (status tabs with counts, rows with kind,
// source, call and visit links, received time, status and resolution) is built on top of
// review.list(reviewListQueryOf(parseReviewListState(searchParams))) (?status=open|resolved|all,
// &page=; 40 per page). A role without `conflicts` gets "אין הרשאה" and no item is read. Display
// only (G-04): the server reads `review_items` with `card` and checks every resolution itself.
export default async function OfficeReviewPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/review">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = reviewItemsOffered(permissions);
  const state = parseReviewListState(await searchParams);
  const page = offered ? await demoDataAccess.review.list(reviewListQueryOf(state)) : null;

  return (
    <DemoOfficeFrame role={role} active="review">
      <div className="ptitle">
        <div>
          <h1>פריטים לבדיקה</h1>
          {page && (
            <div className="sub">
              {`${REVIEW_STATUS_LABELS.open}: ${page.counts.open} · ${REVIEW_STATUS_LABELS.resolved}: ${page.counts.resolved}`}
            </div>
          )}
        </div>
      </div>
      {page ? (
        <section className="card" aria-labelledby="review-placeholder">
          <div className="sec">
            <h2 id="review-placeholder">המסך בבנייה</h2>
          </div>
          <ul style={{ margin: 0, padding: "0 16px 16px", listStyle: "none", display: "flex", flexDirection: "column", gap: 6 }}>
            {page.items.map((x) => (
              <li key={x.id}>
                <Link className="lnk" href={demoHref.reviewItem(role, x.id)}>
                  {`${REVIEW_KIND_LABELS[x.kind]} · פנייה ${x.call.req}`}
                </Link>
              </li>
            ))}
          </ul>
        </section>
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
