// The real AccountCommands (D60 (7) unified user management; Step 2 plan §3.8, §3.9; Migration 5
// hand-offs): the orchestration of every account action, with injected clients so the local-stack
// tests run this same code (tests/accounts). lib/actions/accounts.ts wires it per request:
// - `db`: a Supabase client under the CALLER'S OWN SESSION. Every rule is the database's: each
//   action calls its function in `public` (SECURITY INVOKER wrappers of the `private` bodies, which
//   check the caller themselves) and reads stored rows under RLS;
// - `admin`: the narrow Auth Admin port (auth-admin.ts), or UNAVAILABLE_AUTH_ADMIN without a secret
//   key. It is called only AFTER the database authorized the action under the caller's session
//   (D34, docs/security.md §4, §5), and only with values the database returned or checked;
// - `viewer`: the session's user (lib/auth/session.ts, server-validated). Only an early, cheap
//   refusal with the database's own message, and the app-only rules (never the Creator's own
//   credentials, Q22; example.test for test-marked targets, Q17; the Manager's Q14 fields). A wrong
//   viewer can never grant anything: the database decides under the session.
// Every input is untrusted and re-validated (schemas.ts: strict Zod shape, then the shared Hebrew
// rules). Results carry Hebrew business messages only (features/data-access/supabase-errors.ts),
// never a database or Auth text, a password or a token. `log` receives an event name and a code
// only (docs/security.md §8). Nothing here throws to a caller: an exception is the generic message.
import type { SupabaseClient } from "@supabase/supabase-js";
import type { AccountCommands } from "@/features/accounts/data/ports";
import type {
  AccountListEntry,
  AccountRole,
  CompletedTechnicianProfile,
  CreatedAccount,
  CreatedTechnician,
} from "@/features/accounts/data/types";
import {
  accountAdminCallerError,
  creationCallerError,
  isOwnAccount,
  ownCreationIntentError,
  routineUpdateCallerError,
  testAccountEmailError,
  type AccountRequestStored,
  type AccountViewer,
} from "@/features/accounts/data/validate";
import type { SessionUser } from "@/features/auth/data/types";
import { dbRoleOf, uiRoleOf } from "@/features/auth/roles";
import { isUuid, type CommandResult, type VersionedResult } from "@/features/data-access/common";
import {
  ACCOUNT_MESSAGES,
  ACTION_MESSAGES,
  authAdminErrorMessage,
  databaseErrorKind,
  databaseErrorMessage,
  TECHNICIAN_MESSAGES,
} from "@/features/data-access/supabase-errors";
import type { TechnicianColorToken } from "@/features/reference/data/types";
import type { TechnicianSetting } from "@/features/settings/data/types";
import { authUserIdForIntent, type AuthAdminFailure, type AuthAdminPort } from "./auth-admin";
import { accountsQueriesOf, INTENT_COLUMNS, PROFILE_COLUMNS, TECHNICIAN_COLUMNS, type IntentRow, type ProfileRow, type TechnicianRow } from "./queries";
import {
  INVALID_INPUT,
  changeEmailTargetError,
  parseAccountState,
  parseCancelCreation,
  parseChangeEmail,
  parseCompleteCreation,
  parseCompleteTechnicianProfile,
  parseDeleteAccount,
  parseNewAccount,
  parseNewTechnician,
  parseRoleChange,
  parseSetPassword,
  parseUpdateProfile,
  parseUpdateTechnician,
} from "./schemas";

export type AccountCommandsDeps = {
  /** A Supabase client under the caller's own session (RLS; the functions check the caller). */
  db: SupabaseClient;
  /** The Auth Admin port; UNAVAILABLE_AUTH_ADMIN when no secret key is configured. */
  admin: AuthAdminPort;
  /** The server-validated session's user; null without one (every action is refused). */
  viewer: SessionUser | null;
  /** An event name and a short code, never a value (lib/auth/log.ts). */
  log?: (event: string, code: unknown) => void;
};

