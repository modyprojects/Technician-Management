"use client";

// Account forms of account administration (SE-01, D34), opened inline under the accounts card's
// "+" button (the demo's "+ הוספת משתמש" toast, L943, becomes a real form). Same look as the other
// Settings add forms (styles/ui.css "settings-ops": .set-form, colour swatches as in SettingsTechs).
// - "account": the Creator's "+ הוספת משתמש" (Customer Service, Manager or Creator), immediate.
//   Technicians are added on Settings › "טכנאים" (the demo's setTechs() "+ הוספת טכנאי").
// - "cs-request": the Manager's "+ בקשת חשבון שירות לקוחות": a request that waits for the Creator;
//   nothing is created until the Creator approves (D34 a).
// - "tech": the Manager's "+ הוספת טכנאי", immediate (D34 c).
// No password field and no public sign-up (D50): until an email provider is approved the Creator
// hands out the first sign-in details. Each submit runs one command from useCommands().accounts;
// the inputs are checked first with the same validators the commands use (no toast for a typo).
// In the UI demo every command is simulated (the provider's toast says nothing was saved); the
// caller shows the new row or request locally, marked as not saved.
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import {
  ACCOUNT_ROLE_LABELS,
  type AccountRef,
  type AccountRequest,
  type AccountRole,
  type UserAccount,
} from "@/features/accounts/data/types";
import {
  accountRequestError,
  ACCOUNT_NAME_MAX,
  DEVICE_MAX,
  EMAIL_MAX,
  newAccountError,
  newTechnicianError,
  PHONE_MAX,
} from "@/features/accounts/data/validate";
import { useCommands } from "@/features/data-access/commands-context";
import { TECHNICIAN_COLOR_TOKENS, type TechnicianColorToken } from "@/features/reference/data/types";

export type AccountFormKind = "account" | "cs-request" | "tech";

export type AccountFormResult =
  | { kind: "account" | "tech"; account: UserAccount }
  | { kind: "cs-request"; request: AccountRequest };

/** Roles of "+ הוספת משתמש" (technicians: Settings › טכנאים, with colour and device). */
const OFFICE_ACCOUNT_ROLES: readonly AccountRole[] = ["cs", "mgr", "creator"];

/** Hebrew names of the allowlisted technician colours (inputs name a token, never CSS). */
const COLOR_NAMES: Readonly<Record<TechnicianColorToken, string>> = { "t-y": "ירוק", "t-e": "אדום", "t-s": "כחול" };

const DEFAULT_DEVICE = "סמארטפון";
const FAILED = "הפעולה לא בוצעה. נסה שוב.";

const LABELS: Readonly<Record<AccountFormKind, string>> = {
  account: "הוספת משתמש",
  "cs-request": "בקשת חשבון שירות לקוחות",
  tech: "הוספת טכנאי",
};

const NOTES: Readonly<Record<AccountFormKind, string>> = {
  account: "החשבון נוצר מיד. אין הרשמה עצמית: עד שיאושר ספק מייל, היוצר מוסר את פרטי הכניסה הראשוניים. טכנאים מוסיפים בלשונית \"טכנאים\".",
  "cs-request": "הבקשה עוברת לאישור היוצר. עד שהיוצר מאשר לא נוצר חשבון ושום דבר לא משתנה.",
  tech: "הטכנאי נוסף מיד. המייל משמש לכניסה לאפליקציה ולשיוך זימונים מ-Outlook לטכנאי.",
};

const SUBMIT: Readonly<Record<AccountFormKind, { idle: string; busy: string }>> = {
  account: { idle: "יצירת חשבון", busy: "יוצר…" },
  "cs-request": { idle: "שליחה לאישור היוצר", busy: "שולח…" },
  tech: { idle: "הוספה", busy: "מוסיף…" },
};

