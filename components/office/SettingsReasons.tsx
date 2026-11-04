"use client";

// Settings › סיבות המשך טיפול, the reasons card (docs/demo.html setReasons() L956-962,
// demo-deviations SE-07): order, reason, "שימוש החודש" and "פעילה".
// - "פעילה": useCommands().settings.setReasonActive. An inactive reason disappears from the close
//   screen at once.
// - "+ הוספת סיבה": settings.addReason (appended at the end of the order).
// - "מחיקה" only for a user-added reason that was never used (reasonDeletable(): docs/demo.html
//   `r.added && !used`, docs/database-schema.md `is_user_added`): settings.deleteReason. An initial
//   (D48) or used reason can only be deactivated (SE-07; the database restricts the delete).
// The initial reasons are the demo's five, to validate with customer service (owner task O3, D48).
// Editing is governed by the matrix key `settings` (D35), checked on the server (G-04). Changes show
// on this screen only; a row from a simulated command is marked as not saved. The "טופל" text card
// is SettingsReasonsFixedText.
import { useId, useRef, useState, type FormEvent } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { Bounded } from "@/features/data-access/common";
import { reasonDeletable, type ReasonSetting } from "@/features/settings/data/types";
import { SETTING_NAME_MAX, settingNameError } from "@/features/settings/data/validate";
import { SettingsMore, SettingsNotSaved } from "./SettingsShell";
import { SettingsShellToggle } from "./SettingsShellToggle";

const ADD_FAILED = "הסיבה לא נוספה. נסה שוב.";
const DELETE_FAILED = "הסיבה לא נמחקה. נסה שוב.";
const DUPLICATE = "סיבה בשם הזה כבר קיימת";

const sameName = (a: string, b: string): boolean => a.trim().toLocaleLowerCase("he") === b.trim().toLocaleLowerCase("he");

export function SettingsReasons({ reasons }: { reasons: Bounded<ReasonSetting> }) {
  const { settings } = useCommands();
  const [rows, setRows] = useState<ReasonSetting[]>(reasons.items);
  const [name, setName] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  /** Rows added by a simulated command (shown as not saved). */
  const [unsaved, setUnsaved] = useState<readonly string[]>([]);
  const input = useRef<HTMLInputElement>(null);
  const id = useId();
  const errorId = `${id}-error`;
  const hintId = `${id}-hint`;

  async function add(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    const trimmed = name.trim();
    // Checked first with the command's own validator: a typo gets an inline error, not a toast.
    const invalid = settingNameError(trimmed, "שם הסיבה") ?? (rows.some((r) => sameName(r.name, trimmed)) ? DUPLICATE : null);
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
      const result = await settings.addReason(trimmed);
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
    // The id and test marker come from the command (as stored, D47); a new reason is user-added.
    const created: ReasonSetting = {
      id: createdRef.id,
      name: trimmed,
      active: true,
      order: rows.reduce((max, r) => Math.max(max, r.order), 0) + 1,
      inUse: false,
      userAdded: true,
      usedThisMonth: 0,
      isTest: createdRef.isTest,
    };
    setRows((r) => [...r, created]);
    if (simulated) setUnsaved((u) => [...u, created.id]);
    setName("");
  }

  async function remove(reason: ReasonSetting) {
    if (busy) return;
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    try {
      const result = await settings.deleteReason(reason.id);
      if (!result.ok) failure = result.error;
    } catch {
      failure = DELETE_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure) {
      setError(failure);
      return;
    }
    setRows((r) => r.filter((x) => x.id !== reason.id));
    input.current?.focus();
  }

  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby={`${id}-title`}>
      <div className="sec set-head">
        <div>
          <h2 id={`${id}-title`}>סיבות המשך טיפול</h2>
          <div className="sub">סיבה מכובה נעלמת מהטכנאי מיד.</div>
        </div>
      </div>
      <div className="scrollx">
        <table>
          <thead>
            <tr>
              <th className="col-center col-fit">סדר</th>
              <th>סיבה</th>
              <th className="col-center col-fit">שימוש החודש</th>
              <th className="col-fit">פעילה</th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.id}>
                <td className="num col-center col-fit" style={{ color: "var(--muted)" }}>
                  {r.order}
                </td>
                <td>
                  <span className="set-name">
                    <b>{r.name}</b>
                    {unsaved.includes(r.id) && <SettingsNotSaved />}
                  </span>
                </td>
                <td className="num col-center col-fit">{r.usedThisMonth}</td>
                <td className="col-fit">
                  <div className="set-cell-actions">
                    <SettingsShellToggle action={{ kind: "reasonActive", id: r.id }} initial={r.active} label={`${r.name} פעילה`} />
                    {reasonDeletable(r) && (
                      <button
                        type="button"
                        className="chip set-del"
                        disabled={busy}
                        aria-label={`מחיקת ${r.name}`}
                        onClick={() => void remove(r)}
                      >
                        מחיקה
                      </button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      <SettingsMore shown={reasons.items.length} total={reasons.total} />
      <form className="set-add" onSubmit={(e) => void add(e)} aria-label="הוספת סיבת המשך טיפול">
        <input
          ref={input}
          value={name}
          onChange={(e) => setName(e.target.value)}
          placeholder="סיבה חדשה, למשל: נדרש אישור ספק"
          aria-label="סיבה חדשה"
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          aria-invalid={error ? true : undefined}
          maxLength={SETTING_NAME_MAX}
          autoComplete="off"
        />
        <button type="submit" className="btn pri" disabled={busy}>
          + הוספת סיבה
        </button>
        {error && (
          <span id={errorId} role="alert" className="set-err">
            {error}
          </span>
        )}
      </form>
      <div id={hintId} className="sub set-foot">
        סיבה חדשה מופיעה מיד לטכנאי במסך הסגירה, בדשבורד ובסינון. אפשר למחוק רק סיבה שנוספה כאן ועוד לא השתמשו בה, וסיבה שכבר בשימוש
        אפשר רק לכבות. הסיבות הראשונות הן ערכים התחלתיים, לאימות עם שירות הלקוחות, ואפשר רק לכבות אותן.
      </div>
    </section>
  );
}
