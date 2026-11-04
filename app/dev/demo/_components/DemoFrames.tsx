import type { ReactNode } from "react";
import { OfficeShell } from "@/components/office/OfficeShell";
import type { TechTab } from "@/components/tech/TechBottomNav";
import { TechShell } from "@/components/tech/TechShell";
import type { OfficeRole } from "@/features/reference/data/types";
import { demoDataAccess } from "../_data/adapter";
import { OFFICE_SHELL_USERS, officeNav, TECH_NAV_HREFS, type OfficeNavKey } from "../_data/roles";
import { DemoPage } from "./DemoPage";

/**
 * DemoPage + OfficeShell with the role's sidebar (real links) and signed-in user. Server
 * Component: the sidebar items follow the role's permission values, read through the layer
 * (reference.permissions; display only, G-04).
 */
export async function DemoOfficeFrame({ role, active, children }: { role: OfficeRole; active: OfficeNavKey; children: ReactNode }) {
  const permissions = await demoDataAccess.reference.permissions(role);
  return (
    <DemoPage viewpoint={role}>
      <OfficeShell nav={officeNav(role, permissions)} activeKey={active} user={OFFICE_SHELL_USERS[role]}>
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
  children,
}: {
  head: ReactNode;
  foot?: ReactNode;
  /** Shows the bottom navigation (home, notifications-style screens); omit on visit screens. */
  activeTab?: TechTab;
  children: ReactNode;
}) {
  return (
    <DemoPage viewpoint="tech">
      <TechShell head={head} foot={foot} activeTab={activeTab} navHrefs={TECH_NAV_HREFS}>
        {children}
      </TechShell>
    </DemoPage>
  );
}
