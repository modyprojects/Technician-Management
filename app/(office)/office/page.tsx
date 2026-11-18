import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { RoleStartCard } from "@/components/ui/RoleStartCard";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { officeStartItem } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { isOfficeRole } from "@/features/reference/data/types";
import { requireArea } from "@/lib/auth/guards";
import { OfficeFrame } from "./_OfficeFrame";

export const metadata: Metadata = { title: "ניהול טכנאים" };

// The office start screen (Step 2 PR 2.5; TEMPORARY, Step 2 plan Q18; AU-03 PROPOSED) for the
// Creator, the Manager and Customer Service, on real session data only (D61): the name, role and
// 🧪 marker come from the user's own profile, never from a fixture.
// Landing (features/auth/landing.ts): "דשבורד" for the Manager and the Creator (D57 (1)) and
// "קריאות" for Customer Service (QA S-01: no "בית"). Until those screens are built, this page shows
// the temporary start card under the landing item's title. The navigation lists only built screens
// (realOfficeNav): the landing item, and "הגדרות" for the Manager and the Creator (D57 (1), the
// unified user management of D60 (7)).
// The guard runs here, at the time of the request (requireArea): no layout or proxy is trusted.
export default async function OfficeStartPage() {
  const me = await requireArea("office");
  const item = officeStartItem(me.role);
  if (!item || !isOfficeRole(me.role)) redirect(LOGIN_NO_ACCESS_PATH);
  return (
    <OfficeFrame me={me} active={item.key}>
      <div className="ptitle">
        <h1>{item.label}</h1>
      </div>
      <RoleStartCard greeting={`שלום, ${me.name}`} roleLabel={ACCOUNT_ROLE_LABELS[me.role]} isTest={me.isTest} />
    </OfficeFrame>
  );
}
