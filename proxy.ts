import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";
import { devRoutesAllowed } from "@/app/dev/_gate";
import { isHttpsRequest, sessionCookieOptions } from "@/features/auth/session-cookies";
import { supabasePublicEnv } from "@/lib/supabase/env";

// /dev gate. It runs before any route renders, so a closed gate returns the Hebrew 404 page
// and none of the showcase content (a notFound() in the layout still streamed the page).
function devGate(request: NextRequest) {
  const allowed = devRoutesAllowed({
    vercelEnv: process.env.VERCEL_ENV,
    localFlag: process.env.ENABLE_DEV_ROUTES,
    host: request.headers.get("host"),
  });
  if (allowed) return NextResponse.next();
  return NextResponse.rewrite(new URL("/dev-gate-closed", request.url), { status: 404 });
}

// Session refresh for the real routes (Step 2 plan §3.6; Step 2 PR 2.5). Server Components cannot
// write cookies, so an expired access token is refreshed here, once per request, and the rotated
// cookies are written onto the request (so the page renders with them) and onto the response
// (HttpOnly, SameSite=Lax, Path=/, Secure on https; features/auth/session-cookies.ts), with the
// library's no-store cache headers. A convenience only: it never decides access. Every page checks
// the session and the role itself (lib/auth/guards.ts) and the database checks every call. Not
// configured or any failure: the request passes unchanged and the page fails closed.
async function refreshSession(request: NextRequest) {
  let response = NextResponse.next({ request });
  const env = supabasePublicEnv();
  if (!env.configured) return response;
  const secure = isHttpsRequest(request.headers.get("x-forwarded-proto"));
  const supabase = createServerClient(env.url, env.publishableKey, {
    cookieOptions: sessionCookieOptions({}, secure),
    cookies: {
      getAll: () => request.cookies.getAll(),
      setAll: (cookiesToSet, headers) => {
        for (const { name, value } of cookiesToSet) request.cookies.set(name, value);
        response = NextResponse.next({ request });
        for (const { name, value, options } of cookiesToSet) {
          response.cookies.set(name, value, sessionCookieOptions(options, secure));
        }
        for (const [key, value] of Object.entries(headers ?? {})) response.headers.set(key, value);
      },
    },
  });
  try {
    // Refreshes an expired session (and saves it through setAll); the page validates the user.
    await supabase.auth.getClaims();
  } catch {
    // The page decides (fail closed).
  }
  return response;
}

/**
 * The real routes, in every form the real matchers below send here (document, RSC, `.rsc` and
 * segment files, `_next/data`, which Next.js normalizes to the page path). Everything else the
 * matchers send is a /dev request in some form (also a percent-encoded or `_next/data` one), so it
 * goes to the gate by default (independent review P1): only an explicit real route skips it.
 */
const REAL_ROUTE = /^\/(?:index(?:[/.].*)?)?$|^\/(?:login|office|tech)(?:[/.].*)?$/;

export async function proxy(request: NextRequest) {
  return REAL_ROUTE.test(request.nextUrl.pathname) ? refreshSession(request) : devGate(request);
}

export const config = {
  // Explicit paths only: no catch-all, so static assets and other routes are untouched.
  matcher: ["/dev", "/dev/:path*", "/", "/login", "/office", "/office/:path*", "/tech", "/tech/:path*"],
};
