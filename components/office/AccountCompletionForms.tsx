"use client";

// Completing an open creation (Step 2 plan §4 #10, §3.8 "Retry"; SE-20 PROPOSED):
// - CompleteCreationForm, "השלמת יצירה": an open creation intent of the viewer ("יצירה שלא
//   הושלמה", intentCompletionOffered) or, for the Creator, a Manager's approved creation request
//   whose account was not created (Variant B; TEMPORARY Q15; requestCompletionOffered). Email, role
//   and name are the stored row's, shown read-only; the input is the work phone and, for a
//   Technician, the colour and device (accounts.completeCreation). No password (TEMPORARY Q1: the
//   Creator sets the first one); a Technician's Outlook email is his sign-in email (TEMPORARY Q14).
// - CompleteTechnicianForm, "השלמה" of "פרופיל טכנאי חסר" (plan §3.8 phase 4): the colour and
//   device of an active Technician account without a field profile
//   (accounts.completeTechnicianProfile); the Outlook email is the sign-in email the server reads.
// On the real screens an email the viewer cannot read shows "—" (TEMPORARY Q5). Each runs one
// command and returns what it created as stored; the caller shows it. A cancelled intent may leave
// an orphan sign-in user (TEMPORARY Q16): not shown here, reported to the owner.
// After a refused or failed command focus stays in the dialog (review AUTH-N1, UI-4): the form is
// re-enabled with flushSync first (focus() on a disabled control does nothing), then focus goes to
// the submit button (the message is about no field).
import { useId, useRef, useState, type FormEvent, type RefObject } from "react";
import { flushSync } from "react-dom";
import {
  ACCOUNT_ROLE_LABELS,
  DEFAULT_TECHNICIAN_DEVICE,
  type AccountRequest,
  type CompletedCreation,
  type CompletedTechnicianProfile,
  type CreationIntent,
  type UserAccount,
} from "@/features/accounts/data/types";
import { DEVICE_MAX, deviceError, PHONE_MAX, phoneError } from "@/features/accounts/data/validate";
import { useAccountCommands } from "@/features/accounts/commands-context";
import type { TechnicianColorToken } from "@/features/reference/data/types";
import { AccountDialog, ColorChoice, DIALOG_FAILED, DialogNotes } from "./AccountDialog";

type Field = "phone" | "color" | "device";

/** What "השלמת יצירה" completes, with its time label ("התחילה" for an intent, "אושרה" for a request). */
export type CreationSource =
  | { kind: "intent"; intent: CreationIntent; label: string }
  | { kind: "request"; request: AccountRequest; label: string };

const sourceTarget = (source: CreationSource): { id: string; name: string; email: string; role: UserAccount["role"] } =>
  source.kind === "intent"
    ? { id: source.intent.id, name: source.intent.name, email: source.intent.email, role: source.intent.role }
    : { id: source.request.id, ...source.request.target };

/**
 * A message about no field: focus stays where it is in the form, or comes back to the submit button
 * (after a command, the control that had focus was disabled, and focus fell outside the dialog).
 */
function keepFocusInForm(form: RefObject<HTMLFormElement | null>, submit: RefObject<HTMLButtonElement | null>) {
  if (!form.current?.contains(document.activeElement)) submit.current?.focus();
}

/** The technician part of a completion: colour and device fields, shared by both forms. */
function useTechnicianFields() {
  const [color, setColor] = useState<TechnicianColorToken | null>(null);
  const [device, setDevice] = useState<string>(DEFAULT_TECHNICIAN_DEVICE);
  return { color, setColor, device, setDevice };
}

