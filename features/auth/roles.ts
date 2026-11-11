// Role codes and the role-based navigation helpers (Step 2 plan §3.1, §3.5). Pure: no data, no
// I/O, no fixtures, no route addresses (the caller passes them), so the real app and the
// /dev demo share one rule set. Moved here from app/dev/demo/_data/roles.ts, which ESLint keeps
// out of production routes (G-05).
//
// Display only (G-04): these helpers decide what a screen offers. Enforcement is always on the
// server and in the database (RLS, grants, server functions; D33, D34; docs/security.md §5).
// Permission values are temporary until the owner approves the final matrix in Step 10 (D51).
import type { AccountRole } from "@/features/accounts/data/types";
import { offers, offersAnyDashboard } from "@/features/reference/data/permissions";
import { isOfficeRole, OFFICE_ROLE_VALUES, type OfficeRole, type RolePermissions } from "@/features/reference/data/types";
import { reviewScreenOffered } from "@/features/review/data/permissions";
import { CREATOR_SETTINGS_SECTIONS, type OpenDecisionId, type SettingsSection } from "@/features/settings/data/types";
import type { RoleArea } from "./redirects";

// ---------------------------------------------------------------------------------------------
// Role codes: database (profiles.role, Migration 1) <-> UI (AccountRole, OfficeRole)
// ---------------------------------------------------------------------------------------------

/** `profiles.role` values (Migration 1, `profiles_role_check`). The role comes from `profiles` only (docs/security.md §5). */
export const DB_ROLE_VALUES = ["creator", "manager", "customer_service", "technician"] as const;
export type DbRole = (typeof DB_ROLE_VALUES)[number];

const DB_TO_UI: ReadonlyMap<DbRole, AccountRole> = new Map([
  ["creator", "creator"],
  ["manager", "mgr"],
  ["customer_service", "cs"],
  ["technician", "tech"],
]);

const UI_TO_DB: ReadonlyMap<AccountRole, DbRole> = new Map([...DB_TO_UI].map(([db, ui]) => [ui, db]));

/** Whether `value` is a database role code. Own values only: "constructor" or "__proto__" are not roles. */
export const isDbRole = (value: unknown): value is DbRole => typeof value === "string" && DB_TO_UI.has(value as DbRole);

/** The UI role of a database role code; null for anything else (deny by default). */
export function uiRoleOf(value: unknown): AccountRole | null {
  return isDbRole(value) ? (DB_TO_UI.get(value) ?? null) : null;
}

/** The database role code of a UI role; null for anything else. */
export function dbRoleOf(value: unknown): DbRole | null {
  return typeof value === "string" ? (UI_TO_DB.get(value as AccountRole) ?? null) : null;
}

/** The office role of an account role; null for a technician or anything else. */
export function officeRoleOf(role: unknown): OfficeRole | null {
  return isOfficeRole(role) ? role : null;
}

const ROLE_AREA: ReadonlyMap<AccountRole, RoleArea> = new Map([
  ["creator", "office"],
  ["mgr", "office"],
  ["cs", "office"],
  ["tech", "tech"],
]);

/**
 * The area a role's screens live in: office roles `/office…`, technicians `/tech…`. Never the
 * device (D27). An explicit map, so a value that is no role (typing bypassed) has no area (deny
 * by default) instead of falling through to one.
 */
export const roleArea = (role: AccountRole): RoleArea | null => ROLE_AREA.get(role) ?? null;

// ---------------------------------------------------------------------------------------------
// What an office role's screens offer (display only, G-04)
// ---------------------------------------------------------------------------------------------

export type OfficeNavKey =
  | "home"
  | "cal"
  | "calls"
  | "customers"
  | "unparsed"
  | "back"
  | "review"
  | "analytics"
  | "products"
  | "users"
  | "settings";

/**
 * TEMPORARY, reversible (open decision #15, board ref d23): which matrix key gates "זימונים שלא
 * נקלטו" and "חזרו מהשטח", and whether both are in the first release, is the owner's decision. Until
 * then the demo offers both to the roles the spec lists (Customer Service, Manager, Creator: every
 * office role) as a fixed rule, never a matrix key, and each screen shows a hint built from this
 * rule. The screen shows the decision's number (#15), not its board ref: "d23" next to the
 * approved D23 (Microsoft 365) would read as the same decision. Display only (G-04): the server
 * stays deny-by-default until #15 is decided; this rule is not a grant.
 */
export const WORK_QUEUE_SCREENS_DECISION = { number: 15, boardRef: "d23" } as const satisfies {
  number: number;
  boardRef: OpenDecisionId;
};

/** Whether the role's screens offer "זימונים שלא נקלטו" and "חזרו מהשטח" (the temporary rule above). */
export const workQueueScreensOffered = (role: OfficeRole): boolean => OFFICE_ROLE_VALUES.includes(role);

