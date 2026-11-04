import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { offersAnyDashboard } from "@/features/reference/data/permissions";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { Placeholder } from "../../../_components/Placeholder";
import { demoDataAccess } from "../../../_data/adapter";
import { isOfficeRole } from "../../../_data/roles";

// Manager only: customer service has no dashboard permission (D33 defaults, temporary per D51).
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ role: "mgr" }];
}

export const metadata: Metadata = { title: "דשבורדים · מנהל · הדגמה" };

// Manager dashboards (general / technicians / products). Placeholder until the dashboards replace
// it; they read demoDataAccess.dashboards.managerAnalytics({ from: "2026-10-01", to: "2026-10-31" })
// and .technicianDetail(techId, period, { filter, page }) for the drill-down; the tabs follow
// reference.permissions(role) (dashGen / dashTech / dashProd, display only).
export default async function OfficeAnalyticsPage({ params }: PageProps<"/dev/demo/office/[role]/analytics">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  if (!offersAnyDashboard(permissions)) notFound();
  return (
    <DemoOfficeFrame role={role} active="analytics">
      <div className="ptitle">
        <div>
          <h1>דשבורד</h1>
          <div className="sub">אוקטובר 2026</div>
        </div>
      </div>
      <Placeholder screen="הדשבורדים" />
    </DemoOfficeFrame>
  );
}
