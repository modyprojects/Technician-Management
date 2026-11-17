// Whether a session may set a new password on the reset screen (D65; docs/security.md §4). Pure.
//
// Only a session that the reset link itself created, recently: its JWT `amr` (authentication
// methods reference) must hold an email-token verification no older than RESET_LINK_MINUTES. An
// ordinary password session ("password"), a refreshed one (the amr keeps the original method and
// time) or an old one is refused, so a signed-in session can never change a password here.
//
// The claim shape, pinned on the local stack (tests/auth/password-reset.spec.ts): Supabase Auth's
// `verifyOtp({ type: "recovery", token_hash })` gives `amr: [{ method: "otp", timestamp: <unix s> }]`
// (the same method as every email-token verification: an emailed sign-in link or code would also
// pass, and each proves control of the mailbox exactly as the reset link does; public sign-up is
// off, D50). "recovery" is accepted too, the name an Auth version may give the same verification.
// A password sign-in gives `[{ method: "password", … }]`.
import { RESET_LINK_MINUTES } from "./paths";

const RECOVERY_METHODS: ReadonlySet<string> = new Set(["otp", "recovery"]);

/** Clock skew tolerated between the Auth server and this server, in seconds. */
const CLOCK_SKEW_SECONDS = 60;

/**
 * True when `claims` (the verified JWT claims of the request's session) show an email-token
 * verification within the last RESET_LINK_MINUTES. Anything malformed is false (fail closed).
 */
export function isRecentRecoverySession(claims: unknown, nowSeconds: number): boolean {
  if (typeof claims !== "object" || claims === null) return false;
  const amr = (claims as { amr?: unknown }).amr;
  if (!Array.isArray(amr)) return false;
  const oldest = nowSeconds - RESET_LINK_MINUTES * 60;
  return amr.some((entry: unknown) => {
    if (typeof entry !== "object" || entry === null) return false;
    const { method, timestamp } = entry as { method?: unknown; timestamp?: unknown };
    return (
      typeof method === "string" &&
      RECOVERY_METHODS.has(method) &&
      typeof timestamp === "number" &&
      Number.isFinite(timestamp) &&
      timestamp >= oldest &&
      timestamp <= nowSeconds + CLOCK_SKEW_SECONDS
    );
  });
}
