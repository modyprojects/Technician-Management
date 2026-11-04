import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CallDetail } from "@/components/office/CallDetail";
import type { TimelineVisit } from "@/components/office/VisitTimeline";
import { offers } from "@/features/reference/data/permissions";
import { isOpenVisitStatus } from "@/features/visits/data/types";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { demoDataAccess } from "../../../../_data/adapter";
import { officeCallParams } from "../../../../_data/params";
import { customersOffered, isOfficeRole } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { CallActions } from "./_CallActions";
import { callDetailData } from "./_callDetailData";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeCallParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/calls/[req]">): Promise<Metadata> {
  const { req } = await params;
  const c = await demoDataAccess.calls.get(req);
  return { title: c ? `${c.customer.name} · פנייה ${c.req} · הדגמה` : "כרטיס קריאה · הדגמה" };
}

/**
 * Recording control for roles with the matrix key `recordings` (D37): simulated playback.
 * TODO(OF-06): no media port yet. Playback needs a short-lived signed media link from a server
 * port (never a public URL); until then data-sim shows the simulated notice (data-sim stays only
 * for navigation affordances once that port exists).
 */
function playRecording(v: TimelineVisit) {
  return (
    <button type="button" className="btn" data-sim={`השמעת הקלטה ${v.recLabel ?? ""} · ביקור ${v.n}`}>
      <span aria-hidden="true">▶ </span>
      הקלטה <span className="num">{v.recLabel}</span>
    </button>
  );
}

// Office service-call card (demo offCard(), screens 2-4): customer, call and product details,
// assignment, visit timeline and the header actions (a simulated dial; cancel pending d08).
// Reads only through the data-access layer (calls.get, calls.customerHistory,
// reference.permissions). The customer section links to the customer card (OF-16, `calls`). What each role sees follows the role's matrix values (D33, temporary
// per D51); this only shapes the demo screen (G-04).
export default async function OfficeCallPage({ params }: PageProps<"/dev/demo/office/[role]/calls/[req]">) {
  const { role, req } = await params;
  if (!isOfficeRole(role)) notFound();
  const [c, customerCalls, permissions] = await Promise.all([
    demoDataAccess.calls.get(req),
    demoDataAccess.calls.customerHistory(req),
    demoDataAccess.reference.permissions(role),
  ]);
  if (!c) notFound();
  const last = c.visits[c.visits.length - 1]?.technician;
  return (
    <DemoOfficeFrame role={role} active="calls">
      <CallDetail
        call={callDetailData(c, customerCalls.items, role)}
        backHref={demoHref.calls(role)}
        customerHref={customersOffered(permissions) ? demoHref.customer(role, c.customer.id) : undefined}
        showReport={offers(permissions, "card")}
        renderRecording={offers(permissions, "recordings") ? playRecording : undefined}
        actions={
          <CallActions
            tech={last ? { name: last.name, phone: last.phone } : null}
            hasOpenVisit={c.visits.some((v) => isOpenVisitStatus(v.status))}
            canCancel={offers(permissions, "cancel")}
          />
        }
      />
    </DemoOfficeFrame>
  );
}
