// Supabase configuration schema (Step 2 plan §2.3, §3.2; S15: fail closed). Pure: it never reads
// process.env; lib/supabase/env.ts passes the values in, so unit tests can import this module.
// The URL and the publishable key (every request), and the secret key of the Auth Admin client
// (account administration only, D60 (7)): lib/supabase/admin.ts passes it in at call time and uses
// the result at once; this module never stores, logs or returns a value in a problem.
import { z } from "zod";

/** Why the configuration is unusable. Codes only: a value is never echoed (docs/security.md §2, §8). */
export type SupabaseEnvProblem = "url-missing" | "url-invalid" | "publishable-key-missing" | "publishable-key-invalid";

export type SupabasePublicEnvInput = {
  /** NEXT_PUBLIC_SUPABASE_URL. */
  url: string | undefined;
  /** NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY. */
  publishableKey: string | undefined;
};

/**
 * The parsed configuration. `configured: false` means no Supabase call at all: every guard denies
 * and the sign-in screen shows its "unavailable" state (plan §3.2, §3.4).
 */
export type SupabasePublicEnv =
  | { configured: true; url: string; publishableKey: string }
  | { configured: false; problems: readonly SupabaseEnvProblem[] };

const MAX_URL_LENGTH = 2048;
const MAX_KEY_LENGTH = 512;

/** Hosts where a plain-http URL is accepted: the local Supabase stack only. */
const LOOPBACK_HOSTNAMES: ReadonlySet<string> = new Set(["127.0.0.1", "localhost", "[::1]"]);

/**
 * The new key format only (`sb_publishable_…`). A legacy JWT-shaped `anon` key is refused: it
 * would also trip the bundle check's JWT rule (scripts/check-bundle.mjs), and a secret key put
 * into this variable by mistake (`sb_secret_…`) is refused before it can be used.
 */
const PUBLISHABLE_KEY_PATTERN = /^sb_publishable_[A-Za-z0-9_-]+$/;

/**
 * The Supabase API origin, or null. https only, except plain http on a loopback host (the local
 * stack). No credentials, path, query or fragment: a Supabase project URL is an origin.
 */
function supabaseOrigin(value: string): string | null {
  let url: URL;
  try {
    url = new URL(value);
  } catch {
    return null;
  }
  const secure = url.protocol === "https:";
  const localHttp = url.protocol === "http:" && LOOPBACK_HOSTNAMES.has(url.hostname);
  if (!secure && !localHttp) return null;
  if (url.username !== "" || url.password !== "" || url.search !== "" || url.hash !== "") return null;
  if (url.pathname !== "/") return null;
  if (value.includes("?") || value.includes("#")) return null;
  return url.origin;
}

const urlSchema = z
  .string()
  .max(MAX_URL_LENGTH)
  .transform((value, ctx) => {
    const origin = supabaseOrigin(value);
    if (origin === null) {
      ctx.addIssue({ code: "custom", message: "invalid Supabase URL" });
      return z.NEVER;
    }
    return origin;
  });

const publishableKeySchema = z.string().max(MAX_KEY_LENGTH).regex(PUBLISHABLE_KEY_PATTERN);

/** A missing value is undefined, empty or whitespace only. Surrounding whitespace is ignored. */
function present(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/**
 * Parses the two public Supabase values. Fails closed: anything missing or malformed gives
 * `configured: false` with the problem codes, never the values.
 */
export function parseSupabasePublicEnv(input: SupabasePublicEnvInput): SupabasePublicEnv {
  const problems: SupabaseEnvProblem[] = [];

  const rawUrl = present(input.url);
  const url = rawUrl === null ? null : urlSchema.safeParse(rawUrl);
  if (url === null) problems.push("url-missing");
  else if (!url.success) problems.push("url-invalid");

  const rawKey = present(input.publishableKey);
  const key = rawKey === null ? null : publishableKeySchema.safeParse(rawKey);
  if (key === null) problems.push("publishable-key-missing");
  else if (!key.success) problems.push("publishable-key-invalid");

  if (url?.success && key?.success) return { configured: true, url: url.data, publishableKey: key.data };
  return { configured: false, problems };
}

// ---------------------------------------------------------------------------------------------
// The Auth Admin configuration (Step 2 plan §3.2 "Admin client"; D60 (7) account administration).
// Server only: lib/supabase/admin.ts reads SUPABASE_SECRET_KEY at call time and passes it here.
// Its absence disables only the actions that need the Auth Admin API ("unavailable"), never
// sign-in (S15).

/** Why the Auth Admin configuration is unusable. Codes only, never a value. */
export type SupabaseAdminEnvProblem = "url-missing" | "url-invalid" | "secret-key-missing" | "secret-key-invalid";

export type SupabaseAdminEnvInput = {
  /** NEXT_PUBLIC_SUPABASE_URL (the same project as the user client). */
  url: string | undefined;
  /** SUPABASE_SECRET_KEY: server only, never `NEXT_PUBLIC_`, never logged (docs/security.md §2). */
  secretKey: string | undefined;
};

export type SupabaseAdminEnv =
  | { configured: true; url: string; secretKey: string }
  | { configured: false; problems: readonly SupabaseAdminEnvProblem[] };

/**
 * The new key format only (`sb_secret_…`). A legacy JWT-shaped `service_role` key is refused (it
 * would bypass the new key's revocation model), and so is a publishable key put here by mistake.
 */
const SECRET_KEY_PATTERN = /^sb_secret_[A-Za-z0-9_-]+$/;

const secretKeySchema = z.string().max(MAX_KEY_LENGTH).regex(SECRET_KEY_PATTERN);

/**
 * Parses the Auth Admin values. Fails closed: anything missing or malformed gives
 * `configured: false` with the problem codes, never the values.
 */
export function parseSupabaseAdminEnv(input: SupabaseAdminEnvInput): SupabaseAdminEnv {
  const problems: SupabaseAdminEnvProblem[] = [];

  const rawUrl = present(input?.url);
  const url = rawUrl === null ? null : urlSchema.safeParse(rawUrl);
  if (url === null) problems.push("url-missing");
  else if (!url.success) problems.push("url-invalid");

  const rawKey = present(input?.secretKey);
  const key = rawKey === null ? null : secretKeySchema.safeParse(rawKey);
  if (key === null) problems.push("secret-key-missing");
  else if (!key.success) problems.push("secret-key-invalid");

  if (url?.success && key?.success) return { configured: true, url: url.data, secretKey: key.data };
  return { configured: false, problems };
}