export function AccountForm({
  formId,
  kind,
  self,
  onDone,
  onCancel,
}: {
  /** The form element's id (the opener button's aria-controls). */
  formId: string;
  kind: AccountFormKind;
  /** The signed-in account (the requester of a Customer Service request). */
  self: AccountRef | null;
  onDone: (result: AccountFormResult) => void;
  onCancel: () => void;
}) {
  const { accounts } = useCommands();
  const id = useId();
  const errorId = `${id}-error`;
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AccountRole>("cs");
  const [color, setColor] = useState<TechnicianColorToken>(TECHNICIAN_COLOR_TOKENS[0]);
  const [device, setDevice] = useState(DEFAULT_DEVICE);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    firstRef.current?.focus();
  }, []);

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const base = { name: name.trim(), email: email.trim(), phone: phone.trim() };
    const invalid =
      kind === "account"
        ? newAccountError({ ...base, role })
        : kind === "tech"
          ? newTechnicianError({ ...base, color, device: device.trim() })
          : accountRequestError({ kind: "create", ...base });
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    try {
      if (kind === "cs-request") {
        const r = await accounts.requestAccount({ kind: "create", ...base });
        if (!r.ok || !r.data) {
          setError(r.ok ? FAILED : r.error);
          return;
        }
        onDone({
          kind,
          request: {
            id: r.data.requestId,
            kind: "create",
            account: null,
            target: { name: base.name, email: base.email, role: "cs" },
            newRole: null,
            requestedBy: self ?? { id: "", name: "" },
            requestedAt: new Date().toISOString(),
            status: "pending",
            reason: null,
            decidedBy: null,
            decidedAt: null,
            isTest: true,
          },
        });
        return;
      }
      const accountRole: AccountRole = kind === "tech" ? "tech" : role;
      const r =
        kind === "tech"
          ? await accounts.createTechnician({ ...base, color, device: device.trim() })
          : await accounts.createAccount({ ...base, role: accountRole });
      if (!r.ok || !r.data) {
        setError(r.ok ? FAILED : r.error);
        return;
      }
      onDone({
        kind,
        account: {
          id: r.data.accountId,
          ...base,
          role: accountRole,
          active: true,
          lastSignInAt: null,
          technicianId: null,
          isTest: true,
        },
      });
    } catch {
      setError(FAILED);
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id={formId}
      className="set-form"
      noValidate
      onSubmit={(e) => void submit(e)}
      aria-label={LABELS[kind]}
      aria-describedby={error ? errorId : undefined}
    >
      <label>
        שם
        <input ref={firstRef} value={name} onChange={(e) => setName(e.target.value)} required maxLength={ACCOUNT_NAME_MAX} autoComplete="off" />
      </label>
      <label>
        {kind === "tech" ? "מייל ב-Outlook" : "מייל"}
        <input
          type="email"
          dir="ltr"
          value={email}
          onChange={(e) => setEmail(e.target.value)}
          required
          maxLength={EMAIL_MAX}
          placeholder="name@example.test"
          autoComplete="off"
        />
      </label>
      <label>
        טלפון
        <input type="tel" dir="ltr" value={phone} onChange={(e) => setPhone(e.target.value)} required maxLength={PHONE_MAX} autoComplete="off" />
      </label>
      {kind === "account" && (
        <label>
          הרשאה
          <select value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
            {OFFICE_ACCOUNT_ROLES.map((r) => (
              <option key={r} value={r}>
                {ACCOUNT_ROLE_LABELS[r]}
              </option>
            ))}
          </select>
        </label>
      )}
      {kind === "tech" && (
        <>
          <label>
            מכשיר
            <input value={device} onChange={(e) => setDevice(e.target.value)} required maxLength={DEVICE_MAX} autoComplete="off" />
          </label>
          <fieldset className="set-swatches">
            <legend>צבע ביומן</legend>
            {TECHNICIAN_COLOR_TOKENS.map((token) => (
              <label key={token} className="set-swatch-opt">
                <input type="radio" name={`${id}-color`} value={token} checked={color === token} onChange={() => setColor(token)} />
                {/* An allowlisted token, mapped to its CSS variable here (never CSS from input). */}
                <span className="set-swatch" style={{ background: `var(--${token})` }} aria-hidden="true" />
                {COLOR_NAMES[token]}
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
