"use client";

// "התראות" on the technician's profile (docs/demo.html techProfile() L686-687; TE-29 CHANGE,
// SE-11): "זימון חדש או שינוי ביומן" and "צליל התראה". The demo's "תזכורת 'מה לאסוף' בבוקר"
// toggle is removed (no scheduled pickup reminder in v1, TE-28, D25). The sound plays only while
// the app is open (no push), which the row says.
// The toggles persist per user: each change runs useCommands().notifications.setPreferences with
// both values. The switch moves at once and moves back, with an inline error, when the command
// fails; while one change is running, further taps are ignored. In the UI demo the command is
// simulated (the provider's toast says nothing was saved).
// Accessibility: each toggle is a switch named by its row's label.
import { useId, useRef, useState } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { NotificationPreferences } from "@/features/notifications/data/types";

const FAILED = "ההגדרה לא נשמרה. נסה שוב.";
const HEADING_STYLE = { fontFamily: "var(--body)", fontWeight: 700 } as const;

const ROWS: { key: keyof NotificationPreferences; label: string; hint?: string }[] = [
  { key: "newOrChange", label: "זימון חדש או שינוי ביומן" },
  { key: "sound", label: "צליל התראה", hint: "רק כשהאפליקציה פתוחה" },
];

export function ProfilePreferences({ initial }: { initial: NotificationPreferences }) {
  const { notifications } = useCommands();
  const [prefs, setPrefs] = useState<NotificationPreferences>(initial);
  const [error, setError] = useState<string | null>(null);
  const running = useRef(false);
  const id = useId();

  async function toggle(key: keyof NotificationPreferences) {
    if (running.current) return;
    running.current = true;
    const before = prefs;
    const next: NotificationPreferences = { ...prefs, [key]: !prefs[key] };
    setPrefs(next);
    setError(null);
    let failure: string | null = null;
    try {
      const result = await notifications.setPreferences(next);
      if (!result.ok) failure = result.error;
    } catch {
      failure = FAILED;
    } finally {
      running.current = false;
    }
    if (failure) {
      setPrefs(before);
      setError(failure);
    }
  }

  return (
    <>
      <h2 id={`${id}-title`} className="sub" style={HEADING_STYLE}>
        התראות
      </h2>
      <section className="card" aria-labelledby={`${id}-title`}>
        {ROWS.map((row) => {
          const labelId = `${id}-${row.key}`;
          const hintId = row.hint ? `${id}-${row.key}-hint` : undefined;
          const on = prefs[row.key];
          return (
            <div key={row.key} className="tnp-row">
              <span>
                <span id={labelId}>{row.label}</span>
                {row.hint && (
                  <span id={hintId} className="sub" style={{ display: "block" }}>
                    {row.hint}
                  </span>
                )}
              </span>
              <button
                type="button"
                role="switch"
                aria-checked={on}
                aria-labelledby={labelId}
                aria-describedby={hintId}
                className={on ? "tog on" : "tog"}
                onClick={() => void toggle(row.key)}
              />
            </div>
          );
        })}
        {error && (
          <div role="alert" style={{ padding: "0 14px 10px", color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
            {error}
          </div>
        )}
      </section>
    </>
  );
}
