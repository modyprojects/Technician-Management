// Server-only access to the Supabase configuration (Step 2 plan §2.3, §3.2). The only module that
// reads the Supabase variables; it passes them to the pure schema (features/auth/env-schema.ts).
// Values are never logged or returned to a client: callers get `configured` and problem codes.
import "server-only";
import { parseSupabasePublicEnv, type SupabasePublicEnv } from "@/features/auth/env-schema";

/**
 * The URL and publishable key, or `configured: false` (fail closed: no Supabase call, every guard
 * denies). Next.js inlines `NEXT_PUBLIC_*` values at build time, so they are read by their full
 * literal names here and a change needs a new build (plan §2.3, R10). The build itself does not
 * need them: without them the app builds and reports "not configured".
 */
export function supabasePublicEnv(): SupabasePublicEnv {
  return parseSupabasePublicEnv({
    url: process.env.NEXT_PUBLIC_SUPABASE_URL,
    publishableKey: process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY,
  });
}