/**
 * "פריטים לבדיקה" (D39, D44): matrix key `conflicts` (Manager on, Customer Service off by default;
 * the Creator fixed), and `card`, with which the server reads `review_items` (docs/database-schema.md
 * §8.3; items carry report content). TEMPORARY (owner question, phase G): whether the D14 items stay
 * reachable when `conflicts` or `card` is off; until then the whole screen follows both keys (deny
 * by default). Display only (G-04): the server checks every read and resolution itself.
 */
export const reviewItemsOffered = (permissions: RolePermissions): boolean => reviewScreenOffered(permissions);

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
 * - Creator: the seven Creator tabs (fixed capabilities, D33; CREATOR_SETTINGS_SECTIONS), never
 *   "accounts" (the Creator administers every account on "משתמשים והרשאות").
 * - The Manager: "משתמשים" ("accounts"), the account administration of D34 (a fixed capability,
 *   D57 (1)), whatever the matrix values: it never comes from `settings` (SE-03).
 * - A matrix role whose `settings` value is on: also the operational settings of D35 (places,
 *   reasons with the "טופל" text, call types, template labels). "משתמשים והרשאות" stays
 *   Creator-only (the matrix is Creator-only, D33). "טכנאים" and "מיילים והתראות" are not D35
 *   operational settings: deny by default until the owner says otherwise (the Manager manages
 *   technician accounts on "משתמשים", D34).
 * - Otherwise none (Customer Service by default: `settings` off, SE-03).
 */