export function CompleteCreationForm({
  source,
  onDone,
  onClose,
}: {
  source: CreationSource;
  /** After the command succeeded: the created records as returned, and whether it was simulated. */
  onDone: (created: CompletedCreation, simulated: boolean) => void;
  onClose: () => void;
}) {
  const accounts = useAccountCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const target = sourceTarget(source);
  const tech = target.role === "tech";
  const phoneRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const [phone, setPhone] = useState("");
  const t = useTechnicianFields();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: Field | null } | null>(null);

  function fail(text: string, field: Field | null) {
    setError({ text, field });
    if (field === "phone") phoneRef.current?.focus();
    else if (field === "device") deviceRef.current?.focus();
    else if (field === "color") colorRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    else keepFocusInForm(formRef, submitRef);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const phoneText = phone.trim();
    const checks: [Field, string | null][] = [["phone", phoneText === "" ? null : phoneError(phoneText)]];
    if (tech) {
      checks.push(["color", t.color === null ? "צבע לא תקין" : null]);
      checks.push(["device", deviceError(t.device)]);
    }
    const hit = checks.find(([, text]) => text !== null);
    if (hit) return fail(hit[1] as string, hit[0]);
    setBusy(true);
    setError(null);
    let failure: string | null = DIALOG_FAILED;
    let done: { created: CompletedCreation; simulated: boolean } | null = null;
    try {
      const r = await accounts.completeCreation({
        requestId: target.id,
        phone: phoneText === "" ? null : phoneText,
        ...(tech && t.color !== null ? { technician: { color: t.color, device: t.device.trim() } } : {}),
      });
      if (r.ok && r.data) {
        failure = null;
        done = { created: r.data, simulated: r.simulated };
      } else if (!r.ok) {
        failure = r.error;
      }
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      // Re-enabled now, so the focus fail() moves reaches an enabled control.
      flushSync(() => setBusy(false));
    }
    if (done) return onDone(done.created, done.simulated);
    fail(failure ?? DIALOG_FAILED, null);
  }

  const invalid = (field: Field) => (error?.field === field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {});
  const notes = [
    { text: "החשבון נוצר בלי סיסמה. את הסיסמה הראשונה קובע היוצר · ממתין להחלטת בעלים", pending: true },
    ...(tech ? [{ text: "המייל משמש גם לשיוך זימונים מ-Outlook · ממתין להחלטת בעלים", pending: true }] : []),
  ];

  return (
    <AccountDialog title={`השלמת יצירה · ${target.name}`} dirty={dirty} busy={busy} onClose={onClose}>
      <form
        ref={formRef}
        className="vc-form"
        noValidate
        onSubmit={(e) => void submit(e)}
        aria-describedby={error && !error.field ? errorId : undefined}
      >
        <div className="db">
          <div className="kv vc-kv">
            <span>תפקיד</span>
            <span>{ACCOUNT_ROLE_LABELS[target.role]}</span>
            <span>מייל</span>
            <span dir="ltr" style={{ textAlign: "right", overflowWrap: "anywhere" }}>
              {target.email || "—"}
            </span>
            <span>{source.kind === "intent" ? "התחילה" : "אושרה"}</span>
            <span>{source.label}</span>
          </div>
          <label className="vc-label">
            טלפון
            <input
              ref={phoneRef}
              type="tel"
              dir="ltr"
              value={phone}
              maxLength={PHONE_MAX}
              autoComplete="off"
              disabled={busy}
              aria-describedby={error?.field === "phone" ? `${id}-phone-hint ${errorId}` : `${id}-phone-hint`}
              aria-invalid={error?.field === "phone" ? true : undefined}
              onChange={(e) => {
                setPhone(e.target.value);
                setDirty(true);
                if (error?.field === "phone" || error?.field === null) setError(null);
              }}
            />
          </label>
          <p id={`${id}-phone-hint`} className="sub vc-p">
            אפשר להוסיף גם אחר כך, ב&quot;עריכת פרטים&quot;.
          </p>
          {tech && (
            <>
              <div ref={colorRef}>
                <ColorChoice
                  name={`${id}-color`}
                  value={t.color}
                  disabled={busy}
                  invalid={error?.field === "color"}
                  describedBy={error?.field === "color" ? errorId : undefined}
                  onChange={(token) => {
                    t.setColor(token);
                    setDirty(true);
                    if (error?.field === "color") setError(null);
                  }}
                />
              </div>
              <label className="vc-label">
                מכשיר
                <input
                  ref={deviceRef}
                  value={t.device}
                  maxLength={DEVICE_MAX}
                  autoComplete="off"
                  disabled={busy}
                  onChange={(e) => {
                    t.setDevice(e.target.value);
                    setDirty(true);
                    if (error?.field === "device") setError(null);
                  }}
                  {...invalid("device")}
                />
              </label>
            </>
          )}
          <DialogNotes notes={notes} />
        </div>
        <div className="df">
          <button ref={submitRef} type="submit" className="btn pri" disabled={busy}>
            {busy ? "משלים…" : "השלמת היצירה"}
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

export function CompleteTechnicianForm({
  account,
  onDone,
  onClose,
}: {
  /** `email` null: unknown to the viewer (the real screen shows "—", Q5). */
  account: { id: UserAccount["id"]; name: string; email: string | null };
  /** After the command succeeded: the technician record as returned, and whether it was simulated. */
  onDone: (created: CompletedTechnicianProfile, simulated: boolean) => void;
  onClose: () => void;
}) {
  const accounts = useAccountCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const deviceRef = useRef<HTMLInputElement>(null);
  const colorRef = useRef<HTMLDivElement>(null);
  const formRef = useRef<HTMLFormElement>(null);
  const submitRef = useRef<HTMLButtonElement>(null);
  const t = useTechnicianFields();
  const [dirty, setDirty] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; field: Exclude<Field, "phone"> | null } | null>(null);

  function fail(text: string, field: Exclude<Field, "phone"> | null) {
    setError({ text, field });
    if (field === "device") deviceRef.current?.focus();
    else if (field === "color") colorRef.current?.querySelector<HTMLInputElement>("input")?.focus();
    else keepFocusInForm(formRef, submitRef);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (t.color === null) return fail("צבע לא תקין", "color");
    const deviceProblem = deviceError(t.device);
    if (deviceProblem) return fail(deviceProblem, "device");
    setBusy(true);
    setError(null);
    let failure: string | null = DIALOG_FAILED;
    let done: { created: CompletedTechnicianProfile; simulated: boolean } | null = null;
    try {
      const r = await accounts.completeTechnicianProfile({ accountId: account.id, color: t.color, device: t.device.trim() });
      if (r.ok && r.data) {
        failure = null;
        done = { created: r.data, simulated: r.simulated };
      } else if (!r.ok) {
        failure = r.error;
      }
    } catch {
      failure = DIALOG_FAILED;
    } finally {
      // Re-enabled now, so the focus fail() moves reaches an enabled control.
      flushSync(() => setBusy(false));
    }
    if (done) return onDone(done.created, done.simulated);
    fail(failure ?? DIALOG_FAILED, null);
  }

  return (
    <AccountDialog title={`השלמת פרופיל טכנאי · ${account.name}`} dirty={dirty} busy={busy} onClose={onClose}>
      <form
        ref={formRef}
        className="vc-form"
        noValidate
        onSubmit={(e) => void submit(e)}
        aria-describedby={error && !error.field ? errorId : undefined}
      >
        <div className="db">
          <div ref={colorRef}>
            <ColorChoice
              name={`${id}-color`}
              value={t.color}
              disabled={busy}
              invalid={error?.field === "color"}
              describedBy={error?.field === "color" ? errorId : undefined}
              onChange={(token) => {
                t.setColor(token);
                setDirty(true);
                if (error?.field === "color") setError(null);
              }}
            />
          </div>
          <label className="vc-label">
            מכשיר
            <input
              ref={deviceRef}
              value={t.device}
              maxLength={DEVICE_MAX}
              autoComplete="off"
              disabled={busy}
              onChange={(e) => {
                t.setDevice(e.target.value);
                setDirty(true);
                if (error?.field === "device") setError(null);
              }}
              {...(error?.field === "device" ? { "aria-invalid": true as const, "aria-describedby": errorId } : {})}
            />
          </label>
          <div className="kv vc-kv">
            <span>מייל ב-Outlook:</span>
            <span dir="ltr" style={{ textAlign: "right", overflowWrap: "anywhere" }}>
              {account.email ?? "—"}
            </span>
          </div>
          <DialogNotes notes={[{ text: "המייל לכניסה משמש גם ב-Outlook · ממתין להחלטת בעלים", pending: true }]} />
        </div>
        <div className="df">
          <button ref={submitRef} type="submit" className="btn pri" disabled={busy}>
            {busy ? "משלים…" : "השלמה"}
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
