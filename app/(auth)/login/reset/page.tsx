import type { Metadata } from "next";
import { connection } from "next/server";
import { isRecoveryTokenHash } from "@/features/auth/password-reset/input";
import { completePasswordReset } from "@/lib/actions/password-reset";
import { hasRecentRecoverySession } from "@/lib/auth/recovery-session";
import { createUserSupabaseClient } from "@/lib/supabase/server";
import { ResetScreen } from "./_ResetScreen";

// The reset link's screen "בחירת סיסמה חדשה" (D65). The address carries the token's hash
// (`?token_hash=…`, built by the app, lib/actions/password-reset.ts); this page never uses it: the
// token is verified only when the form is submitted (a POST), so an email scanner or a prefetch that
// opens the link cannot consume it. The form shows for a well-formed token, or without one for a
// recent reset session (a retry after a refused password); otherwise the invalid-link state.
// No referrer leaves this page (the token is in its address), and it loads nothing external.
export const metadata: Metadata = { title: "בחירת סיסמה חדשה · ניהול טכנאים", referrer: "no-referrer" };

export default async function ResetPasswordPage({ searchParams }: PageProps<"/login/reset">) {
  await connection();
  const raw = (await searchParams).token_hash;
  if (raw !== undefined) {
    const tokenHash = isRecoveryTokenHash(raw) ? raw : null;
    return <ResetScreen action={completePasswordReset} tokenHash={tokenHash} initialState={tokenHash ? "form" : "invalid-link"} />;
  }
  const client = await createUserSupabaseClient();
  const recovery = client ? await hasRecentRecoverySession(client) : false;
  return <ResetScreen action={completePasswordReset} tokenHash={null} initialState={recovery ? "form" : "invalid-link"} />;
}
