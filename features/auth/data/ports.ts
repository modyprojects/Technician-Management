// Session port (Step 2 plan §3.3, §3.7 b). Implemented by app/dev/demo/_data/adapter.ts
// (`demoSession`, over the fictional accounts) and, from PR 2.5, by a server-only module in lib/
// (`getSessionUser()`: `auth.getUser()` and then the user's own `profiles` row under the session).
// Real pages depend on this port and on AccountsQueries, not on the DataAccess aggregate; it is not
// part of DataAccess (the demo's role is in the URL, X-02).
import type { SessionUser } from "./types";

export interface SessionQueries {
  /**
   * The signed-in user, or null for "no access": no session, an inactive account, no profile, or
   * the database objects missing (Migration 1 not applied). The role comes only from `profiles`
   * (docs/security.md §5). The caller denies on null; this never signs anyone out.
   */
  current(): Promise<SessionUser | null>;
}