type DbError = { code?: string; message?: string } | null;

const fail = <T>(error: string): CommandResult<T> => ({ ok: false, simulated: false, error });
const done = <T>(message: string, data?: T): CommandResult<T> =>
  data === undefined ? { ok: true, simulated: false, message } : { ok: true, simulated: false, message, data };

const codeOf = (error: unknown): string | null => {
  const code = typeof error === "object" && error !== null ? (error as { code?: unknown }).code : null;
  return typeof code === "string" ? code : null;
};

/**
 * The message of a failed Auth Admin call: Auth's code mapped to Hebrew; "uncertain" is generic.
 * `forCreator`: the caller is the Creator, who is never told to ask the Creator (review N2).
 */
const authFailureMessage = (failure: AuthAdminFailure, context: { requestRef?: string; forCreator: boolean }): string =>
  failure.kind === "unavailable"
    ? ACTION_MESSAGES.unavailable
    : failure.kind === "refused"
      ? authAdminErrorMessage({ code: failure.code }, context)
      : ACTION_MESSAGES.unknown;

/** A creation intent as the shared rules read it (AccountRequestStored). */
const storedIntent = (row: IntentRow): AccountRequestStored => ({
  status: row.status === "approved" || row.status === "pending" || row.status === "rejected" || row.status === "cancelled" ? row.status : "cancelled",
  version: row.version,
  requestedBy: row.requested_by,
  creation: row.request_type === "direct_create" || row.request_type === "create",
  fulfilled: row.target_profile_id !== null,
  intent: row.request_type === "direct_create",
  requestedRole: uiRoleOf(row.requested_role) ?? "tech",
});

/**
 * A Technician's Settings row as the creation results carry it (TechnicianSetting). A Manager never
 * receives the Outlook email (Q14, review AUTH-N3): "" instead; "פעיל" is the value just stored.
 */
function technicianSettingOf(entry: AccountListEntry): TechnicianSetting | null {
  const t = entry.technician;
  if (!t) return null;
  return {
    id: t.id,
    name: t.name,
    color: t.color,
    phone: entry.phone,
    email: t.outlookEmail ?? "",
    active: t.active ?? true,
    device: t.device,
    version: t.version,
    isTest: t.isTest,
  };
}

