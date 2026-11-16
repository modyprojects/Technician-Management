// Auth instrumentation (docs/security.md §8; Step 2 plan §3.4 "Instrumentation"): an event name and
// a short code only. Never an email, a password, a token, a cookie or a request payload.
import "server-only";
import { authLogLine } from "@/features/auth/sign-in-input";

export function logAuthEvent(event: string, code: unknown): void {
  console.warn(authLogLine(event, code));
}
