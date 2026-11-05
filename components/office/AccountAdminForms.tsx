"use client";

// Account forms of account administration (SE-01, D34), opened inline under a card's "+" button
// (the demo's "+ הוספת משתמש" and "+ הוספת טכנאי" toasts, L943 and L948, become real forms). Same
// look as the other Settings add forms (styles/ui.css "settings-ops": .set-form, colour swatches).
// - "account": the Creator's "+ הוספת משתמש" (Customer Service or Manager), immediate. A Creator
//   account is not offered: TEMPORARY (Step 2 plan Q9; D49), the role list shows a disabled
//   "יוצר · ממתין להחלטת בעלים" and the note says so. Technicians are added with the "tech" form
//   (Settings › "טכנאים", the Manager's screen).
// - "cs-request": the Manager's "+ בקשת חשבון שירות לקוחות": a request that waits for the Creator;
//   nothing is created until the Creator approves (D34 a). Name and email only: a request stores
//   no phone (Migration 1); it is added after the account is created (plan §3.7 h).
// - "tech": "+ הוספת טכנאי" (Settings › "טכנאים" and the Manager's Settings › "משתמשים"), immediate
//   (D34 c): one form for both screens.
// No password field and no public sign-up (D50): until an email provider is approved the Creator
// hands out the first sign-in details. Each submit runs one command from useCommands().accounts;
// the fields are checked first with the same validators the commands use (no toast for a typo):
// the first invalid field gets focus and aria-invalid. The command returns the created record as
// stored (ids, test marker), and whether it was simulated; the caller shows it.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ACCOUNT_ROLE_LABELS,
  DEFAULT_TECHNICIAN_DEVICE,
  isNewAccountRole,
  type AccountRequest,
  type NewAccountRole,
  type UserAccount,
} from "@/features/accounts/data/types";
import {
  accountNameError,
  accountRequestError,
  ACCOUNT_NAME_MAX,
  CREATOR_ACCOUNT_PENDING,
  DEVICE_MAX,
  deviceError,
  EMAIL_MAX,
  emailError,
  newAccountError,
  newTechnicianError,
  PHONE_MAX,
  phoneError,
} from "@/features/accounts/data/validate";
import { useCommands } from "@/features/data-access/commands-context";
import {
  TECHNICIAN_COLOR_NAMES,
  TECHNICIAN_COLOR_TOKENS,
  technicianColorCss,
  type TechnicianColorToken,
} from "@/features/reference/data/types";
import type { TechnicianSetting } from "@/features/settings/data/types";

export type AccountFormKind = "account" | "cs-request" | "tech";

/** What a submit created, as the command returned it; `simulated` when nothing was stored. */
export type AccountFormResult =
  | { kind: "account"; simulated: boolean; account: UserAccount }
  | { kind: "tech"; simulated: boolean; account: UserAccount; technician: TechnicianSetting }
  | { kind: "cs-request"; simulated: boolean; request: AccountRequest };

/**
 * Roles of "+ הוספת משתמש" (technicians: the "tech" form, with colour and device). The Creator role
 * follows as a disabled option (TEMPORARY, Q9): it can never be chosen or sent.
 */
const OFFICE_ACCOUNT_ROLES: readonly NewAccountRole[] = ["cs", "mgr"];

/** The disabled role option's text (Q9). */
const CREATOR_PENDING_OPTION = `${ACCOUNT_ROLE_LABELS.creator} · ממתין להחלטת בעלים`;

const FAILED = "הפעולה לא בוצעה. נסה שוב.";

const LABELS: Readonly<Record<AccountFormKind, string>> = {
  account: "הוספת משתמש",
  "cs-request": "בקשת חשבון שירות לקוחות",
  tech: "הוספת טכנאי",
};

