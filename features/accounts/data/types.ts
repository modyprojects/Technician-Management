// Account-administration DTOs (demo setUsers() L942-946, as changed by demo-deviations SE-01 and
// D34): user accounts and the Manager's account requests that the Creator decides. Pure types,
// enums and product copy (no data). See features/data-access/common.ts.
// D34: only the Creator manages Manager and Creator accounts. A Manager manages Customer Service
// and Technician accounts: Customer Service creation, activation, reactivation and role changes
// wait for the Creator's approval (requests below); deactivation is immediate (audited, the
// Creator is notified in the app); Technician creation, activation and reactivation are
// immediate. Managers never set or reset passwords and never change an account's email. No public
// sign-up (D50). Account administration is a fixed capability, never a matrix key (D33, SE-03).
import type { IsoTimestamp, PageRequest, TestMarker } from "@/features/data-access/common";
import type { TechnicianColorToken, TechnicianId } from "@/features/reference/data/types";

/** Account id (a profile id in production). */
export type AccountId = string;

/** Every account role: the office roles and the technician. */
export const ACCOUNT_ROLE_VALUES = ["creator", "mgr", "cs", "tech"] as const;
export type AccountRole = (typeof ACCOUNT_ROLE_VALUES)[number];

export const isAccountRole = (value: unknown): value is AccountRole =>
  typeof value === "string" && (ACCOUNT_ROLE_VALUES as readonly string[]).includes(value);

/** Role pill text (demo ROLE[r].short). */
export const ACCOUNT_ROLE_LABELS: Readonly<Record<AccountRole, string>> = {
  creator: "יוצר",
  mgr: "מנהל",
  cs: "שירות לקוחות",
  tech: "טכנאי",
};

/**
 * A user account. Test users show the 🧪 badge wherever they are listed or opened (SIM-18, D47).
 * Display only: no password or credential data ever reaches a DTO.
 */
export type UserAccount = TestMarker & {
  id: AccountId;
  name: string;
  role: AccountRole;
  /** Sign-in email (example.test in the demo). Only the Creator changes it (D34 e). */
  email: string;
  /** Work phone. */
  phone: string;
  /** Deactivated accounts cannot sign in (D34). */
  active: boolean;
  /** Last sign-in; null when the account never signed in. The screen formats it. */
  lastSignInAt: IsoTimestamp | null;
  /** The technician record of a "tech" account; null for office accounts. */
  technicianId: TechnicianId | null;
};

/** What other DTOs carry about an account. */
export type AccountRef = Pick<UserAccount, "id" | "name">;

/** Kinds of Manager-initiated Customer Service requests (D34 a). */
export const ACCOUNT_REQUEST_KINDS = ["create", "activate", "reactivate", "role-change"] as const;
export type AccountRequestKind = (typeof ACCOUNT_REQUEST_KINDS)[number];

export const ACCOUNT_REQUEST_KIND_LABELS: Readonly<Record<AccountRequestKind, string>> = {
  create: "יצירת חשבון",
  activate: "הפעלת חשבון",
  reactivate: "הפעלה מחדש",
  "role-change": "שינוי תפקיד",
};

/** D34: no automatic expiry (D25); nothing changes while pending. */
export const ACCOUNT_REQUEST_STATUSES = ["pending", "approved", "rejected", "cancelled"] as const;
export type AccountRequestStatus = (typeof ACCOUNT_REQUEST_STATUSES)[number];

export const isAccountRequestStatus = (value: unknown): value is AccountRequestStatus =>
  typeof value === "string" && (ACCOUNT_REQUEST_STATUSES as readonly string[]).includes(value);

export const ACCOUNT_REQUEST_STATUS_LABELS: Readonly<Record<AccountRequestStatus, string>> = {
  pending: "ממתינה לאישור היוצר",
  approved: "אושרה",
  rejected: "נדחתה",
  cancelled: "בוטלה",
};

export type AccountRequestId = string;

/** A Manager's request that the Creator approves or rejects (D34 a). Every step is audited. */
export type AccountRequest = TestMarker & {
  id: AccountRequestId;
  kind: AccountRequestKind;
  /** The existing account; null for "create" (no account exists until approval). */
  account: AccountRef | null;
  /** Who the request is about: name, email and role (requested for "create", current otherwise). */
  target: { name: string; email: string; role: AccountRole };
  /** "role-change" only: the requested role. */
  newRole: AccountRole | null;
  requestedBy: AccountRef;
  requestedAt: IsoTimestamp;
  status: AccountRequestStatus;
  /** The rejection reason (stored with every rejection, D34); null otherwise. */
  reason: string | null;
  /** The Creator (approved, rejected) or whoever cancelled; null while pending. */
  decidedBy: AccountRef | null;
  decidedAt: IsoTimestamp | null;
};

/** Accounts list query: optional role filter, paged (default 40, at most 100). */
export type AccountListQuery = PageRequest & { roles?: readonly AccountRole[] };

/** Requests list query: optional status filter, newest first, paged (default 40, at most 100). */
export type AccountRequestQuery = PageRequest & { statuses?: readonly AccountRequestStatus[] };

// ---------------------------------------------------------------------------------------------
// Command inputs

/** Roles a Manager's request may name: Customer Service and Technician only (never Manager or Creator, D34). */
export const MANAGER_REQUESTABLE_ROLES: readonly AccountRole[] = ["cs", "tech"];

/** A Manager's Customer Service request (D34 a). */
export type AccountRequestInput =
  | { kind: "create"; name: string; email: string; phone: string }
  | { kind: "activate" | "reactivate"; accountId: AccountId }
  | { kind: "role-change"; accountId: AccountId; newRole: AccountRole };

/** The Creator's decision. A rejection always stores a reason (D34). */
export type AccountDecision = { outcome: "approve" } | { outcome: "reject"; reason: string };

/** "+ הוספת משתמש" by the Creator: any role, immediate (D34). Initial credentials are issued by the Creator (D50). */
export type NewAccountInput = { name: string; email: string; phone: string; role: AccountRole };

/** "+ הוספת טכנאי": immediate for the Manager and the Creator (D34 c). */
export type NewTechnicianInput = {
  name: string;
  /** Sign-in email, also the Outlook attendee address that matches invitations (SE-05). */
  email: string;
  phone: string;
  /** An allowlisted colour token, never CSS. */
  color: TechnicianColorToken;
  /** "סמארטפון". */
  device: string;
};
