import type { Metadata } from "next";
import { TechShell } from "@/components/tech/TechShell";
import { TechStartHead } from "@/components/tech/TechStartHead";
import { RoleStartCard } from "@/components/ui/RoleStartCard";
import { SignOutForm } from "@/components/ui/SignOutForm";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { signOut } from "@/lib/actions/auth";
import { requireArea } from "@/lib/auth/guards";
import { TECH_START_HREFS, TECH_START_TABS } from "./_tabs";

export const metadata: Metadata = { title: "היום · ניהול טכנאים" };

// The technician's start screen (Step 2 PR 2.5; TEMPORARY, Step 2 plan Q18; AU-03 PROPOSED), on
// real session data only (D61): his name and 🧪 marker in the header, his role, and "יציאה" on the
// card (the technician shell has no user block). The guard runs here (requireArea("tech")).
export default async function TechStartPage() {
  const me = await requireArea("tech");
  return (
    <TechShell head={<TechStartHead title={`שלום, ${me.name}`} isTest={me.isTest} />} activeTab="home" navTabs={TECH_START_TABS} navHrefs={TECH_START_HREFS}>
      <RoleStartCard roleLabel={ACCOUNT_ROLE_LABELS[me.role]} isTest={me.isTest} signOut={<SignOutForm action={signOut} variant="row" />} />
    </TechShell>
  );
}
