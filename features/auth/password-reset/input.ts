// Self-service password reset (D65; docs/security.md §4): the server actions' inputs and results,
// and the recovery token's format. Pure: no I/O. The actions (lib/actions/password-reset.ts)
// re-validate everything here on the server; the browser's own checks are a convenience only. The
// routes are in ./paths.ts.
import { z } from "zod";
import { EMAIL_MAX, emailError, passwordError } from "@/features/accounts/data/validate";

/**
 * The recovery token's hash as the app's own link carries it (`/login/reset?token_hash=…`): the
 * `hashed_token` of the Auth Admin `generateLink`, lower-case hex. The local stack gives 56
 * characters (pinned in tests/auth); the bounds leave room for another hash length without
 * accepting anything else (no separators, no percent-encoding, no whitespace).
 */
const TOKEN_HASH_PATTERN = /^[0-9a-f]{32,128}$/;

export function isRecoveryTokenHash(value: unknown): value is string {
  return typeof value === "string" && TOKEN_HASH_PATTERN.test(value);
}

/** Upper bound on the raw password string before the 72-byte check (as the sign-in input). */
const PASSWORD_RAW_MAX = 1024;

// ---------------------------------------------------------------------------------------------
// Request a link ("שכחתי סיסמה").

export type ResetRequestInput = { email: string };

/**
 * What the request screen shows after a submission.
 * - "sent": the same answer for every well-formed address, whether or not an account exists, and
 *   also when the request was throttled or refused (nothing reveals an account);
 * - "delivery-off": email delivery is not configured in this environment (decided by the
 *   environment only, before any Auth call);
 * - "invalid": a malformed submission (the browser's own check normally stops it first).
 */
export type ResetRequestResult = { state: "sent" } | { state: "delivery-off" } | { state: "invalid" };

const requestSchema = z.object({ email: z.string().max(EMAIL_MAX + 64) }).strict();

/** The validated, trimmed and lower-cased address, or null (the sign-in screen's email rule). */
export function parseResetRequestInput(value: unknown): ResetRequestInput | null {
  const parsed = requestSchema.safeParse(value);
  if (!parsed.success) return null;
  const email = parsed.data.email.trim();
  if (emailError(email) !== null) return null;
  return { email: email.toLowerCase() };
}

// ---------------------------------------------------------------------------------------------
// Set the new password (the link's screen).

export type ResetCompleteInput = { tokenHash: string | null; password: string };

/** Why a new-password submission failed in a way the form can show (the link is still usable). */
export type ResetErrorKind = "missing" | "too-long" | "mismatch" | "weak" | "same" | "service";

/**
 * A failed submission. A success redirects to the sign-in screen and never returns.
 * - "invalid-link": no usable link and no recovery session (also a malformed token);
 * - "error": the form stays. `sessionReady` says that the link was used and the recovery session
 *   now carries the reset: the form retries without the token (which works only once).
 */
export type ResetCompleteFailure = { state: "invalid-link" } | { state: "error"; kind: ResetErrorKind; sessionReady: boolean };

const completeSchema = z
  .object({
    tokenHash: z.string().max(256).nullable().optional(),
    password: z.string().max(PASSWORD_RAW_MAX),
    confirm: z.string().max(PASSWORD_RAW_MAX),
  })
  .strict();

export type ResetCompleteParse =
  | { ok: true; input: ResetCompleteInput }
  | { ok: false; problem: "malformed" | "token" | Extract<ResetErrorKind, "missing" | "too-long" | "mismatch"> };

/**
 * The validated submission. The password rules (non-empty, at most 72 UTF-8 bytes, equal to the
 * confirmation) are checked BEFORE the token, so a typo never uses up the link. A token that is
 * present but malformed is "token" (the invalid-link state); an absent one means "use the
 * recovery session".
 */
export function parseResetCompleteInput(value: unknown): ResetCompleteParse {
  const parsed = completeSchema.safeParse(value);
  if (!parsed.success) return { ok: false, problem: "malformed" };
  const { password, confirm } = parsed.data;
  const passwordProblem = passwordError(password);
  if (passwordProblem !== null) return { ok: false, problem: password === "" ? "missing" : "too-long" };
  if (password !== confirm) return { ok: false, problem: "mismatch" };
  const raw = parsed.data.tokenHash ?? null;
  if (raw !== null && raw !== "" && !isRecoveryTokenHash(raw)) return { ok: false, problem: "token" };
  return { ok: true, input: { tokenHash: raw === "" ? null : raw, password } };
}
