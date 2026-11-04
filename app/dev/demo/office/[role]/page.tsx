import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { offers } from "@/features/reference/data/permissions";
import { DemoOfficeFrame } from "../../_components/DemoFrames";
import { demoDataAccess } from "../../_data/adapter";
import { officeRoleParams } from "../../_data/params";
import { isOfficeRole, officeHomeLabel, VIEWPOINTS } from "../../_data/roles";
import { CsHome } from "./_CsHome";
import { ManagerHome } from "./_ManagerHome";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  const permissions = await demoDataAccess.reference.permissions(role);
  return { title: `${officeHomeLabel(permissions)} · ${VIEWPOINTS[role].label} · הדגמה` };
}

// Office home for a role (screen 9 part 1), for the demo's today: the dashboard home "לוח בקרה"
// (dashboards.officeOverview: KPI tiles, technician lanes) where the role's matrix value offers
// `dashGen`, otherwise the "בית" work queue (dashboards.csQueue). With the default matrix that is
// the manager and customer service. Display only (G-04): the production officeOverview port must
// authorize on the server as well. The screens read data only through the data-access layer.
export default async function OfficeHomePage({ params }: PageProps<"/dev/demo/office/[role]">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  return (
    <DemoOfficeFrame role={role} active="home">
      {offers(permissions, "dashGen") ? <ManagerHome role={role} /> : <CsHome role={role} />}
    </DemoOfficeFrame>
  );
}
