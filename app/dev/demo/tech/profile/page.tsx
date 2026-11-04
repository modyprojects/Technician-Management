import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { Placeholder } from "../../_components/Placeholder";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";

export const metadata: Metadata = { title: "פרופיל · טכנאי · הדגמה" };

// PLACEHOLDER (replaced by the screen): technician profile (docs/demo.html techProfile()
// L681-693; TE-29, TE-30): profile.technician(DEMO_TECHNICIAN_ID, TODAY) and
// notifications.preferences(DEMO_TECHNICIAN_ID); the toggles save through
// useCommands().notifications.setPreferences (simulated).
export default async function TechProfilePage() {
  const profile = await demoDataAccess.profile.technician(DEMO_TECHNICIAN_ID, TODAY);
  if (!profile) notFound();
  return (
    <DemoTechFrame activeTab="prof" head={<h1 style={{ fontSize: 22 }}>{profile.technician.name}</h1>}>
      <Placeholder screen={`פרופיל · ${profile.week.visits} ביקורים השבוע · ${profile.week.done} טופלו`} />
    </DemoTechFrame>
  );
}
