import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { startPathOf } from "@/features/auth/session-state";
import { requestPasswordReset } from "@/lib/actions/password-reset";
import { getSessionState } from "@/lib/auth/session";
import { ForgotScreen } from "./_ForgotScreen";

export const metadata: Metadata = { title: "איפוס סיסמה · ניהול טכנאים" };

// "איפוס סיסמה" (D65): asks for a reset link (lib/actions/password-reset.ts requestPasswordReset).
// A signed-in user goes to his own start, as on /login; everyone else gets the form (also without
// the Supabase values: the action then answers "delivery-off"). Rendered per request
// (getSessionState awaits `connection()`).
export default async function ForgotPasswordPage() {
  const state = await getSessionState();
  if (state.kind === "signed-in") {
    const start = startPathOf(state.user);
    if (start) redirect(start);
  }
  return <ForgotScreen action={requestPasswordReset} />;
}
