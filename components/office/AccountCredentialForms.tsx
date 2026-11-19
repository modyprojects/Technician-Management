"use client";

// The Creator's credential dialogs on an account row (Step 2 plan §4 #7, §3.9; D34 e, D50; SE-17
// PROPOSED): "הגדרת סיסמה" and "שינוי כתובת מייל". Offered by credentialActionsOffered (the Creator,
// never on his own row: TEMPORARY Q22, P-6 not built); the server checks the caller in the database
// before any Auth admin call (D34). Each runs one command from useAccountCommands() and returns
// whether it was simulated; the caller shows the result.
// "הגדרת סיסמה": the password is never shown back, kept or sent by the app.
// - The field is UNCONTROLLED (read through its ref; no `name`, `value` or `defaultValue`), so no
//   keystroke reaches the page's HTML; it is read once into a local constant at submit and emptied
//   as soon as the call returns, success or failure. A refusal in the browser (nothing was sent)
//   keeps the value. No show/hide toggle and no confirmation field (neither is in the plan; the
//   toggle is owner question §9 Q-C).
// - A hidden, read-only username field (the account's email) lets a password manager file a save
//   under the target user, never the Creator (critique S10). It is left out when the email is
//   unknown (the real screen, Q5).
// - Strength is the sign-in system's (TEMPORARY Q12): the app checks only non-empty and ≤ 72 bytes.
// "שינוי כתובת מייל": the sign-in email; a test account keeps an example.test address (TEMPORARY
// Q17); a Technician's Outlook email is not changed here ("עריכת פרטים", Q14).
// After a refused or failed command the field takes focus again: the form is re-enabled with
// flushSync first, since focus() on a still-disabled field does nothing and focus would fall to the
// page, outside the dialog (review AUTH-N1, UI-4).
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import type { UserAccount } from "@/features/accounts/data/types";
import { credentialEmailError, EMAIL_MAX, NO_CHANGE, passwordError } from "@/features/accounts/data/validate";
import { useAccountCommands } from "@/features/accounts/commands-context";
import { AccountDialog, DIALOG_FAILED, DialogNotes } from "./AccountDialog";

const PASSWORD_NOTES = [
  { text: "רק היוצר קובע סיסמאות. האפליקציה לא שומרת את הסיסמה אצלה, לא מציגה אותה שוב ולא שולחת אותה במייל או בהודעה." },
  // TEMPORARY (Step 2 plan Q1): the Creator hands the password over himself and no change is forced
  // at the first sign-in; the self-service reset (D65) needs email delivery, which is not enabled.
  { text: "היוצר מוסר את הסיסמה למשתמש בעצמו." },
  // TEMPORARY (Q12).
  { text: "חוזק הסיסמה נבדק במערכת ההתחברות." },
] as const;

export function PasswordForm({
  account,
  onDone,
  onClose,
}: {
  /** `email` null: unknown to the viewer (the real screen, Q5): no hidden username then. */
  account: { id: UserAccount["id"]; name: string; email: string | null };
  /** After the command succeeded: whether it was simulated. */
  onDone: (simulated: boolean) => void;
  onClose: () => void;
}) {
  const accounts = useAccountCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const passwordRef = useRef<HTMLInputElement>(null);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  /** `field`: the message is about the field (aria-invalid). */
  const [error, setError] = useState<{ text: string; field: boolean } | null>(null);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const password = passwordRef.current?.value ?? "";
    const invalid = passwordError(password);
    if (invalid) {
      setError({ text: invalid, field: true });
      passwordRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = DIALOG_FAILED;
    let simulated = false;
    try {
      const r = await accounts.setPassword(account.id, password);
      if (r.ok) {
        failure = null;
        simulated = r.simulated;
      } else {
        failure = r.error;
      }
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      // Emptied as soon as the call returns, whatever the result.
      if (passwordRef.current) passwordRef.current.value = "";
      // Re-enabled now, so the focus below reaches the field.
      flushSync(() => setBusy(false));
    }
    if (failure === null) {
      onDone(simulated);
      return;
    }
    setError({ text: failure, field: false });
    passwordRef.current?.focus();
  }

  return (
    <AccountDialog title={`הגדרת סיסמה · ${account.name}`} dirty={dirty} busy={busy} onClose={onClose}>
      <form className="vc-form" noValidate onSubmit={(e) => void submit(e)} aria-describedby={error && !error.field ? errorId : undefined}>
        <div className="db">
          {/* Markup only (critique S10): the password manager's username, never shown or tabbable. */}
          {account.email !== null && (
            <input type="email" autoComplete="username" value={account.email} readOnly tabIndex={-1} aria-hidden="true" className="sr-only" />
          )}
          <label className="vc-label">
            סיסמה חדשה
            <input
              ref={passwordRef}
              type="password"
              dir="ltr"
              autoComplete="new-password"
              aria-required="true"
              disabled={busy}
              onInput={() => {
                setDirty(true);
                if (error?.field) setError(null);
              }}
              {...(error?.field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {})}
            />
          </label>
          <DialogNotes notes={PASSWORD_NOTES} />
        </div>
        <div className="df">
          <button type="submit" className="btn pri" disabled={busy}>
            {busy ? "שומר…" : "שמירת הסיסמה"}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          {error && (
            <span id={errorId} role="alert" className="set-err vc-err">
              {error.text}
            </span>
          )}
        </div>
      </form>
    </AccountDialog>
  );
}

