import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { REVIEW_KIND_LABELS } from "@/features/review/data/types";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { SimulatedCommandsProvider } from "../../../../_components/SimulatedCommands";
import { demoDataAccess } from "../../../../_data/adapter";
import { officeReviewParams } from "../../../../_data/params";
import { isOfficeRole, officeHomeLabel, reviewItemsOffered, reviewResolutionOffered, VIEWPOINTS } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { NoAccessPlaceholder } from "../../_Placeholder";
import { reviewState } from "../../_simulatedState";

// Every item for every office role is built: a role without `conflicts` gets "אין הרשאה" (no item
// data is read, not even for the title); an unknown id is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeReviewParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/review/[id]">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `פריט לבדיקה · ${VIEWPOINTS[role].label} · הדגמה` };
}

// One review item (D44): both versions side by side per field (base, current, incoming), the
// source, the call and visit links, and the resolution. PLACEHOLDER (phase G ports): the body is
// built on review.get(id) (ReviewItemDetail) and acts only through useCommands().review.resolve
// (simulated). The state the resolution is checked against (version, status, decisions, fields,
// note rule, whether this role may resolve: reviewResolutionOffered) is nested here only
// (reviewState; deny by default elsewhere).
export default async function OfficeReviewItemPage({ params }: PageProps<"/dev/demo/office/[role]/review/[id]">) {
  const { role, id } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  if (!reviewItemsOffered(permissions)) {
    return (
      <DemoOfficeFrame role={role} active="review">
        <div className="ptitle">
          <div>
            <h1>פריט לבדיקה</h1>
          </div>
        </div>
        <NoAccessPlaceholder
          id="review-item-no-access"
          text="לתפקיד הזה אין גישה לפריטים לבדיקה."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      </DemoOfficeFrame>
    );
  }
  const item = await demoDataAccess.review.get(id);
  if (!item) notFound();

  return (
    <DemoOfficeFrame role={role} active="review">
      <SimulatedCommandsProvider state={reviewState(item, reviewResolutionOffered(role, permissions, item.authority))}>
        <div>
          <Link className="lnk" href={demoHref.review(role)}>
            › חזרה לפריטים לבדיקה
          </Link>
        </div>
        <div className="ptitle">
          <div>
            <h1>{REVIEW_KIND_LABELS[item.kind]}</h1>
            <div className="sub">
              <Link className="lnk" href={demoHref.call(role, item.call.req)}>{`פנייה ${item.call.req} · ${item.call.customerName}`}</Link>
            </div>
          </div>
        </div>
        <section className="card" aria-labelledby="review-item-placeholder">
          <div className="sec">
            <h2 id="review-item-placeholder">המסך בבנייה</h2>
          </div>
        </section>
      </SimulatedCommandsProvider>
    </DemoOfficeFrame>
  );
}
