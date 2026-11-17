// Account-administration DTOs (demo setUsers() L942-946, as changed by demo-deviations SE-01 and
// D34, and by D60 (7)): user accounts, creation intents, the Creator's notices and the command
// inputs. Pure types, enums and product copy (no data). See features/data-access/common.ts.
// D60 (7) (owner, 2026-11-12; supersedes D34 a and c; Migration 5): only the Creator manages
// Manager and Creator accounts. A Manager adds Technician and Customer Service accounts directly
// (no Creator approval, no "בקשות לאישור"), edits their permitted details and activates or
// deactivates them at once (audited; the Creator is notified in the app of a Manager's
// deactivation, D34 b). Managers never change a role, never delete, and never set or reset
// passwords or change an account's email (D34 e). Only the Creator changes roles, sets passwords and
// emails, and deletes (Option A: access revoked for good, the profile kept and marked deleted,
// history kept). No public sign-up (D50). Account administration is a fixed capability, never a
// matrix key (D33, SE-03). Edits carry the version read (`expectedVersion`): every edit function
// refuses a stale one (PT409).
// The Manager's account requests (D34 a) below are RETIRED by D60 (7) and Migration 5 (C-02): the
// database refuses them (no EXECUTE). Their types stay only for the /dev/demo prototype (D61 (1)),
// which still shows the pre-D60 screens; the real screen and the server actions never use them.
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
  /**
   * Sign-in email (example.test for test users). Only the Creator changes it (D34 e). The database
   * keeps no copy the caller's session may read (Auth holds it), so the real list shows the
   * address of the account's creation, when the viewer may read that creation and no email change
   * was authorized since; otherwise "" (unknown; TEMPORARY, Step 2 plan Q5 option c).
   */
  email: string;
  /** Work phone. */
  phone: string;
  /**
   * The name invitations use for this person ("כינוי בזימונים"; Migration 1
   * `profiles.invitation_rep_name`, unique, 1–60 characters); null when none is set. A routine
   * update (D34 d) changes it.
   */
  invitationAlias: string | null;
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

/**
 * A Technician account's field profile as the unified list carries it (QA C-01: for a technician
 * also the Outlook email, the calendar colour and "פעיל"; the work phone is the account's).
 * `outlookEmail` and `active` ("פעיל · מקבל זימונים חדשים", `technicians.accepts_invitations`) are
 * the Creator's only: a Manager's entry carries null for both (TEMPORARY, Step 2 plan Q14; review
 * AUTH-N3), although the database lets him read them.
 */
export type AccountTechnician = TestMarker & {
  id: TechnicianId;
  /** `technicians.display_name` (the name invitations and calendars show). */
  name: string;
  /** The stored colour when it is an allowlisted token; null otherwise (deny by default). */
  colorToken: TechnicianColorToken | null;
  /** CSS of `colorToken` (`var(--t-…)`); "" when the stored colour is not allowlisted. */
  color: string;
  /** "" when none is stored. */
  device: string;
  outlookEmail: string | null;
  active: boolean | null;
  /** The stored version (`technicians.version`), sent back as `expectedVersion`. */
  version: number;
};

/**
 * One row of the unified user-management list (D60 (7), QA C-01): the account and, for a
 * Technician with a field profile, that profile; null for office accounts and for a Technician
 * account without one (`technicianMissing`).
 */
export type AccountListEntry = UserAccount & { technician: AccountTechnician | null };

/** Kinds of Manager-initiated Customer Service requests (D34 a; RETIRED by D60 (7), /dev/demo only). */
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

/**
 * A Manager's request that the Creator approves or rejects (D34 a). Every step is audited.
 * RETIRED by D60 (7) and Migration 5 (C-02): no new request can exist; /dev/demo only.
 */
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
   * approved creation that is cancelled later keeps its decider and time (Migration 1
   * `cancel_account_request`): see `cancelledAfterApproval`.
   */
  decidedBy: AccountRef | null;
  decidedAt: IsoTimestamp | null;
  /**
   * An approved creation cancelled before an account was bound to it: `decidedBy` / `decidedAt` are
   * still the APPROVAL, never the cancellation (who cancelled is in the audit only). Always
   * cancelledAfterApprovalOf() of the stored row.
   */
  cancelledAfterApproval: boolean;
  /** The stored version (`account_requests.version`), sent back as `expectedVersion` (PT409 when it changed). */
  version: number;
};

/**
 * Whether a stored request is an approved creation that was cancelled later, read from the row
 * itself: Migration 1 sets `decided_by` on a PENDING cancellation to the caller, who can only be the
 * requester, and keeps the approving Creator on an approved one. So a cancelled "create" whose
 * decider is not its requester was cancelled after approval (the `account_request.cancelled` audit
 * row says the same: `details.from_status = 'approved'`).
 */
