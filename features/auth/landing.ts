// Where each role lands after signing in (Step 2 PR 2.5). Pure: no I/O.
//
// Sources: D57 (1): "דשבורד" is the Manager's default landing page, and the Creator gets the
// corresponding structure; QA corrections 01 (D60, D62) S-01: for Customer Service "בית" is removed
// and the default screen is "קריאות" (docs/qa-corrections-01-integration.md, Step 2 "role landing").
//
// TEMPORARY until those screens are built (Step 2 plan Q18; AU-03 PROPOSED): the landing item is
// the only item of the real office navigation, and `/office` shows the temporary start card under
// that item's title. When "דשבורד" and "קריאות" are built, `/office` sends each role to its screen.
// Display only (G-04): every page checks the session and the role itself.
import { isOfficeRole, type OfficeRole } from "@/features/reference/data/types";

export type OfficeStartItem = { key: "analytics" | "calls"; label: "דשבורד" | "קריאות" };

const OFFICE_START: ReadonlyMap<OfficeRole, OfficeStartItem> = new Map([
  ["creator", { key: "analytics", label: "דשבורד" }],
  ["mgr", { key: "analytics", label: "דשבורד" }],
  ["cs", { key: "calls", label: "קריאות" }],
]);

/** The office role's landing item; null for anything that is no office role (deny by default). */
export function officeStartItem(role: unknown): OfficeStartItem | null {
  return isOfficeRole(role) ? (OFFICE_START.get(role) ?? null) : null;
}

/** The real addresses of the start screens (Step 2 PR 2.5). */
export const OFFICE_START_PATH = "/office";
export const TECH_START_PATH = "/tech";
export const TECH_PROFILE_PATH = "/tech/profile";

/**
 * Settings (D57 (1), D60 (8)): `/office/settings` opens the role's first built tab. The user
 * management (D60 (7)) is one screen for both roles: the Manager's "משתמשים" and the Creator's
 * "משתמשים והרשאות".
 */
export const OFFICE_SETTINGS_PATH = "/office/settings";
export const OFFICE_SETTINGS_USERS_PATH = "/office/settings/users";

/** A real office navigation item (OfficeSidebar), with its real address. */
export type RealOfficeNavItem = { key: "analytics" | "calls" | "settings"; label: string; href: string };

/**
 * The real office navigation (TEMPORARY, Step 2 plan Q18: only screens that are built are listed):
 * the role's landing item, then "הגדרות" for the Manager and the Creator (D57 (1): the Manager's
 * Settings opens "משתמשים", a fixed capability, never the matrix key `settings`, SE-03). Customer
 * Service keeps "קריאות" only (QA S-01; D60 (4): its other items are not built yet) and has no
 * Settings. Anything that is no office role gets nothing (deny by default). Display only (G-04):
 * every page checks the session and the role itself.
 */
export function realOfficeNav(role: unknown): RealOfficeNavItem[] {
  const start = officeStartItem(role);
  if (!start) return [];
  const items: RealOfficeNavItem[] = [{ key: start.key, label: start.label, href: OFFICE_START_PATH }];
  if (role === "creator" || role === "mgr") items.push({ key: "settings", label: "הגדרות", href: OFFICE_SETTINGS_USERS_PATH });
  return items;
}

/** The avatar colour of the office sidebar's user block per office role (the demo's colours). */
const OFFICE_AVATAR: ReadonlyMap<OfficeRole, string> = new Map([
  ["creator", "var(--ink)"],
  ["mgr", "var(--accent)"],
  ["cs", "var(--s-work)"],
]);

export function officeAvatarColor(role: OfficeRole): string {
  return OFFICE_AVATAR.get(role) ?? "var(--ink)";
}
