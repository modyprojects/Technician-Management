import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { ManagerDashboard } from "@/components/office/dashboard/ManagerDashboard";
import { TestBadge } from "@/components/ui/TestBadge";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { OFFICE_CALLS_PATH, officeStartItem } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { isOfficeRole } from "@/features/reference/data/types";
import { requireArea } from "@/lib/auth/guards";
import { OfficeFrame } from "./_OfficeFrame";

export const metadata: Metadata = { title: "ניהול טכנאים" };

// The office start for the Creator, the Manager and Customer Service.
// Landing (features/auth/landing.ts): "דשבורד" for the Manager and the Creator (D57 (1)) and
// "קריאות" for Customer Service (QA S-01: no "בית"), who is sent to /office/calls.
// "דשבורד" is a SKELETON on fake data (D81, approved under D96; components/office/dashboard,
// features/dashboard/skeleton-data.ts): no data access is added here. The name, role and 🧪 marker
// in the title line come from the user's own profile (D61), never from a fixture.
// The guard runs here, at the time of the request (requireArea): no layout or proxy is trusted.
export default async function OfficeStartPage({ searchParams }: PageProps<"/office">) {
  const me = await requireArea("office");
  const item = officeStartItem(me.role);
  if (!item || !isOfficeRole(me.role)) redirect(LOGIN_NO_ACCESS_PATH);
  // "קריאות" is built: Customer Service lands there (QA S-01, D60 (4)).
  if (item.key === "calls") redirect(OFFICE_CALLS_PATH);
  return (
    <OfficeFrame me={me} active={item.key}>
      <div className="ptitle">
        <div>
          <h1>{item.label}</h1>
          <div className="sub">
            <span>{`שלום, ${me.name}`}</span> {me.isTest && <TestBadge />} ·{" "}
            <span className="start-role">הרשאה: {ACCOUNT_ROLE_LABELS[me.role]}</span>
          </div>
        </div>
      </div>
      <ManagerDashboard searchParams={await searchParams} />
    </OfficeFrame>
  );
}