export const cancelledAfterApprovalOf = (row: {
  kind: AccountRequestKind;
  status: AccountRequestStatus;
  requestedBy: AccountId;
  decidedBy: AccountId | null;
}): boolean => row.kind === "create" && row.status === "cancelled" && row.decidedBy !== null && row.decidedBy !== row.requestedBy;

/**
 * The outcome line of a decided or cancelled request ("אושרה על ידי משתמש יוצר · 14.09 12:20"):
 * who decided and when (`decidedLabel`: decidedAt formatted by the page); null while pending. An
 * approved creation cancelled later reads "אושרה על ידי … · בוטלה": its decider and time are the
 * approval's, so they are never shown as the cancellation's.
 */
export function requestOutcomeLine(request: AccountRequest, decidedLabel: string | null): string | null {
  if (request.status === "pending") return null;
  const who = request.decidedBy?.name ? ` על ידי ${request.decidedBy.name}` : "";
  const when = decidedLabel ? ` · ${decidedLabel}` : "";
  if (request.cancelledAfterApproval) {
    return `${ACCOUNT_REQUEST_STATUS_LABELS.approved}${who}${when} · ${ACCOUNT_REQUEST_STATUS_LABELS.cancelled}`;
  }
  return `${ACCOUNT_REQUEST_STATUS_LABELS[request.status]}${who}${when}`;
}

/**
 * A request after a successful cancellation, as Migration 1 stores it: a pending one names who
 * cancelled and when; an approved creation keeps its decider and time (cancelledAfterApproval).
 */
export function cancelledRequest(request: AccountRequest, by: AccountRef | null, at: IsoTimestamp): AccountRequest {
  return request.status === "approved"
    ? { ...request, status: "cancelled", cancelledAfterApproval: true }
    : { ...request, status: "cancelled", decidedBy: by, decidedAt: at };
}

/**
 * An approved "create" request whose account was not created yet (no account bound to it): its
 * requester or the Creator may still cancel it (Migration 1 `cancel_account_request`; the Creator
 * completes it in PR 2.3).
 */
export const isOpenCreation = (request: Pick<AccountRequest, "kind" | "status" | "account">): boolean =>
  request.kind === "create" && request.status === "approved" && request.account === null;

/**
 * What the requester's "הבקשות שלי" offers to cancel (display only; cancelRequestError decides): a
 * pending request, or an approved creation with no account yet (isOpenCreation).
 */
export const requesterMayCancel = (request: Pick<AccountRequest, "kind" | "status" | "account">): boolean =>
  request.status === "pending" || isOpenCreation(request);

/** Accounts list query: optional role filter, paged (default 40, at most 100). */
export type AccountListQuery = PageRequest & { roles?: readonly AccountRole[] };

/** Requests list query: optional status filter, newest first, paged (default 40, at most 100). */
export type AccountRequestQuery = PageRequest & { statuses?: readonly AccountRequestStatus[] };

// ---------------------------------------------------------------------------------------------
// The Creator's account notices ("התראות חשבונות", D34 b and f; Step 2 plan §3.10). The card is PR
// 2.3; no read/unread state (that would need a table).

/**
 * - "pending-request": a Manager's request that waits for the Creator (RETIRED by D60 (7): only the
 *   /dev/demo prototype has one; the real query never returns this kind);
 * - "manager-deactivation": a Manager deactivated an account (D34 b, kept by D60 (7));
 * - "outlook-email-change": someone other than the viewing Creator changed a technician's Outlook
 *   email (D34 f). The audit row holds no email, so neither does the notice;
 * - "manager-creation": a Manager created an account (D67 (b), owner 2026-11-17): the creation's
 *   `profile.created` audit row by anyone but the viewing Creator (D49 and Q9: no other Creator is
 *   ever made, so that is a Manager). No email in it either.
 */
export const CREATOR_NOTICE_KINDS = ["pending-request", "manager-deactivation", "outlook-email-change", "manager-creation"] as const;
export type CreatorNoticeKind = (typeof CREATOR_NOTICE_KINDS)[number];

export type CreatorNotice = TestMarker & {
  id: string;
  kind: CreatorNoticeKind;
  /** When it happened: the request's time, or the audited action's time. */
  at: IsoTimestamp;
  /** Who acted: the requesting Manager, the deactivating Manager, who changed the email, or the creating Manager. */
  actor: AccountRef;
  /**
   * The acting account's role; null when unknown. Demo: from the fixture account; production: the
   * actor's profile, which the Creator may read. The card labels a Manager's Outlook-email change
   * (TEMPORARY, Step 2 plan Q14: in the app only the Creator changes it).
   */
  actorRole: AccountRole | null;
  /** The account it is about; `accountId` is null for a pending "create" (no account exists yet). */
  target: { accountId: AccountId | null; name: string; role: AccountRole };
  /** "pending-request" only: the request's kind; null otherwise. */
  requestKind: AccountRequestKind | null;
};

