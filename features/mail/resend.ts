// The Resend adapter (D65; DORMANT: used only when EMAIL_DELIVERY=resend, which no environment sets
// today). One HTTPS POST to the Resend API with Bearer authentication and a JSON body
// {from, to, subject, html, text}, a 10-second timeout, and every failure mapped to a code. The
// response body is never read: it is cancelled at once, so the connection is released (review
// fix 6). Pure:
// `fetch` is injected (tests use a fake; lib/mail/index.ts passes the global one). Nothing here
// logs, and no result or error carries the key, the address or the body.
import type { MailMessage, SendResult } from "./delivery";

export const RESEND_ENDPOINT = "https://api.resend.com/emails";
export const RESEND_TIMEOUT_MS = 10_000;

/** The part of a response the adapter uses: the status, and the body only to cancel it. */
export type FetchResponseLike = { ok: boolean; status: number; body?: { cancel(): Promise<void> } | null };

/** The part of `fetch` the adapter uses. */
export type FetchLike = (
  url: string,
  init: { method: string; headers: Record<string, string>; body: string; signal: AbortSignal; redirect: "error" },
) => Promise<FetchResponseLike>;

/** Cancels the unread body (releases the connection); a failure here changes nothing. */
function discardBody(response: FetchResponseLike): void {
  try {
    response.body?.cancel().catch(() => undefined);
  } catch {
    // Nothing to release.
  }
}

function failureOf(status: number): Extract<SendResult, { ok: false }>["code"] {
  if (status === 400 || status === 422) return "rejected";
  if (status === 401 || status === 403) return "unauthorized";
  if (status === 429) return "rate_limited";
  if (status >= 500) return "provider_unavailable";
  return "failed";
}

export async function sendWithResend(
  config: { apiKey: string; from: string },
  message: MailMessage,
  deps: { fetch: FetchLike; timeoutMs?: number },
): Promise<SendResult> {
  const controller = new AbortController();
  let timedOut = false;
  const timer = setTimeout(() => {
    timedOut = true;
    controller.abort();
  }, deps.timeoutMs ?? RESEND_TIMEOUT_MS);
  try {
    const response = await deps.fetch(RESEND_ENDPOINT, {
      method: "POST",
      headers: { Authorization: `Bearer ${config.apiKey}`, "Content-Type": "application/json" },
      body: JSON.stringify({ from: config.from, to: message.to, subject: message.subject, html: message.html, text: message.text }),
      signal: controller.signal,
      redirect: "error",
    });
    discardBody(response);
    return response.ok ? { ok: true } : { ok: false, code: failureOf(response.status) };
  } catch {
    return { ok: false, code: timedOut ? "timeout" : "network" };
  } finally {
    clearTimeout(timer);
  }
}
