import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { OfficeShell } from "@/components/office/OfficeShell";
import { RoleStartCard } from "@/components/ui/RoleStartCard";
import { SignOutForm } from "@/components/ui/SignOutForm";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { OFFICE_START_PATH, officeAvatarColor, officeStartItem } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { isOfficeRole } from "@/features/reference/data/types";
import { signOut } from "@/lib/actions/auth";
import { requireArea } from "@/lib/auth/guards";

export const metadata: Metadata = { title: "ניהול טכנאים" };

// The office start screen (Step 2 PR 2.5; TEMPORARY, Step 2 plan Q18; AU-03 PROPOSED) for the
// Creator, the Manager and Customer Service, on real session data only (D61): the name, role and
// 🧪 marker come from the user's own profile, never from a fixture.
// Landing (features/auth/landing.ts): "דשבורד" for the Manager and the Creator (D57 (1)) and
// "קריאות" for Customer Service (QA S-01: no "בית"). Until those screens are built, the landing
// item is the only navigation item and this page shows the temporary start card under its title.
// The guard runs here, at the time of the request (requireArea): no layout or proxy is trusted.
export default async function OfficeStartPage() {
  const me = await requireArea("office");
  const item = officeStartItem(me.role);
  if (!item || !isOfficeRole(me.role)) redirect(LOGIN_NO_ACCESS_PATH);
  const roleLabel = ACCOUNT_ROLE_LABELS[me.role];
  return (
    <OfficeShell
      nav={[{ key: item.key, label: item.label, href: OFFICE_START_PATH }]}
      activeKey={item.key}
      user={{ name: me.name, roleLabel, avatarColor: officeAvatarColor(me.role) }}
      signOut={<SignOutForm action={signOut} variant="side" />}
    >
      <div className="ptitle">
        <h1>{item.label}</h1>
      </div>
      <RoleStartCard greeting={`שלום, ${me.name}`} roleLabel={roleLabel} isTest={me.isTest} />
    </OfficeShell>
  );
}
