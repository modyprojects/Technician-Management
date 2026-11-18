// The Auth Admin port (Step 2 plan §3.2 "Admin client"; D60 (7); docs/security.md §4, §5): the
// narrow Auth Admin functions account administration needs, over a secret-key Supabase client that
// lib/supabase/admin.ts builds and never exports. This module reads no configuration and holds no
// secret (the injected client does), so the local-stack tests run the same code (tests/accounts).
// The flows (commands.ts) call it only after the database authorized the action under the caller's
// own session. It never calls an RPC, never reads or writes `public` tables, never inserts a
// profile, never writes a role into metadata and never hard-deletes a user (docs/database-schema.md
// §8.5). Nothing here logs, and no result carries a password, a token or Auth's own error text.
import type { SupabaseClient, User } from "@supabase/supabase-js";

/**
 * Why an Auth Admin call failed, for the flows' failure table (Step 2 plan §3.8):
 * - "unavailable": no secret key is configured; nothing was attempted;
 * - "refused": a definite refusal (HTTP 4xx other than 408): nothing took effect; `code` is the
 *   Auth error code (`email_exists`, `weak_password`, `user_not_found` …), mapped to Hebrew by
 *   authAdminErrorMessage;
 * - "uncertain": a network failure, a timeout or a server error: the call may have taken effect.
 */
export type AuthAdminFailure =
  | { ok: false; kind: "unavailable" }
  | { ok: false; kind: "refused"; code: string | null }
  | { ok: false; kind: "uncertain"; code: string | null };

export type AuthAdminResult<T = undefined> = { ok: true; value: T } | AuthAdminFailure;

/** What the flows check about an Auth user: never a password, a token or other metadata. */
export type AuthUserFacts = {
  id: string;
  /** Lower-case sign-in email; null when Auth holds none. */
  email: string | null;
  /** `app_metadata.account_request_id`: the creation intent that created it (the binding nonce). */
  intentId: string | null;
  /** Whether the user is banned now (Option A deletion). */
  banned: boolean;
};

export interface AuthAdminPort {
  /** False when no valid secret key is configured: every call answers "unavailable". */
  readonly available: boolean;
  /**
   * Phase 2 of a creation (Step 2 plan §3.8): the Auth user of creation intent `intentId`, with the
   * id `userId` (authUserIdForIntent, so a retry finds it), the intent row's email, confirmed
   * (`email_confirm: true`: no email is sent, D50) and NO password (the Creator sets one, D34 e).
   * `app_metadata` = { account_request_id: intentId, is_test: true }: the nonce Migration 5
   * `admin_create_profile` binds, and the D47 marker (every account created through the app until
   * go-live is test-marked). Never a role.
   */
  createUserForIntent(input: { userId: string; intentId: string; email: string }): Promise<AuthAdminResult<AuthUserFacts>>;
  /** The facts of one Auth user; "refused" with `user_not_found` when there is none. */
  getUser(userId: string): Promise<AuthAdminResult<AuthUserFacts>>;
  /** Sets the password (the Creator's, after `assert_can_change_credentials`). */
  setPassword(userId: string, password: string): Promise<AuthAdminResult>;
  /** Sets the sign-in email, confirmed (after `assert_can_change_credentials`; no email is sent). */
  setEmail(userId: string, email: string): Promise<AuthAdminResult>;
  /**
   * The Auth side of a deletion (D60 (7) Option A; Migration 5 hand-off), after `admin_delete_user`
   * committed: bans the user for good (BAN_DURATION). Auth then refuses the user's sign-in, token
   * refresh and user lookup (`user_banned`), so every existing session ends at its next use; the
   * user row, its email and its D47 metadata stay (a hard delete cannot succeed: profiles.id
   * references auth.users ON DELETE RESTRICT; a soft delete would erase the D47 marker).
   */
  revokeAccess(userId: string): Promise<AuthAdminResult>;
}

/** About 100 years: Supabase Auth's documented way to ban a user indefinitely. */
export const BAN_DURATION = "876000h";

const UNAVAILABLE: AuthAdminFailure = { ok: false, kind: "unavailable" };

/** The port when no valid secret key is configured: nothing is ever attempted. */
export const UNAVAILABLE_AUTH_ADMIN: AuthAdminPort = Object.freeze({
  available: false,
  createUserForIntent: async () => UNAVAILABLE,
  getUser: async () => UNAVAILABLE,
  setPassword: async () => UNAVAILABLE,
  setEmail: async () => UNAVAILABLE,
  revokeAccess: async () => UNAVAILABLE,
});

const CODE = /^[a-z0-9_]{1,64}$/;