/**
 * The Creator's notices from their sources, as every implementation selects them (Step 2 plan
 * §3.10): nothing unless the viewer is the Creator (RLS also lets a Manager read his own audit
 * rows); requests only while pending; a Manager's deactivations (`profile.deactivated` with
 * `actor_role` manager, selected by the source); Outlook-email changes and creations (D67 (b)) by
 * anyone but the viewer; newest first.
 */
export function creatorNoticesOf(
  viewer: { id: AccountId; role: AccountRole } | null | undefined,
  requests: readonly { status: AccountRequestStatus; notice: CreatorNotice }[],
  events: readonly CreatorNotice[],
): CreatorNotice[] {
  if (viewer?.role !== "creator") return [];
  return [
    ...requests.filter((r) => r.status === "pending" && r.notice.kind === "pending-request").map((r) => r.notice),
    ...events.filter(
      (e) =>
        e.kind === "manager-deactivation" ||
        ((e.kind === "outlook-email-change" || e.kind === "manager-creation") && e.actor.id !== viewer.id),
    ),
  ].sort((a, b) => Date.parse(b.at) - Date.parse(a.at));
}

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
  /**
   * Who authorized it. The Manager sees his own intents only; the Creator also sees others' (he may
   * cancel them, review S3); the demo loader filters by it.
   */
  requestedBy: AccountRef;
  authorizedAt: IsoTimestamp;
  version: number;
};

// ---------------------------------------------------------------------------------------------
// Command inputs

/** Roles a Manager's request may name: Customer Service and Technician only (never Manager or Creator, D34). */
export const MANAGER_REQUESTABLE_ROLES: readonly AccountRole[] = ["cs", "tech"];

/**
 * The roles a Manager creates directly (D60 (7), Migration 5 `authorize_account_creation`):
 * Customer Service and Technician. The Creator also creates Manager accounts (NEW_ACCOUNT_ROLES).
 */
export const MANAGER_CREATABLE_ROLES: readonly AccountRole[] = ["cs", "tech"];

/**
 * The Creator's role change (D60 (7): Creator only; never his own account, never to Creator, D49).
 * `newRole` is one of NEW_ACCOUNT_ROLES. The database also refuses a Technician account that has a
 * field profile and the last active Creator (55000), and a deleted account.
 */
export type RoleChangeInput = { accountId: AccountId; expectedVersion: number; newRole: NewAccountRole; reason?: string };

/**
 * The Creator's deletion (D60 (7) Option A; Migration 5 `admin_delete_user`): only after an
 * explicit confirmation (`confirm: true`, the screen's dialog; OQ-10), at the version read. Never
 * his own account and never a Creator account (TEMPORARY OQ-1). Access is revoked for good: the
 * profile is marked deleted and inactive (history and attribution kept), then the Auth user is
 * banned on the server.
 */
export type DeleteAccountInput = { accountId: AccountId; expectedVersion: number; confirm: true; reason?: string };

/**
 * "ביטול" of an incomplete creation ("יצירה שלא הושלמה", a creation intent with no account bound)
 * at the version read (Migration 1 `cancel_account_request`, kept by Migration 5 for intents).
 */
export type CancelCreationInput = { intentId: AccountRequestId; expectedVersion: number };

/** The Creator sets an account's password (D34 e). Never logged, echoed, returned or stored by the app. */
export type SetPasswordInput = { accountId: AccountId; password: string };

/** The Creator changes an account's sign-in email (D34 e); a test-marked account keeps example.test (D47). */
export type ChangeEmailInput = { accountId: AccountId; email: string };

/**
 * RETIRED by D60 (7) (C-02; /dev/demo only). A Manager's Customer Service request (D34 a). The target of "activate", "reactivate" and
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

/** RETIRED by D60 (7) (/dev/demo only). The Creator's decision. A rejection always stores a reason (D34). */
export type AccountDecision = { outcome: "approve" } | { outcome: "reject"; reason: string };

/** RETIRED by D60 (7) (/dev/demo only). The Creator decides a pending request at the version he read (PT409). */
export type AccountDecisionInput = { requestId: AccountRequestId; expectedVersion: number; decision: AccountDecision };

