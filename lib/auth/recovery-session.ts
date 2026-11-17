// Whether the request's session may set a new password (D65). Server-only: the verified claims of
// the session (getClaims) checked by the pure rule in features/auth/password-reset/recovery-session.ts
// (a reset-link verification within the last hour, never an ordinary password session).
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { isRecentRecoverySession } from "@/features/auth/password-reset/recovery-session";

export async function hasRecentRecoverySession(client: SupabaseClient): Promise<boolean> {
  try {
    const { data, error } = await client.auth.getClaims();
    if (error || !data) return false;
    return isRecentRecoverySession(data.claims, Math.floor(Date.now() / 1000));
  } catch {
    return false;
  }
}
