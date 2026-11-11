// Account-administration ports (SE-01, D34). Implemented by app/dev/demo/_data/adapter.ts
// (queries, fictional fixtures), app/dev/demo/_components/simulated-commands.ts (commands,
// simulated) and, later, by server functions that check authorization in the database under the
// caller's own session before any Auth admin call (D34). The caller's role comes from the session,
// never from an argument; a screen only decides what to offer (G-04).
// Command shape (Step 2 PR 2.2): every command that takes `expectedVersion` takes one input object
// (as products.update, review.resolve, visits.correct). A stale version is refused with the
// "data changed" message (PT409, ACTION_MESSAGES.stale). Each returns the record's version as
// stored after it (VersionedResult; every Migration 1 edit function returns it), and a screen sends
// that one with its next edit of the same record (versionAfter). A decision that also changes an
// ACCOUNT (an approved activation or role change) returns the request's version only: the screen
// reads the account again before acting on it.
import type { CommandResult, Page, PageRequest, VersionedResult } from "@/features/data-access/common";
import type {
  AccountDecisionInput,
  AccountId,
  AccountListQuery,
  AccountRequest,
  AccountRequestInput,
  AccountRequestQuery,
  AccountStateInput,
  CancelAccountRequestInput,
  CompleteCreationInput,
  CompletedCreation,
  CompletedTechnicianProfile,
  CompleteTechnicianProfileInput,
  CreatedAccount,
  CreatedAccountRequest,
  CreatedTechnician,
  CreationIntent,
  CreatorNotice,
  NewAccountInput,
  NewTechnicianInput,
  UpdateProfileInput,
  UpdateTechnicianInput,
  UserAccount,
} from "./types";

export interface AccountsQueries {
  /**
   * Accounts by role (creator, mgr, cs, tech) then name (Hebrew collation), optionally filtered by
   * role; paged. A role filter with no known role matches nothing (never every account). Each
   * carries its `version` and `technicianMissing`.
   */
  list(query?: AccountListQuery): Promise<Page<UserAccount>>;
  /**
   * Account requests, newest first, optionally filtered by status; paged. A status filter with no
   * known status matches nothing. Never returns a creation intent (`direct_create`): see
   * openCreations().
   */
  requests(query?: AccountRequestQuery): Promise<Page<AccountRequest>>;
  /**
   * The viewer's own open creation intents (`direct_create`, approved, no account bound yet), newest
   * first; paged (default 40, at most 100). Production: `requested_by` is the session's user (RLS
   * lets a requester read his own rows). The demo adapter has no session and returns every
   * fictional intent: its loader filters by the viewer before anything reaches a page (PR 2.3).
   */
  openCreations(query?: PageRequest): Promise<Page<CreationIntent>>;
  /**
   * The Creator's account notices ("התראות חשבונות", D34 b and f; Step 2 plan §3.10), newest first;
   * paged (default 40, at most 100): pending requests, a Manager's deactivations, and Outlook-email
   * changes made by anyone but the viewing Creator. Creator only: production denies any other
   * caller (the adapter checks the role itself, because RLS also lets a Manager read his own audit
   * rows). The demo adapter has no session: it returns the demo Creator's view, and only the
   * Creator's loader calls it (PR 2.3). No read/unread state. `actorRole` is the acting account's
   * role.
   */
  creatorNotices(query?: PageRequest): Promise<Page<CreatorNotice>>;
}

/**
 * Account actions. Results say whether they were simulated (UI demo: always); a create returns
 * the record as stored, so a screen never builds ids or test markers itself.
 */
