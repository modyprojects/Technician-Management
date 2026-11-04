"use client";

// Spoken summary (docs/demo.html techWork() recording block, L566-569, and recStart/recStop,
// L1119-1120; TE-15). Start, a running timer, stop; then the length, re-record and delete.
// Saving and deleting go through useCommands().visits (saveRecording, deleteRecording). This
// screen never opens the microphone: the recording is simulated in the UI demo and says so.
// At most 180 seconds (D13 provisional, TE-15): the timer stops by itself at the limit.
import { useEffect, useEffectEvent, useRef, useState } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import type { VisitRef } from "@/features/visits/data/types";
import { RECORDING_LIMIT_SECONDS, recordingLabel, type UpdateDraft } from "./WorkDraft";

/** The demo's IC.mic. */
function MicIcon() {
  return (
    <svg aria-hidden="true" width="18" height="18" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2">
      <rect x="9" y="3" width="6" height="11" rx="3" />
      <path d="M5 11a7 7 0 0 0 14 0M12 18v3" />
    </svg>
  );
}

/** The demo keeps at least 3 seconds (recStop). */
const MIN_SECONDS = 3;

export function RecordingPanel({
  visit,
  seconds,
  simulated,
  onChange,
}: {
  visit: VisitRef;
  /** Length of the kept recording; 0 = none. */
  seconds: number;
  /** The kept recording came from a simulated command (nothing was recorded or saved). */
  simulated: boolean;
  onChange: UpdateDraft;
}) {
  const { visits } = useCommands();
  const [recording, setRecording] = useState(false);
  const [elapsed, setElapsed] = useState(0);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const startedAt = useRef(0);

  async function stop() {
    if (!startedAt.current) return; // already stopping
    const secs = Math.min(RECORDING_LIMIT_SECONDS, Math.max(MIN_SECONDS, Math.floor((Date.now() - startedAt.current) / 1000)));
    startedAt.current = 0;
    setRecording(false);
    setBusy(true);
    const r = await visits.saveRecording(visit, { seconds: secs });
    setBusy(false);
    if (!r.ok) setError(r.error);
    else onChange((d) => ({ ...d, recordingSeconds: secs, recordingSimulated: r.simulated }));
  }

  function start() {
    startedAt.current = Date.now();
    setElapsed(0);
    setError(null);
    setRecording(true);
  }

  async function remove() {
    setBusy(true);
    setError(null);
    const r = await visits.deleteRecording(visit);
    setBusy(false);
    if (!r.ok) setError(r.error);
    else onChange((d) => ({ ...d, recordingSeconds: 0, recordingSimulated: r.simulated }));
  }

  const tick = useEffectEvent(() => {
    if (!startedAt.current) return;
    const secs = Math.floor((Date.now() - startedAt.current) / 1000);
    setElapsed(Math.min(secs, RECORDING_LIMIT_SECONDS));
    if (secs >= RECORDING_LIMIT_SECONDS) void stop();
  });

  useEffect(() => {
    if (!recording) return;
    const timer = setInterval(() => tick(), 250);
    return () => clearInterval(timer);
  }, [recording]);

  const time = recording ? recordingLabel(elapsed) : seconds ? recordingLabel(seconds) : "אין הקלטה";
  const note = recording
    ? "מקליט… (הקלטה מדומה · המיקרופון לא מופעל)"
    : seconds
      ? simulated
        ? "הקלטה מדומה · לא נשמרה. לחץ שוב כדי להקליט מחדש."
        : "ההקלטה נשמרה. לחץ שוב כדי להקליט מחדש."
      : `לחץ כדי להתחיל להקליט · עד ${RECORDING_LIMIT_SECONDS / 60} דקות`;

  return (
    <div>
      <div style={{ display: "flex", alignItems: "center", gap: 12, background: "var(--bg)", borderRadius: 10, padding: 12 }}>
        <button
          type="button"
          onClick={recording ? () => void stop() : start}
          disabled={busy}
          aria-label={recording ? "עצירת הקלטה" : "התחלת הקלטה"}
          style={{
            width: 48,
            height: 48,
            borderRadius: "50%",
            border: 0,
            background: recording ? "var(--ink)" : "var(--danger)",
            color: "var(--on-dark)",
            flex: "none",
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
          }}
        >
          {recording ? <span aria-hidden="true">■</span> : <MicIcon />}
        </button>
        <div style={{ flex: 1, minWidth: 0 }}>
          <b className="num" role={recording ? "timer" : undefined}>
            {time}
          </b>
          <div className="sub" aria-live="polite">
            {note}
          </div>
        </div>
        {seconds > 0 && !recording && (
          <button type="button" className="btn dng" onClick={() => void remove()} disabled={busy} style={{ padding: "6px 10px", flex: "none" }}>
            מחיקה
          </button>
        )}
      </div>
      {error && (
        <div role="alert" style={{ marginTop: 8, color: "var(--danger)", fontSize: 13, fontWeight: 700 }}>
          {error}
        </div>
      )}
    </div>
  );
}
