"use client";

// Settings › סוגי קריאה (demo-deviations SE-16, ADD; D35, D48): a new tab in the visual language of
// the reasons card (docs/demo.html setReasons() L956-962). Initial values "תיקון" and "התקנה", to
// validate with customer service (owner task O3).
// - "פעיל": useCommands().settings.setCallTypeActive.
// - "+ הוספת סוג קריאה": settings.addCallType.
// - No delete: call types are deactivated, never deleted (docs/database-schema.md: the only
//   deletes are an unreferenced pickup place and an unused follow-up reason), and SettingsCommands
//   has no delete for them.
// Editing is governed by the matrix key `settings` (D35), checked on the server (G-04). Changes show
// on this screen only; a row from a simulated command is marked as not saved.
import { useId, useState, type FormEvent } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { Bounded } from "@/features/data-access/common";
import type { CallTypeSetting } from "@/features/settings/data/types";
import { SETTING_NAME_MAX, settingNameError } from "@/features/settings/data/validate";
import { SettingsMore, SettingsNotSaved } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

const ADD_FAILED = "סוג הקריאה לא נוסף. נסה שוב.";
const DUPLICATE = "סוג קריאה בשם הזה כבר קיים";

const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase("he") === b.trim().toLocaleLowerCase("he");

export function SettingsCallTypes({ types }: { types: Bounded<CallTypeSetting> }) {
  const { settings } = useCommands();
  const [rows, setRows] = useState<CallTypeSetting[]>(types.items);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Rows added by a simulated command (shown as not saved). */
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    // Checked first with the command's own validator: a typo gets an inline error, not a toast.
    const invalid = settingNameError(trimmed, "שם סוג הקריאה") ?? (rows.some((t) => sameName(t.name, trimmed)) ? DUPLICATE : null);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    let createdRef: { id: string; isTest: boolean } | null = null;
    let simulated = false;
    try {
      const result = await settings.addCallType(trimmed);
      if (result.ok && result.data) {
        createdRef = result.data;
        simulated = result.simulated;
      } else failure = result.ok ? ADD_FAILED : result.error;
    } catch {
      failure = ADD_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure || !createdRef) {
      setError(failure ?? ADD_FAILED);
      return;
    }
    // The id and test marker come from the command (as stored, D47).
    const created: CallTypeSetting = { id: createdRef.id, name: trimmed, active: true, inUse: false, isTest: createdRef.isTest };
    setRows((r) => [...r, created]);
    if (simulated) setUnsaved((u) => [...u, created.id]);
    setName("");
  }

  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`}>
      <div className="sec set-head">
        <div>
          <h2 id={`${id}-title`}>סוגי קריאה</h2>
          <div className="sub">האפשרויות בשדה &quot;סוג קריאה&quot; בזימון.</div>
        </div>
      </div>
      <div className="scrollx">
        <table>
          <thead>
            <tr>
              <th>סוג קריאה</th>
              <th className="col-center col-fit">פעיל</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((t) => (
              <tr key={t.id}>
                <td>
                  <span className="set-name">
                    <b>{t.name}</b>
                    {unsaved.includes(t.id) && <SettingsNotSaved />}
                  </span>
                </td>
                <td className="col-center col-fit">
                  <SettingsShellToggle action={{ kind: "callTypeActive", id: t.id }} initial={t.active} label={`${t.name} פעיל`} />
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SettingsMore shown={types.items.length} total={types.total} />
      <form className="set-add" onSubmit={(e) => void add(e)} aria-label="הוספת סוג קריאה">
        <input
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="סוג חדש, למשל: בדיקה תקופתית"
          aria-label="סוג קריאה חדש"
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          aria-invalid={error ? true : undefined}
          maxLength={SETTING_NAME_MAX}
          autoComplete="off"
        />
        <button type="submit" className="btn pri" disabled={busy}>
          + הוספת סוג קריאה
        </button>
        {error && (
          <span id={errorId} role="alert" className="set-err">
            {error}
          </span>
        )}
      </form>
      <div id={hintId} className="sub set-foot">
        סוג קריאה לא נמחק: סוג שלא צריך אפשר לכבות. הסוגים הראשונים הם ערכים התחלתיים, לאימות עם שירות הלקוחות.
      </div>
    </section>
  );
}
