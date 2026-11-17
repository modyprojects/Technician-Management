// This server instance's throttle of reset emails (D65). INTERIM and per instance (in memory): a
// durable throttle is a go-live blocker before `resend` is enabled (see
// features/auth/password-reset/throttle.ts).
import "server-only";
import { createResetThrottle, resetThrottleKey } from "@/features/auth/password-reset/throttle";

const throttle = createResetThrottle();

/** True when a reset email may go to `email` now (it is then counted). */
export function allowResetEmail(email: string): boolean {
  return throttle.allow(resetThrottleKey(email));
}
