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
  NewAccountInput,
  NewTechnicianInput,
  UserAccount,
} from "./types";

export interface AccountsQueries {
  /** Accounts by role (creator, mgr, cs, tech) then name, optionally filtered by role; paged. */
  list(query?: AccountListQuery): Promise<Page<UserAccount>>;
  /** Account requests, newest first, optionally filtered by status; paged. */
  requests(query?: AccountRequestQuery): Promise<Page<AccountRequest>>;
}

/** Account actions. Results say whether they were simulated (UI demo: always). */
export interface AccountCommands {
  /** Creator only: creates an account of any role, immediately (D34). */
  createAccount(input: NewAccountInput): Promise<CommandResult<{ accountId: AccountId }>>;
  /**
   * Manager: a Customer Service create / activate / reactivate / role-change request. Nothing
   * changes until the Creator approves (D34 a); the result carries the new request's id.
   */
  requestAccount(input: AccountRequestInput): Promise<CommandResult<{ requestId: AccountRequestId }>>;
  /** Creator only: approves or rejects a pending request; a rejection needs a reason. */
  decideAccountRequest(requestId: AccountRequestId, decision: AccountDecision): Promise<CommandResult>;
  /** Cancels a pending request (its Manager, or the Creator). */
  cancelAccountRequest(requestId: AccountRequestId): Promise<CommandResult>;
  /**
   * Deactivates an account immediately, without approval (D34 b): the Manager for Customer Service
   * and Technician accounts, the Creator for any. Audited; the Creator is notified in the app.
   * Deactivation, never deletion, for an account that history references (SE-06 principle).
   */
  deactivateAccount(accountId: AccountId): Promise<CommandResult>;
  /**
   * Activates or reactivates an account immediately: the Creator for any, the Manager for
   * Technician accounts only (D34 c). A Manager's Customer Service activation is a request.
   */
  activateAccount(accountId: AccountId): Promise<CommandResult>;
  /** Manager or Creator: a technician account with its Settings row, immediately (D34 c). */
  createTechnician(input: NewTechnicianInput): Promise<CommandResult<{ accountId: AccountId }>>;
}
