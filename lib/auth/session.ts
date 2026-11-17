// The request's session (Step 2 plan §3.3; Step 2 PR 2.5). Server-only.
// `auth.getUser()` (validated by the Auth server), then the session's verified claims
// (`auth.getClaims()`): a session the password-reset link created is for the reset screen only and
// counts as anonymous here (D65, independent review fix 2;
// features/auth/password-reset/recovery-session.ts isAppSessionClaims). Then the user's own
// `profiles` row under the same session (RLS: an active profile reads its own row only), then, for
// a Technician, his technician record (`my_technician_id()`). The role comes only from `profiles`
// (docs/security.md §5). It never signs anyone out and never writes cookies itself: a Server
// Component cannot.
import "server-only";
import type { SupabaseClient } from "@supabase/supabase-js";
import { connection } from "next/server";
import { cache } from "react";
import type { SessionQueries } from "@/features/auth/data/ports";
import { sessionUserOf } from "@/features/auth/data/session";
import { isAppSessionClaims } from "@/features/auth/password-reset/recovery-session";
import { uiRoleOf } from "@/features/auth/roles";
import { userLookupFailure, type SessionState } from "@/features/auth/session-state";
import { databaseErrorKind } from "@/features/data-access/supabase-errors";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { logAuthEvent } from "./log";

const UNAVAILABLE: SessionState = { kind: "unavailable" };
const ANONYMOUS: SessionState = { kind: "anonymous" };
const NO_ACCESS: SessionState = { kind: "no-access" };

/** Profile columns the session reads (Migration 1 `profiles`). */
type ProfileRow = { id: string; role: string; full_name: string; is_active: boolean; is_test: boolean };

/**
 * The session state of `client`'s user `userId`, read under that user's own session. Shared by the
 * per-request state and the sign-in action (which reads it right after `signInWithPassword`).
 */
export async function sessionStateOf(client: SupabaseClient, userId: string): Promise<SessionState> {
  const { data, error } = await client
    .from("profiles")
    .select("id, role, full_name, is_active, is_test")
    .eq("id", userId)
    .maybeSingle<ProfileRow>();
  if (error) {
    // The database objects are missing (a migration not applied): no access, as plan §3.3 says.
    if (databaseErrorKind(error) === "missing-object") return NO_ACCESS;
    logAuthEvent("auth.session.profile_failed", error.code);
    return UNAVAILABLE;
  }
  // No row: no profile, or an inactive or deleted one (the own-row policy needs an active profile).
  if (!data) return NO_ACCESS;
  const role = uiRoleOf(data.role);
  let technicianId: string | null = null;
  if (role === "tech") {
    const tech = await client.rpc("my_technician_id");
    if (tech.error) {
      logAuthEvent("auth.session.technician_failed", tech.error.code);
      return UNAVAILABLE;
    }
    technicianId = typeof tech.data === "string" ? tech.data : null;
  }
  const user = sessionUserOf(
    role === null
      ? null
      : { id: data.id, role, name: data.full_name, active: data.is_active, technicianId, isTest: data.is_test },
  );
  return user ? { kind: "signed-in", user } : NO_ACCESS;
}

/**
 * This request's session state, once per request (React cache). Fails closed: a missing or invalid
 * configuration, or any Auth or database failure, is "unavailable"; nothing is guessed. A reset-link
 * session (no password sign-in) is "anonymous": it serves the reset screen only (see the header).
 */
export const getSessionState = cache(async (): Promise<SessionState> => {
  // Always per request, never prerendered: also a build without the Supabase variables (which reads
  // no cookie) must not bake one visitor's answer into a static page.
  await connection();
  const client = await createUserSupabaseClient();
  if (!client) return UNAVAILABLE;
  let userId: string;
  try {
    const { data, error } = await client.auth.getUser();
    if (error || !data.user) {
      const failure = error ? userLookupFailure(error) : "anonymous";
      if (failure === "unavailable") logAuthEvent("auth.session.user_failed", error?.code ?? error?.status);
      return failure === "anonymous" ? ANONYMOUS : UNAVAILABLE;
    }
    userId = data.user.id;
  } catch {
    logAuthEvent("auth.session.user_failed", "exception");
    return UNAVAILABLE;
  }
  try {
    const { data, error } = await client.auth.getClaims();
    if (error || !data) {
      const failure = error ? userLookupFailure(error) : "anonymous";
      if (failure === "unavailable") logAuthEvent("auth.session.claims_failed", error?.code ?? error?.status);
      return failure === "anonymous" ? ANONYMOUS : UNAVAILABLE;
    }
    if (!isAppSessionClaims(data.claims)) {
      logAuthEvent("auth.session.not_app_session", "reset_session");
      return ANONYMOUS;
    }
  } catch {
    logAuthEvent("auth.session.claims_failed", "exception");
    return UNAVAILABLE;
  }
  try {
    return await sessionStateOf(client, userId);
  } catch {
    logAuthEvent("auth.session.profile_failed", "exception");
    return UNAVAILABLE;
  }
});

/** The SessionQueries port (features/auth/data/ports.ts) over the request's session. */
export const supabaseSession: SessionQueries = {
  async current() {
    const state = await getSessionState();
    return state.kind === "signed-in" ? state.user : null;
  },
};
