// The app's own origin for links in emails (D65; docs/security.md §4 "no open redirects"). Pure:
// lib/auth/app-origin.ts passes the variables in.
//
// Never taken from the request (Host, X-Forwarded-Host, Origin): a forged Host header would put an
// attacker's site into a real reset email and hand it the token. The order:
// 1. APP_ORIGIN when set: an https origin, or plain http on a loopback host only (the local
//    server); anything else is refused (null), never a fallback, so a typo cannot silently send
//    links to another address.
// 2. On Vercel, the system variables: Production `https://${VERCEL_PROJECT_PRODUCTION_URL}`,
//    Preview `https://${VERCEL_BRANCH_URL}` (both host names without a scheme, set by Vercel).
// 3. Otherwise the local development server, http://localhost:3000.

export type AppOriginEnv = {
  APP_ORIGIN?: string | undefined;
  VERCEL_ENV?: string | undefined;
  VERCEL_PROJECT_PRODUCTION_URL?: string | undefined;
  VERCEL_BRANCH_URL?: string | undefined;
};

export const LOCAL_APP_ORIGIN = "http://localhost:3000";

const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/** A host name as Vercel gives it: letters, digits, dots and hyphens, an optional port. */
const HOST_PATTERN = /^[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?(?:\.[a-z0-9](?:[a-z0-9-]{0,61}[a-z0-9])?)*(?::\d{1,5})?$/i;

function present(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** The origin of `value`, or null: https, or http on a loopback host; no credentials, path, query or fragment. */
function originOf(value: string): string | null {
  if (value.length > 2048 || value.includes("?") || value.includes("#") || value.includes("\\")) return null;
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const localHttp = url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  if (!secure && !localHttp) return null;
  if (url.username !== "" || url.password !== "" || url.pathname !== "/" || url.search !== "" || url.hash !== "") return null;
  return url.origin;
}

function vercelOrigin(host: string | undefined): string | null {
  const value = present(host);
  if (value === null || value.length > 253 || !HOST_PATTERN.test(value)) return null;
  return originOf(`https://${value}`);
}

/** The origin for links in emails, or null when the configuration is unusable (fail closed). */
export function appOriginOf(env: AppOriginEnv): string | null {
  const explicit = present(env?.APP_ORIGIN);
  if (explicit !== null) return originOf(explicit);
  const vercelEnv = present(env?.VERCEL_ENV);
  if (vercelEnv === "production") return vercelOrigin(env.VERCEL_PROJECT_PRODUCTION_URL);
  if (vercelEnv === "preview") return vercelOrigin(env.VERCEL_BRANCH_URL);
  return LOCAL_APP_ORIGIN;
}
