"use client";

// "סיכום הטיפול" card (docs/demo.html techWork() L563-570; TE-15): "✎ כתיבה" / "🎙 הקלטה"
// toggle, the written summary or the recording panel, and "יש גם הקלטה של …" under the text.
// The text is a draft until the visit is closed; it goes through useCommands().visits.saveSummary
// when the field loses focus and the text changed (not on every keystroke).
// TE-16 is pending (WorkDraft VOICE_ONLY_CLOSE): until the owner decides, the written summary is
// what makes the card complete, and the subtitle says so.
import { useId, useState } from "react";
import { useVisitCommands } from "@/features/visits/commands-context";
import type { VisitRef } from "@/features/visits/data/types";
import { SUMMARY_MAX } from "@/features/visits/data/validate";
import { RecordingPanel } from "./RecordingPanel";
import { recordingLabel, VOICE_ONLY_CLOSE, type SummaryMode, type UpdateDraft, type VisitDraft } from "./WorkDraft";

const MODES: readonly [SummaryMode, string][] = [
  ["text", "✎ כתיבה"],
  ["rec", "🎙 הקלטה"],
];

export function SummaryEditor({
  visit,
  draft,
  onChange,
  recording = true,
}: {
  visit: VisitRef;
  draft: VisitDraft;
  onChange: UpdateDraft;
  /** Offer "🎙 הקלטה" (Version 2 in the real app: without it the card is the written summary only). */
  recording?: boolean;
}) {
  const visits = useVisitCommands();
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const titleId = useId();

  async function save() {
    const text = draft.summary;
    if (text === draft.savedSummary) return;
    setSaving(true);
    setError(null);
    const r = await visits.saveSummary(visit, text);
    setSaving(false);
    if (!r.ok) setError(r.error);
    else onChange((d) => ({ ...d, savedSummary: text }));
  }

  return (
    <section className="card" style={{ padding: "12px 14px" }} aria-labelledby={titleId}>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", flexWrap: "wrap", gap: "2px 10px", marginBottom: 8 }}>
        <h2 id={titleId} style={{ fontFamily: "var(--body)", fontSize: 14, fontWeight: 700 }}>
          סיכום הטיפול{" "}
          <span style={{ color: "var(--danger)" }} aria-hidden="true">
            *
          </span>
        </h2>
        <span className="sub">{!recording ? "חובה: סיכום כתוב" : VOICE_ONLY_CLOSE ? "חובה: כתיבה או הקלטה" : "חובה: סיכום כתוב · הקלטה לא חובה"}</span>
      </div>
      {recording && (
      <div className="seg" role="group" aria-label="אופן הסיכום" style={{ marginBottom: 10 }}>
        {MODES.map(([mode, label]) => (
          <button
            key={mode}
            type="button"
            className={draft.mode === mode ? "on" : undefined}
            aria-pressed={draft.mode === mode}
            onClick={() => onChange((d) => ({ ...d, mode }))}
          >
            {label}
          </button>
        ))}
      </div>
      )}
      {!recording || draft.mode === "text" ? (
        <>
          <textarea
            aria-label="סיכום הטיפול"
            rows={5}
            style={{ width: "100%", display: "block" }}
            placeholder="מה נעשה בביקור?"
            maxLength={SUMMARY_MAX}
            value={draft.summary}
            aria-required={!VOICE_ONLY_CLOSE}
            aria-busy={saving}
            onChange={(e) => {
              const summary = e.target.value;
              onChange((d) => ({ ...d, summary }));
            }}
            onBlur={() => void save()}
          />
          {draft.recordingSeconds > 0 && (
            <div className="sub" style={{ marginTop: 6 }}>
              יש גם הקלטה של {recordingLabel(draft.recordingSeconds)}
            </div>
          )}
        </>
      ) : (
        <>
          <RecordingPanel visit={visit} seconds={draft.recordingSeconds} simulated={draft.recordingSimulated} onChange={onChange} />
          {!VOICE_ONLY_CLOSE && (
            <div className="sub" style={{ marginTop: 6 }}>
              סגירה עם הקלטה בלבד ממתינה להחלטה · כדי לסיים צריך גם סיכום כתוב
            </div>
          )}
        </>
      )}
      {error && (
        <div role="alert" style={{ marginTop: 8, color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
          {error}
        </div>
      )}
    </section>
  );
}
