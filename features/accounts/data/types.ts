// Account-administration DTOs (demo setUsers() L942-946, as changed by demo-deviations SE-01 and
// D34): user accounts and the Manager's account requests that the Creator decides. Pure types,
// enums and product copy (no data). See features/data-access/common.ts.
// D34: only the Creator manages Manager and Creator accounts. A Manager manages Customer Service
// and Technician accounts: Customer Service creation, activation, reactivation and role changes
// wait for the Creator's approval (requests below); deactivation is immediate (audited, the
// Creator is notified in the app); Technician creation, activation and reactivation are
// immediate. Managers never set or reset passwords and never change an account's email: only the
// Creator does (D34 e, D50). No public sign-up (D50). Account administration is a fixed
// capability, never a matrix key (D33, SE-03). Edits carry the version read (`expectedVersion`):
// every Migration 1 edit function refuses a stale one (PT409).
import type { IsoTimestamp, PageRequest, TestMarker } from "@/features/data-access/common";
import type { TechnicianColorToken, TechnicianId } from "@/features/reference/data/types";
import type { TechnicianSetting } from "@/features/settings/data/types";

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
 * Display only: no password or credential data ever reaches a DTO, and no sign-in activity (last
 * sign-in times belong with the usage screen, which waits for open decision d13: employee privacy).
 */
export type UserAccount = TestMarker & {
  id: AccountId;
  name: string;
  role: AccountRole;
  /** Sign-in email (example.test for test users). Only the Creator changes it (D34 e). */
  email: string;
  /** Work phone. */
  phone: string;
  /** Deactivated accounts cannot sign in (D34). */
  active: boolean;
  /**
   * When the account was last deactivated; null while it is active and for an account that was
   * never activated. Decides "הפעלה" (activate) vs "הפעלה מחדש" (reactivate): see activationKind().
   */
  deactivatedAt: IsoTimestamp | null;
  /** The technician record of a "tech" account; null for office accounts. */
  technicianId: TechnicianId | null;
  /**
   * An active Technician account without a field profile: an immediate creation whose last phase
   * (the technician record) failed (Step 2 plan §3.8 phase 4). PR 2.3 shows the row as "פרופיל טכנאי
   * חסר" with "השלמה". Always technicianProfileMissing() of the stored row.
   */
  technicianMissing: boolean;
  /**
   * The stored version (`profiles.version`). Every edit command sends it back as `expectedVersion`;
   * when the account changed in between, the command is refused with the "data changed" message
   * (PT409, ACTION_MESSAGES.stale). Never hard-coded: always the value read.
   */
  version: number;
};

/** An active Technician account with no technician record (UserAccount.technicianMissing). */
export const technicianProfileMissing = (account: Pick<UserAccount, "role" | "active" | "technicianId">): boolean =>
  account.role === "tech" && account.active && account.technicianId === null;

/** An inactive account's activation request kind: "reactivate" after a deactivation, otherwise "activate". */
export const activationKind = (account: Pick<UserAccount, "deactivatedAt">): "activate" | "reactivate" =>
  account.deactivatedAt ? "reactivate" : "activate";

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
  /**
   * The Creator (approved, rejected) or whoever cancelled a pending request; null while pending. An
   * approved creation that is cancelled later keeps its decider (the audit names who cancelled).
   */
  decidedBy: AccountRef | null;
  decidedAt: IsoTimestamp | null;
  /** The stored version (`account_requests.version`), sent back as `expectedVersion` (PT409 when it changed). */
  version: number;
};

/**
 * An approved "create" request whose account was not created yet (no account bound to it): its
 * requester or the Creator may still cancel it (Migration 1 `cancel_account_request`; the Creator
 * completes it in PR 2.3).
 */
export const isOpenCreation = (request: Pick<AccountRequest, "kind" | "status" | "account">): boolean =>
  request.kind === "create" && request.status === "approved" && request.account === null;

/** Accounts list query: optional role filter, paged (default 40, at most 100). */
export type AccountListQuery = PageRequest & { roles?: readonly AccountRole[] };

/** Requests list query: optional status filter, newest first, paged (default 40, at most 100). */
export type AccountRequestQuery = PageRequest & { statuses?: readonly AccountRequestStatus[] };

// ---------------------------------------------------------------------------------------------
// The Creator's account notices ("התראות חשבונות", D34 b and f; Step 2 plan §3.10). The card is PR
// 2.3; no read/unread state (that would need a table).

/**
 * - "pending-request": a Manager's request that waits for the Creator;
 * - "manager-deactivation": a Manager deactivated an account (D34 b);
 * - "outlook-email-change": someone other than the viewing Creator changed a technician's Outlook
 *   email (D34 f). The audit row holds no email, so neither does the notice.
 */
export const CREATOR_NOTICE_KINDS = ["pending-request", "manager-deactivation", "outlook-email-change"] as const;
export type CreatorNoticeKind = (typeof CREATOR_NOTICE_KINDS)[number];

export type CreatorNotice = TestMarker & {
  id: string;
  kind: CreatorNoticeKind;
  /** When it happened: the request's time, or the audited action's time. */
  at: IsoTimestamp;
  /** Who acted: the requesting Manager, the deactivating Manager, or who changed the email. */
  actor: AccountRef;
  /** The account it is about; `accountId` is null for a pending "create" (no account exists yet). */
  target: { accountId: AccountId | null; name: string; role: AccountRole };
  /** "pending-request" only: the request's kind; null otherwise. */
  requestKind: AccountRequestKind | null;
};

