// Per-page guards (Step 2 plan §3.5; Step 2 PR 2.5). Server-only. Every real page calls one of
// these itself, at the time of the request: layouts and the proxy are conveniences only, because a
// client-side navigation can render a page without its layout. The database checks the caller
// again in every function and policy (RLS is the real boundary, docs/security.md §5).
import "server-only";
import { redirect } from "next/navigation";
import type { SessionUser } from "@/features/auth/data/types";
import type { RoleArea } from "@/features/auth/redirects";
import { areaDecision } from "@/features/auth/session-state";
import { getSessionState } from "./session";

/**
 * The signed-in user of `area`, or a redirect: anonymous and unavailable → `/login`; a session
 * without access (no profile, inactive, deleted, another area) → `/login?state=no-access`.
 */
export async function requireArea(area: RoleArea): Promise<SessionUser> {
  const decision = areaDecision(await getSessionState(), area);
  if ("redirect" in decision) redirect(decision.redirect);
  return decision.allow;
}
