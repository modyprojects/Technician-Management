import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { DemoTechFrame } from "../../../../../_components/DemoFrames";
import { Placeholder } from "../../../../../_components/Placeholder";
import { demoHref, findVisit, isOpenVisit, ME, techOpenVisitParams } from "../../../../../_data";

export const dynamicParams = false;

export function generateStaticParams() {
  return techOpenVisitParams();
}

export const metadata: Metadata = { title: "סיום ביקור · טכנאי · הדגמה" };

// Close screen (result, signature or follow-up reason). Placeholder until the close screen replaces it.
export default async function TechClosePage({ params }: PageProps<"/dev/demo/tech/visit/[req]/[n]/close">) {
  const { req, n } = await params;
  const found = findVisit(req, Number(n));
  if (!found || found.v.tech !== ME || !isOpenVisit(found.v)) notFound();
  const { c, v } = found;
  return (
    <DemoTechFrame
      head={
        <>
          <Link className="ph-back" href={demoHref.work(c.req, v.n)}>
            › חזרה לטיפול
          </Link>
          <h1 style={{ fontSize: 19, marginTop: 6 }}>סיום ביקור · {c.customer}</h1>
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
