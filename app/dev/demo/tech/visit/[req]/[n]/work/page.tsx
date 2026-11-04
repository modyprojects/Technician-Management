import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/ui/StatusPill";
import { isOpenVisitStatus } from "@/features/visits/data/types";
import { DemoTechFrame } from "../../../../../_components/DemoFrames";
import { Placeholder } from "../../../../../_components/Placeholder";
import { demoDataAccess } from "../../../../../_data/adapter";
import { techOpenVisitParams } from "../../../../../_data/params";
import { DEMO_TECHNICIAN_ID } from "../../../../../_data/roles";
import { demoHref } from "../../../../../_data/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return techOpenVisitParams();
}

export const metadata: Metadata = { title: "טיפול בביקור · טכנאי · הדגמה" };

// Work screen (photos, recording, summary, parts). Placeholder until the work screen replaces it;
// that screen reads visits.get(ref) and runs useCommands().visits (addMedia, removeMedia,
// saveSummary, saveRecording, deleteRecording, saveParts).
export default async function TechWorkPage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/work">) {
  const { req, n } = await params;
  const visit = await demoDataAccess.visits.get({ req, n: Number(n) });
  if (!visit || visit.technician.id !== DEMO_TECHNICIAN_ID || !isOpenVisitStatus(visit.status)) notFound();
  return (
    <DemoTechFrame
      head={
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Link className="ph-back" href={demoHref.visit(visit.req, visit.n)}>
              › פרטי קריאה
            </Link>
            <StatusPill status="work" />
          </div>
          <h1 style={{ fontSize: 19, marginTop: 6 }}>
            {visit.customer.name} · {visit.product.name}
          </h1>
        </>
      }
      foot={
        <Link className="bigbtn" href={demoHref.close(visit.req, visit.n)} style={{ background: "var(--ink)" }}>
          סיום ביקור ›
        </Link>
      }
    >
      <Placeholder screen="מסך הטיפול" />
    </DemoTechFrame>
  );
}
