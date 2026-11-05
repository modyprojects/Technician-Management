import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { OfficeShell } from "@/components/office/OfficeShell";
import { TechShell } from "@/components/tech/TechShell";
import { TechStartHead } from "@/components/tech/TechStartHead";
import { LoginScreen } from "@/components/ui/LoginScreen";
import { RoleStartCard } from "@/components/ui/RoleStartCard";
import { ACCOUNT_ROLE_LABELS } from "@/features/accounts/data/types";
import { DemoPage } from "../../_components/DemoPage";
import { DemoSignOut } from "../../_components/DemoSignOut";
import { demoDataAccess, demoSession } from "../../_data/adapter";
import { startParams } from "../../_data/params";
import { DEMO_START_TECH_TABS, demoStartLanding, demoStartNav, isOfficeRole, VIEWPOINTS, type Viewpoint } from "../../_data/roles";
import { demoHref } from "../../_data/routes";

// Every viewpoint is built; anything else is a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return startParams();
}

const isViewpoint = (value: string): value is Viewpoint => value === "tech" || isOfficeRole(value);

export async function generateMetadata({ params }: PageProps<"/dev/demo/start/[role]">): Promise<Metadata> {
  const { role } = await params;
  if (!isViewpoint(role)) return {};
  return { title: `מסך פתיחה זמני · ${VIEWPOINTS[role].label} · הדגמה` };
}

// Prototype of a role's temporary start screen (Step 2 plan §4 #3, #11; TEMPORARY, Q18: "the
// shell, the user's name and role, sign-out, and one sentence that the role's screens arrive in
// later steps; navigation shows only built items"; AU-03 PROPOSED). Wired to the session port
// (demoSession: the viewpoint's fictional account; production: getSessionUser(), PR 2.5): the
// name, role label and 🧪 come from that SessionUser, never from a fixture, and only display text
// reaches the page (no account id). No session (a missing or inactive account) fails closed with
// the sign-in screen's no-access state, as the real app does (plan §3.4).
// - Office: the shared navigation rule with the prototype's addresses only (demoStartNav): "בית"
//   and, where the role has a Settings tab, "הגדרות". OPEN (§9 Q-A, AU-03 PENDING): D57 (1) makes
//   "דשבורד" the Manager's and the Creator's landing; this prototype shows the Q18 option with the
//   visible pending label and decides nothing. "הגדרות" opens the full demo (its D57 sidebar).
// - Technician: "היום" and "פרופיל" (no "יומן": not built in Step 2); sign-out on the card, since
//   the technician shell has no user block.
export default async function StartPage({ params }: PageProps<"/dev/demo/start/[role]">) {
  const { role } = await params;
  if (!isViewpoint(role)) notFound();
  const me = await demoSession({ role, name: VIEWPOINTS[role].who }).current();
  if (!me) {
    return (
      <DemoPage>
        <LoginScreen state="no-access" signOut={<DemoSignOut variant="light" />} />
      </DemoPage>
    );
  }
  const roleLabel = ACCOUNT_ROLE_LABELS[me.role];

  if (role === "tech") {
    return (
      <DemoPage viewpoint="tech">
        <TechShell
          head={<TechStartHead title={`שלום, ${me.name}`} isTest={me.isTest} />}
          activeTab="home"
          navTabs={DEMO_START_TECH_TABS}
          navHrefs={{ home: demoHref.start("tech"), prof: demoHref.startProfile() }}
        >
          <RoleStartCard roleLabel={roleLabel} isTest={me.isTest} signOut={<DemoSignOut variant="row" />} />
        </TechShell>
      </DemoPage>
    );
  }

  const permissions = await demoDataAccess.reference.permissions(role);
  const landing = demoStartLanding(role, permissions);
  return (
    <DemoPage viewpoint={role}>
      <OfficeShell
        nav={demoStartNav(role, permissions)}
        activeKey={landing.key}
        user={{ name: me.name, roleLabel, avatarColor: VIEWPOINTS[role].color }}
        signOut={<DemoSignOut variant="side" />}
      >
        <div className="ptitle">
          <h1>{landing.label}</h1>
        </div>
        <RoleStartCard greeting={`שלום, ${me.name}`} roleLabel={roleLabel} isTest={me.isTest} />
      </OfficeShell>
    </DemoPage>
  );
}
