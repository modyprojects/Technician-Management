// The Auth Admin client (Step 2 plan §3.2 "Admin client"; D60 (7) account administration;
// docs/security.md §2, §4, §5). Server-only: the secret key never reaches a browser, a log, a
// response or a client bundle. It reads SUPABASE_SECRET_KEY and NEXT_PUBLIC_SUPABASE_URL at call
// time (never at module load, never cached across requests). Without a valid key every call is
// "unavailable": the actions that need the Auth Admin API refuse with a Hebrew message and nothing
// is created; sign-in and every other action are unaffected.
// The client object is never exported: callers get only the narrow port (features/accounts/
// supabase/auth-admin.ts: create a user for a creation intent, read its facts, set a password, set
// an email, ban for a deletion). It is used only for Auth Admin calls after a database authorization
// check under the caller's own session, never for ordinary reads or writes of `public` tables.
import "server-only";
import { createClient } from "@supabase/supabase-js";
import { authAdminPortOf, UNAVAILABLE_AUTH_ADMIN, type AuthAdminPort } from "@/features/accounts/supabase/auth-admin";
import { parseSupabaseAdminEnv } from "@/features/auth/env-schema";

/** The Auth Admin port for this call, or the "unavailable" port when the configuration is unusable. */
export function authAdmin(): AuthAdminPort {
  const env = parseSupabaseAdminEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    secretKey: process.env.SUPABASE_SECRET_KEY,
  });
  if (!env.configured) return UNAVAILABLE_AUTH_ADMIN;
  const client = createClient(env.url, env.secretKey, {
    auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false },
  });
  return authAdminPortOf(client);
}
