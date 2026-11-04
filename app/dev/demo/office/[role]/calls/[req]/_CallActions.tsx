"use client";

// Header actions of the demo call card (docs/demo.html offCard() L849-850 and the askCancel /
// noCancel / doCancel handlers L1161-1163). Data actions go through the data-access layer
// (useCommands().calls); in the demo they are simulated (D53): the provider shows
// "פעולה מדומה · לא נשמר" and nothing changes on screen (G-06).
// - "חיוג לטכנאי": as in the demo (the last visit's technician). A dial is navigation, not a data
//   action, so it stays a data-sim affordance.
// - "שינוי מועד" and "הוספת הערה": not in the demo; scheduling stays in Outlook (OF-03), so the
//   result says where the change is really made.
// - "ביטול ביקור" (OF-09 PENDING, D38: cancels the open visit, never the whole call): the demo's
//   inline confirmation, only where the default matrix gives `cancel` (Manager; D33, temporary
//   per D51). Customer Service sees why the action is missing instead of the button (G-04).
// - "פתח זימון ב-Outlook" is not shown until Microsoft 365 is connected (OF-08).
import { useEffect, useId, useRef, useState, type FormEvent, type KeyboardEvent } from "react";
import { NOTE_MAX } from "@/features/calls/data/validate";
import { useCommands } from "@/features/data-access/commands-context";

type Panel = "cancel" | "note" | null;
type Busy = "reschedule" | "note" | "cancel" | null;

export function CallActions({
  req,
  tech,
  openVisit,
  canCancel,
}: {
  req: string;
  /** Technician of the last visit (the demo's "חיוג לטכנאי"); null when the call has no visit. */
  tech: { name: string; phone: string } | null;
  /** The open visit the reschedule and cancel actions apply to, if any. */
  openVisit: { n: number; techName: string; when: string } | null;
  canCancel: boolean;
}) {
  const { calls } = useCommands();
  const [panel, setPanel] = useState<Panel>(null);
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState<Busy>(null);
  const [error, setError] = useState<string | null>(null);
  const noteId = useId();
  const cancelBtn = useRef<HTMLButtonElement>(null);
  const noteBtn = useRef<HTMLButtonElement>(null);
  const keepBtn = useRef<HTMLButtonElement>(null);
  const noteField = useRef<HTMLTextAreaElement>(null);
  const returnFocus = useRef<HTMLButtonElement | null>(null);

  useEffect(() => {
    if (panel === "cancel") keepBtn.current?.focus();
    else if (panel === "note") noteField.current?.focus();
  }, [panel]);

  function toggle(next: Exclude<Panel, null>) {
    returnFocus.current = next === "cancel" ? cancelBtn.current : noteBtn.current;
    setError(null);
    setPanel((p) => (p === next ? null : next));
  }

  function close() {
    setPanel(null);
    setError(null);
    returnFocus.current?.focus();
  }

  function onPanelKey(e: KeyboardEvent) {
    if (e.key === "Escape") close();
  }

  async function reschedule() {
    if (!openVisit || busy) return;
    setBusy("reschedule");
    await calls.reschedule({ req, n: openVisit.n });
    setBusy(null);
  }

  async function saveNote(e: FormEvent) {
    e.preventDefault();
    const text = note.trim();
    if (!text || busy) return;
    setBusy("note");
    const result = await calls.addNote(req, text);
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setNote("");
    close();
  }

  async function confirmCancel() {
    if (!openVisit || busy) return;
    setBusy("cancel");
    const result = await calls.cancelVisit({ req, n: openVisit.n });
    setBusy(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    close();
  }

  const panelStyle = { flexBasis: "100%", width: "100%", padding: "12px 16px" } as const;

  return (
    <>
      <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
        {tech && (
          <button type="button" className="btn" data-sim={`חיוג לטכנאי ${tech.name} · ${tech.phone}`}>
            חיוג לטכנאי
          </button>
        )}
        {openVisit && (
          <button type="button" className="btn" onClick={reschedule} disabled={busy === "reschedule"}>
            שינוי מועד
          </button>
        )}
        <button
          ref={noteBtn}
          type="button"
          className="btn"
          aria-expanded={panel === "note"}
          onClick={() => toggle("note")}
        >
          הוספת הערה
        </button>
        {openVisit &&
          (canCancel ? (
            <button
              ref={cancelBtn}
              type="button"
              className="btn dng"
              aria-expanded={panel === "cancel"}
              onClick={() => toggle("cancel")}
            >
              ביטול ביקור
            </button>
          ) : (
            <span className="sub">ביטול ביקור: למנהל בלבד</span>
          ))}
      </div>

      {panel === "cancel" && openVisit && (
        <div
          role="group"
          aria-label="אישור ביטול ביקור"
          className="card"
          onKeyDown={onPanelKey}
          style={{
            ...panelStyle,
            background: "var(--danger-bg)",
            borderColor: "var(--danger-line)",
            display: "flex",
            gap: 10,
            alignItems: "center",
            flexWrap: "wrap",
          }}
        >
          <b style={{ flex: 1, minWidth: 200, color: "var(--danger-fg)" }}>
            לבטל את הביקור הפתוח (ביקור {openVisit.n} · {openVisit.when})? הוא יירד מהיומן של {openVisit.techName}.
          </b>
          <button type="button" className="btn dng" onClick={confirmCancel} disabled={busy === "cancel"}>
            כן, לבטל
          </button>
          <button ref={keepBtn} type="button" className="btn" onClick={close}>
            לא
          </button>
          {error && (
            <div role="alert" style={{ flexBasis: "100%", color: "var(--danger-fg)", fontSize: 13 }}>
              {error}
            </div>
          )}
        </div>
      )}

      {panel === "note" && (
        <form
          className="card"
          aria-label="הוספת הערה לקריאה"
          onSubmit={saveNote}
          onKeyDown={onPanelKey}
          style={{ ...panelStyle, display: "flex", flexDirection: "column", gap: 8 }}
        >
          <label htmlFor={noteId} className="sub" style={{ fontWeight: 700 }}>
            הערה לפנייה {req}
          </label>
          <textarea
            ref={noteField}
            id={noteId}
            rows={3}
            maxLength={NOTE_MAX}
            value={note}
            onChange={(e) => setNote(e.target.value)}
            placeholder="לדוגמה: הלקוח ביקש שיתקשרו חצי שעה לפני ההגעה"
          />
          {error && (
            <div role="alert" style={{ color: "var(--danger-fg)", fontSize: 13 }}>
              {error}
            </div>
          )}
          <div style={{ display: "flex", gap: 8, flexWrap: "wrap" }}>
            <button type="submit" className="btn pri" disabled={!note.trim() || busy === "note"}>
              שמירת הערה
            </button>
            <button type="button" className="btn" onClick={close}>
              סגירה
            </button>
          </div>
        </form>
      )}
    </>
  );
}
