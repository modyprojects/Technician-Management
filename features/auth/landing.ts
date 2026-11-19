// Where each role lands after signing in (Step 2 PR 2.5). Pure: no I/O.
//
// Sources: D57 (1): "דשבורד" is the Manager's default landing page, and the Creator gets the
// corresponding structure; QA corrections 01 (D60, D62) S-01: for Customer Service "בית" is removed
// and the default screen is "קריאות" (docs/qa-corrections-01-integration.md, Step 2 "role landing").
//
// TEMPORARY until "דשבורד" is built (Step 2 plan Q18; AU-03 PROPOSED): `/office` shows the temporary
// start card under that item's title for the Manager and the Creator. "קריאות" is built, so `/office`
// sends Customer Service there (OFFICE_CALLS_PATH).
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

/** "קריאות" (V1 item 4; D57 (1), D60 (4)): the calls list; Customer Service's landing (QA S-01). */
export const OFFICE_CALLS_PATH = "/office/calls";

/** "יומן טכנאים" (D88 office module 2; D60 (4)): the office technician calendar. */
export const OFFICE_CALENDAR_PATH = "/office/calendar";

/** The call card of one request number (the card itself is the next screen; a temporary page until then). */
export const officeCallPath = (req: string): string => `${OFFICE_CALLS_PATH}/${encodeURIComponent(req)}`;

/**
 * "זימונים שלא נקלטו" (QA S-05; D57 (1), D60 (4)): the unparsed invitations and, where the simulator
 * is switched on, the Outlook invitation simulator (D60 (11)).
 */
export const OFFICE_UNPARSED_PATH = "/office/unparsed";

/** A real office navigation item (OfficeSidebar), with its real address. */
export type RealOfficeNavItem = { key: "analytics" | "cal" | "calls" | "unparsed" | "settings"; label: string; href: string };

/**
 * The real office navigation (TEMPORARY, Step 2 plan Q18: only screens that are built are listed),
 * in the order of D57 (1) and D60 (4): the role's landing item ("דשבורד" for the Manager and the
 * Creator, still the temporary start card; "קריאות" for Customer Service, QA S-01), "קריאות" for the
 * Manager and the Creator, "זימונים שלא נקלטו" for every office role (the TEMPORARY #15 rule,
 * features/auth/roles.ts workQueueScreensOffered), then "הגדרות" for the Manager and the Creator
 * (D57 (1): the Manager's Settings opens "משתמשים", a fixed capability, never the matrix key
 * `settings`, SE-03). Customer Service has "קריאות" and "זימונים שלא נקלטו" ("יומן טכנאים" is not
 * built yet; QA S-01, S-04, S-05) and no Settings. Anything that is no office role gets nothing (deny
 * by default). Display only (G-04): every page checks the session and the role itself (the calls
 * list also checks the matrix key `calls` on the server).
 */
export function realOfficeNav(role: unknown): RealOfficeNavItem[] {
  const start = officeStartItem(role);
  if (!start) return [];
  const items: RealOfficeNavItem[] = [];
  if (start.key !== "calls") items.push({ key: start.key, label: start.label, href: OFFICE_START_PATH });
  items.push({ key: "cal", label: "יומן טכנאים", href: OFFICE_CALENDAR_PATH });
  items.push({ key: "calls", label: "קריאות", href: OFFICE_CALLS_PATH });
  items.push({ key: "unparsed", label: "זימונים שלא נקלטו", href: OFFICE_UNPARSED_PATH });
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
