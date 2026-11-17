"use server";

// Account administration server actions (D60 (7) unified user management; QA M-06, M-10, C-01,
// C-02; Step 2 plan §3.7–§3.9). No screen calls them yet: the user-management screen waits for the
// owner's approval of the previous screen (D62). Each action:
// - takes its input as `unknown` and re-validates it (strict Zod shape, then the shared Hebrew rules:
//   features/accounts/supabase/schemas.ts);
// - takes the caller from the server-validated session (lib/auth/session.ts), never from the input;
// - lets the database decide under the caller's own session (RLS and the account functions) BEFORE
//   any Auth Admin call, which only lib/supabase/admin.ts can make with the secret key;
// - answers with Hebrew business messages only (features/data-access/supabase-errors.ts): never a
//   database or Auth text, a stack trace, a password or a token (docs/security.md §8).
// Next.js checks the Origin of every server-action POST against the Host. The logic is
// features/accounts/supabase/commands.ts, which the local-stack tests run with real clients.
import "server-only";
import type { AccountCommands } from "@/features/accounts/data/ports";
import type {
  CompletedCreation,
  CompletedTechnicianProfile,
  CreatedAccount,
  CreatedTechnician,
} from "@/features/accounts/data/types";
import { accountCommandsOf } from "@/features/accounts/supabase/commands";
import { INVALID_INPUT } from "@/features/accounts/supabase/schemas";
import { ACTION_MESSAGES } from "@/features/data-access/supabase-errors";
import type { CommandResult, VersionedResult } from "@/features/data-access/common";
import { logAuthEvent } from "@/lib/auth/log";
import { getSessionState } from "@/lib/auth/session";
import { authAdmin } from "@/lib/supabase/admin";
import { createUserSupabaseClient } from "@/lib/supabase/server";

/** The commands of this request's caller, or a refusal (no session: forbidden; no configuration: unavailable). */
async function withCommands<T>(run: (commands: AccountCommands) => Promise<CommandResult<T>>): Promise<CommandResult<T>> {
  try {
    const state = await getSessionState();
    if (state.kind === "unavailable") return { ok: false, simulated: false, error: ACTION_MESSAGES.unavailable };
    if (state.kind !== "signed-in") return { ok: false, simulated: false, error: ACTION_MESSAGES.forbidden };
    const db = await createUserSupabaseClient();
    if (!db) return { ok: false, simulated: false, error: ACTION_MESSAGES.unavailable };
    return await run(accountCommandsOf({ db, admin: authAdmin(), viewer: state.user, log: logAuthEvent }));
  } catch {
    logAuthEvent("accounts.action.exception", "exception");
    return { ok: false, simulated: false, error: ACTION_MESSAGES.unknown };
  }
}

// The port types describe what a screen sends; the values arrive untrusted, so every command
// re-validates them itself (the casts below only satisfy the port's signature).

/** "+ הוסף משתמש" for an office role (the Creator: Manager or Customer Service; the Manager: Customer Service). */
export async function createAccount(input: unknown): Promise<CommandResult<CreatedAccount>> {
  return withCommands((c) => c.createAccount(input as never));
}

/** "+ הוסף משתמש" with the Technician role: the account and its field profile (Creator or Manager). */
export async function createTechnician(input: unknown): Promise<CommandResult<CreatedTechnician>> {
  return withCommands((c) => c.createTechnician(input as never));
}

/** "השלמת יצירה" of the caller's own incomplete creation. */
export async function completeCreation(input: unknown): Promise<CommandResult<CompletedCreation>> {
  return withCommands((c) => c.completeCreation(input as never));
}

/** "ביטול" of an incomplete creation. */
export async function cancelCreation(input: unknown): Promise<CommandResult<VersionedResult>> {
  return withCommands((c) => c.cancelCreation(input as never));
}

/** "השלמה" of "פרופיל טכנאי חסר". */
export async function completeTechnicianProfile(input: unknown): Promise<CommandResult<CompletedTechnicianProfile>> {
  return withCommands((c) => c.completeTechnicianProfile(input as never));
}

/** Immediate deactivation (audited; the Creator is notified of a Manager's). */
export async function deactivateAccount(input: unknown): Promise<CommandResult<VersionedResult>> {
  return withCommands((c) => c.deactivateAccount(input as never));
}

/** Immediate activation or reactivation (never of a deleted account). */
export async function activateAccount(input: unknown): Promise<CommandResult<VersionedResult>> {
  return withCommands((c) => c.activateAccount(input as never));
}

/** Routine profile update: name, work phone, invitation alias (never the email). */
export async function updateProfile(input: unknown): Promise<CommandResult<VersionedResult>> {
  return withCommands((c) => c.updateProfile(input as never));
}

/** Routine technician update: name, colour, device; the Outlook email and "פעיל" by the Creator only. */
export async function updateTechnician(input: unknown): Promise<CommandResult<VersionedResult>> {
  return withCommands((c) => c.updateTechnician(input as never));
}

/** The Creator's role change. */
export async function changeRole(input: unknown): Promise<CommandResult<VersionedResult>> {
  return withCommands((c) => c.changeRole(input as never));
}

/** The Creator sets another account's password: `{ accountId, password }`. Nothing is returned. */
export async function setPassword(input: unknown): Promise<CommandResult> {
  const v = typeof input === "object" && input !== null ? (input as { accountId?: unknown; password?: unknown }) : {};
  const extra = typeof input === "object" && input !== null && Object.keys(input).some((k) => k !== "accountId" && k !== "password");
  if (extra) return { ok: false, simulated: false, error: INVALID_INPUT };
  return withCommands((c) => c.setPassword(v.accountId as never, v.password as never));
}

/** The Creator changes another account's sign-in email: `{ accountId, email }`. */
export async function changeEmail(input: unknown): Promise<CommandResult> {
  const v = typeof input === "object" && input !== null ? (input as { accountId?: unknown; email?: unknown }) : {};
  const extra = typeof input === "object" && input !== null && Object.keys(input).some((k) => k !== "accountId" && k !== "email");
  if (extra) return { ok: false, simulated: false, error: INVALID_INPUT };
  return withCommands((c) => c.changeEmail(v.accountId as never, v.email as never));
}

/** The Creator's deletion, with its explicit confirmation: `{ accountId, expectedVersion, confirm: true, reason? }`. */
export async function deleteAccount(input: unknown): Promise<CommandResult<VersionedResult>> {
  return withCommands((c) => c.deleteAccount(input as never));
}
