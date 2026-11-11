import type { ReactNode } from "react";
import { OfficeShell } from "@/components/office/OfficeShell";
import type { TechTab } from "@/components/tech/TechBottomNav";
import { TechShell } from "@/components/tech/TechShell";
import type { OfficeRole } from "@/features/reference/data/types";
import { demoDataAccess } from "../_data/adapter";
import { OFFICE_SHELL_USERS, officeNav, officeNavParent, TECH_NAV_HREFS, type OfficeNavKey } from "../_data/roles";
import { DemoPage } from "./DemoPage";
import { DemoSignOut } from "./DemoSignOut";

/**
 * DemoPage + OfficeShell with the role's sidebar (real links) and signed-in user. Server
 * Component: the sidebar items follow the role's permission values, read through the layer
 * (reference.permissions; display only, G-04).
 * `active` is the open screen. When it has no sidebar item of its own (D57: Manager and Creator
 * reach customers, back from field, review items and products from "קריאות", and the former
 * "משתמשים" address belongs to "הגדרות"), its parent item is highlighted without aria-current
 * (officeNavParent). Otherwise nothing is highlighted (Customer Service: as before).
 * Every office demo page has "יציאה" in the sidebar's user block (Step 2 PR 2.3, Q4 TEMPORARY):
 * simulated (DemoSignOut).
 */
export async function DemoOfficeFrame({ role, active, children }: { role: OfficeRole; active: OfficeNavKey; children: ReactNode }) {
  const permissions = await demoDataAccess.reference.permissions(role);
  const nav = officeNav(role, permissions);
  const inNav = (key: OfficeNavKey | null) => key !== null && nav.some((item) => item.key === key);
  const parent = inNav(active) ? null : officeNavParent(role, active);
  const activeKey = parent !== null && inNav(parent) ? parent : active;
  return (
    <DemoPage viewpoint={role}>
      <OfficeShell
        nav={nav}
        activeKey={activeKey}
        activeIsCurrent={activeKey === active}
        user={OFFICE_SHELL_USERS[role]}
        signOut={<DemoSignOut variant="side" />}
      >
        {children}
      </OfficeShell>
    </DemoPage>
  );
}

/** DemoPage + TechShell; the bottom navigation links "היום" to the demo technician home. */
export function DemoTechFrame({
  head,
  foot,
  activeTab,
  activeIsCurrent,
  children,
}: {
  head: ReactNode;
  foot?: ReactNode;
  /** Shows the bottom navigation (home, notifications-style screens); omit on visit screens. */
  activeTab?: TechTab;
  /** False on a screen opened from the tab, such as a closed visit (no aria-current). */
  activeIsCurrent?: boolean;
  children: ReactNode;
}) {
  return (
    <DemoPage viewpoint="tech">
      <TechShell head={head} foot={foot} activeTab={activeTab} activeIsCurrent={activeIsCurrent} navHrefs={TECH_NAV_HREFS}>
        {children}
      </TechShell>
    </DemoPage>
  );
}
