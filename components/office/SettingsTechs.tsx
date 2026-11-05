"use client";

// Settings › טכנאים (docs/demo.html setTechs() L948-951, as amended by demo-deviations SE-05 and
// SIM-18): colour, name (🧪 on test records), phone, Outlook email, device and "פעיל".
// - "פעיל" is eligibility for new invitations (SE-05): an inactive technician gets no new
//   invitations and keeps his history. It does not control sign-in, which follows the user
//   account (D34, D36). Each change runs useCommands().settings.setTechnicianActive with the
//   row's version (`expectedVersion`; a stale one gets the "data changed" message, PT409).
// - "+ הוספת טכנאי" (the demo's toast button) opens the shared technician form (AccountForm "tech",
//   the same form as the Manager's screen), which runs useCommands().accounts.createTechnician: a
//   technician account with its Settings row, immediate (D34 c). The colour is an allowlisted
//   token, never CSS. The new row is the one the command returns (its technician id and test
//   marker as stored); a simulated row is marked as not saved.
// - The Outlook email is not edited here (no email-change command; D34 e). The note says that a
//   change to it notifies the Creator in the app (SE-05).
// - At narrow widths the Outlook email and the device move under the name (styles/ui.css
//   .set-col-wide), so "פעיל" stays in view.
// Changes show on this screen only.
import { useId, useRef, useState } from "react";
import { TestBadge } from "@/components/ui/TestBadge";
import type { Bounded } from "@/features/data-access/common";
import type { TechnicianSetting } from "@/features/settings/data/types";
import { AccountForm, type AccountFormResult } from "./AccountAdminForms";
import { SettingsCardHead, SettingsMore, SettingsNotSaved } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

export function SettingsTechs({ technicians }: { technicians: Bounded<TechnicianSetting> }) {
  const [rows, setRows] = useState<TechnicianSetting[]>(technicians.items);
  const [open, setOpen] = useState(false);
  /** Rows added by a simulated command (shown as not saved). */
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const addButton = useRef<HTMLButtonElement>(null);
  const id = useId();
  const formId = `${id}-form`;

  function close() {
    setOpen(false);
    addButton.current?.focus();
  }

  function onDone(result: AccountFormResult) {
    if (result.kind !== "tech") return;
    const created = result.technician;
    setRows((r) => [...r, created]);
    if (result.simulated) setUnsaved((u) => [...u, created.id]);
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
              aria-controls={open ? formId : undefined}
              onClick={() => (open ? close() : setOpen(true))}
            >
              + הוספת טכנאי
            </button>
          }
        />
        {open && <AccountForm formId={formId} kind="tech" onDone={onDone} onCancel={close} />}
        <div className="scrollx">
          <table>
            <thead>
              <tr>
                <th className="col-center col-fit">צבע</th>
                <th>שם</th>
                <th className="col-fit">טלפון</th>
                <th className="set-col-wide">מייל ב-Outlook</th>
                <th className="col-fit set-col-wide">מכשיר</th>
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
                    {/* Narrow widths: email and device under the name (their columns are hidden). */}
                    <span className="sub set-inline-narrow" style={{ fontSize: 12 }}>
                      <span dir="ltr" style={{ display: "block", textAlign: "right", overflowWrap: "anywhere" }}>
                        {t.email}
                      </span>
                      {t.device}
                    </span>
                  </td>
                  <td className="col-fit" dir="ltr" style={{ textAlign: "right" }}>
                    {t.phone}
                  </td>
                  <td className="set-col-wide" dir="ltr" style={{ textAlign: "right", color: "var(--muted)" }}>
                    {t.email}
                  </td>
                  <td className="col-fit set-col-wide">{t.device}</td>
                  <td className="col-center col-fit">
                    <SettingsShellToggle
                      action={{ kind: "technicianActive", techId: t.id, expectedVersion: t.version }}
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
