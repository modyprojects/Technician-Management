// Pure rules of the real unified user management (D60 (7)): what the page hands the screen, and the
// result lines the screen shows. No hooks, no I/O (precedent: AccountAdminRules.ts).
// - userManagementRowOf: one list entry (features/accounts/supabase/queries.ts, read under the
//   viewer's own session) as the screen's row: the account, and for a Technician with a field
//   profile the details the edit form shows. The Outlook email and "פעיל" are carried only when the
//   entry has them (the Creator's view; the query gives a Manager null for both, Q14), so a
//   Manager's payload never holds them.
// - The success lines name the account; refusals are the server's Hebrew messages, shown as they
//   are (never a database or Auth text: lib/actions/accounts.ts).
import type { AccountAdminScope } from "@/features/accounts/data/offers";
import { ACCOUNT_ROLE_LABELS, type AccountListEntry, type NewAccountRole, type UserAccount } from "@/features/accounts/data/types";
import type { AccountTechnicianDetails } from "./AccountAdminParts";

/** One row of the screen. */
export type UserManagementRow = { account: UserAccount; technician: AccountTechnicianDetails | null };

/** The screen's row of a list entry (see above). */
export function userManagementRowOf(entry: AccountListEntry): UserManagementRow {
  const { technician: t, ...account } = entry;
  if (!t) return { account, technician: null };
  const technician: AccountTechnicianDetails = {
    id: t.id,
    name: t.name,
    color: t.color,
    device: t.device,
    version: t.version,
    isTest: t.isTest,
    ...(typeof t.outlookEmail === "string" ? { outlookEmail: t.outlookEmail } : {}),
    ...(typeof t.active === "boolean" ? { active: t.active } : {}),
  };
  return { account, technician };
}

/** The screen's title per scope (D57 (1): the Manager's "משתמשים"; the Creator's "משתמשים והרשאות"). */
export const USER_MANAGEMENT_TITLES: Readonly<Record<AccountAdminScope, string>> = {
  all: "משתמשים והרשאות",
  "cs-tech": "משתמשים",
};

/** The card's sub-line per scope. */
export const USER_MANAGEMENT_SUBS: Readonly<Record<AccountAdminScope, string>> = {
  all: "כל המשתמשים בכל התפקידים: טכנאים, שירות לקוחות, מנהלים ויוצר",
  "cs-tech": "טכנאים ונציגי שירות לקוחות",
};

/** The created line: who was created, and how he gets his first password (TEMPORARY, Step 2 plan Q1). */
export function createdLine(name: string, role: NewAccountRole, scope: AccountAdminScope): string {
  const who = `${ACCOUNT_ROLE_LABELS[role]} ${name}`;
  return scope === "all"
    ? `המשתמש ${who} נוצר. כדי שיוכל להיכנס, קבעו לו סיסמה ב"סיסמה".`
    : `המשתמש ${who} נוצר. עד שהיוצר יקבע לו סיסמה הוא לא יוכל להיכנס.`;
}

/** The deactivation line; a Manager's deactivation is also a notice to the Creator (D34 b). */
export const deactivatedLine = (name: string, scope: AccountAdminScope): string =>
  `החשבון של ${name} הושבת ונרשם ביומן הביקורת${scope === "cs-tech" ? ", והיוצר קיבל התראה באפליקציה" : ""}.`;

export const activatedLine = (name: string): string => `החשבון של ${name} הופעל.`;
export const roleChangedLine = (name: string, role: NewAccountRole): string => `התפקיד של ${name} שונה ל${ACCOUNT_ROLE_LABELS[role]}.`;
export const deletedLine = (name: string): string => `החשבון של ${name} נמחק. ההתחברות חסומה וההיסטוריה שלו נשמרת.`;
export const passwordLine = (name: string): string => `הסיסמה של ${name} נקבעה. היא לא תוצג שוב.`;
export const emailLine = (name: string): string => `כתובת המייל לכניסה של ${name} עודכנה.`;
export const editedLine = (name: string): string => `הפרטים של ${name} עודכנו ונרשמו ביומן הביקורת.`;
export const intentCompletedLine = (name: string): string => `החשבון של ${name} נוצר.`;
export const intentCancelledLine = (name: string): string => `היצירה של ${name} בוטלה.`;
export const technicianCompletedLine = (name: string): string => `פרופיל הטכנאי של ${name} נוצר.`;
