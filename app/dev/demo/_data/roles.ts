// FICTITIOUS DATA ONLY: demo presentation config: viewpoints, the signed-in demo users, office
// navigation and technician navigation. Allowed only under app/dev (G-05). Server-side: it
// imports the fixture reference data (./reference, server-only), so a client component that
// imports it fails the build.
// No permission values here: the matrix is data (D33, temporary per D51), served by
// demoDataAccess.reference.permissions(role); officeNav() receives it and only shapes the menu.
// Real enforcement is on the server and in the database (G-04).
// The role rules themselves (what each office role's screens offer, the sidebar order) live in
// features/auth/roles.ts, shared with the real app (Step 2 plan §3.5); this module re-exports
// them for the demo pages and adds the demo's addresses and fictional users.
import type { TechNavHrefs } from "@/components/tech/TechBottomNav";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import {
  accountAdminScope,
  customersOffered,
  officeHomeLabel,
  officeNav as sharedOfficeNav,
  type OfficeNavHrefs,
  type OfficeNavKey,
  type OfficeNavLink,
  productsOffered,
  reviewItemsOffered,
  settingsTabsOffered,
  WORK_QUEUE_SCREENS_DECISION,
  workQueueScreensOffered,
} from "@/features/auth/roles";
import {
  isOfficeRole,
  OFFICE_ROLE_VALUES,
  type OfficeRole,
  type RolePermissions,
  type TechnicianId,
} from "@/features/reference/data/types";
import { reviewDecisionOffered } from "@/features/review/data/permissions";
import type { ReviewItemSummary } from "@/features/review/data/types";
import { ME } from "./reference";
import { demoHref } from "./routes";

export {
  accountAdminScope,
  customersOffered,
  isOfficeRole,
  officeHomeLabel,
  productsOffered,
  reviewItemsOffered,
  settingsTabsOffered,
  WORK_QUEUE_SCREENS_DECISION,
  workQueueScreensOffered,
};
export type { OfficeNavKey };

export type Viewpoint = "tech" | OfficeRole;

export const OFFICE_ROLES: readonly OfficeRole[] = OFFICE_ROLE_VALUES;

/** The technician the demo's technician viewpoint signs in as (G-03: production takes identity
 *  from the session). Pages pass it to the data-access layer as a filter. */
export const DEMO_TECHNICIAN_ID: TechnicianId = ME;

/**
 * Viewpoints offered on the landing page (the demo's ROLE map, L300-305). The app has no role
 * switcher (X-02): the role comes from sign-in; the /dev/demo landing lists the viewpoints.
 */
export const VIEWPOINTS: Record<Viewpoint, { label: string; short: string; who: string; color: string }> = {
  tech: { label: "טכנאי · יורם", short: "טכנאי", who: "יורם", color: "var(--t-y)" },
  mgr: { label: "מנהל · דורון", short: "מנהל", who: "דורון", color: "var(--accent)" },
  cs: { label: "שירות לקוחות · שיראל", short: "שירות לקוחות", who: "שיראל", color: "var(--s-work)" },
  creator: { label: "יוצר", short: "יוצר", who: "משתמש יוצר", color: "var(--ink)" },
};

/** OfficeShell `user` prop per role. */
export const OFFICE_SHELL_USERS: Record<OfficeRole, { name: string; roleLabel: string; avatarColor: string }> = {
  mgr: { name: VIEWPOINTS.mgr.who, roleLabel: VIEWPOINTS.mgr.short, avatarColor: VIEWPOINTS.mgr.color },
  cs: { name: VIEWPOINTS.cs.who, roleLabel: VIEWPOINTS.cs.short, avatarColor: VIEWPOINTS.cs.color },
  creator: { name: VIEWPOINTS.creator.who, roleLabel: VIEWPOINTS.creator.short, avatarColor: VIEWPOINTS.creator.color },
};

/** "א", "א וב", "א, ב וג" (Hebrew list). */
function hebrewList(items: readonly string[]): string {
  if (items.length <= 1) return items.join("");
  return `${items.slice(0, -1).join(", ")} ו${items[items.length - 1] as string}`;
}

/**
 * The visible line both work-queue screens show while #15 is open (CLAUDE.md: clearly labelled
 * temporary behaviour). The roles come from the rule itself, so the line cannot drift from it.
 */
export const WORK_QUEUE_ACCESS_HINT = `הרשאת צפייה זמנית: ${hebrewList(
  OFFICE_ROLES.filter(workQueueScreensOffered).map((r) => VIEWPOINTS[r].short),
)} · ${pendingDecisionHint(`#${WORK_QUEUE_SCREENS_DECISION.number}`)}`;

/**
 * D14 audited corrections of a server-closed visit ("תיקון ביקור סגור", OF-10) and any resolution
 * that changes a server-closed or cancelled visit (D44): Manager and Creator only, a FIXED
 * capability (D33: never a matrix key). Customer Service and technicians never get it. Display
 * only; the server checks the caller's role in the database.
 */
export const closedVisitCorrectionsOffered = (role: OfficeRole): boolean => role === "mgr" || role === "creator";

/**
 * Whether the role's screen offers resolving an item (D44): an item that changes a server-closed or
 * cancelled visit follows the fixed D14 rule; every other item follows `conflicts`, and an
 * invitation's cancellation also `cancel` (TEMPORARY; reviewDecisionOffered). Display only.
 */
export function reviewResolutionOffered(
  role: OfficeRole,
  permissions: RolePermissions,
  item: Pick<ReviewItemSummary, "authority" | "kind">,
): boolean {
  return reviewDecisionOffered({ permissions, closedVisitCapability: closedVisitCorrectionsOffered(role), item });
}

/** The demo's addresses of the office sidebar items for a role (every item is built in the demo). */
const demoOfficeNavHrefs = (role: OfficeRole): OfficeNavHrefs => ({
  home: demoHref.officeHome(role),
  cal: demoHref.officeCalendar(role),
  calls: demoHref.calls(role),
  customers: demoHref.customers(role),
  unparsed: demoHref.unparsed(role),
  back: demoHref.backFromField(role),
  review: demoHref.review(role),
  analytics: demoHref.analytics(role),
  products: demoHref.products(role),
  users: demoHref.users(role),
  settings: (tab) => demoHref.settings(role, tab),
});

/**
 * Office sidebar items of a demo viewpoint: the shared rule (features/auth/roles.ts officeNav) over
 * the role's values, read through demoDataAccess.reference.permissions(role), with the demo's
 * addresses. Display only (G-04).
 */
export const officeNav = (role: OfficeRole, permissions: RolePermissions): OfficeNavLink[] =>
  sharedOfficeNav(role, permissions, demoOfficeNavHrefs(role));

/** Technician bottom-navigation links: "היום", "יומן" and "פרופיל". */
export const TECH_NAV_HREFS: TechNavHrefs = { home: demoHref.tech(), cal: demoHref.techCalendar(), prof: demoHref.techProfile() };