/** The Supabase-backed AccountCommands for one request (see the module comment). */
export function accountCommandsOf(deps: AccountCommandsDeps): AccountCommands {
  const { db, admin, viewer } = deps;
  const log = deps.log ?? (() => undefined);
  const queries = accountsQueriesOf(db, viewer);
  const who: AccountViewer | null = viewer ? { id: viewer.id, role: viewer.role } : null;
  /** A failed Auth Admin call's message for this caller (the Creator is never told to ask himself). */
  const authFailure = (failure: AuthAdminFailure, requestRef?: string): string =>
    authFailureMessage(failure, { ...(requestRef ? { requestRef } : {}), forCreator: who?.role === "creator" });

  /** Runs one action; an exception is logged by name and becomes the generic message. */
  async function guarded<T>(event: string, body: (self: AccountViewer) => Promise<CommandResult<T>>): Promise<CommandResult<T>> {
    if (!who) return fail(ACTION_MESSAGES.forbidden);
    try {
      return await body(who);
    } catch {
      log(`accounts.${event}.exception`, "exception");
      return fail(ACTION_MESSAGES.unknown);
    }
  }

  /** A database refusal: logged by its code, shown in Hebrew. */
  function refused<T>(event: string, error: DbError): CommandResult<T> {
    log(`accounts.${event}.refused`, codeOf(error));
    return fail(databaseErrorMessage(error));
  }

  async function rpc<T>(name: string, args: Record<string, unknown>): Promise<{ data: T | null; error: DbError }> {
    const { data, error } = await db.rpc(name, args);
    return { data: (data ?? null) as T | null, error: error ? { code: error.code, message: error.message } : null };
  }

  async function versioned(event: string, name: string, args: Record<string, unknown>, message: string): Promise<CommandResult<VersionedResult>> {
    const { data, error } = await rpc<number>(name, args);
    if (error) return refused(event, error);
    if (typeof data !== "number" || !Number.isSafeInteger(data) || data < 1) return fail(ACTION_MESSAGES.unknown);
    return done(message, { version: data });
  }

  async function readOne<T>(query: PromiseLike<{ data: unknown; error: unknown }>): Promise<T | null> {
    const { data, error } = await query;
    if (error) throw new Error("read failed");
    return Array.isArray(data) ? ((data[0] as T | undefined) ?? null) : ((data as T | null) ?? null);
  }

  const readIntent = (id: string) => readOne<IntentRow>(db.from("account_requests").select(INTENT_COLUMNS).eq("id", id).limit(1));
  const readProfile = (id: string) => readOne<ProfileRow>(db.from("profiles").select(PROFILE_COLUMNS).eq("id", id).limit(1));

  /** Cancels an intent after a definite failure (plan §3.8); a refusal here changes nothing else. */
  async function cancelIntent(event: string, intent: IntentRow): Promise<void> {
    const { error } = await rpc<number>("cancel_account_request", { p_request_id: intent.id, p_expected_version: intent.version });
    if (error) log(`accounts.${event}.cancel_failed`, error.code);
  }

  /**
   * Phases 2 to 4 of a creation (Step 2 plan §3.8) for an open intent the caller may complete: the
   * Auth user (found when an earlier, uncertain attempt created it; else created), the profile bound
   * to it under the caller's session, and for a Technician his field profile. `technician` is set
   * exactly when the intent names a Technician whose field profile is wanted.
   */
  async function finishCreation(
    event: string,
    intent: IntentRow,
    phone: string | null,
    technician: { color: TechnicianColorToken; device: string } | null,
  ): Promise<CommandResult<{ entry: AccountListEntry | null }>> {
    const email = intent.email ?? "";
    const role = intent.requested_role ?? "";
    const userId = await authUserIdForIntent(intent.id);

    // Phase 2. An Auth user with this intent's id exists only if an earlier attempt created it.
    const existing = await admin.getUser(userId);
    if (existing.ok) {
      if (existing.value.intentId !== intent.id || existing.value.email !== email) {
        log(`accounts.${event}.auth_mismatch`, "mismatch");
        return fail(ACTION_MESSAGES.forbidden);
      }
    } else if (existing.kind === "refused" && existing.code === "user_not_found") {
      const created = await admin.createUserForIntent({ userId, intentId: intent.id, email });
      if (!created.ok) {
        log(`accounts.${event}.auth_${created.kind}`, created.kind === "unavailable" ? "unavailable" : created.code);
        if (created.kind === "uncertain") return fail(ACCOUNT_MESSAGES.creationIncomplete);
        if (created.kind === "refused") await cancelIntent(event, intent);
        return fail(authFailure(created, intent.id));
      }
    } else {
      log(`accounts.${event}.auth_lookup_${existing.kind}`, existing.kind === "unavailable" ? "unavailable" : existing.code);
      return fail(existing.kind === "unavailable" ? ACTION_MESSAGES.unavailable : ACCOUNT_MESSAGES.creationIncomplete);
    }

    // Phase 3: the profile, bound to the Auth user under the caller's own session.
    const bound = await rpc<string>("admin_create_profile", {
      p_user_id: userId,
      p_role: role,
      p_full_name: intent.full_name,
      p_work_phone: phone,
      p_invitation_rep_name: null,
      p_request_id: intent.id,
    });
    if (bound.error) {
      if (databaseErrorKind(bound.error) === "forbidden") {
        // Permanent for this Auth user (nonce and time binding): cancel; the Auth user stays (Q16).
        log(`accounts.${event}.bind_refused`, bound.error.code);
        await cancelIntent(event, intent);
        return fail(ACCOUNT_MESSAGES.creationCancelled);
      }
      return refused(`${event}.bind`, bound.error);
    }

    // Phase 4: a Technician's field profile; a failure leaves "פרופיל טכנאי חסר" (plan §3.8).
    if (technician) {
      const t = await rpc<string>("admin_create_technician", {
        p_profile_id: userId,
        p_display_name: intent.full_name,
        p_color: technician.color,
        p_outlook_email: email,
        p_device_label: technician.device,
        p_accepts_invitations: true,
      });
      if (t.error) {
        log(`accounts.${event}.technician_failed`, t.error.code);
        return fail(ACCOUNT_MESSAGES.technicianProfileMissing);
      }
    }
    return done(ACCOUNT_MESSAGES.created, { entry: await queries.get(userId) });
  }

  /** "+ הוסף משתמש": phase 1 under the caller's session, then finishCreation. */
  async function create(
    event: string,
    self: AccountViewer,
    value: { name: string; email: string; phone: string; role: AccountRole },
    technician: { color: TechnicianColorToken; device: string } | null,
  ): Promise<CommandResult<{ entry: AccountListEntry | null }>> {
    // Nothing is created without the Auth Admin API (no intent, no audit row).
    if (!admin.available) return fail(ACTION_MESSAGES.unavailable);
    const authorized = await rpc<string>("authorize_account_creation", {
      p_role: dbRoleOf(value.role),
      p_email: value.email,
      p_full_name: value.name,
    });
    if (authorized.error) return refused(`${event}.authorize`, authorized.error);
    if (!isUuid(authorized.data)) return fail(ACTION_MESSAGES.unknown);
    // The values for the Auth user come only from the row the database stored and lets us read.
    const intent = await readIntent(authorized.data);
    if (
      !intent ||
      ownCreationIntentError(storedIntent(intent), self) !== null ||
      uiRoleOf(intent.requested_role) !== value.role ||
      intent.email !== value.email
    ) {
      log(`accounts.${event}.intent_unreadable`, "intent");
      return fail(ACTION_MESSAGES.forbidden);
    }
    return finishCreation(event, intent, value.phone === "" ? null : value.phone, technician);
  }

  return {
    createAccount: (input) =>
      guarded("create", async (self) => {
        const caller = creationCallerError(self.role, (input as { role?: unknown } | null)?.role);
        if (caller) return fail(caller);
        const parsed = parseNewAccount(input);
        if (!parsed.ok) return fail(parsed.error);
        const r = await create("create", self, parsed.value, null);
        if (!r.ok) return r;
        return r.data?.entry ? done<CreatedAccount>(ACCOUNT_MESSAGES.created, { account: r.data.entry }) : done(ACCOUNT_MESSAGES.created);
      }),

    createTechnician: (input) =>
      guarded("create_technician", async (self) => {
        const caller = creationCallerError(self.role, "tech");
        if (caller) return fail(caller);
        const parsed = parseNewTechnician(input);
        if (!parsed.ok) return fail(parsed.error);
        const { color, device, ...account } = parsed.value;
        const r = await create("create_technician", self, { ...account, role: "tech" }, { color, device });
        if (!r.ok) return r;
        const entry = r.data?.entry ?? null;
        const technician = entry ? technicianSettingOf(entry) : null;
        return entry && technician ? done<CreatedTechnician>(ACCOUNT_MESSAGES.created, { account: entry, technician }) : done(ACCOUNT_MESSAGES.created);
      }),

    completeCreation: (input) =>
      guarded("complete", async (self) => {
        const caller = accountAdminCallerError(self.role);
        if (caller) return fail(caller);
        const parsed = parseCompleteCreation(input);
        if (!parsed.ok) return fail(parsed.error);
        if (!admin.available) return fail(ACTION_MESSAGES.unavailable);
        const intent = await readIntent(parsed.value.requestId);
        const owned = ownCreationIntentError(intent ? storedIntent(intent) : undefined, self);
        if (owned || !intent) return fail(owned ?? ACTION_MESSAGES.forbidden);
        const isTech = intent.requested_role === "technician";
        if (isTech !== (parsed.value.technician !== undefined)) return fail(isTech ? "פרטי הטכנאי לא תקינים" : INVALID_INPUT);
        // The intent was authorized when it was written; the caller's current role and scope are
        // checked again in the database, under his own session, before any Auth Admin call.
        const allowed = await rpc<null>("assert_can_manage", { p_target_role: intent.requested_role });
        if (allowed.error) return refused("complete.assert", allowed.error);
        const r = await finishCreation("complete", intent, parsed.value.phone, parsed.value.technician ?? null);
        if (!r.ok) return r;
        const entry = r.data?.entry ?? null;
        return entry ? done(ACCOUNT_MESSAGES.created, { account: entry, technician: technicianSettingOf(entry) }) : done(ACCOUNT_MESSAGES.created);
      }),

    cancelCreation: (input) =>
      guarded("cancel_creation", async (self) => {
        const parsed = parseCancelCreation(input, self);
        if (!parsed.ok) return fail(parsed.error);
        const intent = await readIntent(parsed.value.intentId);
        // A creation intent only (the retired requests are history, D60 (7)); who may: the database.
        if (!intent || intent.request_type !== "direct_create") return fail(ACTION_MESSAGES.forbidden);
        return versioned(
          "cancel_creation",
          "cancel_account_request",
          { p_request_id: parsed.value.intentId, p_expected_version: parsed.value.expectedVersion },
          ACCOUNT_MESSAGES.cancelled,
        );
      }),

    completeTechnicianProfile: (input) =>
      guarded("complete_technician", async (self) => {
        const caller = accountAdminCallerError(self.role);
        if (caller) return fail(caller);
        const parsed = parseCompleteTechnicianProfile(input);
        if (!parsed.ok) return fail(parsed.error);
        if (!admin.available) return fail(ACTION_MESSAGES.unavailable);
        const { accountId, color, device } = parsed.value;
        // The target under the caller's session first (RLS: out of scope reads as unknown).
        const profile = await readProfile(accountId);
        if (!profile) return fail(ACTION_MESSAGES.forbidden);
        if (profile.deleted_at !== null) return fail(ACCOUNT_MESSAGES.deleted);
        if (profile.role !== "technician") return fail(TECHNICIAN_MESSAGES.notTechnician);
        const existing = await readOne<Pick<TechnicianRow, "id">>(db.from("technicians").select("id").eq("profile_id", accountId).limit(1));
        if (existing) return fail(TECHNICIAN_MESSAGES.hasProfile);
        // The database check under the caller's session before the Auth Admin read of the email.
        const allowed = await rpc<null>("assert_can_manage", { p_target_role: "technician" });
        if (allowed.error) return refused("complete_technician.assert", allowed.error);
        const facts = await admin.getUser(accountId);
        if (!facts.ok || facts.value.email === null) {
          log("accounts.complete_technician.auth_lookup", facts.ok ? "no_email" : facts.kind);
          return fail(facts.ok ? ACTION_MESSAGES.unknown : authFailure(facts));
        }
        const t = await rpc<string>("admin_create_technician", {
          p_profile_id: accountId,
          p_display_name: profile.full_name,
          p_color: color,
          p_outlook_email: facts.value.email,
          p_device_label: device,
          p_accepts_invitations: true,
        });
        if (t.error) return refused("complete_technician", t.error);
        const entry = await queries.get(accountId);
        const technician = entry ? technicianSettingOf(entry) : null;
        return technician ? done<CompletedTechnicianProfile>(ACCOUNT_MESSAGES.saved, { technician }) : done(ACCOUNT_MESSAGES.saved);
      }),

    deactivateAccount: (input) => setActive(input, false),
    activateAccount: (input) => setActive(input, true),

    updateProfile: (input) =>
      guarded("update_profile", async (self) => {
        const caller = accountAdminCallerError(self.role);
        if (caller) return fail(caller);
        const parsed = parseUpdateProfile(input);
        if (!parsed.ok) return fail(parsed.error);
        const v = parsed.value;
        const stored = await readProfile(v.accountId);
        const role = stored ? uiRoleOf(stored.role) : null;
        const who2 = routineUpdateCallerError(self, stored && role ? { id: stored.id, role } : undefined, v);
        if (who2 || !stored) return fail(who2 ?? ACTION_MESSAGES.forbidden);
        // The function replaces all three fields: the unchanged ones are the stored values, protected
        // by the version the screen read (PT409 when the row changed in between).
        return versioned(
          "update_profile",
          "admin_update_profile",
          {
            p_profile_id: v.accountId,
            p_expected_version: v.expectedVersion,
            p_full_name: v.name ?? stored.full_name,
            p_work_phone: v.phone !== undefined ? v.phone : stored.work_phone,
            p_invitation_rep_name: v.invitationAlias !== undefined ? v.invitationAlias : stored.invitation_rep_name,
          },
          ACCOUNT_MESSAGES.saved,
        );
      }),

    updateTechnician: (input) =>
      guarded("update_technician", async (self) => {
        const caller = accountAdminCallerError(self.role);
        if (caller) return fail(caller);
        const parsed = parseUpdateTechnician(input);
        if (!parsed.ok) return fail(parsed.error);
        const v = parsed.value;
        const stored = await readOne<TechnicianRow>(db.from("technicians").select(TECHNICIAN_COLUMNS).eq("id", v.technicianId).limit(1));
        const who2 = routineUpdateCallerError(self, stored ? { id: null, role: "tech" } : undefined, v);
        if (who2 || !stored) return fail(who2 ?? ACTION_MESSAGES.forbidden);
        if (v.outlookEmail !== undefined && stored.is_test) {
          const e = testAccountEmailError(v.outlookEmail);
          if (e) return fail(e);
        }
        return versioned(
          "update_technician",
          "admin_update_technician",
          {
            p_technician_id: v.technicianId,
            p_expected_version: v.expectedVersion,
            p_display_name: v.name ?? stored.display_name,
            p_color: v.color ?? stored.color,
            p_outlook_email: v.outlookEmail ?? stored.outlook_email,
            p_device_label: v.device !== undefined ? v.device : stored.device_label,
            p_accepts_invitations: v.active ?? stored.accepts_invitations,
          },
          ACCOUNT_MESSAGES.saved,
        );
      }),

    changeRole: (input) =>
      guarded("change_role", async (self) => {
        const parsed = parseRoleChange(input, self);
        if (!parsed.ok) return fail(parsed.error);
        const v = parsed.value;
        return versioned(
          "change_role",
          "admin_set_user_role",
          { p_profile_id: v.accountId, p_new_role: dbRoleOf(v.newRole), p_expected_version: v.expectedVersion, p_reason: v.reason ?? null },
          ACCOUNT_MESSAGES.saved,
        );
      }),

    setPassword: (accountId, password) =>
      guarded("password", async (self) => {
        const parsed = parseSetPassword({ accountId, password }, self);
        if (!parsed.ok) return fail(parsed.error);
        if (!admin.available) return fail(ACTION_MESSAGES.unavailable);
        const allowed = await rpc<null>("assert_can_change_credentials", { p_target_profile_id: parsed.value.accountId, p_kind: "password" });
        if (allowed.error) return refused("password.assert", allowed.error);
        const r = await admin.setPassword(parsed.value.accountId, parsed.value.password);
        if (!r.ok) {
          log("accounts.password.auth_failed", r.kind === "unavailable" ? "unavailable" : r.code);
          return fail(authFailure(r));
        }
        return done(ACCOUNT_MESSAGES.passwordSet);
      }),

    changeEmail: (accountId, email) =>
      guarded("email", async (self) => {
        const parsed = parseChangeEmail({ accountId, email }, self);
        if (!parsed.ok) return fail(parsed.error);
        const stored = await readProfile(parsed.value.accountId);
        if (!stored) return fail(ACTION_MESSAGES.forbidden);
        const rule = changeEmailTargetError(parsed.value.email, { isTest: stored.is_test });
        if (rule) return fail(rule);
        if (!admin.available) return fail(ACTION_MESSAGES.unavailable);
        const allowed = await rpc<null>("assert_can_change_credentials", { p_target_profile_id: parsed.value.accountId, p_kind: "email" });
        if (allowed.error) return refused("email.assert", allowed.error);
        const r = await admin.setEmail(parsed.value.accountId, parsed.value.email);
        if (!r.ok) {
          log("accounts.email.auth_failed", r.kind === "unavailable" ? "unavailable" : r.code);
          return fail(authFailure(r));
        }
        return done(ACCOUNT_MESSAGES.emailChanged);
      }),

    deleteAccount: (input) =>
      guarded("delete", async (self) => {
        const parsed = parseDeleteAccount(input, self);
        if (!parsed.ok) return fail(parsed.error);
        const v = parsed.value;
        // All or nothing where the app can tell in advance: without the Auth Admin API nothing changes.
        if (!admin.available) return fail(ACTION_MESSAGES.unavailable);
        const deleted = await rpc<number>("admin_delete_user", {
          p_profile_id: v.accountId,
          p_expected_version: v.expectedVersion,
          p_reason: v.reason ?? null,
        });
        let version: number;
        if (deleted.error) {
          // Already deleted: Migration 5 checks the caller (an active, real Creator), his own account
          // and a Creator target BEFORE this refusal, so it authorizes repeating only the Auth step.
          if (deleted.error.code !== "55000" || deleted.error.message !== "the account is deleted") return refused("delete", deleted.error);
          const stored = await readProfile(v.accountId);
          if (!stored || stored.deleted_at === null) return fail(ACTION_MESSAGES.unknown);
          version = stored.version;
        } else if (typeof deleted.data === "number" && Number.isSafeInteger(deleted.data)) {
          version = deleted.data;
        } else {
          return fail(ACTION_MESSAGES.unknown);
        }
        // Only after the database committed: the Auth side (Option A), sign-in revoked for good. A
        // ban that may not have taken effect (network, timeout, 5xx) is tried once more at once (the
        // ban is idempotent); if it still fails, the screen keeps the account and offers "נסו שוב",
        // which repeats this action: the database refusal above then authorizes the ban alone (S1).
        let revoked = await admin.revokeAccess(v.accountId);
        if (!revoked.ok && revoked.kind === "uncertain") {
          log("accounts.delete.revoke_retry", revoked.code ?? "uncertain");
          revoked = await admin.revokeAccess(v.accountId);
        }
        if (!revoked.ok && !(revoked.kind === "refused" && revoked.code === "user_not_found")) {
          log("accounts.delete.revoke_failed", revoked.kind === "unavailable" ? "unavailable" : revoked.code);
          return fail(ACCOUNT_MESSAGES.revokeIncomplete);
        }
        return done(ACCOUNT_MESSAGES.deletedOk, { version });
      }),
  };

  function setActive(input: unknown, active: boolean): Promise<CommandResult<VersionedResult>> {
    const event = active ? "activate" : "deactivate";
    return guarded(event, async (self) => {
      const caller = accountAdminCallerError(self.role);
      if (caller) return fail(caller);
      const parsed = parseAccountState(input);
      if (!parsed.ok) return fail(parsed.error);
      // Nobody changes his own state (the database refuses it too: 42501).
      if (isOwnAccount(parsed.value.accountId, self)) return fail(ACTION_MESSAGES.forbidden);
      return versioned(
        event,
        "admin_set_user_active",
        { p_profile_id: parsed.value.accountId, p_active: active, p_expected_version: parsed.value.expectedVersion, p_reason: null },
        ACCOUNT_MESSAGES.saved,
      );
    });
  }
}
