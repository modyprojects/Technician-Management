import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { connection } from "next/server";
import { offers } from "@/features/reference/data/permissions";
import { DemoOfficeFrame } from "../../_components/DemoFrames";
import { demoDataAccess } from "../../_data/adapter";
import { officeRoleParams } from "../../_data/params";
import { demoOfficeLanding, isOfficeRole, VIEWPOINTS } from "../../_data/roles";
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
  return { title: `${demoOfficeLanding(role, permissions).label} · ${VIEWPOINTS[role].label} · הדגמה` };
}

// Office home for a role (screen 9 part 1), for the demo's today.
// - D57 (1): the Manager and the Creator land on "דשבורד" (demoOfficeLanding: any dashboard tab
//   offered): this route redirects there (307), so the sidebar's first item, this route and every
//   "חזרה ל…" link agree. Rendered per request (connection()): the landing follows the role's
//   permission values, which are request data in the real app.
// - Otherwise (Customer Service; a Manager or Creator without any dashboard tab) the page renders
//   as before: the dashboard home "לוח בקרה" (dashboards.officeOverview: KPI tiles, technician
//   lanes) where the role's matrix value offers `dashGen`, otherwise the "בית" work queue
//   (dashboards.csQueue). With the default matrix that is Customer Service's "בית".
// Display only (G-04): the production ports must authorize on the server as well. The screens read
// data only through the data-access layer.
export default async function OfficeHomePage({ params }: PageProps<"/dev/demo/office/[role]">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  await connection();
  const permissions = await demoDataAccess.reference.permissions(role);
  const landing = demoOfficeLanding(role, permissions);
  if (landing.key === "analytics") redirect(landing.href);
  return (
    <DemoOfficeFrame role={role} active="home">
      {offers(permissions, "dashGen") ? <ManagerHome role={role} /> : <CsHome role={role} />}
    </DemoOfficeFrame>
  );
}
