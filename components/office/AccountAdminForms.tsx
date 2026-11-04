"use client";

// Account forms of account administration (SE-01, D34), opened inline under the accounts card's
// "+" buttons (the demo's "+ הוספת משתמש" / "+ הוספת טכנאי" toasts, L943-944, become real forms):
// - "account": the Creator's "+ הוספת משתמש" (Creator, Manager or Customer Service), immediate.
// - "cs-request": the Manager's "+ בקשת חשבון שירות לקוחות": a request that waits for the Creator;
//   nothing is created until the Creator approves (D34 a).
// - "tech": "+ הוספת טכנאי" (Manager and Creator), immediate (D34 c).
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
import { ActionMessage, FormField, type ActionMessageValue } from "./AccountAdminParts";

export type AccountFormKind = "account" | "cs-request" | "tech";

export type AccountFormResult =
  | { kind: "account" | "tech"; account: UserAccount }
  | { kind: "cs-request"; request: AccountRequest };

/** Roles of "+ הוספת משתמש" (technicians have their own form, with colour and device). */
const OFFICE_ACCOUNT_ROLES: readonly AccountRole[] = ["cs", "mgr", "creator"];

/** Hebrew names of the allowlisted technician colours (never CSS from input). */
const COLOR_LABELS: Readonly<Record<TechnicianColorToken, string>> = { "t-y": "ירוק", "t-e": "אדום", "t-s": "כחול" };

const DEFAULT_DEVICE = "סמארטפון";
const FAILED = "הפעולה לא בוצעה. נסה שוב.";

const TITLES: Readonly<Record<AccountFormKind, string>> = {
  account: "משתמש חדש",
  "cs-request": "בקשת חשבון שירות לקוחות",
  tech: "טכנאי חדש",
};

const NOTES: Readonly<Record<AccountFormKind, string>> = {
  account: "החשבון נוצר מיד. אין הרשמה עצמית: עד שיאושר ספק מייל, היוצר מוסר את פרטי הכניסה הראשוניים. לא קובעים כאן סיסמה.",
  "cs-request": "הבקשה עוברת לאישור היוצר. עד שהיוצר מאשר לא נוצר חשבון ושום דבר לא משתנה.",
  tech: "הטכנאי נוסף מיד. המייל משמש לכניסה ולשיוך זימונים מ-Outlook (לפי השדה \"אל\"). לא קובעים כאן סיסמה.",
};

const SUBMIT: Readonly<Record<AccountFormKind, string>> = {
  account: "יצירת חשבון",
  "cs-request": "שליחת הבקשה ליוצר",
  tech: "הוספת טכנאי",
};

const GRID = { display: "grid", gridTemplateColumns: "repeat(auto-fit, minmax(min(100%, 180px), 1fr))", gap: 10 } as const;

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
  const firstRef = useRef<HTMLInputElement>(null);
  const [name, setName] = useState("");
  const [email, setEmail] = useState("");
  const [phone, setPhone] = useState("");
  const [role, setRole] = useState<AccountRole>("cs");
  const [color, setColor] = useState<TechnicianColorToken>(TECHNICIAN_COLOR_TOKENS[0]);
  const [device, setDevice] = useState(DEFAULT_DEVICE);
  const [busy, setBusy] = useState(false);
  const [message, setMessage] = useState<ActionMessageValue>(null);

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
          ? newTechnicianError({ ...base, color, device })
          : accountRequestError({ kind: "create", ...base });
    if (invalid) {
      setMessage({ kind: "error", text: invalid });
      return;
    }
    setBusy(true);
    setMessage(null);
    try {
      if (kind === "cs-request") {
        const r = await accounts.requestAccount({ kind: "create", ...base });
        if (!r.ok || !r.data) {
          setMessage({ kind: "error", text: r.ok ? FAILED : r.error });
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
        setMessage({ kind: "error", text: r.ok ? FAILED : r.error });
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
      setMessage({ kind: "error", text: FAILED });
    } finally {
      setBusy(false);
    }
  }

  return (
    <form
      id={formId}
      onSubmit={(e) => void submit(e)}
      aria-labelledby={`${id}-title`}
      noValidate
      style={{ borderTop: "1px solid var(--line)", padding: "12px 18px", display: "flex", flexDirection: "column", gap: 10, background: "var(--tint)" }}
    >
      <h3 id={`${id}-title`} style={{ fontSize: 15 }}>
        {TITLES[kind]}
      </h3>
      <div style={GRID}>
        <FormField id={`${id}-name`} label="שם">
          <input
            ref={firstRef}
            id={`${id}-name`}
            value={name}
            maxLength={ACCOUNT_NAME_MAX}
            autoComplete="off"
            aria-required="true"
            onChange={(e) => setName(e.target.value)}
          />
        </FormField>
        <FormField id={`${id}-email`} label={kind === "tech" ? "מייל (כניסה ו-Outlook)" : "מייל"}>
          <input
            id={`${id}-email`}
            type="email"
            dir="ltr"
            value={email}
            maxLength={EMAIL_MAX}
            autoComplete="off"
            aria-required="true"
            placeholder="name@example.test"
            style={{ textAlign: "right" }}
            onChange={(e) => setEmail(e.target.value)}
          />
        </FormField>
        <FormField id={`${id}-phone`} label="טלפון עבודה">
          <input
            id={`${id}-phone`}
            type="tel"
            dir="ltr"
            value={phone}
            maxLength={PHONE_MAX}
            autoComplete="off"
            aria-required="true"
            style={{ textAlign: "right" }}
            onChange={(e) => setPhone(e.target.value)}
          />
        </FormField>
        {kind === "account" && (
          <FormField id={`${id}-role`} label="הרשאה">
            <select id={`${id}-role`} value={role} onChange={(e) => setRole(e.target.value as AccountRole)}>
              {OFFICE_ACCOUNT_ROLES.map((r) => (
                <option key={r} value={r}>
                  {ACCOUNT_ROLE_LABELS[r]}
                </option>
              ))}
            </select>
          </FormField>
        )}
        {kind === "tech" && (
          <>
            <FormField id={`${id}-color`} label="צבע ביומן">
              <div style={{ display: "flex", gap: 8, alignItems: "center" }}>
                <span aria-hidden="true" className="dot" style={{ background: `var(--${color})`, width: 14, height: 14, borderRadius: 4, flex: "none" }} />
                <select id={`${id}-color`} value={color} style={{ flex: 1, minWidth: 0 }} onChange={(e) => setColor(e.target.value as TechnicianColorToken)}>
                  {TECHNICIAN_COLOR_TOKENS.map((t) => (
                    <option key={t} value={t}>
                      {COLOR_LABELS[t]}
                    </option>
                  ))}
                </select>
              </div>
            </FormField>
            <FormField id={`${id}-device`} label="מכשיר">
              <input
                id={`${id}-device`}
                value={device}
                maxLength={DEVICE_MAX}
                autoComplete="off"
                aria-required="true"
                onChange={(e) => setDevice(e.target.value)}
              />
            </FormField>
          </>
        )}
      </div>
      <p className="sub" style={{ margin: 0, lineHeight: 1.5 }}>
        {NOTES[kind]}
      </p>
      <ActionMessage message={message} />
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
        <button type="submit" className="btn pri" disabled={busy}>
          {busy ? "שולח…" : SUBMIT[kind]}
        </button>
        <button type="button" className="btn" onClick={onCancel} disabled={busy}>
          ביטול
        </button>
      </div>
    </form>
  );
}
