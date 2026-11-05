"use client";

// The sign-in form of "כניסה" (Step 2 plan §3.4; AU-01 PROPOSED, Step 2 PR 2.3): "אימייל" and
// "סיסמה" (both LTR) and "כניסה". The caller's `onSubmit` acts (the UI demo: a simulated toast; the
// real sign-in, PR 2.5, binds its server action and decides the form's attributes).
// The password never leaves the input except into the one call:
// - the password input is UNCONTROLLED (read through its ref), with no `value` or `defaultValue`
//   prop: a controlled input would make React copy each keystroke into the `value` attribute, and
//   so into the page's HTML;
// - no input has a `name`, so a submit without JavaScript can never serialize it (the form posts,
//   never a GET into the URL);
// - it is read once into a local constant at submit, never put in state, a log or a message, and
//   the input is emptied as soon as the call returns, whether it succeeded or failed;
// - after a refusal in the browser (nothing was sent) it keeps its value, so the user can fix the
//   other field.
// Checks before the call are the shared validators (no new rule): emailError, then passwordError.
// The first invalid field gets focus, aria-invalid and the message (role="alert").
import { useId, useRef, useState, type FormEvent } from "react";
import { EMAIL_MAX, emailError, passwordError } from "@/features/accounts/data/validate";

type Field = "email" | "password";

export function LoginForm({ onSubmit }: { onSubmit: (values: { email: string; password: string }) => void | Promise<void> }) {
  const id = useId();
  const errorId = `${id}-error`;
  const emailRef = useRef<HTMLInputElement>(null);
  const passwordRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ field: Field; text: string } | null>(null);

  function fail(field: Field, text: string) {
    setError({ field, text });
    (field === "email" ? emailRef : passwordRef).current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const password = passwordRef.current?.value ?? "";
    const emailProblem = emailError(email);
    if (emailProblem) return fail("email", emailProblem);
    const passwordProblem = passwordError(password);
    if (passwordProblem) return fail("password", passwordProblem);
    setError(null);
    setBusy(true);
    try {
      await onSubmit({ email: email.trim(), password });
    } finally {
      if (passwordRef.current) passwordRef.current.value = "";
      setBusy(false);
    }
  }

  const invalid = (field: Field) => (error?.field === field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {});

  return (
    <form className="login-form" noValidate method="post" aria-label="כניסה" onSubmit={(e) => void submit(e)}>
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
            if (error?.field === "email") setError(null);
          }}
          {...invalid("email")}
        />
      </label>
      <label>
        סיסמה
        <input
          ref={passwordRef}
          type="password"
          dir="ltr"
          autoComplete="current-password"
          aria-required="true"
          onInput={() => {
            if (error?.field === "password") setError(null);
          }}
          {...invalid("password")}
        />
      </label>
      {error && (
        <span id={errorId} role="alert" className="set-err login-err">
          {error.text}
        </span>
      )}
      <button type="submit" className="btn pri" disabled={busy}>
        {busy ? "נכנס…" : "כניסה"}
      </button>
    </form>
  );
}
