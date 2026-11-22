import type { ReactNode } from "react";
import { OfficeShell } from "@/components/office/OfficeShell";
import { SignOutForm } from "@/components/ui/SignOutForm";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import type { SessionUser } from "@/features/auth/data/types";
import { officeAvatarColor, realOfficeNav, type RealOfficeNavItem } from "@/features/auth/landing";
import { isOfficeRole } from "@/features/reference/data/types";
import { signOut } from "@/lib/actions/auth";
import { officeCalendarQueries } from "@/lib/data/supabase/office-calendar";

// The real office frame (Step 2): the sidebar with the real navigation (features/auth/landing.ts
// realOfficeNav: the role's landing item and, for the Manager and the Creator, "הגדרות"), the
// signed-in user's name and role from his own profile (never a fixture, D61) and "יציאה". A Server
// Component used by the real office pages AFTER their own guard (requireArea): it decides nothing.
export async function OfficeFrame({ me, active, children }: { me: SessionUser; active: RealOfficeNavItem["key"]; children: ReactNode }) {
  const roleLabel = ACCOUNT_ROLE_LABELS[me.role];
  // "יומן טכנאים" in the menu only with `cal` (D94 (c)), asked of the database under the user's session.
  const cal = isOfficeRole(me.role) ? await (await officeCalendarQueries()).permitted() : false;
  return (
    <OfficeShell
      nav={realOfficeNav(me.role, { cal })}
      activeKey={active}
      user={{ name: me.name, roleLabel, avatarColor: isOfficeRole(me.role) ? officeAvatarColor(me.role) : "var(--ink)" }}
      signOut={<SignOutForm action={signOut} variant="side" />}
      phoneSignOut={<SignOutForm action={signOut} variant="light" />}
    >
      {children}
    </OfficeShell>
  );
}
