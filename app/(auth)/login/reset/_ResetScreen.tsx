"use client";

// "בחירת סיסמה חדשה" (D65): the new-password form, or the invalid-link state with "בקשת קישור חדש".
// The link's token is sent only with a submission (the server action uses it once). When the
// action answers that the link was used and the reset session now carries it (`sessionReady`, for
// example after a weak password), the form drops the token for the next try and removes it from
// the address bar. A success redirects to the sign-in screen with a notice.
import { useRef, useState } from "react";
import { AuthCardLink, AuthScreen } from "@/components/ui/AuthScreen";
import { ResetPasswordForm } from "@/components/ui/ResetPasswordForm";
import type { ResetCompleteFailure, ResetErrorKind } from "@/features/auth/password-reset/input";
import { FORGOT_PASSWORD_PATH, RESET_PASSWORD_PATH } from "@/features/auth/password-reset/paths";
import { PASSWORD_RESET_MESSAGES as M } from "@/features/data-access/supabase-errors";

const ERROR_TEXT: Readonly<Record<ResetErrorKind, string>> = {
  missing: "חסרה סיסמה",
  "too-long": "הסיסמה ארוכה מדי",
  mismatch: M.mismatch,
  weak: M.weak,
  same: M.same,
  service: M.service,
};

export function ResetScreen({
  action,
  tokenHash,
  initialState,
}: {
  action: (input: unknown) => Promise<ResetCompleteFailure>;
  tokenHash: string | null;
  initialState: "form" | "invalid-link";
}) {
  const [state, setState] = useState(initialState);
  const [alert, setAlert] = useState<string | null>(null);
  const token = useRef(tokenHash);

  async function submit(values: { password: string; confirm: string }) {
    setAlert(null);
    let result: ResetCompleteFailure | undefined;
    try {
      result = await action({ tokenHash: token.current, password: values.password, confirm: values.confirm });
    } catch {
      // The request did not complete (offline, server error).
      setAlert(M.service);
      return;
    }
    // A redirect (success) leaves the page; only a returned failure lands here.
    if (!result) return;
    if (result.state === "invalid-link") {
      setState("invalid-link");
      return;
    }
    if (result.sessionReady && token.current !== null) {
      token.current = null;
      window.history.replaceState(null, "", RESET_PASSWORD_PATH);
    }
    setAlert(ERROR_TEXT[result.kind] ?? M.service);
  }

  if (state === "invalid-link") {
    return (
      <AuthScreen title={M.resetTitle}>
        <div role="alert" className="login-alert">
          {M.invalidLink}
        </div>
        <AuthCardLink href={FORGOT_PASSWORD_PATH}>{M.requestNew}</AuthCardLink>
      </AuthScreen>
    );
  }
  return (
    <AuthScreen title={M.resetTitle}>
      {alert && (
        <div role="alert" className="login-alert">
          {alert}
        </div>
      )}
      <ResetPasswordForm onSubmit={submit} />
    </AuthScreen>
  );
}
