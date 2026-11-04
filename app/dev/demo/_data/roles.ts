// FICTITIOUS DATA ONLY: demo presentation config: viewpoints, the signed-in demo users, office
// navigation and technician navigation. Allowed only under app/dev (G-05). Client-safe.
// No permission values here: the matrix is data (D33, temporary per D51), served by
// demoDataAccess.reference.permissions(role); officeNav() receives it and only shapes the menu.
// Real enforcement is on the server and in the database (G-04).
import type { OfficeNavItem } from "@/components/office/OfficeSidebar";
import type { TechNavHrefs } from "@/components/tech/TechBottomNav";
import { offersAnyDashboard } from "@/features/reference/data/permissions";
import {
  isOfficeRole,
  OFFICE_ROLE_VALUES,
  type OfficeRole,
  type RolePermissions,
  type TechnicianId,
} from "@/features/reference/data/types";
import { ME } from "./reference";
import { demoHref } from "./routes";

export { isOfficeRole };

export type Viewpoint = "tech" | OfficeRole;

export const OFFICE_ROLES: readonly OfficeRole[] = OFFICE_ROLE_VALUES;

/** The technician the demo's technician viewpoint signs in as (G-03: production takes identity
 *  from the session). Pages pass it to the data-access layer as a filter. */
export const DEMO_TECHNICIAN_ID: TechnicianId = ME;

/** Viewpoints offered on the landing page (the demo's ROLE map, without the creator). */
export const VIEWPOINTS: Record<Viewpoint, { label: string; short: string; who: string; color: string }> = {
  tech: { label: "טכנאי · יורם", short: "טכנאי", who: "יורם", color: "var(--t-y)" },
  mgr: { label: "מנהל · דורון", short: "מנהל", who: "דורון", color: "var(--accent)" },
  cs: { label: "שירות לקוחות · שיראל", short: "שירות לקוחות", who: "שיראל", color: "var(--s-work)" },
};

/** OfficeShell `user` prop per role. */
export const OFFICE_SHELL_USERS: Record<OfficeRole, { name: string; roleLabel: string; avatarColor: string }> = {
  mgr: { name: VIEWPOINTS.mgr.who, roleLabel: VIEWPOINTS.mgr.short, avatarColor: VIEWPOINTS.mgr.color },
  cs: { name: VIEWPOINTS.cs.who, roleLabel: VIEWPOINTS.cs.short, avatarColor: VIEWPOINTS.cs.color },
};

export type OfficeNavKey = "home" | "calls" | "analytics";

/**
 * Office sidebar items as real links, from the role's matrix values (read through
 * demoDataAccess.reference.permissions(role)). Display only: it hides menu items, it does not
 * protect routes (G-04).
 */
export function officeNav(role: OfficeRole, permissions: RolePermissions): (OfficeNavItem & { key: OfficeNavKey })[] {
  const items: (OfficeNavItem & { key: OfficeNavKey })[] = [
    { key: "home", label: role === "mgr" ? "לוח בקרה" : "בית", href: demoHref.officeHome(role) },
    { key: "calls", label: "קריאות", href: demoHref.calls(role) },
  ];
  if (offersAnyDashboard(permissions)) items.push({ key: "analytics", label: "דשבורדים", href: demoHref.analytics() });
  return items;
}

/** Technician bottom-navigation links. "יומן" and "פרופיל" are not part of this demo. */
export const TECH_NAV_HREFS: TechNavHrefs = { home: demoHref.tech() };
