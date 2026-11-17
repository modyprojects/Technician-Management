// The mock delivery's record (D65): one JSON line per message, for the local stack's tests
// (MAIL_MOCK_FILE) or the in-memory list. Pure. Never sent anywhere and never logged.
import type { MailMessage } from "./delivery";

export type MockMailRecord = MailMessage & { at: string };

export function mockMailLine(message: MailMessage, at: Date): string {
  const record: MockMailRecord = { at: at.toISOString(), to: message.to, subject: message.subject, text: message.text, html: message.html };
  return `${JSON.stringify(record)}\n`;
}
