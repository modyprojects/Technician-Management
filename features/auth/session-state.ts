// The session's state and what each real page does with it (Step 2 plan §3.3–§3.5; Step 2 PR 2.5).
// Pure: no I/O, no Supabase, no Next.js. lib/auth/session.ts builds a SessionState under the
// request's own session; lib/auth/guards.ts and the pages act on the decisions below.
//
// Fail closed (docs/security.md §5, "default deny"): anything that is not an active profile of a
// known role in the page's own area is denied, and a page never renders data for a denied state.
// The role comes only from `profiles` (never from Auth metadata).
import type { SessionUser } from "./data/types";
import { AREA_START, type RoleArea } from "./redirects";
import { roleArea } from "./roles";

/**
 * - "signed-in": an Auth session whose user has an active profile of a known role;
 * - "anonymous": no session, or a session the Auth server no longer accepts;
 * - "no-access": an Auth session without an active profile (none, inactive, deleted, unknown role);
 * - "unavailable": the app is not configured, or the Auth server or the database failed.
 */
export type SessionState =
  | { kind: "signed-in"; user: SessionUser }
  | { kind: "anonymous" }
  | { kind: "no-access" }
  | { kind: "unavailable" };

export const LOGIN_PATH = "/login";
export const LOGIN_NO_ACCESS_PATH = "/login?state=no-access";

/** A small integer `status` of an error-shaped value, else null. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

/** Auth answers that mean "this session is not (or no longer) accepted": sign in again. */
const SESSION_REJECTED_STATUSES: ReadonlySet<number> = new Set([400, 401, 403, 404]);

/**
 * What a failed `auth.getUser()` means. No session at all (AuthSessionMissingError), or a session
 * the Auth server rejects (expired or reused refresh token, revoked session, deleted user: HTTP
 * 400/401/403/404), is "anonymous". Anything else (network failure, HTTP 0, 429 or 5xx) is
 * "unavailable": the service failed, which says nothing about the session.
 */
export function userLookupFailure(error: unknown): "anonymous" | "unavailable" {
  if (typeof error === "object" && error !== null && (error as { name?: unknown }).name === "AuthSessionMissingError") {
    return "anonymous";
  }
  const status = statusOf(error);
  return status !== null && SESSION_REJECTED_STATUSES.has(status) ? "anonymous" : "unavailable";
}

/** The start of the signed-in user's own area (`/office` or `/tech`); null when the role has none. */
export function startPathOf(user: SessionUser): string | null {
  const area = roleArea(user.role);
  return area ? AREA_START[area] : null;
}

/**
 * What a page of `area` does with the session (every real page, at the time of the request):
 * render for a signed-in user of that area; otherwise go to the sign-in screen, with the generic
 * no-access state for a session that exists but has no access to the area (no profile, inactive,
 * another area). An unavailable service goes to the sign-in screen, which shows its own state.
 */
export function areaDecision(state: SessionState, area: RoleArea): { allow: SessionUser } | { redirect: string } {
  switch (state.kind) {
    case "signed-in":
      return roleArea(state.user.role) === area ? { allow: state.user } : { redirect: LOGIN_NO_ACCESS_PATH };
    case "no-access":
      return { redirect: LOGIN_NO_ACCESS_PATH };
    case "anonymous":
    case "unavailable":
      return { redirect: LOGIN_PATH };
  }
}

/** Where `/` sends the visitor: the signed-in user's area, else the sign-in screen. */
export function rootRedirect(state: SessionState): string {
  if (state.kind === "signed-in") return startPathOf(state.user) ?? LOGIN_NO_ACCESS_PATH;
  return state.kind === "no-access" ? LOGIN_NO_ACCESS_PATH : LOGIN_PATH;
}

/**
 * What `/login` shows. `requested` is the untrusted `?state=` value, already reduced to a known
 * LoginState (features/auth/login-state.ts); only "no-access" is taken from the URL.
 * - unavailable → the unavailable state (no form);
 * - a session with "no-access" requested, or a session without access → the no-access state with
 *   "יציאה" (a signed-in user who opened a page of another area lands here too);
 * - a signed-in user who did not ask for no-access → his area's start (no second sign-in);
 * - otherwise (anonymous, also with "no-access" in the URL: there is nothing to sign out) → the form.
 */
export function loginDecision(
  state: SessionState,
  requestedNoAccess: boolean,
): { show: "form" | "unavailable" | "no-access" } | { redirect: string } {
  switch (state.kind) {
    case "unavailable":
      return { show: "unavailable" };
    case "anonymous":
      return { show: "form" };
    case "no-access":
      return { show: "no-access" };
    case "signed-in": {
      if (requestedNoAccess) return { show: "no-access" };
      const start = startPathOf(state.user);
      return start ? { redirect: start } : { show: "no-access" };
    }
  }
}
