import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { CloseFooter } from "@/components/tech/CloseFooter";
import { CloseScreen } from "@/components/tech/CloseScreen";
import type { WorkSeed } from "@/components/tech/WorkDraft";
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

export async function generateMetadata({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/close">): Promise<Metadata> {
  const { req, n } = await params;
  const visit = await myOpenVisit(req, n);
  return { title: visit ? `סיום ביקור · ${visit.customer.name} · הדגמה` : "סיום ביקור · טכנאי · הדגמה" };
}

// Technician close screen (docs/demo.html techClose(), L579-602, and initSig(), L707-721;
// TE-18 to TE-23): the outcome, then the approval text, signer name and signature ("טופל") or the
// follow-up reason and next-visit note ("המשך טיפול"). Reads visits.get(ref),
// reference.reasons() (active ones) and reference.approvalText(); the client components run
// useCommands().visits.close(ref, input) and show the result.
export default async function TechClosePage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/close">) {
  const { req, n } = await params;
  const visit = await myOpenVisit(req, n);
  if (!visit) notFound();
  const [reasons, approvalText] = await Promise.all([
    demoDataAccess.reference.reasons(),
    demoDataAccess.reference.approvalText(),
  ]);
  const ref: VisitRef = { req: visit.req, n: visit.n };
  const seed: WorkSeed = {
    media: visit.media,
    summary: visit.summary,
    recordingSeconds: visit.recordingSeconds,
    parts: visit.parts,
  };
  const workHref = demoHref.work(visit.req, visit.n);
  return (
    <DemoTechFrame
      head={
        <>
          <div>
            <Link className="ph-back" href={workHref}>
              <span aria-hidden="true">› </span>
              חזרה לטיפול
            </Link>
          </div>
          <h1 style={{ fontSize: 19, marginTop: 6 }}>סיום ביקור · {visit.customer.name}</h1>
        </>
      }
      foot={
        <CloseFooter visit={ref} seed={seed} approvalTextVersionId={approvalText.versionId} homeHref={demoHref.tech()} />
      }
    >
      <CloseScreen
        visit={ref}
        seed={seed}
        reasons={reasons.filter((r) => r.active).map((r) => r.name)}
        approvalText={{ versionId: approvalText.versionId, text: approvalText.text }}
        workHref={workHref}
      />
    </DemoTechFrame>
  );
}
