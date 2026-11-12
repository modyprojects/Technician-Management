// The sign-in screen's states ("כניסה", Step 2 plan §3.4 and §4 #1). Pure: no I/O.
// - "form": the email and password form;
// - "failed": the form with the one message for every credential failure (SIGN_IN_MESSAGES.credentials);
// - "unavailable": the one message for every service failure, before any submission (no form);
// - "no-access": a signed-in account without access to the screen, with sign-out.
// The UI demo reads all four from the URL (`?state=`). The real `/login` (Step 2 PR 2.5) takes
// "no-access" from the URL (plan §3.4) and the other two from its own state; PR 2.5 decides, and
// nothing here wires it.

export const LOGIN_STATES = ["form", "failed", "unavailable", "no-access"] as const;
export type LoginState = (typeof LOGIN_STATES)[number];

/** A Set, so a value such as "__proto__" or "constructor" is never found. */
const KNOWN: ReadonlySet<string> = new Set(LOGIN_STATES);

/**
 * The state named by an untrusted value (a URL search parameter): one of LOGIN_STATES exactly, or
 * "form" for anything else (another case, an array of values, "__proto__", undefined …).
 */
export function loginStateOf(value: unknown): LoginState {
  return typeof value === "string" && KNOWN.has(value) ? (value as LoginState) : "form";
}
