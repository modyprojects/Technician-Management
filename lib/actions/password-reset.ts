"use server";

// Self-service password reset (D65; docs/security.md §4: tested recovery and reset flows,
// time-limited reset links, no open redirects, brute-force protection, generic errors). Server
// actions: Next.js checks the Origin of every server-action POST against the Host. Logs carry an
// event name and an outcome code only, one line per request, never an address, a link, a token or a
// password (docs/security.md §8).
//
// 1. requestPasswordReset: the same answer ("sent") for every well-formed address, whether or not an
//    account exists, also when throttled or refused. When this environment cannot deliver (email
//    delivery disabled, no Auth Admin key, no usable app origin) the answer is "delivery-off",
//    decided by the environment alone before any Auth call. Otherwise the request does only the
//    interim throttle and answers "sent"; everything whose duration depends on the account runs
//    after the response (`after`; independent review fix 1: the Auth Admin call is measurably
//    slower for an existing account): the recovery token from the Auth Admin API
//    (lib/auth/password-reset-admin.ts), the app's own link (origin from configuration, never from
//    the request) and the email through the mail port, to the account's own address as the Auth
//    server returns it (review fix 4), never the typed spelling. Skipped silently (no link is built
//    and nothing is sent; the answer was "sent" all the same): a banned account, i.e. a deleted one
//    (D60 (7) Option A; user-management review N4), and an account that has never signed in (D67 (a):
//    the self-service reset serves only accounts that have signed in before; the Creator sets the
//    first password, D50).
// 2. completePasswordReset: the password rules first (so a typo never uses up the link), then the
//    link's token once (verifyOtp, on submission only: a link scanner's GET never consumes it), then
//    the session must be a recent reset-link session (never an ordinary signed-in one), then the new
//    password. On success every session of the account ends (scope "global") and the browser goes
//    to the sign-in screen with a notice. A user without an active profile can reset, but the
//    sign-in rules still refuse him.
import "server-only";
import { cookies } from "next/headers";
import { redirect } from "next/navigation";
import { after } from "next/server";
import { passwordResetEmail } from "@/features/auth/password-reset/email";
import {
  parseResetCompleteInput,
  parseResetRequestInput,
  type ResetCompleteFailure,
  type ResetErrorKind,
  type ResetRequestResult,
} from "@/features/auth/password-reset/input";
import { PASSWORD_UPDATED_PATH, RESET_LINK_MINUTES, RESET_PASSWORD_PATH } from "@/features/auth/password-reset/paths";
import { isSessionCookieName } from "@/features/auth/session-cookies";
import { appOrigin } from "@/lib/auth/app-origin";
import { logAuthEvent } from "@/lib/auth/log";
import { createRecoveryTokenHash, recoveryAdminConfigured } from "@/lib/auth/password-reset-admin";
import { allowResetEmail } from "@/lib/auth/password-reset-throttle";
import { hasRecentRecoverySession } from "@/lib/auth/recovery-session";
import { deliveryMode, sendMail } from "@/lib/mail";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const REQUEST_EVENT = "auth.password_reset.request";
const COMPLETE_EVENT = "auth.password_reset.complete";

const SENT: ResetRequestResult = { state: "sent" };
const DELIVERY_OFF: ResetRequestResult = { state: "delivery-off" };
const INVALID_REQUEST: ResetRequestResult = { state: "invalid" };
const INVALID_LINK: ResetCompleteFailure = { state: "invalid-link" };

const formError = (kind: ResetErrorKind, sessionReady: boolean): ResetCompleteFailure => ({ state: "error", kind, sessionReady });

/** The origin for the link when this environment can deliver a reset email; else null. */
function deliveryOrigin(): string | null {
  if (deliveryMode() === "disabled" || !recoveryAdminConfigured()) return null;
  return appOrigin();
}

/**
 * Runs after the response: the recovery token, the link and the email. One log line: the refusal
 * code (an unknown address is "user_not_found"), "skipped_banned" for a banned (deleted) account,
 * "skipped_never_signed_in" for an account that has never signed in (D67 (a)), or the delivery's
 * outcome.
 */
async function deliverResetLink(email: string, origin: string): Promise<void> {
  try {
    const token = await createRecoveryTokenHash(email);
    if (!token.ok) {
      logAuthEvent(REQUEST_EVENT, token.code);
      return;
    }
    // A deleted account is banned for good (D60 (7) Option A): no link, no email (review N4). An
    // account that has never signed in gets none either (D67 (a), owner 2026-11-17: a Manager could
    // otherwise create an account on a mailbox he controls and set its password himself; the Creator
    // sets the first password). Auth created the recovery token with the lookup; it is never
    // delivered.
    if (token.banned) {
      logAuthEvent(REQUEST_EVENT, "skipped_banned");
      return;
    }
    if (!token.signedInBefore) {
      logAuthEvent(REQUEST_EVENT, "skipped_never_signed_in");
      return;
    }
    const link = `${origin}${RESET_PASSWORD_PATH}?token_hash=${token.tokenHash}`;
    const message = passwordResetEmail({ link, expiresMinutes: RESET_LINK_MINUTES });
    const result = await sendMail({ to: token.email, ...message });
    logAuthEvent(REQUEST_EVENT, result.ok ? "sent" : `mail_${result.code}`);
  } catch {
    logAuthEvent(REQUEST_EVENT, "exception");
  }
}

