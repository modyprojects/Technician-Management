import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import { StatusPill } from "@/components/ui/StatusPill";
import { DemoTechFrame } from "../_components/DemoFrames";
import { Placeholder } from "../_components/Placeholder";
import { demoDataAccess } from "../_data/adapter";
import { dayName, ddmm, TODAY, toMin } from "../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../_data/roles";
import { demoHref } from "../_data/routes";

export const metadata: Metadata = { title: "היום · טכנאי · הדגמה" };

// Technician home (today). Placeholder until the home screen replaces it: today's visits as
// links. Reads only through the layer: visits.techDay(DEMO_TECHNICIAN_ID, TODAY) (the full
// screen also uses notifications.unreadCount(DEMO_TECHNICIAN_ID) for the bell).
export default async function TechHomePage() {
  const day = await demoDataAccess.visits.techDay(DEMO_TECHNICIAN_ID, TODAY);
  if (!day) notFound();
  const visits = [...day.open, ...day.closed].sort((a, b) => toMin(a.start) - toMin(b.start));
  return (
    <DemoTechFrame
      activeTab="home"
      head={
        <>
          <div className="sub" style={{ color: "var(--on-dark2)" }}>
            יום {dayName(day.date)} · {ddmm(day.date)}.2026
          </div>
          <h1 style={{ fontSize: 22, marginTop: 2 }}>בוקר טוב, {day.technician.name}</h1>
        </>
      }
    >
      <Placeholder screen="מסך היום" />
      <section className="card">
        {visits.map((v) => (
          <Link key={`${v.req}-${v.n}`} href={demoHref.visit(v.req, v.n)} className="li">
            <span className="t num">{v.start}</span>
            <span style={{ flex: 1, minWidth: 0 }}>
              <b style={{ fontSize: 14 }}>{v.customerName}</b>
              <div className="sub">
                {v.city} · {v.isFollowUp ? "↻ ביקור המשך" : v.productName}
              </div>
            </span>
            <StatusPill status={v.status} />
          </Link>
        ))}
      </section>
    </DemoTechFrame>
  );
}
