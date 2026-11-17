// The mail port's configuration (D65; docs/integrations.md "Email"). Pure: lib/mail/index.ts passes
// the variables in. No real email is sent anywhere today: every environment is `disabled` (the
// default) or the local `mock`; `resend` is dormant until the owner approves a provider and a
// verified sending domain (open decision 9) and a durable throttle exists.
import { isAbsolute } from "node:path";

export type MailMessage = { to: string; subject: string; html: string; text: string };

/**
 * - "disabled": nothing is sent (the default when EMAIL_DELIVERY is unset or unknown);
 * - "mock": local runs and CI only; the message is appended to MAIL_MOCK_FILE, never sent. Only
 *   where VERCEL_ENV is unset (never on any Vercel deployment) and only with MAIL_MOCK_FILE naming
 *   an absolute path; otherwise "disabled" (independent review fix 5: no in-memory list that would
 *   keep live reset links in a server's memory);
 * - "resend": the Resend HTTP API (dormant). Needs EMAIL_PROVIDER_API_KEY and EMAIL_FROM_ADDRESS,
 *   else "disabled".
 */
export type DeliveryMode = "disabled" | "mock" | "resend";

export type MailEnv = {
  EMAIL_DELIVERY?: string | undefined;
  VERCEL_ENV?: string | undefined;
  MAIL_MOCK_FILE?: string | undefined;
  EMAIL_PROVIDER_API_KEY?: string | undefined;
  EMAIL_FROM_ADDRESS?: string | undefined;
};

/** The outcome of one send. Codes only: never the key, the address or the body. */
export type MailErrorCode =
  | "disabled"
  | "mock_failed"
  | "timeout"
  | "network"
  | "rejected"
  | "unauthorized"
  | "rate_limited"
  | "provider_unavailable"
  | "failed";
export type SendResult = { ok: true } | { ok: false; code: MailErrorCode };

function present(value: string | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

/** A key: printable ASCII without spaces (no header injection through the Authorization header). */
const API_KEY_PATTERN = /^[\x21-\x7e]{8,512}$/;

/** A sender: an address, or "Name <address>"; no line breaks (no header injection). */
const FROM_PATTERN = /^(?:[^\r\n<>]{0,100}<[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+>|[^\s@<>]+@[^\s@<>]+\.[^\s@<>]+)$/;

/** The Resend configuration, or null when either value is missing or malformed. */
export function resendConfigOf(env: MailEnv): { apiKey: string; from: string } | null {
  const apiKey = present(env?.EMAIL_PROVIDER_API_KEY);
  const from = present(env?.EMAIL_FROM_ADDRESS);
  if (apiKey === null || from === null || !API_KEY_PATTERN.test(apiKey) || from.length > 320 || !FROM_PATTERN.test(from)) return null;
  return { apiKey, from };
}

/** The mock delivery's file: an absolute path without control characters, else null. */
export function mockFileOf(env: MailEnv): string | null {
  const file = present(env?.MAIL_MOCK_FILE);
  if (file === null || file.length > 1024 || /[\u0000-\u001f\u007f]/.test(file) || !isAbsolute(file)) return null;
  return file;
}

export function deliveryModeOf(env: MailEnv): DeliveryMode {
  const requested = present(env?.EMAIL_DELIVERY)?.toLowerCase() ?? "disabled";
  if (requested === "mock") return present(env.VERCEL_ENV) === null && mockFileOf(env) !== null ? "mock" : "disabled";
  if (requested === "resend") return resendConfigOf(env) === null ? "disabled" : "resend";
  return "disabled";
}