/** Asks for a reset link. Always "sent" for a well-formed address (see the header). */
export async function requestPasswordReset(input: unknown): Promise<ResetRequestResult> {
  const parsed = parseResetRequestInput(input);
  if (!parsed) {
    logAuthEvent(REQUEST_EVENT, "invalid_input");
    return INVALID_REQUEST;
  }
  const origin = deliveryOrigin();
  if (origin === null) {
    logAuthEvent(REQUEST_EVENT, "delivery_off");
    return DELIVERY_OFF;
  }
  if (!allowResetEmail(parsed.email)) {
    logAuthEvent(REQUEST_EVENT, "throttled");
    return SENT;
  }
  // Nothing that depends on the account runs before the answer (review fix 1).
  const email = parsed.email;
  after(() => deliverResetLink(email, origin));
  return SENT;
}

/** Removes this browser's session cookies directly (the fallback when the Auth sign-out failed). */
async function clearSessionCookies(): Promise<void> {
  const store = await cookies();
  for (const { name } of store.getAll()) {
    if (isSessionCookieName(name)) store.delete(name);
  }
}

/** The HTTP status of an Auth error, else null. */
function statusOf(error: unknown): number | null {
  const status = typeof error === "object" && error !== null ? (error as { status?: unknown }).status : undefined;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

/** A failed verifyOtp that says nothing about the link (rate limit, network, server error). */
function isServiceFailure(error: unknown): boolean {
  const status = statusOf(error);
  return status === null || status === 0 || status === 429 || status >= 500;
}

function codeOf(error: { code?: unknown; status?: unknown } | null | undefined): unknown {
  return error?.code ?? error?.status;
}

/**
 * Sets the new password. On success it redirects to the sign-in screen and never returns; on
 * failure it returns the state for the form (see ResetCompleteFailure).
 */
export async function completePasswordReset(input: unknown): Promise<ResetCompleteFailure> {
  const parsed = parseResetCompleteInput(input);
  if (!parsed.ok) {
    logAuthEvent(COMPLETE_EVENT, `invalid_${parsed.problem}`);
    return parsed.problem === "malformed" || parsed.problem === "token" ? INVALID_LINK : formError(parsed.problem, false);
  }
  const client = await createUserSupabaseClient();
  if (!client) {
    logAuthEvent(COMPLETE_EVENT, "not_configured");
    return formError("service", false);
  }
  const { tokenHash, password } = parsed.input;
  let tokenUsed = false;
  try {
    if (tokenHash !== null) {
      const { error } = await client.auth.verifyOtp({ type: "recovery", token_hash: tokenHash });
      if (error) {
        logAuthEvent(COMPLETE_EVENT, `verify_${String(codeOf(error) ?? "error")}`);
        return isServiceFailure(error) ? formError("service", false) : INVALID_LINK;
      }
      tokenUsed = true;
    }
    if (!(await hasRecentRecoverySession(client))) {
      // Without a token: an ordinary session, an old reset session or none at all is refused.
      logAuthEvent(COMPLETE_EVENT, tokenUsed ? "session_missing" : "not_recovery_session");
      return tokenUsed ? formError("service", true) : INVALID_LINK;
    }
    const { error } = await client.auth.updateUser({ password });
    if (error) {
      const code = error.code;
      logAuthEvent(COMPLETE_EVENT, `update_${String(codeOf(error) ?? "error")}`);
      // The recovery session stays, so the user can try again without the (now used) link.
      return formError(code === "weak_password" ? "weak" : code === "same_password" ? "same" : "service", true);
    }
  } catch {
    logAuthEvent(COMPLETE_EVENT, "exception");
    return formError("service", tokenUsed);
  }

  // Every session of the account ends, this one included (earlier sign-ins on other devices too).
  let outcome = "updated";
  try {
    const { error } = await client.auth.signOut({ scope: "global" });
    if (error) {
      outcome = "updated_sign_out_fallback";
      await clearSessionCookies();
    }
  } catch {
    outcome = "updated_sign_out_fallback";
    await clearSessionCookies();
  }
  logAuthEvent(COMPLETE_EVENT, outcome);
  redirect(PASSWORD_UPDATED_PATH);
}
