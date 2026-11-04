// FICTITIOUS DATA ONLY: demo presentation config: viewpoints, the signed-in demo users, office
// navigation and technician navigation. Allowed only under app/dev (G-05). Server-side: it
// imports the fixture reference data (./reference, server-only), so a client component that
// imports it fails the build.
// No permission values here: the matrix is data (D33, temporary per D51), served by
// demoDataAccess.reference.permissions(role); officeNav() receives it and only shapes the menu.
// Real enforcement is on the server and in the database (G-04).
import type { OfficeNavItem } from "@/components/office/OfficeSidebar";
import type { TechNavHrefs } from "@/components/tech/TechBottomNav";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import { offers, offersAnyDashboard } from "@/features/reference/data/permissions";
import {
  isOfficeRole,
  OFFICE_ROLE_VALUES,
  type OfficeRole,
  type RolePermissions,
  type TechnicianId,
} from "@/features/reference/data/types";
import { type OpenDecisionId, SETTINGS_SECTION_VALUES, type SettingsSection } from "@/features/settings/data/types";
import { ME } from "./reference";
import { demoHref } from "./routes";

export { isOfficeRole };

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

export type OfficeNavKey =
  | "home"
  | "cal"
  | "calls"
  | "customers"
  | "unparsed"
  | "back"
  | "analytics"
  | "products"
  | "users"
  | "settings";

/**
 * TEMPORARY, reversible (open decision #15, board ref d23): which matrix key gates "זימונים שלא
 * נקלטו" and "חזרו מהשטח", and whether both are in the first release, is the owner's decision. Until
 * then the demo offers both to the roles the spec lists (Customer Service, Manager, Creator: every
 * office role) as a fixed rule, never a matrix key, and each screen shows WORK_QUEUE_ACCESS_HINT.
 * The screen shows the decision's number (#15), not its board ref: "d23" next to the approved
 * D23 (Microsoft 365) would read as the same decision. Display only (G-04): the server stays
 * deny-by-default until #15 is decided; this rule is not a grant.
 */
export const WORK_QUEUE_SCREENS_DECISION = { number: 15, boardRef: "d23" } as const satisfies {
  number: number;
  boardRef: OpenDecisionId;
};

/** Whether the role's screens offer "זימונים שלא נקלטו" and "חזרו מהשטח" (the temporary rule above). */
export const workQueueScreensOffered = (role: OfficeRole): boolean => OFFICE_ROLES.includes(role);

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

/** "לקוחות" and the customer card: matrix key `calls` (spec office screens). Display only. */
export const customersOffered = (permissions: RolePermissions): boolean => offers(permissions, "calls");

/**
 * "מוצרים" (PR-06): matrix key `products` (Manager on, Customer Service off by default; the
 * Creator fixed). The spec defines this screen by its edit capability, so a role without
 * `products` has no products screen (product facts stay on the call and customer cards); a
 * read-only list for `calls` would be a new screen the spec does not list. Display only.
 */
export const productsOffered = (permissions: RolePermissions): boolean => offers(permissions, "products");

/**
 * The Settings tabs a role's screens offer. Display only (G-04): the server checks the Creator
 * role (matrix, accounts, D33/D34) and `settings` (operational settings, D35) itself.
 * - Creator: every tab (fixed capabilities, D33).
 * - A matrix role whose `settings` value is on: the operational settings of D35 (places, reasons
 *   with the "טופל" text, call types, template labels). "משתמשים והרשאות" stays Creator-only (the
 *   matrix is Creator-only, D33; the Manager's account administration is the "משתמשים" screen).
 *   "טכנאים" and "מיילים והתראות" are not D35 operational settings: deny by default until the
 *   owner says otherwise (the Manager manages technician accounts on "משתמשים", D34).
 * - Otherwise none (the default for Manager and Customer Service: `settings` off, SE-03).
 */
