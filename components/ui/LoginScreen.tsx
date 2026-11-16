import { Fragment, type ReactNode } from "react";
import type { LoginState } from "@/features/auth/login-state";
import { SIGN_IN_MESSAGES } from "@/features/data-access/supabase-errors";
import { BrandLogo } from "./BrandLogo";

// The sign-in screen "כניסה" (Step 2 plan §3.4, §4 #1; AU-01 PROPOSED, Step 2 PR 2.3). No hooks:
// usable from Server Components. Presentational: the caller passes the form (LoginForm with its own
// submit handler), the sign-out control of the no-access state and any extra content under the card.
// - "form": the email and password form, and the note that there is no self sign-up.
// - "failed": one message for every credential failure (SIGN_IN_MESSAGES.credentials, never which
//   part was wrong), above the form; the caller's form starts with an empty password.
// Each state renders a fresh form (keyed by the state): a password typed in one state never carries
// into another, also when the state changes without a full page load (the demo's state links).
// - "unavailable": one message for every service failure, before any submission (plan §3.4: not
//   configured); no form.
// - "retry": a service failure AFTER a submission (Step 2 PR 2.5): the same message above the form,
//   which is kept so the user can try again.
// - "no-access": a signed-in account without access to the screen (SIGN_IN_MESSAGES.noAccess) and
//   "יציאה", so another account can sign in.
// No sign-up link or route and no "שכחתי סיסמה" (TEMPORARY, Step 2 plan Q2; D50: accounts are
// opened by the system's administrators only). Messages come from features/data-access/supabase-errors.ts.
// The look is PROPOSED (owner question §9 Q-D): a dark page with the white logo, outside the
// existing dark headers of G-08 / D57 (6), and a white card in the demo's language.

const TITLE_ID = "login-title";

const NO_SIGN_UP = "אין הרשמה עצמית. חשבונות נפתחים רק על ידי הנהלת המערכת.";

export function LoginScreen({
  state,
  form,
  signOut,
  extra,
}: {
  state: LoginState;
  /** The sign-in form ("form", "failed" and "retry"). */
  form?: ReactNode;
  /** The sign-out control of the no-access state. */
  signOut?: ReactNode;
  /** Content under the card (the UI demo's state links). */
  extra?: ReactNode;
}) {
  const noAccess = state === "no-access";
  const alert =
    state === "failed" ? SIGN_IN_MESSAGES.credentials : state === "unavailable" || state === "retry" ? SIGN_IN_MESSAGES.service : null;
  const withForm = state === "form" || state === "failed" || state === "retry";
  return (
    <main className="login">
      <div className="login-col">
        <BrandLogo className="brand-logo-login" />
        <div className="login-product">ניהול טכנאים</div>
        <section className="card login-card" aria-labelledby={TITLE_ID}>
          <h1 id={TITLE_ID}>{noAccess ? "אין גישה" : "כניסה"}</h1>
          {alert && (
            <div role="alert" className="login-alert">
              {alert}
            </div>
          )}
          {withForm && <Fragment key={state}>{form}</Fragment>}
          {noAccess ? (
            <>
              <p className="sub login-p">{SIGN_IN_MESSAGES.noAccess}</p>
              <p className="sub login-p">אחרי היציאה אפשר להיכנס עם חשבון אחר.</p>
              {signOut && <div className="login-signout">{signOut}</div>}
            </>
          ) : (
            <p className="sub login-p">{NO_SIGN_UP}</p>
          )}
        </section>
        {extra}
      </div>
    </main>
  );
}
