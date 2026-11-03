import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/ui/StatusPill";
import { DemoTechFrame } from "../../../../../_components/DemoFrames";
import { Placeholder } from "../../../../../_components/Placeholder";
import { demoHref, findVisit, isOpenVisit, ME, prod, techOpenVisitParams } from "../../../../../_data";

export const dynamicParams = false;

export function generateStaticParams() {
  return techOpenVisitParams();
}

export const metadata: Metadata = { title: "טיפול בביקור · טכנאי · הדגמה" };

// Work screen (photos, recording, summary, parts). Placeholder until the work screen replaces it.
export default async function TechWorkPage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/work">) {
  const { req, n } = await params;
  const found = findVisit(req, Number(n));
  if (!found || found.v.tech !== ME || !isOpenVisit(found.v)) notFound();
  const { c, v } = found;
  return (
    <DemoTechFrame
      head={
        <>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Link className="ph-back" href={demoHref.visit(c.req, v.n)}>
              › פרטי קריאה
            </Link>
            <StatusPill status="work" />
          </div>
          <h1 style={{ fontSize: 19, marginTop: 6 }}>
            {c.customer} · {prod(c.sku).name}
          </h1>
        </>
      }
      foot={
        <Link className="bigbtn" href={demoHref.close(c.req, v.n)} style={{ background: "var(--ink)" }}>
          סיום ביקור ›
        </Link>
      }
    >
      <Placeholder screen="מסך הטיפול" />
    </DemoTechFrame>
  );
}
