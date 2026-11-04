"use client";

// Settings › טכנאים (docs/demo.html setTechs() L948-951, as amended by demo-deviations SE-05 and
// SIM-18): colour, name (🧪 on test records), phone, Outlook email, device and "פעיל".
// - "פעיל" is eligibility for new invitations (SE-05): an inactive technician gets no new
//   invitations and keeps his history. It does not control sign-in, which follows the user
//   account (D34, D36). Each change runs useCommands().settings.setTechnicianActive.
// - "+ הוספת טכנאי" (the demo's toast button) opens a form (checked first with the command's
//   validator) that runs
//   useCommands().accounts.createTechnician: a technician account with its Settings row,
//   immediate (D34 c). The colour is an allowlisted token, never CSS.
// - The Outlook email is not edited here (no email-change command; D34 e). The note says that a
//   change to it notifies the Creator in the app (SE-05).
// Changes show on this screen only; in the UI demo every command is simulated (toast).
import { useId, useRef, useState, type FormEvent } from "react";
import { TestBadge } from "@/components/ui/TestBadge";
import { ACCOUNT_NAME_MAX, DEVICE_MAX, EMAIL_MAX, newTechnicianError, PHONE_MAX } from "@/features/accounts/data/validate";
import { useCommands } from "@/features/data-access/commands-context";
import type { Bounded } from "@/features/data-access/common";
import { TECHNICIAN_COLOR_TOKENS, type TechnicianColorToken } from "@/features/reference/data/types";
import type { TechnicianSetting } from "@/features/settings/data/types";
import { SettingsCardHead, SettingsMore, SettingsNotSaved } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

const FAILED = "הטכנאי לא נוסף. נסה שוב.";
const DEFAULT_DEVICE = "סמארטפון";

/** Names of the allowlisted calendar colours (app/globals.css --t-*). */
const COLOR_NAMES: Readonly<Record<TechnicianColorToken, string>> = { "t-y": "ירוק", "t-e": "אדום", "t-s": "כחול" };

const colorCss = (token: TechnicianColorToken): string => `var(--${token})`;

type Draft = { name: string; email: string; phone: string; color: TechnicianColorToken; device: string };

const EMPTY_DRAFT: Draft = { name: "", email: "", phone: "", color: TECHNICIAN_COLOR_TOKENS[0], device: DEFAULT_DEVICE };

