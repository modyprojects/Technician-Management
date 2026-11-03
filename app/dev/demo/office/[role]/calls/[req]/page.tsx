import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CallDetail } from "@/components/office/CallDetail";
import type { TimelineVisit } from "@/components/office/VisitTimeline";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import {
  can,
  demoHref,
  findCall,
  isOfficeRole,
  isOpenVisit,
  lastVisit,
  officeCallParams,
  tech,
  type Call,
} from "../../../../_data";
import { CallActions } from "./_CallActions";
import { callDetailData, visitWhen } from "./_callDetailData";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeCallParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/calls/[req]">): Promise<Metadata> {
  const { req } = await params;
  const c = findCall(req);
  return { title: c ? `${c.customer} · פנייה ${c.req} · הדגמה` : "כרטיס קריאה · הדגמה" };
}

/** Recording control for roles with the matrix key `recordings` (D37): simulated playback. */
function playRecording(v: TimelineVisit) {
  return (
    <button type="button" className="btn" data-sim={`השמעת הקלטה ${v.recLabel ?? ""} · ביקור ${v.n}`}>
      <span aria-hidden="true">▶ </span>
      הקלטה <span className="num">{v.recLabel}</span>
    </button>
  );
}

/** The open visit the header actions apply to (the latest by visit number), if any. */
function openVisitOf(c: Call) {
  const v = c.visits.filter(isOpenVisit).at(-1);
  return v ? { n: v.n, techName: tech(v.tech).name, when: visitWhen(v) } : null;
}

// Office service-call card (demo offCard(), screens 2-4): customer, call and product details,
// assignment, visit timeline and simulated actions. What each role sees follows the default
// permission matrix (D33, temporary per D51); this only shapes the demo screen (G-04).
export default async function OfficeCallPage({ params }: PageProps<"/dev/demo/office/[role]/calls/[req]">) {
  const { role, req } = await params;
  const c = findCall(req);
  if (!isOfficeRole(role) || !c) notFound();
  const last = tech(lastVisit(c).tech);
  return (
    <DemoOfficeFrame role={role} active="calls">
      <CallDetail
        call={callDetailData(c, role)}
        backHref={demoHref.calls(role)}
        showReport={can(role, "card")}
        renderRecording={can(role, "recordings") ? playRecording : undefined}
        actions={
          <CallActions
            req={c.req}
            tech={{ name: last.name, phone: last.phone }}
            openVisit={openVisitOf(c)}
            canCancel={can(role, "cancel")}
          />
        }
      />
    </DemoOfficeFrame>
  );
}