/**
 * Cancels a request at the version read (/dev/demo: RetiredAccountRequestCommands.cancelAccountRequest;
 * the real screen cancels a creation intent with CancelCreationInput).
 */
export type CancelAccountRequestInput = { requestId: AccountRequestId; expectedVersion: number };

/** An immediate deactivation or activation at the version read. */
export type AccountStateInput = { accountId: AccountId; expectedVersion: number };

/**
 * Roles an immediate creation may give (Migration 5 `authorize_account_creation`): Manager, Customer
 * Service and Technician for the Creator; Customer Service and Technician for the Manager
 * (MANAGER_CREATABLE_ROLES, D60 (7)). TEMPORARY (Step 2 plan Q9, PR 1.3 Q11): no Creator account is created
 * through the app until the owner decides; the form labels it "ממתין להחלטת בעלים" (D49).
 */
export const NEW_ACCOUNT_ROLES = ["mgr", "cs", "tech"] as const;
export type NewAccountRole = (typeof NEW_ACCOUNT_ROLES)[number];

export const isNewAccountRole = (value: unknown): value is NewAccountRole =>
  typeof value === "string" && (NEW_ACCOUNT_ROLES as readonly string[]).includes(value);

/**
 * "+ הוסף משתמש": immediate (D60 (7)). The Creator: Technician, Customer Service and Manager; the
 * Manager: Technician and Customer Service. A Creator account is pending the owner's decision (Q9). No password: the Creator sets the first one (D50; Q1). A
 * Technician is created with NewTechnicianInput (createTechnician, D34 c): "tech" here covers only
 * the account phases (Step 2 plan §3.8 phases 1–3), so its result has `technicianMissing: true`.
 */
export type NewAccountInput = { name: string; email: string; phone: string; role: NewAccountRole };

/**
 * A routine profile update (D34 d): name, work phone and invitation alias, never the email. Patch
 * semantics: an omitted field is unchanged, `null` clears it; any other key, or no field at all, is
 * refused. The Manager may update Technician and Customer Service accounts other than his own; the
 * Creator any account. The checks (profileUpdateCommandError) run on the input AS SENT (the patch),
 * before the real adapter fills the unchanged fields from the row it reads under the caller's
 * session (the database function replaces all of them); the filled values are the stored ones,
 * protected by `expectedVersion`.
 */
export type UpdateProfileInput = {
  accountId: AccountId;
  expectedVersion: number;
  name?: string;
  phone?: string | null;
  invitationAlias?: string | null;
};

/**
 * A routine technician update (D34 d, SE-05). Patch semantics and checks as UpdateProfileInput:
 * the caller check runs on the patch as sent, so a Manager's patch that names neither field passes,
 * although the adapter then sends the stored Outlook email and "פעיל" unchanged. The Outlook email
 * and "פעיל" (`active`, the same field as SettingsCommands.setTechnicianActive) are the Creator's
 * only (TEMPORARY, Step 2 plan Q14): the database lets a Manager change them; the app narrows it
 * until the owner decides.
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

// ---------------------------------------------------------------------------------------------
// Completing an open creation (Step 2 plan §3.8 "Retry"; PR 2.3 "השלמת יצירה" and "השלמה")

/**
 * "השלמת יצירה": completes an open creation (an approved creation with no account bound yet): since
 * D60 (7) and Migration 5 (OQ-4) only the requester's own creation intent (`direct_create`); the
 * pre-D60 Variant B (the Creator completing a Manager's approved Customer Service request, Q15) is
 * /dev/demo only. Email, role and name come from the stored row, never from this input; no
 * password (Q1). `technician` is required for a Technician creation and refused for any other role.
 */
export type CompleteCreationInput = {
  requestId: AccountRequestId;
  /** Work phone; null for none (it can be added later, as a routine update). */
  phone: string | null;
  technician?: { color: TechnicianColorToken; device: string };
};

/**
 * The created account and, for a Technician, his Settings › טכנאים row, as stored. A Manager caller
 * never receives the technician's real Outlook email or "פעיל" (Q14; ports.ts completeCreation:
 * the real adapter narrows the result for him); the screens keep only the fields the viewer's scope
 * shows.
 */
export type CompletedCreation = { account: UserAccount; technician: TechnicianSetting | null };

/**
 * "השלמה" of "פרופיל טכנאי חסר" (Step 2 plan §3.8 phase 4): the field profile of an active
 * Technician account that has none. The Outlook email is the account's sign-in email as the server
 * reads it (Q5, Q14), never an input.
 */
export type CompleteTechnicianProfileInput = { accountId: AccountId; color: TechnicianColorToken; device: string };

export type CompletedTechnicianProfile = { technician: TechnicianSetting };
