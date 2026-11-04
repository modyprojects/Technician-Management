// FICTITIOUS DATA ONLY: demo viewpoints, office navigation and the default permission matrix.
// Allowed only under app/dev (G-05). Client-safe.
// Permission values are the demo's defaults (D33) and are TEMPORARY until the owner approves the
// final matrix in Step 10 (D51). Here they only decide what the demo shows; real enforcement is
// on the server and in the database (G-04).
import type { OfficeNavItem } from "@/components/office/OfficeSidebar";
import type { TechNavHrefs } from "@/components/tech/TechBottomNav";
import {
  isOfficeRole,
  OFFICE_ROLE_VALUES,
  type OfficeRole,
  type PermissionKey,
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

/** Permission-matrix keys (D33). */
export type PermKey = PermissionKey;

/** Status of every value below (D51). */
export const PERMISSION_STATUS = "temporary" as const;

/** Default matrix (D33, D37): Manager all on except settings and usage; Customer Service cal, calls, card. */
export const PERMISSIONS: Record<OfficeRole, Record<PermKey, boolean>> = {
  mgr: {
    cal: true, calls: true, card: true, cancel: true, dashGen: true, dashTech: true, dashProd: true,
    export: true, settings: false, usage: false, products: true, conflicts: true, recordings: true,
  },
  cs: {
    cal: true, calls: true, card: true, cancel: false, dashGen: false, dashTech: false, dashProd: false,
    export: false, settings: false, usage: false, products: false, conflicts: false, recordings: false,
  },
};

/** The demo's can(): what this role's screens show. Never access control (G-04). */
export const can = (role: OfficeRole, key: PermKey): boolean => PERMISSIONS[role][key];

/** Whether the role sees any dashboard tab. */
export const canSeeDashboards = (role: OfficeRole): boolean => can(role, "dashGen") || can(role, "dashTech") || can(role, "dashProd");

export type OfficeNavKey = "home" | "calls" | "analytics";

/** Office sidebar items per role, as real links. */
export function officeNav(role: OfficeRole): (OfficeNavItem & { key: OfficeNavKey })[] {
  const items: (OfficeNavItem & { key: OfficeNavKey })[] = [
    { key: "home", label: role === "mgr" ? "לוח בקרה" : "בית", href: demoHref.officeHome(role) },
    { key: "calls", label: "קריאות", href: demoHref.calls(role) },
  ];
  if (canSeeDashboards(role)) items.push({ key: "analytics", label: "דשבורדים", href: demoHref.analytics() });
  return items;
}

/** Technician bottom-navigation links. "יומן" and "פרופיל" are not part of this demo. */
export const TECH_NAV_HREFS: TechNavHrefs = { home: demoHref.tech() };
