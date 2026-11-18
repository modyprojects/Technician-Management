"use client";

// "הוסף משתמש" (D60 (7); QA M-06, C-01: one button, the role chosen in the form): the real
// unified user management's creation dialog, in the account dialogs' drawer (AccountDialog).
// - "תפקיד": the roles creatableRoles() offers (the Creator: טכנאי, שירות לקוחות, מנהל; the
//   Manager: טכנאי, שירות לקוחות). No role is chosen at first. The Creator also sees a disabled
//   "יוצר · ממתין להחלטת בעלים" (TEMPORARY, Step 2 plan Q9; D49): it can never be chosen or sent.
// - "שם", "מייל", "טלפון עבודה"; with "טכנאי" also "צבע ביומן" (the allowlisted `t-*` tokens,
//   never CSS from input) and "מכשיר". The email of a Technician is also his Outlook attendee
//   address (the server stores it as both; Q14), and a new Technician is "פעיל" (receives new
//   invitations): shown as a note, changed later in "עריכת פרטים" by the Creator (Q14).
// - Until go-live every new account is test-marked (D47): the email must be in example.test.
// - No password field and no public sign-up (D50): the Creator sets the first password
//   ("הגדרת סיסמה", TEMPORARY Q1).
// The fields are checked first with the shared validators the server runs again (the first invalid
// field takes focus and aria-invalid); the action then runs createAccount (an office role) or
// createTechnician (the account and its field profile). Its Hebrew message is shown; outcomes that
// left something behind (an incomplete creation, a missing field profile, a cancelled creation) are
// passed to the caller as `onSettled`, which closes the dialog and shows them on the card.
import { useId, useRef, useState, type FormEvent } from "react";
import { flushSync } from "react-dom";
import { useAccountCommands } from "@/features/accounts/commands-context";
import { ACCOUNT_ROLE_LABELS, DEFAULT_TECHNICIAN_DEVICE, type NewAccountRole, type UserAccount } from "@/features/accounts/data/types";
import {
  accountEmailError,
  ACCOUNT_NAME_MAX,
  accountNameError,
  DEVICE_MAX,
  deviceError,
  EMAIL_MAX,
  PHONE_MAX,
  phoneError,
  TEST_EMAIL_DOMAIN,
  testAccountEmailError,
} from "@/features/accounts/data/validate";
import { ACCOUNT_MESSAGES } from "@/features/data-access/supabase-errors";
import type { TechnicianColorToken } from "@/features/reference/data/types";
import { AccountDialog, ColorChoice, DIALOG_FAILED, DialogNotes } from "./AccountDialog";

type Field = "role" | "name" | "email" | "phone" | "color" | "device";

/** A role must be chosen (no default). */
export const ROLE_REQUIRED = "יש לבחור תפקיד";
const COLOR_REQUIRED = "יש לבחור צבע ביומן";

/**
 * Failures after which something exists that the list shows (Step 2 plan §3.8): the dialog closes
 * and the card shows the message, so the user sees the row it names.
 */
export const SETTLED_FAILURES: ReadonlySet<string> = new Set([
  ACCOUNT_MESSAGES.creationIncomplete,
  ACCOUNT_MESSAGES.technicianProfileMissing,
  ACCOUNT_MESSAGES.creationCancelled,
]);

