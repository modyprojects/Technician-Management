"use client";

// Settings › סיבות המשך טיפול, the 'נוסח אישור "טופל"' card (docs/demo.html setReasons() L963,
// demo-deviations SE-07): the text the customer signs when the technician chooses "טופל". The demo
// changes it on every keystroke; here "שמירת נוסח" runs useCommands().settings.setFixedText, which
// saves a new version: past signatures keep the exact text shown at signing (D43). Read through
// reference.approvalText(). Editing is governed by the matrix key `settings` (D35), checked on the
// server (G-04). In the UI demo the command is simulated (toast); the saved text shows on this
// screen only.
import { useId, useState, type FormEvent } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { ApprovalText } from "@/features/reference/data/types";
import { FIXED_TEXT_MAX, fixedTextError } from "@/features/settings/data/validate";

const FAILED = "הנוסח לא נשמר. נסה שוב.";

export function SettingsReasonsFixedText({ approvalText }: { approvalText: ApprovalText }) {
  const { settings } = useCommands();
  const [saved, setSaved] = useState(approvalText.text);
  const [text, setText] = useState(approvalText.text);
  const [error, setError] = useState<string | null>(null);
  /** What the last successful save did: a simulated result never claims a save (TE-23). */
  const [done, setDone] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const id = useId();
  const inputId = `${id}-text`;
  const hintId = `${id}-hint`;
  const errorId = `${id}-error`;
  const unchanged = text.trim() === saved.trim();

  async function save(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy || unchanged) return;
    const next = text.trim();
    // Checked first with the command's own validator: an empty text gets an inline error, not a toast.
    const invalid = fixedTextError(next);
    if (invalid) {
      setError(invalid);
      return;
    }
    setBusy(true);
    setError(null);
    setDone(null);
    let failure: string | null = null;
    let simulated = false;
    try {
      const result = await settings.setFixedText(next);
      if (result.ok) simulated = result.simulated;
      else failure = result.error;
    } catch {
      failure = FAILED;
    } finally {
      setBusy(false);
    }
    if (failure) {
      setError(failure);
      return;
    }
    setSaved(next);
    setText(next);
    setDone(simulated ? "גרסה חדשה בהדגמה · פעולה מדומה, לא נשמרה" : "נשמר כגרסה חדשה של הנוסח");
  }

  return (
    <section className="card sec" aria-labelledby={`${id}-title`}>
      <h2 id={`${id}-title`}>נוסח אישור &quot;טופל&quot;</h2>
      <form noValidate onSubmit={(e) => void save(e)}>
        <label htmlFor={inputId} className="sub">
          הנוסח שהלקוח חותם עליו כשהטכנאי בוחר &quot;טופל&quot;
        </label>
        <input
          id={inputId}
          value={text}
          onChange={(e) => {
            setText(e.target.value);
            setDone(null);
          }}
          maxLength={FIXED_TEXT_MAX}
          required
          aria-describedby={error ? `${errorId} ${hintId}` : hintId}
          aria-invalid={error ? true : undefined}
          autoComplete="off"
          style={{ width: "100%", marginTop: 6 }}
        />
        <div className="set-form-actions" style={{ marginTop: 10 }}>
          <button type="submit" className="btn pri" disabled={busy || unchanged}>
            {busy ? "שומר…" : "שמירת נוסח"}
          </button>
          <span role="status" className="sub">
            {done ?? ""}
          </span>
          {error && (
            <span id={errorId} role="alert" className="set-err">
              {error}
            </span>
          )}
        </div>
      </form>
      <div id={hintId} className="sub" style={{ marginTop: 8 }}>
        כל שמירה יוצרת גרסה חדשה. חתימות קודמות לא משתנות: כל חתימה שומרת את הנוסח המדויק שהלקוח ראה בזמן החתימה.
      </div>
    </section>
  );
}
