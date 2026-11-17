// The one Auth Admin call of the self-service password reset (D65; docs/security.md §2, §4).
// Server-only and narrow: it creates a recovery token for an address and returns only the token's
// hash and the account's own address (the email goes there, never to the typed spelling: review
// fix 4), from which the app builds its OWN link (`<app origin>/login/reset?token_hash=…`). Supabase's
// mailer, email templates, Site URL and redirect settings are not involved, so no remote Auth or
// email setting changes, and `generateLink` itself sends nothing.
//
// The secret key (SUPABASE_SECRET_KEY) is read at call time, validated by the shared schema
// (features/auth/env-schema.ts parseSupabaseAdminEnv), used at once by a client built for this
// call (no session kept, no refresh, no URL detection) and never stored, logged or returned. The
// client object is never exported. Without a valid key every call is "unavailable".
// A new token replaces the address's earlier one (the Auth server keeps one recovery token per
// user): the caller throttles requests (features/auth/password-reset/throttle.ts).
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { parseSupabaseAdminEnv } from "@/features/auth/env-schema";
import { isRecoveryTokenHash } from "@/features/auth/password-reset/input";

/**
 * Two facts for the caller, which then sends nothing: `banned`, the account is banned now (a deleted
 * account, D60 (7) Option A; review N4); `signedInBefore`, Auth holds a last sign-in time (D67 (a):
 * only accounts that have signed in before reset their own password). Auth gives no lookup by
 * address before `generateLink`, so the facts come with it.
 */
export type RecoveryTokenResult =
  | { ok: true; tokenHash: string; email: string; banned: boolean; signedInBefore: boolean }
  | { ok: false; code: string | number };

/** An address as the Auth server returns it: no spaces, controls or angle brackets, bounded. */
const ACCOUNT_EMAIL_PATTERN = /^[^\s@<>]+@[^\s@<>]+$/;

function accountEmailOf(value: unknown): string | null {
  return typeof value === "string" && value.length <= 320 && ACCOUNT_EMAIL_PATTERN.test(value) ? value : null;
}

/** Whether Auth's `banned_until` lies in the future (anything else: not banned). */
function bannedNow(value: unknown): boolean {
  return typeof value === "string" && Date.parse(value) > Date.now();
}

/** Whether Auth's `last_sign_in_at` is a time (anything else: never signed in, fail closed). */
function signedInBefore(value: unknown): boolean {
  return typeof value === "string" && Number.isFinite(Date.parse(value));
}

function adminEnv() {
  return parseSupabaseAdminEnv({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY });
}

/** Whether this environment can create recovery tokens (the URL and a valid secret key are set). */
export function recoveryAdminConfigured(): boolean {
  return adminEnv().configured;
}

/**
 * A recovery token hash for `email`, the account's own address (`data.user.email`), whether it is
 * banned now and whether it has signed in before, or a refusal code: "unavailable" (not configured), the Auth error code (for example
 * "user_not_found" for an unknown address), "malformed" (no well-formed hash or address) or
 * "exception". The caller runs this after its response and treats every refusal (and a skipped
 * account) alike, so the answer never reveals whether an account exists.
 */
export async function createRecoveryTokenHash(email: string): Promise<RecoveryTokenResult> {
  const env = adminEnv();
  if (!env.configured) return { ok: false, code: "unavailable" };
  const client = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  try {
    const { data, error } = await client.auth.admin.generateLink({ type: "recovery", email });
    if (error) return { ok: false, code: error.code ?? error.status ?? "error" };
    const tokenHash = data?.properties?.hashed_token;
    const accountEmail = accountEmailOf(data?.user?.email);
    if (!isRecoveryTokenHash(tokenHash) || accountEmail === null) return { ok: false, code: "malformed" };
    const user = data.user as { banned_until?: unknown; last_sign_in_at?: unknown };
    return { ok: true, tokenHash, email: accountEmail, banned: bannedNow(user.banned_until), signedInBefore: signedInBefore(user.last_sign_in_at) };
  } catch {
    return { ok: false, code: "exception" };
  }
}
