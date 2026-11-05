// Attributes of the Supabase session cookies (docs/security.md §4: HttpOnly, SameSite cookies
// through the supported Supabase SSR pattern; Step 2 plan §3.2). Pure, so unit tests reach it;
// lib/supabase/server.ts (and later the proxy) apply it to every cookie the library writes.
import type { CookieOptions } from "@supabase/ssr";

/**
 * The attributes forced on every Supabase session cookie, whatever the library passes: HttpOnly
 * (the browser never reads them; the app has no browser Supabase client), SameSite=Lax (plan
 * §3.2: a TECH choice), Path=/, host-only (no Domain), and Secure unless the request is plain
 * http (only the local server). The lifetime (`maxAge`/`expires`) stays the library's, so a
 * removal (`maxAge: 0`) still removes.
 */
export function sessionCookieOptions(options: CookieOptions, secure: boolean): CookieOptions {
  return { ...options, httpOnly: true, sameSite: "lax", path: "/", domain: undefined, secure };
}

/**
 * Whether the request reached the app over https, from its `x-forwarded-proto` header. Only an
 * explicit "http" (the local `next start`) drops Secure, so a missing or unexpected value keeps it.
 *
 * Trust assumption: the platform sets this header. Vercel's edge sets it on every request; the
 * Next.js server sets it only when it is absent, so without such a proxy in front a client could
 * send "http". That only drops Secure on the cookies of the sender's own response (a cross-site
 * form cannot set custom headers). The proxy (PR 2.5) reuses this function and this assumption.
 */
export function isHttpsRequest(forwardedProto: string | null | undefined): boolean {
  const first = (forwardedProto ?? "").split(",")[0]?.trim().toLowerCase();
  return first !== "http";
}