export interface AccountCommands {
  /**
   * Creator only: creates a Manager, Customer Service or Technician account, immediately (D34). A
   * Creator account is pending the owner's decision (Step 2 plan Q9). No password: the Creator
   * sets the first one with setPassword (Q1). Technicians are created with createTechnician (the
   * account and its technician record); "tech" here creates the account only (Step 2 plan §3.8
   * phases 1–3), which then shows as "פרופיל טכנאי חסר" (`technicianMissing`).
   */
  createAccount(input: NewAccountInput): Promise<CommandResult<CreatedAccount>>;
  /**
   * Manager only: a Customer Service create / activate / reactivate / role-change request. Nothing
   * changes until the Creator approves (D34 a); the result carries the new request. The
   * implementation checks the target account's current role against stored data (the input
   * validator checks only the shape): a Manager must never gain extra privileges (D34). A create
   * request carries no phone (the Creator adds it on completion, or later as a routine update).
   */
  requestAccount(input: AccountRequestInput): Promise<CommandResult<CreatedAccountRequest>>;
  /** Creator only: approves or rejects a pending request at the version read; a rejection needs a reason. */
  decideAccountRequest(input: AccountDecisionInput): Promise<CommandResult<VersionedResult>>;
  /**
   * The requester cancels his own pending requests and his own approved, unfulfilled creations; the
   * Creator cancels approved, unfulfilled creations of anyone. A Manager's pending request is never
   * cancelled by the Creator: he rejects it with a reason (decideAccountRequest). An approved
   * creation that is cancelled keeps its decider; the audit names who cancelled (Migration 1
   * `cancel_account_request`; TEMPORARY design, PR 1.3 Q16).
   */
  cancelAccountRequest(input: CancelAccountRequestInput): Promise<CommandResult<VersionedResult>>;
  /**
   * Deactivates an account immediately, without approval (D34 b): the Manager for Customer Service
   * and Technician accounts, the Creator for any but its own. Audited; a Manager's deactivation
   * notifies the Creator in the app. Accounts are deactivated, never deleted
   * (docs/database-schema.md).
   */
  deactivateAccount(input: AccountStateInput): Promise<CommandResult<VersionedResult>>;
  /**
   * Activates or reactivates an account immediately: the Creator for any, the Manager for
   * Technician accounts only (D34 c). A Manager's Customer Service activation is a request: this
   * command refuses it with "הפעולה דורשת אישור של היוצר." (Migration 1, 55000).
   */
  activateAccount(input: AccountStateInput): Promise<CommandResult<VersionedResult>>;
  /** Manager or Creator: a technician account with its Settings row, immediately (D34 c). */
  createTechnician(input: NewTechnicianInput): Promise<CommandResult<CreatedTechnician>>;
  /**
   * Creator only (D34 e, D50): sets or resets an account's password. The server first runs
   * `assert_can_change_credentials` under the caller's session (Creator only, audited), then the
   * Auth admin call. The password is never logged, echoed, returned or stored by the app; Supabase
   * decides its strength (Q12). No data is returned.
   */
  setPassword(accountId: AccountId, password: string): Promise<CommandResult>;
  /**
   * Creator only (D34 e, D50): changes an account's sign-in email, after the same database check.
   * A test-marked account keeps an example.test address (TEMPORARY, app-only rule, Q17).
   */
  changeEmail(accountId: AccountId, email: string): Promise<CommandResult>;
  /**
   * Routine profile update (D34 d): name, work phone, invitation alias; never the email. The
   * Manager: Technician and Customer Service accounts, never his own; the Creator: any account.
   * The checks run on the patch as sent, before the adapter fills the unchanged fields
   * (UpdateProfileInput).
   */
  updateProfile(input: UpdateProfileInput): Promise<CommandResult<VersionedResult>>;
  /**
   * Routine technician update (D34 d, SE-05): name, colour, device; the Outlook email and "פעיל"
   * only by the Creator (TEMPORARY, Q14; "פעיל" is also SettingsCommands.setTechnicianActive, under
   * the same rule). The Manager's caller check runs on the patch as sent, before the adapter fills
   * the unchanged fields from the row it reads (UpdateTechnicianInput). Every Outlook-email change
   * notifies the Creator (D34 f).
   */
  updateTechnician(input: UpdateTechnicianInput): Promise<CommandResult<VersionedResult>>;
  /**
   * "השלמת יצירה" (Step 2 plan §3.8 "Retry"; the real adapter is PR 2.6): completes an open creation.
   * Before any Auth admin call the server re-reads the row under the caller's session and requires
   * it to be approved with no account bound, and either the Creator on a Manager's "create"
   * request (Variant B; Q15; PR 1.3 Q14) or the requester on his own creation intent
   * (`direct_create`). Email, role and name come from the row, never from the client. No password
   * (Q1): the Creator sets the first one with setPassword. Failures follow plan §3.8: a definite
   * Auth refusal or a binding refusal is reported (the row stays open, or the intent is cancelled
   * and an orphan Auth user may keep the email taken, Q16); an uncertain one leaves the row open for
   * another attempt. Carries no version: no Migration 1 function takes one.
   * The result is mapped per caller, as the loaders map technician details (Q14, security.md §8):
   * the real adapter (PR 2.6–2.7) never sends a Manager the technician's Outlook email
   * (`technician.email`) or "פעיל" (`technician.active`); it narrows this result for that caller,
   * or the screen re-reads the record (review AUTH-N3). The screens already keep only the fields the
   * viewer's scope shows (AccountAdminScreen technicianDetailsOf).
   */
  completeCreation(input: CompleteCreationInput): Promise<CommandResult<CompletedCreation>>;
  /**
   * "השלמה" of "פרופיל טכנאי חסר" (Step 2 plan §3.8 phase 4): creates the field profile of an
   * active Technician account that has none. Callers: the Creator for any account, the Manager
   * within his scope (Migration 1 `admin_create_technician`). The Outlook email is the sign-in email
   * as the server reads it (Q5, Q14), never an input. A second field profile is refused (55000).
   * Carries no version: no Migration 1 function takes one.
   * The result is mapped per caller as for completeCreation: a Manager's never carries the Outlook
   * email or "פעיל" (review AUTH-N3).
   */
  completeTechnicianProfile(input: CompleteTechnicianProfileInput): Promise<CommandResult<CompletedTechnicianProfile>>;
}
