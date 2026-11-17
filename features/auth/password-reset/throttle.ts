// Interim throttle of reset emails (D65). INTERIM, per server instance and in memory: Vercel runs
// several instances and restarts them, so this is no durable limit. A durable throttle (a
// database-backed counter, or Supabase's Send Email Hook) is a GO-LIVE BLOCKER before the `resend`
// delivery is enabled (docs/integrations.md "Email"; docs/review/step2-password-reset/README.md).
// Today every environment is `disabled` or the local `mock`, and Preview and Production sit behind
// Vercel Authentication (D29, D31).
//
// Keyed by a SHA-256 of the lower-cased address (the address itself is never kept): at most one
// email per address per minute, and a small cap for the whole instance. A refused request still
// answers "sent" (nothing reveals an account) and leaves the earlier link valid (a new link would
// replace it). Pure apart from the hash: the clock is injected for tests.
import { createHash } from "node:crypto";

export type ResetThrottleOptions = {
  /** Minimum time between two emails to one address. */
  perAddressMs?: number;
  /** Emails per minute for the whole instance. */
  perInstancePerMinute?: number;
  /** Addresses remembered at most; beyond it every request is refused (fail closed). */
  maxAddresses?: number;
  now?: () => number;
};

export type ResetThrottle = {
  /** True when an email may go to the address behind `key` now; it is then counted. */
  allow(key: string): boolean;
};

const MINUTE_MS = 60_000;

/** The throttle key of an address: SHA-256 hex of the trimmed, lower-cased address. */
export function resetThrottleKey(email: string): string {
  return createHash("sha256").update(email.trim().toLowerCase(), "utf8").digest("hex");
}

export function createResetThrottle({
  perAddressMs = MINUTE_MS,
  perInstancePerMinute = 20,
  maxAddresses = 10_000,
  now = Date.now,
}: ResetThrottleOptions = {}): ResetThrottle {
  const lastByAddress = new Map<string, number>();
  let recent: number[] = [];

  function prune(at: number) {
    for (const [key, last] of lastByAddress) {
      if (at - last >= perAddressMs) lastByAddress.delete(key);
    }
    recent = recent.filter((time) => at - time < MINUTE_MS);
  }

  return {
    allow(key) {
      const at = now();
      prune(at);
      if (lastByAddress.has(key)) return false;
      if (recent.length >= perInstancePerMinute) return false;
      if (lastByAddress.size >= maxAddresses) return false;
      lastByAddress.set(key, at);
      recent.push(at);
      return true;
    },
  };
}
