import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoOfficeFrame } from "../../_components/DemoFrames";
import { officeRoleParams } from "../../_data/params";
import { isOfficeRole, VIEWPOINTS } from "../../_data/roles";
import { CsHome } from "./_CsHome";
import { ManagerHome } from "./_ManagerHome";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `${role === "mgr" ? "לוח בקרה" : "בית"} · ${VIEWPOINTS[role].label} · הדגמה` };
}

// Office home for a role (screen 9 part 1): the manager's "לוח בקרה" (dashboards.officeOverview)
// or customer service's "בית" work queue (dashboards.csQueue), for the demo's today. The home
// follows the signed-in role; the screens read data only through the data-access layer.
export default async function OfficeHomePage({ params }: PageProps<"/dev/demo/office/[role]">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  return (
    <DemoOfficeFrame role={role} active="home">
      {role === "mgr" ? <ManagerHome role={role} /> : <CsHome role={role} />}
    </DemoOfficeFrame>
  );
}