const NOTES: Readonly<Record<AccountFormKind, string>> = {
  account: `החשבון נוצר מיד. אין הרשמה עצמית: עד שיאושר ספק מייל, היוצר מוסר את פרטי הכניסה הראשוניים. טכנאים מוסיפים בלשונית "טכנאים". ${CREATOR_ACCOUNT_PENDING}.`,
  "cs-request": "הבקשה עוברת לאישור היוצר. עד שהיוצר מאשר לא נוצר חשבון ושום דבר לא משתנה. את הטלפון מוסיפים אחרי שהחשבון נוצר.",
  tech: "הטכנאי נוסף מיד. המייל משמש לכניסה לאפליקציה ולשיוך זימונים מ-Outlook לטכנאי.",
};

const SUBMIT: Readonly<Record<AccountFormKind, { idle: string; busy: string }>> = {
  account: { idle: "יצירת חשבון", busy: "יוצר…" },
  "cs-request": { idle: "שליחה לאישור היוצר", busy: "שולח…" },
  tech: { idle: "הוספה", busy: "מוסיף…" },
};

type Field = "name" | "email" | "phone" | "device";

export function AccountForm({
  formId,
  kind,
  onDone,
  onCancel,
}: {
  /** The form element's id (the opener button's aria-controls). */
  formId: string;
  kind: AccountFormKind;
  onDone: (result: AccountFormResult) => void;
  onCancel: () => void;
}) {
  const { accounts } = useCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const nameRef = useRef<HTMLInputElement>(null);
  const emailRef = useRef<HTMLInputElement>(null);
  const phoneRef = useRef<HTMLInputElement>(null);
  const deviceRef = useRef<HTMLInputElement>(null);
  const refs: Readonly<Record<Field, typeof nameRef>> = { name: nameRef, email: emailRef, phone: phoneRef, device: deviceRef };
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<NewAccountRole>("cs");
  /** The Customer Service request has no phone field (a request stores no phone). */
  const withPhone = kind !== "cs-request";
  const [color, setColor] = useState<TechnicianColorToken>(TECHNICIAN_COLOR_TOKENS[0]);
  const [device, setDevice] = useState(DEFAULT_TECHNICIAN_DEVICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The field the error is about (aria-invalid, focus); null for an error of the whole form. */
  const [invalid, setInvalid] = useState<Field | null>(null);

  // Focus the first field when the form opens.
  useEffect(() => {
    nameRef.current?.focus();
  }, []);

  /** The first invalid field, in form order, with its message (the same checks as the command). */
  function firstInvalid(values: { name: string; email: string; phone: string; device: string }): { field: Field | null; message: string } | null {
    const fields: [Field, string | null][] = [
      ["name", accountNameError(values.name)],
      ["email", emailError(values.email)],
    ];
    if (withPhone) fields.push(["phone", phoneError(values.phone)]);
    if (kind === "tech") fields.push(["device", deviceError(values.device)]);
    const hit = fields.find(([, message]) => message !== null);
    if (hit) return { field: hit[0], message: hit[1] as string };
    // Whole-input checks (role, colour), as the command runs them.
    const base = { name: values.name, email: values.email, phone: values.phone };
    const rest =
      kind === "account"
        ? newAccountError({ ...base, role })
        : kind === "tech"
          ? newTechnicianError({ ...base, color, device: values.device })
          : accountRequestError({ kind: "create", name: values.name, email: values.email });
    return rest ? { field: null, message: rest } : null;
  }

  function fail(message: string, field: Field | null) {
    setError(message);
    setInvalid(field);
    if (field) refs[field].current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const values = { name: name.trim(), email: email.trim(), phone: phone.trim(), device: device.trim() };
    const check = firstInvalid(values);
    if (check) {
      fail(check.message, check.field);
      return;
    }
    const base = { name: values.name, email: values.email, phone: values.phone };
    setBusy(true);
    setError(null);
    setInvalid(null);
    try {
      if (kind === "cs-request") {
        const r = await accounts.requestAccount({ kind: "create", name: values.name, email: values.email });
        if (!r.ok || !r.data) return fail(r.ok ? FAILED : r.error, null);
        onDone({ kind, simulated: r.simulated, request: r.data.request });
      } else if (kind === "tech") {
        const r = await accounts.createTechnician({ ...base, color, device: values.device });
        if (!r.ok || !r.data) return fail(r.ok ? FAILED : r.error, null);
        onDone({ kind, simulated: r.simulated, account: r.data.account, technician: r.data.technician });
      } else {
        const r = await accounts.createAccount({ ...base, role });
        if (!r.ok || !r.data) return fail(r.ok ? FAILED : r.error, null);
        onDone({ kind, simulated: r.simulated, account: r.data.account });
      }
    } catch {
      fail(FAILED, null);
    } finally {
      setBusy(false);
    }
  }

  /** Props of a validated field: aria-invalid and the error reference while the error is about it. */
  const fieldProps = (field: Field) =>
    invalid === field ? { "aria-invalid": true as const, "aria-describedby": errorId } : {};
  const edited = (field: Field) => {
    if (invalid === field) setInvalid(null);
  };

  return (
    <form
      id={formId}
      className="set-form"
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label={LABELS[kind]}
      aria-describedby={error && !invalid ? errorId : undefined}
    >
      <label>
        שם
        <input
          ref={nameRef}
          value={name}
          onChange={(e) => {
            setName(e.target.value);
            edited("name");
          }}
          required
          maxLength={ACCOUNT_NAME_MAX}
          autoComplete="off"
          {...fieldProps("name")}
        />
      </label>
      <label>
        {kind === "tech" ? "מייל ב-Outlook" : "מייל"}
        <input
          ref={emailRef}
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => {
            setEmail(e.target.value);
            edited("email");
          }}
          required
          maxLength={EMAIL_MAX}
          placeholder="name@example.test"
          autoComplete="off"
          {...fieldProps("email")}
        />
      </label>
      {withPhone && (
        <label>
          טלפון
          <input
            ref={phoneRef}
            type="tel"
            dir="ltr"
            value={phone}
            onChange={(e) => {
              setPhone(e.target.value);
              edited("phone");
            }}
            required
            maxLength={PHONE_MAX}
            autoComplete="off"
            {...fieldProps("phone")}
          />
        </label>
      )}
      {kind === "account" && (
        <label>
          הרשאה
          <select
            value={role}
            onChange={(e) => {
              const next = e.target.value;
              if (isNewAccountRole(next)) setRole(next);
            }}
          >
            {OFFICE_ACCOUNT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ACCOUNT_ROLE_LABELS[r]}
              </option>
            ))}
            {/* TEMPORARY (Q9): shown, never selectable, no `creator` value. */}
            <option value="" disabled>
              {CREATOR_PENDING_OPTION}
            </option>
          </select>
        </label>
      )}
      {kind === "tech" && (
        <>
          <label>
            מכשיר
            <input
              ref={deviceRef}
              value={device}
              onChange={(e) => {
                setDevice(e.target.value);
                edited("device");
              }}
              required
              maxLength={DEVICE_MAX}
              autoComplete="off"
              {...fieldProps("device")}
            />
          </label>
          <fieldset className="set-swatches">
            <legend>צבע ביומן</legend>
            {TECHNICIAN_COLOR_TOKENS.map((token) => (
              <label key={token} className="set-swatch-opt">
                <input type="radio" name={`${id}-color`} value={token} checked={color === token} onChange={() => setColor(token)} />
                {/* An allowlisted token, mapped to its CSS variable (never CSS from input). */}
                <span className="set-swatch" style={{ background: technicianColorCss(token) }} aria-hidden="true" />
                {TECHNICIAN_COLOR_NAMES[token]}
              </label>
            ))}
          </fieldset>
        </>
      )}
      <div className="set-form-actions">
        <button type="submit" className="btn pri" disabled={busy}>
          {busy ? SUBMIT[kind].busy : SUBMIT[kind].idle}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          ביטול
        </button>
        <span className="sub">{NOTES[kind]}</span>
        {error && (
          <span id={errorId} role="alert" className="set-err">
            {error}
          </span>
        )}
      </div>
    </form>
  );
}
