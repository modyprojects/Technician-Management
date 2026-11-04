"use client";

// "חלפים שהוחלפו" card (TE-17, ADD: missing from docs/demo.html; on the work screen after the
// summary). New UI in the demo's visual language: the parts as chips with a remove button, a
// field and "הוספה", and, when the visit had an item to pick up before it, a one-tap chip that
// adds that item. Optional. Every change goes through useCommands().visits.saveParts with the
// whole list; the draft changes only when the command accepts it.
import { useId, useRef, useState, type FormEvent } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { VisitRef } from "@/features/visits/data/types";
import { PART_MAX, PARTS_MAX } from "@/features/visits/data/validate";
import type { UpdateDraft } from "./WorkDraft";

const sameName = (a: string, b: string): boolean => a.trim().toLowerCase() === b.trim().toLowerCase();

export function PartsEditor({
  visit,
  parts,
  pickupItem,
  onChange,
}: {
  visit: VisitRef;
  parts: readonly string[];
  /** The visit's "לאסוף לפני הביקור" item, offered as a quick add; null when none. */
  pickupItem: string | null;
  onChange: UpdateDraft;
}) {
  const { visits } = useCommands();
  const [text, setText] = useState("");
  // After a removal the removed chip's button is gone: focus moves to the part field.
  const fieldRef = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();
  const fieldId = useId();
  const errorId = useId();
  const full = parts.length >= PARTS_MAX;
  const suggestion = pickupItem && !parts.some((p) => sameName(p, pickupItem)) ? pickupItem : null;

  async function save(next: string[]): Promise<boolean> {
    setBusy(true);
    setError(null);
    const r = await visits.saveParts(visit, next);
    setBusy(false);
    if (!r.ok) {
      setError(r.error);
      return false;
    }
    onChange((d) => ({ ...d, parts: next }));
    return true;
  }

  async function add(name: string) {
    const part = name.trim();
    if (!part) return setError("כתוב את שם החלק ואז לחץ הוספה");
    if (part.length > PART_MAX) return setError(`שם חלק ארוך מ-${PART_MAX} תווים`);
    if (parts.some((p) => sameName(p, part))) return setError("החלק הזה כבר ברשימה");
    if (full) return setError(`אפשר לרשום עד ${PARTS_MAX} חלפים`);
    if (await save([...parts, part])) setText("");
  }

  function onSubmit(event: FormEvent) {
    event.preventDefault();
    void add(text);
  }

  return (
    <section className="card" style={{ padding: "12px 14px" }} aria-labelledby={titleId} aria-busy={busy}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "2px 10px", marginBottom: 8 }}>
        <h2 id={titleId} style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 700 }}>
          חלפים שהוחלפו
        </h2>
        <span className="sub">לא חובה</span>
      </div>
      {parts.length > 0 ? (
        <ul style={{ listStyle: "none", margin: "0 0 10px", padding: 0, display: "flex", flexWrap: "wrap", gap: 6 }} aria-label="חלפים שנרשמו">
          {parts.map((p) => (
            <li key={p} className="chip" style={{ display: "inline-flex", alignItems: "center", gap: 6, maxWidth: "100%", paddingInlineEnd: 6 }}>
              <span style={{ overflowWrap: "anywhere" }}>{p}</span>
              <button
                type="button"
                onClick={() => void save(parts.filter((x) => x !== p)).then(() => fieldRef.current?.focus())}
                disabled={busy}
                aria-label={`הסרת ${p}`}
                style={{ border: 0, background: "var(--line2)", borderRadius: "50%", width: 24, height: 24, padding: 0, flex: "none", fontSize: 12, lineHeight: 1 }}
              >
                <span aria-hidden="true">✕</span>
              </button>
            </li>
          ))}
        </ul>
      ) : (
        <div className="sub" style={{ marginBottom: 10 }}>
          לא נרשמו חלפים
        </div>
      )}
      {!full && (
        <form onSubmit={onSubmit} style={{ display: "flex", gap: 8 }}>
          <input
            ref={fieldRef}
            id={fieldId}
            aria-label="שם החלק"
            value={text}
            maxLength={PART_MAX}
            placeholder="שם החלק או מק״ט"
            onChange={(e) => setText(e.target.value)}
            aria-invalid={error ? true : undefined}
            aria-describedby={error ? errorId : undefined}
            style={{ flex: 1, minWidth: 0 }}
          />
          <button type="submit" className="btn" disabled={busy}>
            הוספה
          </button>
        </form>
      )}
      {suggestion && !full && (
        <div style={{ display: "flex", alignItems: "center", flexWrap: "wrap", gap: 6, marginTop: 8 }}>
          <span className="sub">נאסף לפני הביקור:</span>
          <button type="button" className="chip" onClick={() => void add(suggestion)} disabled={busy} aria-label={`הוספת ${suggestion} לחלפים`}>
            + {suggestion}
          </button>
        </div>
      )}
      {full && <div className="sub">אפשר לרשום עד {PARTS_MAX} חלפים</div>}
      {error && (
        <div id={errorId} role="alert" style={{ marginTop: 8, color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
          {error}
        </div>
      )}
    </section>
  );
}
