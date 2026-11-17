"use client";

// The new-password form of "בחירת סיסמה חדשה" (D65): "סיסמה חדשה" and "אימות סיסמה" (both LTR, each
// with the sign-in screen's show/hide eye) and "שמירת הסיסמה". The passwords follow the sign-in
// form's rules (LoginForm):
// - the inputs are UNCONTROLLED (read through refs), with no `value` or `defaultValue` and no `name`:
//   a password never reaches React state, a `value` attribute, the page's HTML or a GET URL;
// - read once into local constants at submit, never put in state, a log or a message, and both
//   inputs are emptied as soon as the call returns, whether it succeeded or failed;
// - hidden again (type="password") synchronously before the call (flushSync) and after it;
// - after a refusal in the browser (nothing was sent) they keep their values, so the user can fix one.
// Checks before the call: the shared password rule (passwordError: non-empty, at most 72 UTF-8
// bytes) on each, then equality. The server checks the same again, before it uses the link.
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import { passwordError } from "@/features/accounts/data/validate";
import { PASSWORD_RESET_MESSAGES } from "@/features/data-access/supabase-errors";
import { EyeIcon, EyeOffIcon } from "./Icons";

type Field = "password" | "confirm";

function PasswordField({
  id,
  label,
  toggleLabel,
  inputRef,
  shown,
  onToggle,
  onInput,
  invalid,
  errorId,
}: {
  id: string;
  label: string;
  toggleLabel: string;
  inputRef: RefObject<HTMLInputElement | null>;
  shown: boolean;
  onToggle: () => void;
  onInput: () => void;
  invalid: boolean;
  errorId: string;
}) {
  return (
    <div className="login-field">
      <label htmlFor={id}>{label}</label>
      <div className="pw-field">
        <input
          id={id}
          ref={inputRef}
          type={shown ? "text" : "password"}
          dir="ltr"
          autoComplete="new-password"
          autoCapitalize="none"
          autoCorrect="off"
          spellCheck={false}
          aria-required="true"
          onInput={onInput}
          {...(invalid ? { "aria-invalid": true as const, "aria-describedby": errorId } : {})}
        />
        <button
          type="button"
          className="pw-toggle"
          aria-label={toggleLabel}
          aria-pressed={shown}
          aria-controls={id}
          onClick={onToggle}
        >
          {shown ? <EyeOffIcon /> : <EyeIcon />}
        </button>
      </div>
    </div>
  );
}

export function ResetPasswordForm({ onSubmit }: { onSubmit: (values: { password: string; confirm: string }) => void | Promise<void> }) {
  const id = useId();
  const errorId = `${id}-error`;
  const passwordRef = useRef<HTMLInputElement>(null);
  const confirmRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [shown, setShown] = useState<Record<Field, boolean>>({ password: false, confirm: false });
  const [error, setError] = useState<{ field: Field; text: string } | null>(null);

  function fail(field: Field, text: string) {
    setError({ field, text });
    (field === "password" ? passwordRef : confirmRef).current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const password = passwordRef.current?.value ?? "";
    const confirm = confirmRef.current?.value ?? "";
    const passwordProblem = passwordError(password);
    if (passwordProblem) return fail("password", passwordProblem);
    const confirmProblem = passwordError(confirm);
    if (confirmProblem) return fail("confirm", confirmProblem);
    if (password !== confirm) return fail("confirm", PASSWORD_RESET_MESSAGES.mismatch);
    setError(null);
    flushSync(() => setShown({ password: false, confirm: false }));
    setBusy(true);
    try {
      await onSubmit({ password, confirm });
    } finally {
      if (passwordRef.current) passwordRef.current.value = "";
      if (confirmRef.current) confirmRef.current.value = "";
      setShown({ password: false, confirm: false });
      setBusy(false);
    }
  }

  const clear = (field: Field) => () => {
    if (error?.field === field) setError(null);
  };
  const toggle = (field: Field) => () => setShown((current) => ({ ...current, [field]: !current[field] }));

  return (
    <form className="login-form" noValidate method="post" aria-label={PASSWORD_RESET_MESSAGES.resetTitle} onSubmit={(e) => void submit(e)}>
      <PasswordField
        id={`${id}-password`}
        label={PASSWORD_RESET_MESSAGES.newPassword}
        toggleLabel="הצגת הסיסמה החדשה"
        inputRef={passwordRef}
        shown={shown.password}
        onToggle={toggle("password")}
        onInput={clear("password")}
        invalid={error?.field === "password"}
        errorId={errorId}
      />
      <PasswordField
        id={`${id}-confirm`}
        label={PASSWORD_RESET_MESSAGES.confirmPassword}
        toggleLabel="הצגת אימות הסיסמה"
        inputRef={confirmRef}
        shown={shown.confirm}
        onToggle={toggle("confirm")}
        onInput={clear("confirm")}
        invalid={error?.field === "confirm"}
        errorId={errorId}
      />
      {error && (
        <span id={errorId} role="alert" className="set-err">
          {error.text}
        </span>
      )}
      <button type="submit" className="btn pri" disabled={busy}>
        {busy ? PASSWORD_RESET_MESSAGES.saving : PASSWORD_RESET_MESSAGES.save}
      </button>
    </form>
  );
}