export function settingsTabsOffered(role: OfficeRole, permissions: RolePermissions): readonly SettingsSection[] {
  if (role === "creator") return SETTINGS_SECTION_VALUES;
  if (!offers(permissions, "settings")) return [];
  return ["places", "reasons", "types", "template"];
}

/**
 * Account administration a role's screens offer (D34, a fixed capability, never a matrix key,
 * SE-03). Display only: the server checks every account action in the database (D34).
 * - "all": the Creator (every account, decides the Manager's requests; on Settings › משתמשים והרשאות).
 * - "cs-tech": the Manager (Customer Service and Technician accounts; requests for Customer Service).
 * - null: Customer Service.
 */
export function accountAdminScope(role: OfficeRole): "all" | "cs-tech" | null {
  if (role === "creator") return "all";
  return role === "mgr" ? "cs-tech" : null;
}

/**
 * The office home's title: the dashboard home ("לוח בקרה") where the role's matrix value offers
 * `dashGen`, otherwise the work queue ("בית"). Display only (G-04).
 */
export const officeHomeLabel = (permissions: RolePermissions): string => (offers(permissions, "dashGen") ? "לוח בקרה" : "בית");

/**
 * Office sidebar items, from the role's values (read through
 * demoDataAccess.reference.permissions(role)), in the demo's NAV order (L724-730) with the spec's
 * new screens (OF-02) in the order of the spec's office screens table: "לקוחות", "זימונים שלא
 * נקלטו" and "חזרו מהשטח" after "קריאות", "מוצרים" after "דשבורד". Display only: it hides menu
 * items, it does not protect routes (G-04): each page checks what it offers itself.
 * - "לקוחות": with `calls`. "זימונים שלא נקלטו" and "חזרו מהשטח": every office role, a TEMPORARY
 *   fixed rule (open #15, d23; workQueueScreensOffered). "מוצרים": with `products`.
 * - "משתמשים" (account administration, D34): the Manager only (a fixed capability, SE-03); the
 *   Creator administers accounts on Settings › משתמשים והרשאות.
 * - "הגדרות": where settingsTabsOffered() offers a tab (the Creator always; a matrix role only
 *   with `settings`), linking to the first offered tab.
 * - "מדדי שימוש" is never in the menu (OF-15 PENDING d13: the usage screen is not built).
 */
export function officeNav(role: OfficeRole, permissions: RolePermissions): (OfficeNavItem & { key: OfficeNavKey })[] {
  const items: (OfficeNavItem & { key: OfficeNavKey })[] = [
    { key: "home", label: officeHomeLabel(permissions), href: demoHref.officeHome(role) },
  ];
  if (offers(permissions, "cal")) items.push({ key: "cal", label: "יומן טכנאים", href: demoHref.officeCalendar(role) });
  items.push({ key: "calls", label: "קריאות", href: demoHref.calls(role) });
  if (customersOffered(permissions)) items.push({ key: "customers", label: "לקוחות", href: demoHref.customers(role) });
  if (workQueueScreensOffered(role)) {
    items.push({ key: "unparsed", label: "זימונים שלא נקלטו", href: demoHref.unparsed(role) });
    items.push({ key: "back", label: "חזרו מהשטח", href: demoHref.backFromField(role) });
  }
  if (offersAnyDashboard(permissions)) items.push({ key: "analytics", label: "דשבורד", href: demoHref.analytics(role) });
  if (productsOffered(permissions)) items.push({ key: "products", label: "מוצרים", href: demoHref.products(role) });
  if (accountAdminScope(role) === "cs-tech") items.push({ key: "users", label: "משתמשים", href: demoHref.users(role) });
  const tabs = settingsTabsOffered(role, permissions);
  if (tabs[0]) items.push({ key: "settings", label: "הגדרות", href: demoHref.settings(role, tabs[0]) });
  return items;
}

/** Technician bottom-navigation links: "היום", "יומן" and "פרופיל". */
export const TECH_NAV_HREFS: TechNavHrefs = { home: demoHref.tech(), cal: demoHref.techCalendar(), prof: demoHref.techProfile() };
