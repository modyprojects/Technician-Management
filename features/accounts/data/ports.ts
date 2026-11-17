// Account-administration ports (SE-01; D34 as superseded by D60 (7); Migration 5).
// - AccountsQueries and AccountCommands are what the real unified user-management screen uses
//   (D60 (7), QA M-06, C-01, C-02). The server implements them under the caller's own session:
//   features/accounts/supabase/{queries,commands}.ts with injected clients, wired by
//   lib/data/supabase/accounts.ts and lib/actions/accounts.ts. Authorization is checked in the
//   database under the caller's session before any Auth Admin call (D34, docs/security.md §5).
// - RetiredAccountRequestQueries and RetiredAccountRequestCommands are the Manager's requests and the
//   Creator's decisions of D34 (a). D60 (7) and Migration 5 (C-02) retired them: the database
//   refuses them (no EXECUTE) and no real implementation exists or may be added. They remain only
//   for the /dev/demo prototype (D61 (1)), which still shows the pre-D60 screens:
//   app/dev/demo/_data/adapter.ts (queries, fictional fixtures) and
//   app/dev/demo/_components/simulated-commands.ts (commands, simulated) implement the Demo* types.
// The caller's role comes from the session, never from an argument; a screen only decides what to
// offer (G-04).
// Command shape (Step 2 PR 2.2): every command that takes `expectedVersion` takes one input object
// (as products.update, review.resolve, visits.correct). A stale version is refused with the
// "data changed" message (PT409, ACTION_MESSAGES.stale). Each returns the record's version as
// stored after it (VersionedResult; every edit function returns it), and a screen sends that one
// with its next edit of the same record (versionAfter).
import type { CommandResult, Page, PageRequest, VersionedResult } from "@/features/data-access/common";
import type {
  AccountDecisionInput,
  AccountId,
  AccountListEntry,
  AccountListQuery,
  AccountRequest,
  AccountRequestInput,
  AccountRequestQuery,
  AccountStateInput,
  CancelAccountRequestInput,
  CancelCreationInput,
  CompleteCreationInput,
  CompletedCreation,
  CompletedTechnicianProfile,
  CompleteTechnicianProfileInput,
  CreatedAccount,
  CreatedAccountRequest,
  CreatedTechnician,
  CreationIntent,
  CreatorNotice,
  DeleteAccountInput,
  NewAccountInput,
  NewTechnicianInput,
  RoleChangeInput,
  UpdateProfileInput,
  UpdateTechnicianInput,
} from "./types";

export interface AccountsQueries {
  /**
   * The unified list (D60 (7), QA C-01): accounts by role (creator, mgr, cs, tech) then name,
   * optionally filtered by role; paged (default 40, at most 100). A role filter with no known role
   * matches nothing (never every account). Deleted accounts are left out (Migration 5 OQ-3: lists
   * and pickers never show them). Each entry carries its `version`, `technicianMissing` and, for a
   * Technician, his field profile (AccountListEntry). Production: the Creator every account, the
   * Manager Customer Service and Technician accounts (RLS); anyone else gets an empty page.
   */
  list(query?: AccountListQuery): Promise<Page<AccountListEntry>>;
  /**
   * One account as list() shows it (the screen re-reads after an action), or null: unknown, deleted,
   * or not in the viewer's scope.
   */
  get(accountId: AccountId): Promise<AccountListEntry | null>;
  /**
   * The viewer's own open creation intents (`direct_create`, approved, no account bound yet), newest
   * first; paged (default 40, at most 100). Production: `requested_by` is the session's user (RLS
   * lets a requester read his own rows). The demo adapter has no session and returns every
   * fictional intent: its loader filters by the viewer before anything reaches a page (PR 2.3).
   */
  openCreations(query?: PageRequest): Promise<Page<CreationIntent>>;
  /**
   * The Creator's account notices ("התראות חשבונות", D34 b and f, kept by D60 (7); Step 2 plan
   * §3.10), newest first; paged (default 40, at most 100): a Manager's deactivations, and
   * Outlook-email changes made by anyone but the viewing Creator. Creator only: production denies
   * any other caller (the implementation checks the role itself, because RLS also lets a Manager
   * read his own audit rows). The demo adapter has no session: it returns the demo Creator's view
   * (with the retired "pending-request" kind of the prototype), and only the Creator's loader calls
   * it (PR 2.3). No read/unread state. `actorRole` is the acting account's role.
   */
  creatorNotices(query?: PageRequest): Promise<Page<CreatorNotice>>;
}

