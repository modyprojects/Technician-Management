import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { LoginScreen } from "@/components/ui/LoginScreen";
import { SignOutForm } from "@/components/ui/SignOutForm";
import { loginStateOf } from "@/features/auth/login-state";
import { FORGOT_PASSWORD_PATH, PASSWORD_UPDATED_STATE } from "@/features/auth/password-reset/paths";
import { loginDecision } from "@/features/auth/session-state";
import { PASSWORD_RESET_MESSAGES } from "@/features/data-access/supabase-errors";
import { signIn, signOut } from "@/lib/actions/auth";
import { getSessionState } from "@/lib/auth/session";
import { SignInScreen } from "./_SignInScreen";

export const metadata: Metadata = { title: "כניסה · ניהול טכנאים" };

// The real sign-in screen "כניסה" (Step 2 plan §3.4, §4 #1; Step 2 PR 2.5; AU-01 PROPOSED), on the
// shared LoginScreen of the UI demo prototype (Step 2 PR 2.3). Supabase email and password through
// the server action `signIn`. No sign-up (D50). "שכחתי סיסמה" leads to the self-service reset (D65;
// /login/forgot), and `?state=password-updated` (where a successful reset lands) shows a notice.
// What it shows (features/auth/session-state.ts loginDecision): the unavailable state when the app
// cannot reach the service (not configured); the no-access state with "יציאה" for a session without
// access to the screen it asked for; a signed-in user's own start otherwise; the form for anyone
// else. Only "no-access" is read from the URL as a state ("password-updated" adds the notice only);
// `next` is passed to the action, which follows it only inside the signed-in role's own area
// (features/auth/redirects.ts).
export default async function LoginPage({ searchParams }: PageProps<"/login">) {
  const sp = await searchParams;
  const decision = loginDecision(await getSessionState(), loginStateOf(sp.state) === "no-access");
  if ("redirect" in decision) redirect(decision.redirect);
  const notice = sp.state === PASSWORD_UPDATED_STATE ? PASSWORD_RESET_MESSAGES.updated : undefined;
  if (decision.show === "unavailable") {
    return <LoginScreen state="unavailable" notice={notice} forgotPasswordHref={FORGOT_PASSWORD_PATH} />;
  }
  if (decision.show === "no-access") {
    return <LoginScreen state="no-access" signOut={<SignOutForm action={signOut} variant="light" />} />;
  }
  return (
    <SignInScreen
      action={signIn}
      next={typeof sp.next === "string" ? sp.next : null}
      notice={notice}
      forgotPasswordHref={FORGOT_PASSWORD_PATH}
    />
  );
}
