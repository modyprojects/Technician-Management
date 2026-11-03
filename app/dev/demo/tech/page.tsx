import type { Metadata } from "next";
import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import { DemoTechFrame } from "../_components/DemoFrames";
import { Placeholder } from "../_components/Placeholder";
import { dayName, ddmm, demoHref, myVisits, prod, TODAY } from "../_data";

export const metadata: Metadata = { title: "היום · טכנאי · הדגמה" };

// Technician home (today). Placeholder until the home screen replaces it: today's visits as links.
export default function TechHomePage() {
  const visits = myVisits(TODAY);
  return (
    <DemoTechFrame
      activeTab="home"
      head={
        <>
          <div className="sub" style={{ color: "var(--on-dark2)" }}>
            יום {dayName(TODAY)} · {ddmm(TODAY)}.2026
          </div>
          <h1 style={{ fontSize: 22, marginTop: 2 }}>בוקר טוב, יורם</h1>
        </>
      }
    >
      <Placeholder screen="מסך היום" />
      <section className="card">
        {visits.map(({ c, v }) => (
          <Link key={`${c.req}-${v.n}`} href={demoHref.visit(c.req, v.n)} className="li">
            <span className="t num">{v.start}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{c.customer}</b>
              <div className="sub">
                {c.city} · {v.n > 1 ? "↻ ביקור המשך" : prod(c.sku).name}
              </div>
            </span>
            <StatusPill status={v.status} />
          </Link>
        ))}
      </section>
    </DemoTechFrame>
  );
}
