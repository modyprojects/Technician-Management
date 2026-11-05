// Post-sign-in redirect allowlist (docs/security.md §4 "no open redirects"; Step 2 plan §3.4).
// Pure. A `next` value is followed only when it is a plain internal path inside the signed-in
// role's own area; anything else falls back to the area's start. The caller decides the area from
// the role read from `profiles` (features/auth/roles.ts roleArea), never from the request.

/** Where a role's screens live: `/office…` for office roles, `/tech…` for technicians. */
export type RoleArea = "office" | "tech";

/** The start of each area. */
export const AREA_START: Readonly<Record<RoleArea, `/${RoleArea}`>> = { office: "/office", tech: "/tech" };

/** Longer values are refused outright. */
export const NEXT_PATH_MAX_LENGTH = 512;

/**
 * Characters a `next` value may contain: unreserved URL characters plus `/`, `?`, `=` and `&`.
 * Everything else is refused, which covers schemes (`:`), backslashes, percent-encoded forms
 * (`%`), fragments (`#`), whitespace, control and non-ASCII characters.
 */
const ALLOWED_CHARACTERS = /^[A-Za-z0-9\-._~/?=&]+$/;

/** A base that never matches a real host; used only to check that parsing does not move the path. */
const PROBE_ORIGIN = "http://next-path.invalid";

/**
 * The safe internal path for `next` inside `area`, or null.
 * - a string of allowed characters only, at most NEXT_PATH_MAX_LENGTH long;
 * - starts with a single `/` (no `//`, no scheme, no host);
 * - the path is the area start or below it (`/office`, `/office/…`, `/office?…`), never a
 *   neighbour such as `/officers`;
 * - no `.` or `..` segment and no empty segment;
 * - URL parsing keeps it on the same origin and returns it unchanged.
 */
export function safeNextPath(next: unknown, area: RoleArea): string | null {
  if (typeof next !== "string" || next.length === 0 || next.length > NEXT_PATH_MAX_LENGTH) return null;
  if (!ALLOWED_CHARACTERS.test(next)) return null;
  if (!next.startsWith("/") || next.startsWith("//")) return null;

  const queryAt = next.indexOf("?");
  const path = queryAt === -1 ? next : next.slice(0, queryAt);
  const start = AREA_START[area];
  if (path !== start && !path.startsWith(`${start}/`)) return null;

  const segments = path.split("/").slice(1);
  // A trailing slash leaves one empty last segment; any other empty segment is a `//`.
  const inner = segments[segments.length - 1] === "" ? segments.slice(0, -1) : segments;
  if (inner.some((segment) => segment === "" || segment === "." || segment === "..")) return null;

  let parsed: URL;
  try {
    parsed = new URL(next, PROBE_ORIGIN);
  } catch {
    return null;
  }
  if (parsed.origin !== PROBE_ORIGIN || `${parsed.pathname}${parsed.search}` !== next) return null;
  return next;
}

/** Where to go after signing in: a safe `next` inside the role's area, else the area's start. */
export function postSignInPath(next: unknown, area: RoleArea): string {
  return safeNextPath(next, area) ?? AREA_START[area];
}
