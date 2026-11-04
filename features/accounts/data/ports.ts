// Account-administration ports (SE-01, D34). Implemented by app/dev/demo/_data/adapter.ts
// (queries, fictional fixtures), app/dev/demo/_components/SimulatedCommands.tsx (commands,
// simulated) and, later, by server functions that check authorization in the database under the
// caller's own session before any Auth admin call (D34). The caller's role comes from the session,
// never from an argument; a screen only decides what to offer (G-04).
import type { CommandResult, Page } from "@/features/data-access/common";
import type {
  AccountDecision,
  AccountId,
  AccountListQuery,
  AccountRequest,
  AccountRequestId,
  AccountRequestInput,
  AccountRequestQuery,
  CreatedAccount,
  CreatedAccountRequest,
  CreatedTechnician,
  NewAccountInput,
  NewTechnicianInput,
  UserAccount,
} from "./types";

export interface AccountsQueries {
  /**
   * Accounts by role (creator, mgr, cs, tech) then name (Hebrew collation), optionally filtered by
   * role; paged. A role filter with no known role matches nothing (never every account).
   */
  list(query?: AccountListQuery): Promise<Page<UserAccount>>;
  /**
   * Account requests, newest first, optionally filtered by status; paged. A status filter with no
   * known status matches nothing.
   */
  requests(query?: AccountRequestQuery): Promise<Page<AccountRequest>>;
}

/**
 * Account actions. Results say whether they were simulated (UI demo: always); a create returns
 * the record as stored, so a screen never builds ids or test markers itself.
 */
export interface AccountCommands {
  /** Creator only: creates an account of any role, immediately (D34). */
  createAccount(input: NewAccountInput): Promise<CommandResult<CreatedAccount>>;
  /**
   * Manager: a Customer Service create / activate / reactivate / role-change request. Nothing
   * changes until the Creator approves (D34 a); the result carries the new request. The
   * implementation checks the target account's current role against stored data (the input
   * validator checks only the shape): a Manager must never gain extra privileges (D34).
   */
  requestAccount(input: AccountRequestInput): Promise<CommandResult<CreatedAccountRequest>>;
  /** Creator only: approves or rejects a pending request; a rejection needs a reason. */
  decideAccountRequest(requestId: AccountRequestId, decision: AccountDecision): Promise<CommandResult>;
  /** Cancels a pending request (its Manager, or the Creator). */
  cancelAccountRequest(requestId: AccountRequestId): Promise<CommandResult>;
  /**
   * Deactivates an account immediately, without approval (D34 b): the Manager for Customer Service
   * and Technician accounts, the Creator for any but its own. Audited; a Manager's deactivation
   * notifies the Creator in the app. Accounts are deactivated, never deleted
   * (docs/database-schema.md).
   */
  deactivateAccount(accountId: AccountId): Promise<CommandResult>;
  /**
   * Activates or reactivates an account immediately: the Creator for any, the Manager for
   * Technician accounts only (D34 c). A Manager's Customer Service activation is a request.
   */
  activateAccount(accountId: AccountId): Promise<CommandResult>;
  /** Manager or Creator: a technician account with its Settings row, immediately (D34 c). */
  createTechnician(input: NewTechnicianInput): Promise<CommandResult<CreatedTechnician>>;
}
