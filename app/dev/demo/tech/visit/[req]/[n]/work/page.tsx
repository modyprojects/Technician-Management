import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { WorkFooter } from "@/components/tech/WorkFooter";
import { WorkScreen } from "@/components/tech/WorkScreen";
import type { WorkSeed } from "@/components/tech/WorkDraft";
import { StatusPill } from "@/components/ui/StatusPill";
import { isOpenVisitStatus, type VisitDetail, type VisitRef } from "@/features/visits/data/types";
import { DemoTechFrame } from "../../../../../_components/DemoFrames";
import { demoDataAccess } from "../../../../../_data/adapter";
import { techOpenVisitParams } from "../../../../../_data/params";
import { DEMO_TECHNICIAN_ID } from "../../../../../_data/roles";
import { demoHref } from "../../../../../_data/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return techOpenVisitParams();
}

/** The demo technician's open visit, or null (closed visits are read-only to technicians, D14). */
async function myOpenVisit(req: string, n: string): Promise<VisitDetail | null> {
  const visit = await demoDataAccess.visits.get({ req, n: Number(n) });
  return visit && visit.technician.id === DEMO_TECHNICIAN_ID && isOpenVisitStatus(visit.status) && visit.editable ? visit : null;
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/work">): Promise<Metadata> {
  const { req, n } = await params;
  const visit = await myOpenVisit(req, n);
  return { title: visit ? `טיפול · ${visit.customer.name} · הדגמה` : "טיפול בביקור · טכנאי · הדגמה" };
}

// Technician work screen (docs/demo.html techWork(), L552-578; TE-14 to TE-17): photos and videos
// before and after, the treatment summary (written, or a simulated recording), the parts replaced
// and "סיום ביקור ›" once the work is ready. Reads visits.get(ref); the client components run
// useCommands().visits (addMedia, removeMedia, saveSummary, saveRecording, deleteRecording,
// saveParts). The status pill shows "בטיפול": the technician reaches this screen through "הגעתי".
export default async function TechWorkPage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/work">) {
  const { req, n } = await params;
  const visit = await myOpenVisit(req, n);
  if (!visit) notFound();
  const ref: VisitRef = { req: visit.req, n: visit.n };
  const seed: WorkSeed = {
    media: visit.media,
    summary: visit.summary,
    recordingSeconds: visit.recordingSeconds,
    parts: visit.parts,
  };
  return (
    <DemoTechFrame
      head={
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 10 }}>
            <Link className="ph-back" href={demoHref.visit(visit.req, visit.n)}>
              <span aria-hidden="true">› </span>
              פרטי קריאה
            </Link>
            <StatusPill status="work" />
          </div>
          <h1 style={{ fontSize: 19, marginTop: 6 }}>
            {visit.customer.name} · {visit.product.name}
          </h1>
        </>
      }
      foot={<WorkFooter visit={ref} seed={seed} closeHref={demoHref.close(visit.req, visit.n)} />}
    >
      <WorkScreen visit={ref} seed={seed} pickupItem={visit.pickup?.item ?? null} />
    </DemoTechFrame>
  );
}
