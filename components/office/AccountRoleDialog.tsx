"use client";

// "שינוי תפקיד" (D60 (7): only the Creator changes an existing user's role; Managers never do),
// opened by "תפקיד" on a row that roleChangeOffered() allows (never the Creator's own row, never a
// Creator row, never a Technician with a field profile). The new role is one of
// roleChangeChoices(): never Creator (D49) and never the current one. The action runs changeRole at
// the version read (`expectedVersion`; a stale one is refused with the "data changed" message,
// PT409); the server checks the caller in the database (`admin_set_user_role`).
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useAccountCommands } from "@/features/accounts/commands-context";
import { roleChangeChoices } from "@/features/accounts/data/offers";
import { ACCOUNT_ROLE_LABELS, type NewAccountRole, type UserAccount } from "@/features/accounts/data/types";
import { AccountDialog, DIALOG_FAILED, DialogNotes } from "./AccountDialog";
import { ROLE_REQUIRED } from "./AccountAddDialog";

const NOTES = [
  { text: "רק היוצר משנה תפקיד של משתמש. השינוי מיידי ונרשם ביומן הביקורת." },
  { text: "התפקיד קובע מה המשתמש רואה ועושה; שינוי תפקיד לא מעניק הרשאות שלא הוגדרו." },
] as const;

export function AccountRoleDialog({
  account,
  onDone,
  onClose,
}: {
  account: Pick<UserAccount, "id" | "name" | "role" | "version">;
  /** The role change was stored: the new role. */
  onDone: (role: NewAccountRole) => void;
  onClose: () => void;
}) {
  const accounts = useAccountCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const groupRef = useRef<HTMLFieldSetElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [role, setRole] = useState<NewAccountRole | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: boolean } | null>(null);
  const choices = roleChangeChoices(account.role);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (role === null) {
      setError({ text: ROLE_REQUIRED, field: true });
      groupRef.current?.querySelector<HTMLInputElement>("input")?.focus();
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = DIALOG_FAILED;
    try {
      const r = await accounts.changeRole({ accountId: account.id, expectedVersion: account.version, newRole: role });
      failure = r.ok ? null : r.error;
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      flushSync(() => setBusy(false));
    }
    if (failure === null) return onDone(role);
    setError({ text: failure, field: false });
    submitRef.current?.focus();
  }

  return (
    <AccountDialog title={`שינוי תפקיד · ${account.name}`} dirty={role !== null} busy={busy} onClose={onClose}>
      <form className="vc-form" noValidate onSubmit={(e) => void submit(e)} aria-describedby={error && !error.field ? errorId : undefined}>
        <div className="db">
          <div className="kv vc-kv">
            <span>התפקיד הנוכחי:</span>
            <b>{ACCOUNT_ROLE_LABELS[account.role]}</b>
          </div>
          <fieldset
            ref={groupRef}
            className="set-swatches acct-roles"
            aria-required="true"
            aria-invalid={error?.field ? true : undefined}
            aria-describedby={error?.field ? errorId : undefined}
          >
            <legend>תפקיד חדש</legend>
            {choices.map((r) => (
              <label key={r} className="set-swatch-opt">
                <input
                  type="radio"
                  name={`${id}-role`}
                  value={r}
                  checked={role === r}
                  disabled={busy}
                  onChange={() => {
                    setRole(r);
                    if (error) setError(null);
                  }}
                />
                {ACCOUNT_ROLE_LABELS[r]}
              </label>
            ))}
          </fieldset>
          <DialogNotes
            notes={[
              ...NOTES,
              ...(role === "tech" ? [{ text: "אחרי השינוי לטכנאי, את הצבע והמכשיר מגדירים ב\"השלמה\" (פרופיל טכנאי חסר)." }] : []),
            ]}
          />
        </div>
        <div className="df">
          <button ref={submitRef} type="submit" className="btn pri" disabled={busy}>
            {busy ? "שומר…" : "שינוי התפקיד"}
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