export function SettingsTechs({ technicians }: { technicians: Bounded<TechnicianSetting> }) {
  const { accounts } = useCommands();
  const [rows, setRows] = useState<TechnicianSetting[]>(technicians.items);
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(EMPTY_DRAFT);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Rows added by a simulated command (shown as not saved). */
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const formId = `${id}-form`;
  const errorId = `${id}-error`;

  const set = <K extends keyof Draft>(key: K, value: Draft[K]) => setDraft((d) => ({ ...d, [key]: value }));

  function close() {
    setOpen(false);
    setDraft(EMPTY_DRAFT);
    setError(null);
    addButton.current?.focus();
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const input = { ...draft, name: draft.name.trim(), email: draft.email.trim(), phone: draft.phone.trim(), device: draft.device.trim() };
    // Checked first with the command's own validator: a typo gets an inline error, not a toast.
    const invalid = newTechnicianError(input);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    let newId: string | null = null;
    let simulated = false;
    try {
      const result = await accounts.createTechnician(input);
      if (result.ok) {
        newId = result.data?.accountId ?? `new-tech-${rows.length + 1}`;
        simulated = result.simulated;
      } else failure = result.error;
    } catch {
      failure = FAILED;
    } finally {
      setBusy(false);
    }
    if (failure || !newId) {
      setError(failure ?? FAILED);
      return;
    }
    const created: TechnicianSetting = {
      id: newId,
      name: input.name,
      color: colorCss(input.color),
      phone: input.phone,
      email: input.email,
      active: true,
      device: input.device,
      isTest: true,
    };
    setRows((r) => [...r, created]);
    if (simulated) setUnsaved((u) => [...u, created.id]);
    close();
  }

  return (
    <>
      <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`}>
        <SettingsCardHead
          id={`${id}-title`}
          title="טכנאים"
          action={
            <button
              ref={addButton}
              type="button"
              className="btn pri"
              aria-expanded={open}
              aria-controls={formId}
              onClick={() => (open ? close() : setOpen(true))}
            >
              + הוספת טכנאי
            </button>
          }
        />
        {open && (
          <form id={formId} className="set-form" noValidate onSubmit={(e) => void submit(e)} aria-label="הוספת טכנאי" aria-describedby={error ? errorId : undefined}>
            <label>
              שם
              <input value={draft.name} onChange={(e) => set("name", e.target.value)} required maxLength={ACCOUNT_NAME_MAX} autoComplete="off" />
            </label>
            <label>
              מייל ב-Outlook
              <input
                type="email"
                dir="ltr"
                value={draft.email}
                onChange={(e) => set("email", e.target.value)}
                required
                maxLength={EMAIL_MAX}
                placeholder="name@example.test"
                autoComplete="off"
              />
            </label>
            <label>
              טלפון
              <input type="tel" dir="ltr" value={draft.phone} onChange={(e) => set("phone", e.target.value)} required maxLength={PHONE_MAX} autoComplete="off" />
            </label>
            <label>
              מכשיר
              <input value={draft.device} onChange={(e) => set("device", e.target.value)} required maxLength={DEVICE_MAX} autoComplete="off" />
            </label>
            <fieldset className="set-swatches">
              <legend>צבע ביומן</legend>
              {TECHNICIAN_COLOR_TOKENS.map((token) => (
                <label key={token} className="set-swatch-opt">
                  <input type="radio" name={`${id}-color`} value={token} checked={draft.color === token} onChange={() => set("color", token)} />
                  <span className="set-swatch" style={{ background: colorCss(token) }} aria-hidden="true" />
                  {COLOR_NAMES[token]}
                </label>
              ))}
            </fieldset>
            <div className="set-form-actions">
              <button type="submit" className="btn pri" disabled={busy}>
                {busy ? "מוסיף…" : "הוספה"}
              </button>
              <button type="button" className="btn" onClick={close}>
                ביטול
              </button>
              <span className="sub">המייל משמש לכניסה לאפליקציה ולשיוך זימונים מ-Outlook לטכנאי.</span>
              {error && (
                <span id={errorId} role="alert" className="set-err">
                  {error}
                </span>
              )}
            </div>
          </form>
        )}
        <div className="scrollx">
          <table>
            <thead>
              <tr>
                <th className="col-center col-fit">צבע</th>
                <th>שם</th>
                <th className="col-fit">טלפון</th>
                <th>מייל ב-Outlook</th>
                <th className="col-fit">מכשיר</th>
                <th className="col-center col-fit">פעיל</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((t) => (
                <tr key={t.id}>
                  <td className="col-center col-fit">
                    <span className="set-swatch" style={{ background: t.color }} aria-hidden="true" />
                  </td>
                  <td>
                    <span className="set-name">
                      <b>{t.name}</b>
                      {t.isTest && <TestBadge />}
                      {unsaved.includes(t.id) && <SettingsNotSaved />}
                    </span>
                  </td>
                  <td className="col-fit" dir="ltr" style={{ textAlign: "right" }}>
                    {t.phone}
                  </td>
                  <td dir="ltr" style={{ textAlign: "right", color: "var(--muted)" }}>
                    {t.email}
                  </td>
                  <td className="col-fit">{t.device}</td>
                  <td className="col-center col-fit">
                    <SettingsShellToggle
                      action={{ kind: "technicianActive", techId: t.id }}
                      initial={t.active}
                      label={`${t.name} פעיל – מקבל זימונים חדשים`}
                    />
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
        <SettingsMore shown={technicians.items.length} total={technicians.total} />
      </section>
      <div className="note">
        זימון משויך לטכנאי לפי המייל שלו בשדה &quot;אל&quot; ב-Outlook. טכנאי שמכובה לא מקבל זימונים חדשים, וההיסטוריה שלו נשמרת
        בדשבורד. &quot;פעיל&quot; לא קובע כניסה לאפליקציה: הכניסה נקבעת לפי חשבון המשתמש.
        <br />
        שינוי של המייל ב-Outlook של טכנאי שולח התראה ליוצר באפליקציה.
      </div>
    </>
  );
}