/**
 * The failure kind of an Auth Admin error, or of an exception thrown around the call. Read by HTTP
 * status and Auth error code only (never the message). A 4xx is definite (408 Request Timeout is
 * not); everything else, including a network failure (status 0) and an unknown value, is uncertain.
 */
export function authAdminFailureOf(error: unknown): AuthAdminFailure {
  const record = typeof error === "object" && error !== null ? (error as { status?: unknown; code?: unknown }) : {};
  const code = typeof record.code === "string" && CODE.test(record.code) ? record.code : null;
  const status = typeof record.status === "number" && Number.isInteger(record.status) ? record.status : null;
  if (status !== null && status >= 400 && status < 500 && status !== 408) return { ok: false, kind: "refused", code };
  return { ok: false, kind: "uncertain", code };
}

const factsOf = (user: User): AuthUserFacts => {
  const nonce: unknown = user.app_metadata?.account_request_id;
  const bannedUntil = (user as { banned_until?: unknown }).banned_until;
  return {
    id: user.id,
    email: typeof user.email === "string" && user.email !== "" ? user.email.toLowerCase() : null,
    intentId: typeof nonce === "string" ? nonce : null,
    banned: typeof bannedUntil === "string" && Date.parse(bannedUntil) > Date.now(),
  };
};

/** A UUID as supabase-js and Auth accept it (any version); anything else is never sent. */
const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;

/** "refused" for an id the client library would throw on (nothing is sent). */
const BAD_ID: AuthAdminFailure = { ok: false, kind: "refused", code: "validation_failed" };

/**
 * The Auth Admin port over `client`, a Supabase client built with the secret key and no session
 * (`persistSession`, `autoRefreshToken` and `detectSessionInUrl` off). Every call is caught: an
 * exception is classified (authAdminFailureOf) and never rethrown to a caller.
 */
export function authAdminPortOf(client: SupabaseClient): AuthAdminPort {
  const admin = client.auth.admin;

  async function call<T>(work: () => Promise<{ data: { user: User | null }; error: unknown }>, value: (user: User) => T): Promise<AuthAdminResult<T>> {
    try {
      const { data, error } = await work();
      if (error) return authAdminFailureOf(error);
      if (!data.user) return { ok: false, kind: "uncertain", code: null };
      return { ok: true, value: value(data.user) };
    } catch (error) {
      return authAdminFailureOf(error);
    }
  }

  return {
    available: true,
    createUserForIntent: async ({ userId, intentId, email }) => {
      if (!UUID.test(userId) || !UUID.test(intentId)) return BAD_ID;
      return call(
        () =>
          admin.createUser({
            id: userId,
            email,
            email_confirm: true,
            app_metadata: { account_request_id: intentId.toLowerCase(), is_test: true },
          }),
        factsOf,
      );
    },
    getUser: async (userId) => (UUID.test(userId) ? call(() => admin.getUserById(userId), factsOf) : BAD_ID),
    setPassword: async (userId, password) =>
      UUID.test(userId) ? call(() => admin.updateUserById(userId, { password }), () => undefined) : BAD_ID,
    setEmail: async (userId, email) =>
      UUID.test(userId) ? call(() => admin.updateUserById(userId, { email, email_confirm: true }), () => undefined) : BAD_ID,
    revokeAccess: async (userId) =>
      UUID.test(userId) ? call(() => admin.updateUserById(userId, { ban_duration: BAN_DURATION }), () => undefined) : BAD_ID,
  };
}

/**
 * The Auth user id of creation intent `intentId`: a name-based UUID (RFC 9562 version 8) from
 * SHA-256 of a fixed label and the intent id, so a retry of an uncertain phase 2 finds the user an
 * earlier attempt may have created instead of creating a second one (Step 2 plan §3.8 "Retry").
 * Ids are not secrets: the binding is the intent nonce in `app_metadata`, which only the secret key
 * can write, and the database checks it (Migration 5 `admin_create_profile`).
 */
export async function authUserIdForIntent(intentId: string): Promise<string> {
  const bytes = new Uint8Array(
    await globalThis.crypto.subtle.digest("SHA-256", new TextEncoder().encode(`tm.auth-user.v1:${intentId.toLowerCase()}`)),
  ).slice(0, 16);
  bytes[6] = ((bytes[6] ?? 0) & 0x0f) | 0x80;
  bytes[8] = ((bytes[8] ?? 0) & 0x3f) | 0x80;
  const hex = [...bytes].map((b) => b.toString(16).padStart(2, "0")).join("");
  return `${hex.slice(0, 8)}-${hex.slice(8, 12)}-${hex.slice(12, 16)}-${hex.slice(16, 20)}-${hex.slice(20)}`;
}
