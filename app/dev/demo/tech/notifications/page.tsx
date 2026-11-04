import type { Metadata } from "next";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { Placeholder } from "../../_components/Placeholder";
import { demoDataAccess } from "../../_data/adapter";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";

export const metadata: Metadata = { title: "התראות · טכנאי · הדגמה" };

// PLACEHOLDER (replaced by the screen): technician notifications (docs/demo.html techNotifs()
// L644-656; TE-28): notifications.list(DEMO_TECHNICIAN_ID) split into unread ("חדשות") and read
// ("קודמות"); opening one runs useCommands().notifications.markRead([id]) and opens its visit,
// "סמן הכל כנקרא" runs notifications.markAllRead() (both simulated).
export default async function TechNotificationsPage() {
  const list = await demoDataAccess.notifications.list(DEMO_TECHNICIAN_ID);
  const unread = list.items.filter((x) => !x.read).length;
  return (
    <DemoTechFrame activeTab="home" activeIsCurrent={false} head={<h1 style={{ fontSize: 22 }}>התראות</h1>}>
      <Placeholder screen={`התראות · ${list.total} · ${unread} חדשות`} />
    </DemoTechFrame>
  );
}