/**
 * A direct creation that was authorized but not completed (Migration 1 `direct_create`, approved,
 * no account bound yet): the requester's "יצירה שלא הושלמה" row (PR 2.3: "השלמת יצירה", "ביטול").
 * Never listed among the account requests.
 */
export type CreationIntent = TestMarker & {
  id: AccountRequestId;
  role: NewAccountRole;
  name: string;
  email: string;
  /** Who authorized it (only the requester sees his own intents; the demo loader filters by it). */
  requestedBy: AccountRef;
  authorizedAt: IsoTimestamp;
  version: number;
};

// ---------------------------------------------------------------------------------------------
// Command inputs

/** Roles a Manager's request may name: Customer Service and Technician only (never Manager or Creator, D34). */
export const MANAGER_REQUESTABLE_ROLES: readonly AccountRole[] = ["cs", "tech"];

/**
 * A Manager's Customer Service request (D34 a). The target of "activate", "reactivate" and
 * "role-change" must be a Customer Service account in the Manager's scope (role-change: Customer
 * Service or Technician); the input validator checks only the shape, so every implementation also
 * checks the target's CURRENT role against stored data (the server in the database, under the
 * caller's session): a Manager must never gain extra privileges (D34).
 */
export type AccountRequestInput =
  // No phone: a request stores no phone (Migration 1 `account_requests`); the Creator enters it when
  // completing the creation, or later as a routine update (D34 d).
  | { kind: "create"; name: string; email: string }
  | { kind: "activate" | "reactivate"; accountId: AccountId }
  | { kind: "role-change"; accountId: AccountId; newRole: AccountRole };

/** The Creator's decision. A rejection always stores a reason (D34). */
export type AccountDecision = { outcome: "approve" } | { outcome: "reject"; reason: string };

/** The Creator decides a pending request at the version he read (PT409 when it changed). */
export type AccountDecisionInput = { requestId: AccountRequestId; expectedVersion: number; decision: AccountDecision };

/** Cancels a request at the version read (see AccountCommands.cancelAccountRequest for who may). */
export type CancelAccountRequestInput = { requestId: AccountRequestId; expectedVersion: number };

/** An immediate deactivation or activation at the version read. */
export type AccountStateInput = { accountId: AccountId; expectedVersion: number };

/**
 * Roles an immediate creation may give (Migration 1 `authorize_account_creation`): Manager, Customer
 * Service and Technician. TEMPORARY (Step 2 plan Q9, PR 1.3 Q11): no Creator account is created
 * through the app until the owner decides; the form labels it "ממתין להחלטת בעלים" (D49).
 */
export const NEW_ACCOUNT_ROLES = ["mgr", "cs", "tech"] as const;
export type NewAccountRole = (typeof NEW_ACCOUNT_ROLES)[number];

export const isNewAccountRole = (value: unknown): value is NewAccountRole =>
  typeof value === "string" && (NEW_ACCOUNT_ROLES as readonly string[]).includes(value);

/**
 * "+ הוספת משתמש": immediate (D34). Technician, Customer Service and Manager; a Creator account is
 * pending the owner's decision (Q9). No password: the Creator sets the first one (D50; Q1).
 */
export type NewAccountInput = { name: string; email: string; phone: string; role: NewAccountRole };

/**
 * A routine profile update (D34 d): name, work phone and invitation alias, never the email. Patch
 * semantics: an omitted field is unchanged, `null` clears it. The Manager may update Technician and
 * Customer Service accounts other than his own; the Creator any account. The real adapter reads
 * the current row under the caller's session and fills the unchanged fields (the database function
 * replaces all of them).
 */
export type UpdateProfileInput = {
  accountId: AccountId;
  expectedVersion: number;
  name?: string;
  phone?: string | null;
  invitationAlias?: string | null;
};

/**
 * A routine technician update (D34 d, SE-05). Patch semantics as UpdateProfileInput. The Outlook
 * email and "פעיל" (`active`) are the Creator's only (TEMPORARY, Step 2 plan Q14): the database lets
 * a Manager change them; the app narrows it until the owner decides.
 */
export type UpdateTechnicianInput = {
  technicianId: TechnicianId;
  expectedVersion: number;
  name?: string;
  /** An allowlisted colour token, never CSS. */
  color?: TechnicianColorToken;
  device?: string | null;
  outlookEmail?: string;
  active?: boolean;
};

/** The default device of a new technician (the demo's only value). */
export const DEFAULT_TECHNICIAN_DEVICE = "סמארטפון";

/** "+ הוספת טכנאי": immediate for the Manager and the Creator (D34 c). */
export type NewTechnicianInput = {
  name: string;
  /**
   * Sign-in email, used in the demo also as the Outlook attendee address that matches invitations
   * (SE-05). Design note (open item): docs/database-schema.md keeps `technicians.outlook_email`
   * separate from the account email, and D34 (e) and (f) govern them separately; the production
   * input may split them (`outlookEmail`, defaulting to `email`).
   */
  email: string;
  phone: string;
  /** An allowlisted colour token, never CSS. */
  color: TechnicianColorToken;
  /** DEFAULT_TECHNICIAN_DEVICE ("סמארטפון") unless changed. */
  device: string;
};

// ---------------------------------------------------------------------------------------------
// Command results: the created records, as stored (the server sets ids, test markers and times).

export type CreatedAccount = { account: UserAccount };

/** A technician account and its Settings › טכנאים row (two ids: the account and the technician). */
export type CreatedTechnician = { account: UserAccount; technician: TechnicianSetting };

export type CreatedAccountRequest = { request: AccountRequest };
