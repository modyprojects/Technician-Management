import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { clampPage } from "@/features/data-access/common";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { Placeholder } from "../../_components/Placeholder";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";

export const metadata: Metadata = { title: "הושלמו היום · טכנאי · הדגמה" };

// PLACEHOLDER (replaced by the screen): "הושלמו היום" (docs/demo.html techDoneList() L657-662;
// TE-26): visits.doneVisits(DEMO_TECHNICIAN_ID, TODAY, { page }); each row opens
// demoHref.techDoneVisit(req, n).
export default async function TechDonePage({ searchParams }: PageProps<"/dev/demo/tech/done">) {
  const { page } = await searchParams;
  const done = await demoDataAccess.visits.doneVisits(DEMO_TECHNICIAN_ID, TODAY, { page: clampPage(page) });
  if (!done) notFound();
  return (
    <DemoTechFrame activeTab="home" activeIsCurrent={false} head={<h1 style={{ fontSize: 22 }}>הושלמו היום</h1>}>
      <Placeholder screen={`הושלמו היום · ${done.total} ביקורים`} />
    </DemoTechFrame>
  );
}