export function EmailForm({
  account,
  onDone,
  onClose,
}: {
  /** `email` null: unknown to the viewer (the real screen shows "—", Q5). */
  account: { id: UserAccount["id"]; name: string; email: string | null; role: UserAccount["role"]; isTest: boolean };
  /** After the command succeeded: the new email as sent, and whether it was simulated. */
  onDone: (email: string, simulated: boolean) => void;
  onClose: () => void;
}) {
  const accounts = useAccountCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const emailRef = useRef<HTMLInputElement>(null);
  const [email, setEmail] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: boolean } | null>(null);

  const notes = [
    { text: "רק היוצר משנה מייל של חשבון. זה המייל לכניסה לאפליקציה." },
    // TEMPORARY (Step 2 plan Q17): an app-only rule until the owner decides.
    ...(account.isTest ? [{ text: "חשבון בדיקה: רק כתובות ‎@example.test." }] : []),
    // TEMPORARY (Q14): the Outlook email is a separate field of the technician's profile.
    ...(account.role === "tech" ? [{ text: "המייל ב-Outlook של הטכנאי לא משתנה כאן: הוא נערך ב\"עריכת פרטים\"." }] : []),
  ];

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const next = email.trim();
    const invalid =
      credentialEmailError(next, { isTest: account.isTest }) ??
      (account.email !== null && next.toLowerCase() === account.email.trim().toLowerCase() ? NO_CHANGE : null);
    if (invalid) {
      setError({ text: invalid, field: true });
      emailRef.current?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = DIALOG_FAILED;
    let simulated = false;
    try {
      const r = await accounts.changeEmail(account.id, next);
      if (r.ok) {
        failure = null;
        simulated = r.simulated;
      } else {
        failure = r.error;
      }
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      // Re-enabled now, so the focus below reaches the field.
      flushSync(() => setBusy(false));
    }
    if (failure === null) {
      onDone(next, simulated);
      return;
    }
    setError({ text: failure, field: false });
    emailRef.current?.focus();
  }

  return (
    <AccountDialog title={`שינוי כתובת מייל · ${account.name}`} dirty={email !== ""} busy={busy} onClose={onClose}>
      <form className="vc-form" noValidate onSubmit={(e) => void submit(e)} aria-describedby={error && !error.field ? errorId : undefined}>
        <div className="db">
          <div className="kv vc-kv">
            <span>המייל הנוכחי:</span>
            <span dir="ltr" style={{ textAlign: "right", overflowWrap: "anywhere" }}>
              {account.email ?? "—"}
            </span>
          </div>
          <label className="vc-label">
            מייל חדש
            <input
              ref={emailRef}
              type="email"
              dir="ltr"
              autoComplete="off"
              maxLength={EMAIL_MAX}
              value={email}
              disabled={busy}
              onChange={(e) => {
                setEmail(e.target.value);
                if (error?.field) setError(null);
              }}
              {...(error?.field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {})}
            />
          </label>
          <DialogNotes notes={notes} />
        </div>
        <div className="df">
          <button type="submit" className="btn pri" disabled={busy}>
            {busy ? "שומר…" : "שמירת המייל"}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
          {error && (
            <span id={errorId} role="alert" className="set-err vc-err">
              {error.text}
            </span>
          )}
        </div>
      </form>
    </AccountDialog>
  );
}
