"use client";

// "איפוס סיסמה" (D65): the request form, then one of two answers.
// - "sent": the same heading and text for every address, whether or not an account exists;
// - "delivery-off": email delivery is not active in this environment (decided by the environment
//   only, before any Auth call): contact the Creator.
// A request that did not complete (offline, server error) keeps the form with the service message;
// a malformed submission (the browser's own check normally stops it) shows the email rule's message.
// When an answer replaces the form, focus moves to the card's heading (the form and its button are
// gone), so a screen reader announces the new view.
import { useEffect, useRef, useState } from "react";
import { AuthCardLink, AuthScreen } from "@/components/ui/AuthScreen";
import { ForgotPasswordForm } from "@/components/ui/ForgotPasswordForm";
import type { ResetRequestResult } from "@/features/auth/password-reset/input";
import { LOGIN_PATH } from "@/features/auth/session-state";
import { PASSWORD_RESET_MESSAGES as M } from "@/features/data-access/supabase-errors";

type ScreenState = "form" | "retry" | "invalid" | "sent" | "delivery-off";

export function ForgotScreen({ action }: { action: (input: unknown) => Promise<ResetRequestResult> }) {
  const [state, setState] = useState<ScreenState>("form");
  const [email, setEmail] = useState("");
  const title = useRef<HTMLHeadingElement>(null);
  const answered = state === "sent" || state === "delivery-off";

  useEffect(() => {
    if (answered) title.current?.focus();
  }, [answered]);

  async function submit(values: { email: string }) {
    setEmail(values.email);
    try {
      const result = await action({ email: values.email });
      setState(result.state);
    } catch {
      setState("retry");
    }
  }

  if (state === "sent") {
    return (
      <AuthScreen title={M.sentTitle} titleRef={title}>
        <p role="status" className="login-p login-p-center">
          {M.sent}
        </p>
        <AuthCardLink href={LOGIN_PATH}>{M.backToLogin}</AuthCardLink>
      </AuthScreen>
    );
  }
  if (state === "delivery-off") {
    return (
      <AuthScreen title={M.forgotTitle} titleRef={title}>
        <div role="alert" className="login-alert">
          {M.deliveryOff}
        </div>
        <AuthCardLink href={LOGIN_PATH}>{M.backToLogin}</AuthCardLink>
      </AuthScreen>
    );
  }
  const alert = state === "retry" ? M.service : state === "invalid" ? "כתובת מייל לא תקינה" : null;
  return (
    <AuthScreen title={M.forgotTitle}>
      <p className="sub login-p login-p-center">{M.forgotIntro}</p>
      {alert && (
        <div role="alert" className="login-alert">
          {alert}
        </div>
      )}
      <ForgotPasswordForm key={state} initialEmail={email} onSubmit={submit} />
      <AuthCardLink href={LOGIN_PATH}>{M.backToLogin}</AuthCardLink>
    </AuthScreen>
  );
}