export function settingsTabsOffered(role: OfficeRole, permissions: RolePermissions): readonly SettingsSection[] {
  if (role === "creator") return CREATOR_SETTINGS_SECTIONS;
  const tabs: SettingsSection[] = [];
  // D34 fixed capability (D57 (1)); never `settings` (SE-03).
  if (accountAdminScope(role) === "cs-tech") tabs.push("accounts");
  if (offers(permissions, "settings")) tabs.push("places", "reasons", "types", "template");
  return tabs;
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
 * `dashGen`, otherwise the work queue ("בית"). Display only (G-04). Since D57 the Manager and the
 * Creator land on "דשבורד" instead (officeLanding); this rule names Customer Service's home.
 */
export const officeHomeLabel = (permissions: RolePermissions): string => (offers(permissions, "dashGen") ? "לוח בקרה" : "בית");

/** A sidebar link. Structurally an OfficeSidebar `OfficeNavItem` with a required `href`. */
export type OfficeNavLink = { key: OfficeNavKey; label: string; href: string };

/**
 * The addresses of the sidebar items, supplied by the caller (the demo's `/dev/demo/office/<role>/…`
 * routes, later the real `/office/…` routes). An item without an address is not listed, so the
 * real navigation shows only screens that are built (Step 2 plan §3.5, Q18).
 */
export type OfficeNavHrefs = Partial<Readonly<Record<Exclude<OfficeNavKey, "settings">, string>>> & {
  /** The first Settings tab the role is offered. */
  settings?: (tab: SettingsSection) => string;
};

/**
 * D57: office roles whose sidebar and home are unchanged (customers, work queues, review items and
 * products in the sidebar; home "בית"/"לוח בקרה"). D57 changes the Manager and the Creator only.
 */
export const SIDEBAR_WORK_SCREEN_ROLES: readonly OfficeRole[] = ["cs"];
const keepsWorkScreens = (role: OfficeRole): boolean => SIDEBAR_WORK_SCREEN_ROLES.includes(role);

/**
 * D57 (1): the role's landing item, from one rule for the sidebar's first item, the office home
 * route and every "חזרה ל…" link (label and address always agree).
 * - Manager/Creator: "דשבורד" when any dashboard tab is offered and the caller has its address;
 *   otherwise "בית" (never "לוח בקרה", D57 (1)).
 * - Customer Service: today's rule, unchanged ("לוח בקרה" with `dashGen`, else "בית").
 * Display only (G-04): each page checks what it offers itself.
 */
export function officeLanding(role: OfficeRole, permissions: RolePermissions, hrefs: OfficeNavHrefs): OfficeNavLink | null {
  if (!keepsWorkScreens(role) && offersAnyDashboard(permissions) && hrefs.analytics !== undefined) {
    return { key: "analytics", label: "דשבורד", href: hrefs.analytics };
  }
  if (hrefs.home === undefined) return null;
  return { key: "home", label: keepsWorkScreens(role) ? officeHomeLabel(permissions) : "בית", href: hrefs.home };
}

/**
 * Office sidebar items, from the role's permission values. Display only: it hides menu items, it
 * does not protect routes (G-04): each page checks what it offers itself.
 * - Manager and Creator (D57 (1)): exactly "דשבורד" (the landing, officeLanding; "בית" without any
 *   dashboard tab), "יומן טכנאים" (with `cal`), "קריאות", "זימונים שלא נקלטו" (the TEMPORARY #15
 *   rule, workQueueScreensOffered) and "הגדרות". "לקוחות", "חזרו מהשטח", "פריטים לבדיקה" and
 *   "מוצרים" leave the sidebar: their routes stay, reached from the "מסכים נוספים" row on
 *   "קריאות" (callsAreaLinks). "משתמשים" is the Settings tab "accounts" (D34), not an item.
 * - Customer Service (SIDEBAR_WORK_SCREEN_ROLES): unchanged by D57: the demo's NAV order (L724-730)
 *   with the spec's new screens (OF-02): "לקוחות" with `calls`; "זימונים שלא נקלטו" and "חזרו
 *   מהשטח" (#15); "פריטים לבדיקה" (D39, D44) with `conflicts` and `card`; "דשבורד" with any
 *   dashboard key; "מוצרים" with `products`.
 * - "הגדרות": where settingsTabsOffered() offers a tab (the Creator always; the Manager always,
 *   for "משתמשים", D34; Customer Service only with `settings`), linking to the first offered tab.
 * - The mock outbox (X-06) is a /dev developer tool, never a sidebar item. "מדדי שימוש" is never in
 *   the menu (OF-15 PENDING d13: the usage screen is not built). No role has a "משתמשים" item.
 */
export function officeNav(role: OfficeRole, permissions: RolePermissions, hrefs: OfficeNavHrefs): OfficeNavLink[] {
  const items: OfficeNavLink[] = [];
  const add = (key: Exclude<OfficeNavKey, "settings">, label: string) => {
    const href = hrefs[key];
    if (href !== undefined) items.push({ key, label, href });
  };
  if (keepsWorkScreens(role)) {
    // D57 does not change Customer Service.
    add("home", officeHomeLabel(permissions));
    if (offers(permissions, "cal")) add("cal", "יומן טכנאים");
    add("calls", "קריאות");
    if (customersOffered(permissions)) add("customers", "לקוחות");
    if (workQueueScreensOffered(role)) {
      add("unparsed", "זימונים שלא נקלטו");
      add("back", "חזרו מהשטח");
    }
    if (reviewItemsOffered(permissions)) add("review", "פריטים לבדיקה");
    if (offersAnyDashboard(permissions)) add("analytics", "דשבורד");
    if (productsOffered(permissions)) add("products", "מוצרים");
  } else {
    const landing = officeLanding(role, permissions, hrefs);
    if (landing) items.push(landing);
    if (offers(permissions, "cal")) add("cal", "יומן טכנאים");
    add("calls", "קריאות");
    if (workQueueScreensOffered(role)) add("unparsed", "זימונים שלא נקלטו");
  }
  const tabs = settingsTabsOffered(role, permissions);
  if (tabs[0] && hrefs.settings) items.push({ key: "settings", label: "הגדרות", href: hrefs.settings(tabs[0]) });
  return items;
}

/** A screen reached from the "מסכים נוספים" row on "קריאות" (D57). */
export type CallsAreaLink = { key: "customers" | "back" | "review" | "products"; label: string; href: string };

/**
 * D57 (1)-(2): the screens a role is offered that are not in its sidebar, for the unobtrusive
 * "מסכים נוספים" row on "קריאות" (no counts, TEMPORARY #26 (b)), in the order לקוחות, חזרו מהשטח,
 * פריטים לבדיקה, מוצרים. Each follows its own rule (customersOffered, the #15 rule,
 * reviewItemsOffered, productsOffered). Empty for Customer Service (they are in its sidebar). A
 * screen without an address is skipped. Display only (G-04): each page checks what it offers.
 */
export function callsAreaLinks(role: OfficeRole, permissions: RolePermissions, hrefs: OfficeNavHrefs): CallsAreaLink[] {
  if (keepsWorkScreens(role)) return [];
  const links: CallsAreaLink[] = [];
  const add = (key: CallsAreaLink["key"], label: string) => {
    const href = hrefs[key];
    if (href !== undefined) links.push({ key, label, href });
  };
  if (customersOffered(permissions)) add("customers", "לקוחות");
  if (workQueueScreensOffered(role)) add("back", "חזרו מהשטח");
  if (reviewItemsOffered(permissions)) add("review", "פריטים לבדיקה");
  if (productsOffered(permissions)) add("products", "מוצרים");
  return links;
}

/**
 * The sidebar item that stands for a screen without its own item (highlighting only, never
 * access; D57): for Manager and Creator, the screens of the "מסכים נוספים" row belong to
 * "קריאות", and the former "משתמשים" address to "הגדרות". Null for Customer Service (every screen
 * has its own item, unchanged) and for keys that are items themselves.
 */
export function officeNavParent(role: OfficeRole, key: OfficeNavKey): OfficeNavKey | null {
  if (keepsWorkScreens(role)) return null;
  switch (key) {
    case "customers":
    case "back":
    case "review":
    case "products":
      return "calls";
    case "users":
      return "settings";
    default:
      return null;
  }
}
