// The mail port (D65; docs/integrations.md "Email"). Server-only: it reads the delivery variables
// at call time and sends through the selected delivery (features/mail/delivery.ts):
// - "disabled" (the default): nothing is sent;
// - "mock" (local runs and CI only: never where VERCEL_ENV is set, and only with MAIL_MOCK_FILE naming
//   an absolute path): one JSON line per message appended to that file (the local stack's tests);
// - "resend" (DORMANT until the owner approves a provider, a verified sending domain and a durable
//   throttle): the Resend HTTP API (features/mail/resend.ts).
// Nothing here logs; the caller logs an event name and the result's code only (docs/security.md §8).
import "server-only";
import { appendFile } from "node:fs/promises";
import { deliveryModeOf, mockFileOf, resendConfigOf, type DeliveryMode, type MailEnv, type MailMessage, type SendResult } from "@/features/mail/delivery";
import { mockMailLine } from "@/features/mail/mock";
import { sendWithResend } from "@/features/mail/resend";

function mailEnv(): MailEnv {
  return {
    EMAIL_DELIVERY: process.env.EMAIL_DELIVERY,
    VERCEL_ENV: process.env.VERCEL_ENV,
    MAIL_MOCK_FILE: process.env.MAIL_MOCK_FILE,
    EMAIL_PROVIDER_API_KEY: process.env.EMAIL_PROVIDER_API_KEY,
    EMAIL_FROM_ADDRESS: process.env.EMAIL_FROM_ADDRESS,
  };
}

/** The delivery this environment uses now. */
export function deliveryMode(): DeliveryMode {
  return deliveryModeOf(mailEnv());
}

export async function sendMail(message: MailMessage): Promise<SendResult> {
  const env = mailEnv();
  switch (deliveryModeOf(env)) {
    case "disabled":
      return { ok: false, code: "disabled" };
    case "mock": {
      const file = mockFileOf(env);
      if (file === null) return { ok: false, code: "disabled" };
      try {
        await appendFile(file, mockMailLine(message, new Date()), { encoding: "utf8", mode: 0o600 });
        return { ok: true };
      } catch {
        return { ok: false, code: "mock_failed" };
      }
    }
    case "resend": {
      const config = resendConfigOf(env);
      if (config === null) return { ok: false, code: "disabled" };
      return sendWithResend(config, message, { fetch: (url, init) => fetch(url, init) });
    }
  }
}
