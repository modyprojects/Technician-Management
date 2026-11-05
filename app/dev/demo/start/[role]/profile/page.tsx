import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileAccount } from "@/components/tech/ProfileSections";
import { TechShell } from "@/components/tech/TechShell";
import { TechStartHead } from "@/components/tech/TechStartHead";
import { LoginScreen } from "@/components/ui/LoginScreen";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { DemoPage } from "../../../_components/DemoPage";
import { DemoSignOut } from "../../../_components/DemoSignOut";
import { demoSession } from "../../../_data/adapter";
import { startProfileParams } from "../../../_data/params";
import { DEMO_START_TECH_TABS, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";

// Only the technician has a profile here; any other role is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return startProfileParams();
}

export const metadata: Metadata = { title: "פרופיל מינימלי · טכנאי · הדגמה" };

// Prototype of the technician's minimal profile (Step 2 plan §4 #11 "Wired to: session"; AU-04
// PROPOSED; Step 2 PR 2.3): his name, role and 🧪 from the session user (demoSession; production:
// getSessionUser()) and "חשבון" › "יציאה מהחשבון" (Q4 TEMPORARY; simulated). Nothing else: no week
// figures, notification toggles or help until the full profile is built. No session fails closed
// with the no-access state.
export default async function StartProfilePage({ params }: PageProps<"/dev/demo/start/[role]/profile">) {
  const { role } = await params;
  if (role !== "tech") notFound();
  const me = await demoSession({ role: "tech", name: VIEWPOINTS.tech.who }).current();
  if (!me) {
    return (
      <DemoPage>
        <LoginScreen state="no-access" signOut={<DemoSignOut variant="light" />} />
      </DemoPage>
    );
  }
  return (
    <DemoPage viewpoint="tech">
      <TechShell
        head={
          <TechStartHead
            title={me.name}
            isTest={me.isTest}
            sub={`הרשאה: ${ACCOUNT_ROLE_LABELS[me.role]}`}
            backHref={demoHref.start("tech")}
          />
        }
        activeTab="prof"
        navTabs={DEMO_START_TECH_TABS}
        navHrefs={{ home: demoHref.start("tech"), prof: demoHref.startProfile() }}
      >
        <ProfileAccount signOut={<DemoSignOut variant="row" />} />
      </TechShell>
    </DemoPage>
  );
}
