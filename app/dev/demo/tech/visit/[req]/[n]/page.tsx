import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/ui/StatusPill";
import { DemoTechFrame } from "../../../../_components/DemoFrames";
import { Placeholder } from "../../../../_components/Placeholder";
import { demoHref, findVisit, isOpenVisit, ME, techVisitParams } from "../../../../_data";

export const dynamicParams = false;

export function generateStaticParams() {
  return techVisitParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]">): Promise<Metadata> {
  const { req, n } = await params;
  const found = findVisit(req, Number(n));
  return { title: found ? `${found.c.customer} · ביקור ${found.v.n} · הדגמה` : "כרטיס ביקור · הדגמה" };
}

// Technician visit card. Placeholder until the visit screen replaces it.
export default async function TechVisitPage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]">) {
  const { req, n } = await params;
  const found = findVisit(req, Number(n));
  if (!found || found.v.tech !== ME) notFound();
  const { c, v } = found;
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
                פנייה {c.req} · משימה {v.task} · ביקור {v.n}
              </div>
              <h1 style={{ fontSize: 21 }}>{c.customer}</h1>
            </div>
            <StatusPill status={v.status} />
          </div>
        </>
      }
      foot={
        isOpenVisit(v) ? (
          <Link className="bigbtn" href={demoHref.work(c.req, v.n)} style={{ background: "var(--s-work)" }}>
            הגעתי · התחלת טיפול
          </Link>
        ) : undefined
      }
    >
      <Placeholder screen="כרטיס הביקור" />
    </DemoTechFrame>
  );
}
