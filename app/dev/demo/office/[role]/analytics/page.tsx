import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { Placeholder } from "../../../_components/Placeholder";
import { canSeeDashboards, isOfficeRole } from "../../../_data";

// Manager only: customer service has no dashboard permission (D33 defaults, temporary per D51).
export const dynamicParams = false;

export function generateStaticParams() {
  return [{ role: "mgr" }];
}

export const metadata: Metadata = { title: "דשבורדים · מנהל · הדגמה" };

// Manager dashboards (general / technicians / products). Placeholder until the dashboards replace it.
export default async function OfficeAnalyticsPage({ params }: PageProps<"/dev/demo/office/[role]/analytics">) {
  const { role } = await params;
  if (!isOfficeRole(role) || !canSeeDashboards(role)) notFound();
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
