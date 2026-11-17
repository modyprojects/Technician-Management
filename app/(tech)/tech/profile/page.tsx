import type { Metadata } from "next";
import { ProfileAccount } from "@/components/tech/ProfileSections";
import { TechShell } from "@/components/tech/TechShell";
import { TechStartHead } from "@/components/tech/TechStartHead";
import { SignOutForm } from "@/components/ui/SignOutForm";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { TECH_START_PATH } from "@/features/auth/landing";
import { signOut } from "@/lib/actions/auth";
import { requireArea } from "@/lib/auth/guards";
import { TECH_START_HREFS, TECH_START_TABS } from "../_tabs";

export const metadata: Metadata = { title: "פרופיל · ניהול טכנאים" };

// The technician's minimal profile (Step 2 plan §4 #11; Step 2 PR 2.5; AU-04 PROPOSED): his name,
// role and 🧪 marker from his own profile, and "חשבון" › "יציאה מהחשבון" (Q4 TEMPORARY). Nothing
// else until the full profile is built. The guard runs here (requireArea("tech")).
export default async function TechProfilePage() {
  const me = await requireArea("tech");
  return (
    <TechShell
      head={<TechStartHead title={me.name} isTest={me.isTest} sub={`הרשאה: ${ACCOUNT_ROLE_LABELS[me.role]}`} backHref={TECH_START_PATH} />}
      activeTab="prof"
      navTabs={TECH_START_TABS}
      navHrefs={TECH_START_HREFS}
    >
      <ProfileAccount signOut={<SignOutForm action={signOut} variant="row" />} />
    </TechShell>
  );
}
