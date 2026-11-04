import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
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

export const metadata: Metadata = { title: "סיום ביקור · טכנאי · הדגמה" };

// Close screen (result, signature or follow-up reason). Placeholder until the close screen
// replaces it; that screen reads visits.get(ref) and reference.reasons(), and runs
// useCommands().visits.close(ref, { outcome, reason | signerName + signatureDataUrl, nextNote }).
export default async function TechClosePage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/close">) {
  const { req, n } = await params;
  const visit = await demoDataAccess.visits.get({ req, n: Number(n) });
  if (!visit || visit.technician.id !== DEMO_TECHNICIAN_ID || !isOpenVisitStatus(visit.status)) notFound();
  return (
    <DemoTechFrame
      head={
        <>
          <Link className="ph-back" href={demoHref.work(visit.req, visit.n)}>
            › חזרה לטיפול
          </Link>
          <h1 style={{ fontSize: 19, marginTop: 6 }}>סיום ביקור · {visit.customer.name}</h1>
        </>
      }
      foot={
        <button type="button" className="bigbtn" style={{ background: "var(--s-done)" }} disabled>
          בחר תוצאה
        </button>
      }
    >
      <Placeholder screen="מסך הסיום" />
    </DemoTechFrame>
  );
}
