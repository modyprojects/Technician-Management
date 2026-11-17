// The one Auth Admin call of the self-service password reset (D65; docs/security.md §2, §4).
// Server-only and narrow: it creates a recovery token for an address and returns only the token's
// hash, from which the app builds its OWN link (`<app origin>/login/reset?token_hash=…`). Supabase's
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

export type RecoveryTokenResult = { ok: true; tokenHash: string } | { ok: false; code: string | number };

function adminEnv() {
  return parseSupabaseAdminEnv({ url: process.env.NEXT_PUBLIC_SUPABASE_URL, secretKey: process.env.SUPABASE_SECRET_KEY });
}

/** Whether this environment can create recovery tokens (the URL and a valid secret key are set). */
export function recoveryAdminConfigured(): boolean {
  return adminEnv().configured;
}

/**
 * A recovery token hash for `email`, or a refusal code: "unavailable" (not configured), the Auth
 * error code (for example "user_not_found" for an unknown address), "malformed" or "exception".
 * The caller treats every refusal alike, so the answer never reveals whether an account exists.
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
    return isRecoveryTokenHash(tokenHash) ? { ok: true, tokenHash } : { ok: false, code: "malformed" };
  } catch {
    return { ok: false, code: "exception" };
  }
}
