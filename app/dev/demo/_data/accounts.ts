// FICTITIOUS DATA ONLY: the demo's user accounts and account requests (docs/demo.html USERS
// L294-299 and setUsers(), as changed by demo-deviations SE-01 and D34). Allowed only under
// app/dev (G-05). Server-side, and only for the fixture adapter: screens read them through
// demoDataAccess.accounts (eslint.config.mjs blocks direct imports).
// Every person, email (example.test) and phone is fictional; every record is test data (D47,
// SIM-18). Times are ISO timestamps (Israel summer time, +03:00); screens format them.
import "server-only";
import type { AccountRequestKind, AccountRequestStatus, AccountRole, NewAccountRole } from "@/features/accounts/data/types";
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
  /**
   * The stored version (profiles.version): 1 for an account never changed since its creation, 2 for
   * the two deactivated ones, 3 for שיראל (ACCOUNT_VERSION). Not all 1, so nothing can hard-code it.
   */
  version: number;
};

const ACCOUNT_ID: Record<string, string> = {
  "משתמש יוצר": "acc-creator",
  דורון: "acc-doron",
  שיראל: "acc-shirel",
  הדס: "acc-rep2",
};

/**
 * Stored versions above 1 among the active office accounts: שיראל's profile had two routine updates
 * (D34 d), so an action on her row must send 3 (a screen that sent 1 would get PT409).
 */
const ACCOUNT_VERSION: Readonly<Record<string, number>> = { "acc-shirel": 3 };

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
  ...USERS.map((u) => {
    const id = ACCOUNT_ID[u.name] ?? `acc-${u.email.split("@")[0]}`;
    return {
      id,
      name: u.name,
      role: u.role,
      email: u.email,
      phone: u.phone,
      active: true,
      deactivatedAt: null,
      technicianId: null,
      version: ACCOUNT_VERSION[id] ?? 1,
    };
  }),
  ...TECHS.map((t) => ({
    id: `acc-tech-${t.id}`,
    name: t.name,
    role: "tech" as const,
    email: t.email,
    phone: t.phone,
    active: true,
    deactivatedAt: null,
    technicianId: t.id,
    version: 1,
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
    version: 2,
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
    version: 1,
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
    version: 2,
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
  /**
   * The stored version (account_requests.version): 1 while pending (Migration 1 never updates a
   * pending request); 2 once decided or cancelled; 3 once an approved creation is fulfilled
   * (admin_create_profile binds the account) or cancelled after approval.
   */
  version: number;
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
    version: 1,
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
    version: 1,
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
    version: 2,
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
    version: 2,
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
    // Approved (2), then fulfilled: admin_create_profile bound הדס's account to it (3).
    version: 3,
  },
];

/**
 * Fictional stand-ins for the audit rows that the Creator's notices read (D34 b and f; Step 2 plan
 * §3.10): a Manager's deactivations (`profile.deactivated` with `actor_role` manager) and a
 * technician's Outlook-email change (`technician.outlook_email_changed`, which records no email).
 * They match the accounts above: אורית and בני were deactivated by דורון at their `deactivatedAt`.
 */
export type DemoAccountEvent = {
  id: string;
  kind: "manager-deactivation" | "outlook-email-change";
  at: string;
  actorId: string;
  targetAccountId: string;
};

export const ACCOUNT_EVENTS: readonly DemoAccountEvent[] = [
  { id: "aev-1", kind: "manager-deactivation", at: "2026-09-01T09:00:00+03:00", actorId: "acc-doron", targetAccountId: "acc-orit" },
  { id: "aev-2", kind: "manager-deactivation", at: "2026-08-14T16:30:00+03:00", actorId: "acc-doron", targetAccountId: "acc-beni" },
  // A change by the Manager: the database allows it (Migration 1 admin_update_technician), but while
  // Step 2 plan Q14 is open the app keeps the Outlook email for the Creator (TEMPORARY), so the app
  // itself never makes this change. PR 2.3 labels such a notice in the card, or changes this
  // fixture with the owner's Q14 answer.
  { id: "aev-3", kind: "outlook-email-change", at: "2026-10-18T10:15:00+03:00", actorId: "acc-doron", targetAccountId: "acc-tech-e" },
];

/**
 * Open creation intents (Migration 1 `direct_create`, approved, no account bound yet): direct
 * creations whose Auth step did not finish (Step 2 plan §3.8). Never listed as requests; each is
 * shown only to its requester (PR 2.3 "יצירה שלא הושלמה"). A Manager's intent names a Technician
 * only (D34 c); the Creator's may name a Manager.
 */
export type DemoCreationIntent = {
  id: string;
  role: NewAccountRole;
  name: string;
  email: string;
  requestedBy: string;
  authorizedAt: string;
  version: number;
};

export const CREATION_INTENTS: readonly DemoCreationIntent[] = [
  {
    id: "aint-1",
    role: "tech",
    name: "טכנאי חדש",
    email: "tech-new@example.test",
    requestedBy: "acc-doron",
    authorizedAt: "2026-10-22T09:05:00+03:00",
    version: 1,
  },
  {
    id: "aint-2",
    role: "mgr",
    name: "מנהלת משמרת",
    email: "shift-mgr@example.test",
    requestedBy: "acc-creator",
    authorizedAt: "2026-10-23T13:40:00+03:00",
    version: 1,
  },
];
