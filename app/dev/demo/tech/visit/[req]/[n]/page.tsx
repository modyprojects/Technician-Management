import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/ui/StatusPill";
import { isOpenVisitStatus, type VisitDetail } from "@/features/visits/data/types";
import { DemoTechFrame } from "../../../../_components/DemoFrames";
import { Placeholder } from "../../../../_components/Placeholder";
import { demoDataAccess } from "../../../../_data/adapter";
import { techVisitParams } from "../../../../_data/params";
import { DEMO_TECHNICIAN_ID } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return techVisitParams();
}

/** The demo technician's visit, or null (another technician's visit is not his to open). */
async function myVisit(req: string, n: string): Promise<VisitDetail | null> {
  const visit = await demoDataAccess.visits.get({ req, n: Number(n) });
  return visit && visit.technician.id === DEMO_TECHNICIAN_ID ? visit : null;
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]">): Promise<Metadata> {
  const { req, n } = await params;
  const visit = await myVisit(req, n);
  return { title: visit ? `${visit.customer.name} · ביקור ${visit.n} · הדגמה` : "כרטיס ביקור · הדגמה" };
}

// Technician visit card. Placeholder until the visit screen replaces it; that screen reads
// visits.get(ref) and visits.history(ref) (earlier closed visits of the call, D36).
export default async function TechVisitPage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]">) {
  const { req, n } = await params;
  const visit = await myVisit(req, n);
  if (!visit) notFound();
  return (
    <DemoTechFrame
      head={
        <>
          <Link className="ph-back" href={demoHref.tech()}>
            › היום
          </Link>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "flex-start", marginTop: 4 }}>
            <div>
              <div className="sub" style={{ color: "var(--on-dark2)" }}>
                פנייה {visit.call.req} · משימה {visit.task} · ביקור {visit.n}
              </div>
              <h1 style={{ fontSize: 21 }}>{visit.customer.name}</h1>
            </div>
            <StatusPill status={visit.status} />
          </div>
        </>
      }
      foot={
        isOpenVisitStatus(visit.status) ? (
          <Link className="bigbtn" href={demoHref.work(visit.req, visit.n)} style={{ background: "var(--s-work)" }}>
            הגעתי · התחלת טיפול
          </Link>
        ) : undefined
      }
    >
      <Placeholder screen="כרטיס הביקור" />
    </DemoTechFrame>
  );
}
