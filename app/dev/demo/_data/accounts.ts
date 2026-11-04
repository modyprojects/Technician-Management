// FICTITIOUS DATA ONLY: the demo's user accounts and account requests (docs/demo.html USERS
// L294-299 and setUsers(), as changed by demo-deviations SE-01 and D34). Allowed only under
// app/dev (G-05). Server-side, and only for the fixture adapter: screens read them through
// demoDataAccess.accounts (eslint.config.mjs blocks direct imports).
// Every person, email (example.test) and phone is fictional; every record is test data (D47,
// SIM-18). Times are ISO timestamps (Israel summer time, +03:00); screens format them.
import "server-only";
import type { AccountRequestKind, AccountRequestStatus, AccountRole } from "@/features/accounts/data/types";
import { TECHS, USERS } from "./reference";
import type { TechId } from "./types";

export type DemoAccount = {
  id: string;
  name: string;
  role: AccountRole;
  email: string;
  phone: string;
  active: boolean;
  /** When the account was last deactivated (null: active, or never activated). */
  deactivatedAt: string | null;
  /** The technician record; null for office accounts and for the former technician below. */
  technicianId: TechId | null;
};

const ACCOUNT_ID: Record<string, string> = {
  "משתמש יוצר": "acc-creator",
  דורון: "acc-doron",
  שיראל: "acc-shirel",
  הדס: "acc-rep2",
};

/**
 * The office users (USERS), the technicians' accounts (TECHS) and three inactive accounts that
 * show every D34 activation path in the Manager's scope:
 * - אורית: a deactivated Customer Service account whose reactivation request waits (areq-2);
 * - רונית: a Customer Service account created inactive and never activated, with no request: the
 *   Manager offers "בקשת הפעלת חשבון" (D34 a);
 * - בני: a deactivated Technician account: the Manager reactivates it at once (D34 c). The demo's
 *   three technicians are all active, so this former technician has no technician record here.
 */
export const ACCOUNTS: readonly DemoAccount[] = [
  ...USERS.map((u) => ({
    id: ACCOUNT_ID[u.name] ?? `acc-${u.email.split("@")[0]}`,
    name: u.name,
    role: u.role,
    email: u.email,
    phone: u.phone,
    active: true,
    deactivatedAt: null,
    technicianId: null,
  })),
  ...TECHS.map((t) => ({
    id: `acc-tech-${t.id}`,
    name: t.name,
    role: "tech" as const,
    email: t.email,
    phone: t.phone,
    active: true,
    deactivatedAt: null,
    technicianId: t.id,
  })),
  // Deactivated by the Manager (D34 b); a reactivation request waits for the Creator (below).
  {
    id: "acc-orit",
    name: "אורית",
    role: "cs",
    email: "orit@example.test",
    phone: "050-000-0104",
    active: false,
    deactivatedAt: "2026-09-01T09:00:00+03:00",
    technicianId: null,
  },
  // Created inactive ahead of a start date, not activated yet; no request.
  {
    id: "acc-ronit",
    name: "רונית",
    role: "cs",
    email: "ronit@example.test",
    phone: "050-000-0105",
    active: false,
    deactivatedAt: null,
    technicianId: null,
  },
  // A former technician, deactivated by the Manager.
  {
    id: "acc-beni",
    name: "בני",
    role: "tech",
    email: "beni@example.test",
    phone: "050-000-0106",
    active: false,
    deactivatedAt: "2026-08-14T16:30:00+03:00",
    technicianId: null,
  },
];

export const accountById = (id: string): DemoAccount | undefined => ACCOUNTS.find((a) => a.id === id);

export type DemoAccountRequest = {
  id: string;
  kind: AccountRequestKind;
  /** The existing account (for "create": the account created on approval, if any). */
  accountId: string | null;
  target: { name: string; email: string; role: AccountRole };
  newRole: AccountRole | null;
  requestedBy: string;
  requestedAt: string;
  status: AccountRequestStatus;
  reason: string | null;
  decidedBy: string | null;
  decidedAt: string | null;
};

/** The Manager's Customer Service requests (D34 a), one per status. */
export const ACCOUNT_REQUESTS: readonly DemoAccountRequest[] = [
  {
    id: "areq-1",
    kind: "create",
    accountId: null,
    target: { name: "נציגה 3", email: "rep3@example.test", role: "cs" },
    newRole: null,
    requestedBy: "acc-doron",
    requestedAt: "2026-10-20T11:30:00+03:00",
    status: "pending",
    reason: null,
    decidedBy: null,
    decidedAt: null,
  },
  {
    id: "areq-2",
    kind: "reactivate",
    accountId: "acc-orit",
    target: { name: "אורית", email: "orit@example.test", role: "cs" },
    newRole: null,
    requestedBy: "acc-doron",
    requestedAt: "2026-10-21T08:45:00+03:00",
    status: "pending",
    reason: null,
    decidedBy: null,
    decidedAt: null,
  },
  {
    id: "areq-3",
    kind: "role-change",
    accountId: "acc-tech-s",
    target: { name: "שמואל", email: "shmuel@example.test", role: "tech" },
    newRole: "cs",
    requestedBy: "acc-doron",
    requestedAt: "2026-10-12T14:05:00+03:00",
    status: "rejected",
    reason: "שמואל ממשיך לעבוד כטכנאי. אם יידרש, ייפתח חשבון שירות לקוחות נפרד.",
    decidedBy: "acc-creator",
    decidedAt: "2026-10-12T16:40:00+03:00",
  },
  {
    id: "areq-4",
    kind: "create",
    accountId: null,
    target: { name: "נציג זמני", email: "temp-rep@example.test", role: "cs" },
    newRole: null,
    requestedBy: "acc-doron",
    requestedAt: "2026-10-05T09:10:00+03:00",
    status: "cancelled",
    reason: null,
    decidedBy: "acc-doron",
    decidedAt: "2026-10-06T08:30:00+03:00",
  },
  {
    id: "areq-5",
    kind: "create",
    accountId: "acc-rep2",
    target: { name: "הדס", email: "rep2@example.test", role: "cs" },
    newRole: null,
    requestedBy: "acc-doron",
    requestedAt: "2026-09-14T10:00:00+03:00",
    status: "approved",
    reason: null,
    decidedBy: "acc-creator",
    decidedAt: "2026-09-14T12:20:00+03:00",
  },
];
