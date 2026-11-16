"use server";

// Sign-in and sign-out (Step 2 plan §3.4; Step 2 PR 2.5): server actions under the request's own
// session. Next.js checks the Origin of every server-action POST against the Host (no
// `serverActions.allowedOrigins` is added). The session cookies are written here only through the
// SSR client (lib/supabase/server.ts: HttpOnly, SameSite=Lax, Path=/, Secure on https).
// Logs carry an event name and a code only (docs/security.md §8).
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { postSignInPath } from "@/features/auth/redirects";
import { roleArea } from "@/features/auth/roles";
import { isSessionCookieName } from "@/features/auth/session-cookies";
import { LOGIN_PATH } from "@/features/auth/session-state";
import { parseSignInInput, type SignInFailure } from "@/features/auth/sign-in-input";
import { signInFailureKind } from "@/features/data-access/supabase-errors";
import { logAuthEvent } from "@/lib/auth/log";
import { sessionStateOf } from "@/lib/auth/session";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const CREDENTIALS: SignInFailure = { ok: false, kind: "credentials" };
const SERVICE: SignInFailure = { ok: false, kind: "service" };

/** Removes this browser's session cookies directly (the fallback when the Auth call failed). */
async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (isSessionCookieName(name)) store.delete(name);
  }
}

/**
 * Signs in with email and password. On success it redirects (to a safe `next` inside the user's
 * own area, else the area's start) and never returns. On failure it returns one of the two generic
 * outcomes; a sign-in whose account has no access (no profile, inactive, deleted) is signed out
 * again in the same action and reported as a credential failure, so no session cookie stays.
 */
export async function signIn(input: unknown): Promise<SignInFailure> {
  const parsed = parseSignInInput(input);
  if (!parsed) {
    logAuthEvent("auth.sign_in.rejected", "invalid_input");
    return CREDENTIALS;
  }
  const client = await createUserSupabaseClient();
  if (!client) {
    logAuthEvent("auth.sign_in.unavailable", "not_configured");
    return SERVICE;
  }

  let target: string;
  try {
    const { data, error } = await client.auth.signInWithPassword({ email: parsed.email, password: parsed.password });
    if (error || !data.user) {
      const kind = error ? signInFailureKind(error) : "service";
      logAuthEvent(kind === "credentials" ? "auth.sign_in.failed" : "auth.sign_in.unavailable", error?.code ?? error?.status);
      return kind === "credentials" ? CREDENTIALS : SERVICE;
    }
    const state = await sessionStateOf(client, data.user.id);
    const area = state.kind === "signed-in" ? roleArea(state.user.role) : null;
    if (state.kind !== "signed-in" || area === null) {
      // Signed in to Auth, but no access: end this session at once (this device only).
      const { error: outError } = await client.auth.signOut({ scope: "local" });
      if (outError) await clearSessionCookies();
      logAuthEvent("auth.sign_in.denied", state.kind);
      return state.kind === "unavailable" ? SERVICE : CREDENTIALS;
    }
    target = postSignInPath(parsed.next, area);
  } catch {
    logAuthEvent("auth.sign_in.unavailable", "exception");
    await clearSessionCookies();
    return SERVICE;
  }
  logAuthEvent("auth.sign_in.succeeded", "ok");
  redirect(target);
}

/**
 * Signs out this device (scope "local"; Step 2 plan §3.4) and goes to the sign-in screen. When the
 * Auth call fails, the session cookies are removed directly, so the browser never keeps them.
 */
export async function signOut(): Promise<void> {
  try {
    const client = await createUserSupabaseClient();
    const result = client ? await client.auth.signOut({ scope: "local" }) : null;
    if (!client || result?.error) {
      logAuthEvent("auth.sign_out.fallback", result?.error?.code ?? "not_configured");
      await clearSessionCookies();
    }
  } catch {
    logAuthEvent("auth.sign_out.fallback", "exception");
    await clearSessionCookies();
  }
  redirect(LOGIN_PATH);
}