export function AccountAddDialog({
  roles,
  creatorOptionShown,
  onDone,
  onSettled,
  onClose,
}: {
  /** The roles the viewer may create (creatableRoles). */
  roles: readonly NewAccountRole[];
  /** The Creator: the disabled "יוצר · ממתין להחלטת בעלים" option (Q9). */
  creatorOptionShown: boolean;
  /** Created: the account as stored (when the server could read it back) and its name. */
  onDone: (created: { name: string; role: NewAccountRole; account: UserAccount | null }) => void;
  /** A failure that left something behind (SETTLED_FAILURES): its message. */
  onSettled: (message: string) => void;
  onClose: () => void;
}) {
  const accounts = useAccountCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const roleRef = useRef<HTMLFieldSetElement>(null);
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [role, setRole] = useState<NewAccountRole | null>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [color, setColor] = useState<TechnicianColorToken | null>(null);
  const [device, setDevice] = useState<string>(DEFAULT_TECHNICIAN_DEVICE);
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: Field | null } | null>(null);
  const tech = role === "tech";

  const edit =
    <T,>(set: (v: T) => void, field: Field) =>
    (value: T) => {
      set(value);
      setDirty(true);
      if (error?.field === field || error?.field === null) setError(null);
    };

  function fail(text: string, field: Field | null) {
    setError({ text, field });
    const target: Record<Field, HTMLElement | null | undefined> = {
      role: roleRef.current?.querySelector<HTMLInputElement>("input:not([disabled])"),
      name: nameRef.current,
      email: emailRef.current,
      phone: phoneRef.current,
      color: colorRef.current?.querySelector<HTMLInputElement>("input"),
      device: deviceRef.current,
    };
    if (field) target[field]?.focus();
    else if (!formRef.current?.contains(document.activeElement)) submitRef.current?.focus();
  }

  /** The first invalid field, in form order (the same rules the server runs). */
  function firstInvalid(): { text: string; field: Field } | null {
    const checks: [Field, string | null][] = [
      ["role", role === null ? ROLE_REQUIRED : null],
      ["name", accountNameError(name)],
      ["email", accountEmailError(email) ?? testAccountEmailError(email)],
      ["phone", phoneError(phone)],
    ];
    if (tech) {
      checks.push(["color", color === null ? COLOR_REQUIRED : null]);
      checks.push(["device", deviceError(device)]);
    }
    const hit = checks.find(([, text]) => text !== null);
    return hit ? { field: hit[0], text: hit[1] as string } : null;
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const invalid = firstInvalid();
    if (invalid || role === null) return fail(invalid?.text ?? ROLE_REQUIRED, invalid?.field ?? "role");
    const base = { name: name.trim(), email: email.trim(), phone: phone.trim() };
    setBusy(true);
    setError(null);
    let failure: string | null = DIALOG_FAILED;
    let account: UserAccount | null = null;
    try {
      const r =
        role === "tech" && color !== null
          ? await accounts.createTechnician({ ...base, color, device: device.trim() })
          : await accounts.createAccount({ ...base, role });
      if (r.ok) {
        failure = null;
        account = r.data?.account ?? null;
      } else {
        failure = r.error;
      }
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      flushSync(() => setBusy(false));
    }
    if (failure === null) return onDone({ name: base.name, role, account });
    if (SETTLED_FAILURES.has(failure)) return onSettled(failure);
    fail(failure, null);
  }

  const invalidProps = (field: Field) => (error?.field === field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {});

  // Owner review 2026-11-18: one short note (TEMPORARY, Step 2 plan Q1: the Creator sets the first
  // password); the test-data box is replaced by the screen's banner (D74).
  const notes = [{ text: "את הסיסמה הראשונה קובע היוצר ומוסר אותה למשתמש." }];
  const emailHelpId = `${id}-email-help`;

  return (
    <AccountDialog title="הוספת משתמש" dirty={dirty} busy={busy} onClose={onClose}>
      <form
        ref={formRef}
        className="vc-form"
        noValidate
        onSubmit={(e) => void submit(e)}
        aria-describedby={error && !error.field ? errorId : undefined}
      >
        <div className="db">
          {/* A radio group (review N1): aria-required and aria-invalid belong to role="radiogroup". */}
          <fieldset
            ref={roleRef}
            className="set-swatches acct-roles"
            role="radiogroup"
            aria-labelledby={`${id}-role-legend`}
            aria-required="true"
            aria-invalid={error?.field === "role" ? true : undefined}
            aria-describedby={error?.field === "role" ? errorId : undefined}
          >
            <legend id={`${id}-role-legend`}>תפקיד</legend>
            {roles.map((r) => (
              <label key={r} className="set-swatch-opt">
                <input
                  type="radio"
                  name={`${id}-role`}
                  value={r}
                  checked={role === r}
                  disabled={busy}
                  onChange={() => edit(setRole, "role")(r)}
                />
                {ACCOUNT_ROLE_LABELS[r]}
              </label>
            ))}
            {creatorOptionShown && (
              // TEMPORARY (Q9): shown, never selectable, no value the form could send.
              <label className="set-swatch-opt acct-role-pending">
                <input type="radio" name={`${id}-role`} disabled />
                {ACCOUNT_ROLE_LABELS.creator}
              </label>
            )}
          </fieldset>
          <label className="vc-label">
            שם
            <input
              ref={nameRef}
              value={name}
              required
              maxLength={ACCOUNT_NAME_MAX}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => edit(setName, "name")(e.target.value)}
              {...invalidProps("name")}
            />
          </label>
          <label className="vc-label">
            מייל
            <input
              ref={emailRef}
              type="email"
              dir="ltr"
              value={email}
              required
              maxLength={EMAIL_MAX}
              placeholder={`name@${TEST_EMAIL_DOMAIN}`}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => edit(setEmail, "email")(e.target.value)}
              aria-describedby={error?.field === "email" ? `${emailHelpId} ${errorId}` : emailHelpId}
              aria-invalid={error?.field === "email" ? true : undefined}
            />
            <span id={emailHelpId} className="vc-help">
              {tech ? "משמש לכניסה ולשיוך זימונים מ-Outlook" : "משמש לכניסה"}
            </span>
          </label>
          <label className="vc-label">
            טלפון עבודה
            <input
              ref={phoneRef}
              type="tel"
              dir="ltr"
              value={phone}
              required
              maxLength={PHONE_MAX}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => edit(setPhone, "phone")(e.target.value)}
              {...invalidProps("phone")}
            />
          </label>
          {tech && (
            <fieldset className="acct-fieldset">
              <legend>פרטי טכנאי</legend>
              <div ref={colorRef}>
                <ColorChoice
                  name={`${id}-color`}
                  value={color}
                  onChange={edit(setColor, "color")}
                  disabled={busy}
                  invalid={error?.field === "color"}
                  describedBy={error?.field === "color" ? errorId : undefined}
                />
              </div>
              <label className="vc-label">
                מכשיר
                <input
                  ref={deviceRef}
                  value={device}
                  required
                  maxLength={DEVICE_MAX}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(e) => edit(setDevice, "device")(e.target.value)}
                  {...invalidProps("device")}
                />
              </label>
            </fieldset>
          )}
          <DialogNotes notes={notes} />
        </div>
        {error && (
          <div style={{ padding: "0 20px 10px" }}>
            <span id={errorId} role="alert" className="set-err vc-err">
              {error.text}
            </span>
          </div>
        )}
        <div className="df acct-df-end">
          <button ref={submitRef} type="submit" className="btn pri" disabled={busy}>
            {busy ? "יוצר…" : "הוספה"}
          </button>
          <button type="button" className="btn" onClick={onClose} disabled={busy}>
            ביטול
          </button>
        </div>
      </form>
    </AccountDialog>
  );
}
