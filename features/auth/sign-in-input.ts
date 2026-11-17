// The sign-in server action's input and result (Step 2 plan §3.4; Step 2 PR 2.5). Pure: no I/O.
// The action re-validates everything here on the server: the browser's own checks (LoginForm)
// are a convenience, never trusted.
import { z } from "zod";
import { EMAIL_MAX, emailError, passwordError } from "@/features/accounts/data/validate";
import { NEXT_PATH_MAX_LENGTH } from "./redirects";

export type SignInInput = { email: string; password: string; next: string | null };

/**
 * The two outcomes a failed sign-in may show (plan §3.4): one message for every credential
 * failure (wrong password, unknown email, inactive or deleted account, no profile, a malformed
 * submission) and one for every service failure. Neither reveals anything about an account.
 */
export type SignInFailure = { ok: false; kind: "credentials" | "service" };

/** Upper bound on the raw password string before the byte check (72 bytes, Supabase Auth). */
const PASSWORD_RAW_MAX = 1024;

const schema = z
  .object({
    email: z.string().max(EMAIL_MAX + 64),
    password: z.string().max(PASSWORD_RAW_MAX),
    next: z.string().max(NEXT_PATH_MAX_LENGTH).nullable().optional(),
  })
  .strict();

/**
 * The validated input, or null for anything malformed: unknown or missing fields, wrong types,
 * an invalid email (the shared rule), an empty password or one over 72 bytes. `next` is only
 * carried here; the action follows it only through the role-area allowlist (redirects.ts).
 */
export function parseSignInInput(value: unknown): SignInInput | null {
  const parsed = schema.safeParse(value);
  if (!parsed.success) return null;
  const email = parsed.data.email.trim();
  if (emailError(email) !== null || passwordError(parsed.data.password) !== null) return null;
  return { email, password: parsed.data.password, next: parsed.data.next ?? null };
}

/** An auth log line (docs/security.md §8): an event name and a short code only, never a value. */
const LOG_TOKEN = /^[A-Za-z0-9_.:-]{1,64}$/;

export function authLogLine(event: string, code: unknown): string {
  const safeEvent = LOG_TOKEN.test(event) ? event : "auth.event";
  const safeCode = typeof code === "number" && Number.isInteger(code) ? String(code) : typeof code === "string" && LOG_TOKEN.test(code) ? code : "unknown";
  return JSON.stringify({ event: safeEvent, code: safeCode });
}
