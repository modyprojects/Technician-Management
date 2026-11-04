import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ReviewItemView } from "@/components/office/ReviewItemView";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { SimulatedCommandsProvider } from "../../../../_components/SimulatedCommands";
import { demoDataAccess } from "../../../../_data/adapter";
import { notificationTimeLabel } from "../../../../_data/dates";
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

// One review item (D44; D39 for invitations): what the kind means, the source, both versions side
// by side per field (base, the system's value, the submitted value) and the decision. Reads only
// through the layer (review.get). The decision runs only through useCommands().review.resolve
// (simulated): the state it is checked against (version, status, decisions, fields, note rule and
// whether this role may decide: reviewResolutionOffered, D14 cases Manager and Creator, others
// `conflicts`) is nested here only (reviewState; deny by default elsewhere). Display only (G-04).
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
  const canResolve = item.status === "open" && reviewResolutionOffered(role, permissions, item.authority);
  const callHref = demoHref.call(role, item.call.req);

  return (
    <DemoOfficeFrame role={role} active="review">
      <SimulatedCommandsProvider state={reviewState(item, canResolve)}>
        <ReviewItemView
          item={item}
          backHref={demoHref.review(role)}
          callHref={callHref}
          visitHref={item.visit ? `${callHref}#visit-${item.visit.n}` : null}
          canResolve={canResolve}
          timeLabel={notificationTimeLabel}
        />
      </SimulatedCommandsProvider>
    </DemoOfficeFrame>
  );
}
