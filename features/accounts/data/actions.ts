// The real account server actions as a screen receives them (D60 (7) unified user management;
// Step 2). Pure types and one pure adapter: no I/O, no secret, no server code.
// - AccountActions: the shape of the 13 `"use server"` actions of lib/actions/accounts.ts. The page
//   (a Server Component under app/(office)) passes them as props, so components/ never imports
//   lib/actions. Each takes its input as `unknown` (the server re-validates every value) and answers
//   a CommandResult with Hebrew business messages only (`simulated` is always false).
// - accountCommandsOfActions: the AccountCommands port over those actions, so the shared account
//   dialogs (components/office/Account*Form*.tsx) run the real actions through the same port the
//   /dev/demo prototype implements with simulated commands. The only shape change: the port's
//   setPassword(accountId, password) and changeEmail(accountId, email) become one input object.
// A hidden button is not access control: the server takes the caller from the session and the
// database decides under that session before any Auth Admin call (lib/actions/accounts.ts).
import type { CommandResult, VersionedResult } from "@/features/data-access/common";
import type { AccountCommands } from "./ports";
import type {
  CompletedCreation,
  CompletedTechnicianProfile,
  CreatedAccount,
  CreatedTechnician,
} from "./types";

/** One server action: an untrusted input in, a CommandResult out. */
type Action<T = void> = (input: unknown) => Promise<CommandResult<T>>;

/** The real account actions (lib/actions/accounts.ts), as the page hands them to the screen. */
export type AccountActions = {
  createAccount: Action<CreatedAccount>;
  createTechnician: Action<CreatedTechnician>;
  completeCreation: Action<CompletedCreation>;
  cancelCreation: Action<VersionedResult>;
  completeTechnicianProfile: Action<CompletedTechnicianProfile>;
  deactivateAccount: Action<VersionedResult>;
  activateAccount: Action<VersionedResult>;
  updateProfile: Action<VersionedResult>;
  updateTechnician: Action<VersionedResult>;
  changeRole: Action<VersionedResult>;
  setPassword: Action;
  changeEmail: Action;
  deleteAccount: Action<VersionedResult>;
};

/** The names of the 13 actions, in the order of lib/actions/accounts.ts. */
export const ACCOUNT_ACTION_NAMES = [
  "createAccount",
  "createTechnician",
  "completeCreation",
  "cancelCreation",
  "completeTechnicianProfile",
  "deactivateAccount",
  "activateAccount",
  "updateProfile",
  "updateTechnician",
  "changeRole",
  "setPassword",
  "changeEmail",
  "deleteAccount",
] as const satisfies readonly (keyof AccountActions)[];

/**
 * The AccountCommands port over the real actions. Every value goes to the server as given; the
 * password is passed straight through (never kept, logged or returned here).
 */
export function accountCommandsOfActions(actions: AccountActions): AccountCommands {
  return {
    createAccount: (input) => actions.createAccount(input),
    createTechnician: (input) => actions.createTechnician(input),
    completeCreation: (input) => actions.completeCreation(input),
    cancelCreation: (input) => actions.cancelCreation(input),
    completeTechnicianProfile: (input) => actions.completeTechnicianProfile(input),
    deactivateAccount: (input) => actions.deactivateAccount(input),
    activateAccount: (input) => actions.activateAccount(input),
    updateProfile: (input) => actions.updateProfile(input),
    updateTechnician: (input) => actions.updateTechnician(input),
    changeRole: (input) => actions.changeRole(input),
    setPassword: (accountId, password) => actions.setPassword({ accountId, password }),
    changeEmail: (accountId, email) => actions.changeEmail({ accountId, email }),
    deleteAccount: (input) => actions.deleteAccount(input),
  };
}
