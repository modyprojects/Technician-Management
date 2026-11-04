import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoTechFrame } from "../../../../_components/DemoFrames";
import { Placeholder } from "../../../../_components/Placeholder";
import { demoDataAccess } from "../../../../_data/adapter";
import { techClosedVisitParams } from "../../../../_data/params";
import { DEMO_TECHNICIAN_ID } from "../../../../_data/roles";

export const dynamicParams = false;

export function generateStaticParams() {
  return techClosedVisitParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/tech/done/[req]/[n]">): Promise<Metadata> {
  const { req, n } = await params;
  const visit = await demoDataAccess.visits.doneVisit(DEMO_TECHNICIAN_ID, { req, n: Number(n) });
  return { title: visit ? `${visit.customer.name} · ביקור ${visit.n} · הדגמה` : "ביקור שהושלם · הדגמה" };
}

// PLACEHOLDER (replaced by the screen): the technician's closed visit, read-only (docs/demo.html
// techDoneView() L663-680; TE-26, D14, D43): visits.doneVisit(DEMO_TECHNICIAN_ID, ref), null for
// an open visit or another technician's visit.
export default async function TechDoneVisitPage({ params }: PageProps<"/dev/demo/tech/done/[req]/[n]">) {
  const { req, n } = await params;
  const visit = await demoDataAccess.visits.doneVisit(DEMO_TECHNICIAN_ID, { req, n: Number(n) });
  if (!visit) notFound();
  return (
    <DemoTechFrame activeTab="home" activeIsCurrent={false} head={<h1 style={{ fontSize: 21 }}>{visit.customer.name}</h1>}>
      <Placeholder screen={`פנייה ${visit.req} · ביקור ${visit.n} · צפייה בלבד`} />
    </DemoTechFrame>
  );
}
