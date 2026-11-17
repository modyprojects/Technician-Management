"use client";

// The request form of "איפוס סיסמה" (D65): "אימייל" (LTR) and "שליחת קישור", in the sign-in form's
// classes and pattern (LoginForm): no `name` on the input (a submit without JavaScript never
// serializes it, and the form posts, never a GET into the URL), the shared email rule before the
// call (emailError), the message under the field with role="alert", focus on the invalid field.
// The caller's `onSubmit` acts (the server action `requestPasswordReset`).
import { useId, useRef, useState, type FormEvent } from "react";
import { EMAIL_MAX, emailError } from "@/features/accounts/data/validate";
import { PASSWORD_RESET_MESSAGES } from "@/features/data-access/supabase-errors";

export function ForgotPasswordForm({
  onSubmit,
  initialEmail = "",
}: {
  onSubmit: (values: { email: string }) => void | Promise<void>;
  /** The email to start with (after a failed attempt the screen renders a fresh form). */
  initialEmail?: string;
}) {
  const id = useId();
  const errorId = `${id}-error`;
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState(initialEmail);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const problem = emailError(email);
    if (problem) {
      setError(problem);
      emailRef.current?.focus();
      return;
    }
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ email: email.trim() });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form className="login-form" noValidate method="post" aria-label={PASSWORD_RESET_MESSAGES.forgotTitle} onSubmit={(e) => void submit(e)}>
      <label>
        אימייל
        <input
          ref={emailRef}
          type="email"
          dir="ltr"
          autoComplete="username"
          inputMode="email"
          maxLength={EMAIL_MAX}
          aria-required="true"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            if (error) setError(null);
          }}
          {...(error ? { "aria-invalid": true as const, "aria-describedby": errorId } : {})}
        />
      </label>
      {error && (
        <span id={errorId} role="alert" className="set-err">
          {error}
        </span>
      )}
      <button type="submit" className="btn pri" disabled={busy}>
        {busy ? PASSWORD_RESET_MESSAGES.sending : PASSWORD_RESET_MESSAGES.send}
      </button>
    </form>
  );
}