/**
 * RETIRED by D60 (7) and Migration 5 (C-02): /dev/demo only (D61 (1)). The real screen has no
 * "בקשות לאישור" and no real implementation of this port exists.
 */
export interface RetiredAccountRequestQueries {
  /**
   * Account requests, newest first, optionally filtered by status; paged. A status filter with no
   * known status matches nothing. Never returns a creation intent (`direct_create`): see
   * AccountsQueries.openCreations().
   */
  requests(query?: AccountRequestQuery): Promise<Page<AccountRequest>>;
}

/** The /dev/demo aggregate (features/data-access/types.ts DataAccess.accounts). */
export type DemoAccountsQueries = AccountsQueries & RetiredAccountRequestQueries;

/**
 * Account actions (D60 (7)). Results say whether they were simulated (UI demo: always; server:
 * never); a create returns the record as stored, so a screen never builds ids or test markers
 * itself. Every server implementation re-validates its input, takes the caller from the session and
 * lets the database decide under the caller's own session BEFORE any Auth Admin call; Hebrew
 * business messages only (features/data-access/supabase-errors.ts).
 */
export interface AccountCommands {
  /**
   * "+ הוסף משתמש" (D60 (7)), immediate: the Creator creates Manager, Customer Service and Technician
   * accounts; the Manager creates Customer Service and Technician accounts. A Creator account is
   * pending the owner's decision (Step 2 plan Q9; D49). No password: the Creator sets the first one
   * with setPassword (Q1). Technicians are created with createTechnician (the account and its field
   * profile); "tech" here creates the account only (Step 2 plan §3.8 phases 1–3), which then shows
   * as "פרופיל טכנאי חסר" (`technicianMissing`). Until go-live every new account is test-marked and
   * its email is in example.test (D47).
   */
  createAccount(input: NewAccountInput): Promise<CommandResult<CreatedAccount>>;
  /** Manager or Creator: a technician account with its field profile, immediately (D60 (7)). */
  createTechnician(input: NewTechnicianInput): Promise<CommandResult<CreatedTechnician>>;
  /**
   * "השלמת יצירה" (Step 2 plan §3.8 "Retry"): completes the caller's own open creation intent
   * (`direct_create`, approved, no account bound; Migration 5 OQ-4: the Creator's completion of a
   * Manager's request is gone). Before any Auth Admin call the server re-reads the row under the
   * caller's session and checks his current role and scope in the database (`assert_can_manage`).
   * Email, role and name come from the row, never from the client. No password
   * (Q1). An Auth user that an earlier, uncertain attempt created for this intent is bound, not
   * created twice. Failures follow plan §3.8. Carries no version (no function takes one).
   * A Manager's result never carries the technician's Outlook email or "פעיל" (Q14, AUTH-N3).
   */
  completeCreation(input: CompleteCreationInput): Promise<CommandResult<CompletedCreation>>;
  /**
   * "ביטול" of an incomplete creation (a creation intent with no account bound): its requester, or
   * the Creator (Migration 1 `cancel_account_request`, kept by Migration 5 for intents). An Auth user
   * that an uncertain attempt created stays (Step 2 plan Q16 TEMPORARY).
   */
  cancelCreation(input: CancelCreationInput): Promise<CommandResult<VersionedResult>>;
  /**
   * "השלמה" of "פרופיל טכנאי חסר" (Step 2 plan §3.8 phase 4): creates the field profile of a
   * Technician account that has none. Callers: the Creator for any account, the Manager within his
   * scope (Migration 1 `admin_create_technician`). The Outlook email is the account's sign-in email
   * as the server reads it from Auth (after the database check), never an input. A second field
   * profile is refused (55000). Carries no version. A Manager's result never carries the Outlook
   * email (Q14, AUTH-N3).
   */
  completeTechnicianProfile(input: CompleteTechnicianProfileInput): Promise<CommandResult<CompletedTechnicianProfile>>;
  /**
   * Deactivates an account immediately (D34 b, D60 (7)): the Manager for Customer Service and
   * Technician accounts, the Creator for any but his own. Audited; a Manager's deactivation
   * notifies the Creator in the app. A deactivated user cannot sign in; his history is kept.
   */
  deactivateAccount(input: AccountStateInput): Promise<CommandResult<VersionedResult>>;
  /**
   * Activates or reactivates an account immediately (D60 (7), no Creator approval): the Creator for
   * any account but his own, the Manager for Customer Service and Technician accounts. A deleted
   * account is never activated again (Migration 5, 55000).
   */
  activateAccount(input: AccountStateInput): Promise<CommandResult<VersionedResult>>;
  /**
   * Routine profile update (D34 d): name, work phone, invitation alias; never the email. The
   * Manager: Technician and Customer Service accounts, never his own; the Creator: any account.
   * The checks run on the patch as sent, before the implementation fills the unchanged fields
   * from the row it reads under the caller's session (UpdateProfileInput).
   */
  updateProfile(input: UpdateProfileInput): Promise<CommandResult<VersionedResult>>;
  /**
   * Routine technician update (D34 d, SE-05): name, colour, device; the Outlook email and "פעיל"
   * only by the Creator (TEMPORARY, Q14; "פעיל" is also SettingsCommands.setTechnicianActive, under
   * the same rule). The Manager's caller check runs on the patch as sent, before the implementation
   * fills the unchanged fields from the row it reads (UpdateTechnicianInput). Every Outlook-email
   * change notifies the Creator (D34 f).
   */
  updateTechnician(input: UpdateTechnicianInput): Promise<CommandResult<VersionedResult>>;
  /**
   * The Creator's role change (D60 (7): Managers never change roles), never on his own account and
   * never to Creator (D49), at the version read (Migration 1 `admin_set_user_role`). Returns the
   * account's new version.
   */
  changeRole(input: RoleChangeInput): Promise<CommandResult<VersionedResult>>;
  /**
   * Creator only (D34 e, kept by D60 (7)): sets or resets another account's password. The server
   * first runs `assert_can_change_credentials` under the caller's session (Creator only, audited;
   * refused for a deleted account), then the Auth Admin call. Never on the Creator's own account
   * (TEMPORARY, Step 2 plan Q22). The password is never logged, echoed, returned or stored by the
   * app; Supabase decides its strength (Q12). No data is returned.
   */
  setPassword(accountId: AccountId, password: string): Promise<CommandResult>;
  /**
   * Creator only (D34 e): changes another account's sign-in email, after the same database check.
   * A test-marked account keeps an example.test address (TEMPORARY, app-only rule, Q17).
   */
  changeEmail(accountId: AccountId, email: string): Promise<CommandResult>;
  /**
   * The Creator's deletion (D60 (7) Option A; Migration 5 `admin_delete_user`), after an explicit
   * confirmation (`confirm: true`), at the version read: the database first (the profile marked
   * deleted and inactive, a Technician's "פעיל" off, audited; history and attribution kept); only
   * after it committed, the Auth user is banned on the server, so the account can never sign in
   * again. Never his own account, never a Creator account (OQ-1). A repeated call on an account
   * already deleted repeats only the Auth step (its database refusal proves the caller is the
   * Creator). Returns the deleted profile's version.
   */
  deleteAccount(input: DeleteAccountInput): Promise<CommandResult<VersionedResult>>;
}

/**
 * RETIRED by D60 (7) and Migration 5 (C-02): /dev/demo only (D61 (1)). The database refuses
 * `request_account_change` and `decide_account_request` to every role; no real implementation
 * exists or may be added.
 */
export interface RetiredAccountRequestCommands {
  /**
   * Manager only: a Customer Service create / activate / reactivate / role-change request. Nothing
   * changed until the Creator approved (D34 a); the result carries the new request.
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
}

/** The /dev/demo aggregate (features/data-access/types.ts Commands.accounts). */
export type DemoAccountCommands = AccountCommands & RetiredAccountRequestCommands;
