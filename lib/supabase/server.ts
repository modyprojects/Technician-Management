// Per-request Supabase client under the signed-in user's own session (Step 2 plan §3.2, §3.3).
// Server-only: the publishable key and the session cookies stay on the server, and the app has no
// browser Supabase client (docs/security.md §4: HttpOnly cookies, no tokens in browser storage).
// Every query and RPC through this client runs as the user, so RLS, grants and the database
// functions decide (docs/security.md §5). There is no secret-key client here: the Auth Admin
// client is a separate module that arrives with account administration (plan §3.2, PR 2.6).
import "server-only";
import { createServerClient } from "@supabase/ssr";
import type { SupabaseClient } from "@supabase/supabase-js";
import { cookies, headers } from "next/headers";
import { isHttpsRequest, sessionCookieOptions } from "@/features/auth/session-cookies";
import { supabasePublicEnv } from "./env";

/**
 * A new client for this request (never shared between requests), or null when the Supabase
 * variables are missing or invalid (fail closed: no Supabase call; plan §3.2, S15).
 *
 * Cookie attributes: features/auth/session-cookies.ts (HttpOnly, SameSite=Lax, Path=/, Secure on
 * https), forced on every write.
 *
 * Cookie writes: sign-in and sign-out (server actions) and the proxy write the session cookies
 * (plan §3.3, §3.6). A Server Component cannot set cookies: Next.js throws, the write is skipped
 * here, and the proxy's refresh keeps the session current. The library's no-store cache headers
 * that come with a cookie write are applied where a response is built (the proxy, PR 2.5); a
 * server action's POST response is not cached.
 */
export async function createUserSupabaseClient(): Promise<SupabaseClient | null> {
  const env = supabasePublicEnv();
  if (!env.configured) return null;
  const [cookieStore, requestHeaders] = await Promise.all([cookies(), headers()]);
  const secure = isHttpsRequest(requestHeaders.get("x-forwarded-proto"));
  return createServerClient(env.url, env.publishableKey, {
    cookieOptions: sessionCookieOptions({}, secure),
    cookies: {
      getAll: () => cookieStore.getAll(),
      setAll: (cookiesToSet) => {
        try {
          for (const { name, value, options } of cookiesToSet) {
            cookieStore.set(name, value, sessionCookieOptions(options, secure));
          }
        } catch {
          // Called from a Server Component, which cannot write cookies (see above). A server
          // action can write them, so this catch would also hide a failed write there: the sign-in
          // and sign-out actions (PR 2.5) must not rely on it and must check the outcome themselves
          // (log an event name and code only, docs/security.md §8).
        }
      },
    },
  });
}
