"use client";

// "תיקון ביקור סגור" (OF-10, D14, D43, D45): the modal form of an audited correction of one field
// of a server-closed visit. Manager and Creator only (a fixed capability, D33); the caller renders
// it only for them (display only, G-04: the server checks the caller's role in the database).
// - The field list is the visit's own (`history.correctable`: summary, parts, follow-up reason and
//   next-visit note for "המשך טיפול", the three field times). The signed approval text, the signer
//   and the signature are never correctable, and the form says so (D43).
// - The original value (as the technician closed the visit, or as the device reported the time)
//   stays visible next to the current value; the new value starts from the current one.
// - The reason is mandatory. A field time is corrected by a new time report: the device's report is
//   never overwritten (D45); an impossible sequence is flagged, not blocked.
// - Runs useCommands().visits.correct with the visit version it started from (D44). Checks run
//   first with the shared validators, so a typo gets an inline error (aria-invalid, focus on the
//   control) instead of a toast.
// The look is the demo's drawer (.drawer-bg / .drawer, docs/demo.html L159-164), as the calendar's
// CallDrawer: a modal dialog rendered into document.body (outside the card's layout), focus moves
// into it, Tab stays inside, Escape, ✕, "ביטול" and a click on the dimmed background close it, and
// the caller returns focus to the button that opened it. The background closes it only while the
// form is untouched, and only when the press both started and ended on it (a text selection that
// ends outside the panel never discards a typed correction).
import { useEffect, useEffectEvent, useId, useRef, useState, type FormEvent } from "react";
import { createPortal } from "react-dom";
import { useCommands } from "@/features/data-access/commands-context";
import {
  CORRECTABLE_FIELD_LABELS,
  TIME_CORRECTION_FIELDS,
  type CorrectableVisitField,
  type CorrectionValue,
  type VisitCorrection,
  type VisitCorrectionHistory,
  type VisitCorrectionInput,
} from "@/features/visits/data/types";
import {
  CORRECTION_REASON_MAX,
  correctionValueError,
  NEXT_NOTE_MAX,
  PART_MAX,
  PARTS_MAX,
  SUMMARY_MAX,
  visitCorrectionInputError,
} from "@/features/visits/data/validate";
import { ReviewValueText } from "./ReviewParts";

const FOCUSABLE = 'a[href], button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])';
const SAVE_FAILED = "התיקון לא נשמר. נסה שוב.";

/** Correction text for a value as the form edits it (parts one per line, a time "HH:MM"). */
function draftOf(field: CorrectableVisitField, value: CorrectionValue): string {
  if (value === null) return "";
  if (typeof value === "string") return value;
  return field === "parts" ? value.join("\n") : value.join(", ");
}

/** The value the command receives. */
function valueOf(field: CorrectableVisitField, draft: string): CorrectionValue {
  if (field === "parts") return draft.split("\n").map((p) => p.trim()).filter(Boolean);
  return TIME_CORRECTION_FIELDS.includes(field) ? draft.trim() : draft;
}

const sameValue = (a: CorrectionValue, b: CorrectionValue): boolean => {
  const norm = (v: CorrectionValue) => (v === null ? null : typeof v === "string" ? v.trim() : JSON.stringify(v.map((x) => x.trim())));
  return norm(a) === norm(b);
};

const toMinutes = (t: string): number | null => (/^\d{2}:\d{2}$/.test(t) ? Number(t.slice(0, 2)) * 60 + Number(t.slice(3)) : null);

/** What the dialog needs of the visit's history (the card passes its view of it). */
export type CorrectionDialogVisit = Pick<VisitCorrectionHistory, "req" | "n" | "version" | "original" | "current" | "correctable">;

/** D45: departure ≤ arrival ≤ end, with the new value in place; only times that are set count. */
function impossibleSequence(history: CorrectionDialogVisit, field: CorrectableVisitField, draft: string): boolean {
  if (!TIME_CORRECTION_FIELDS.includes(field)) return false;
  const time = (f: CorrectableVisitField): number | null => {
    const v = f === field ? draft : history.current[f];
    return typeof v === "string" ? toMinutes(v) : null;
  };
  const seq = (["departAt", "arriveAt", "endAt"] as const).map(time).filter((m): m is number => m !== null);
  return seq.some((m, i) => i > 0 && m < (seq[i - 1] as number));
}

type Target = "field" | "value" | "reason" | null;

export function VisitCorrectionDialog({
  history,
  reasons,
  title,
  onClose,
  onSaved,
}: {
  history: CorrectionDialogVisit;
  /** Active follow-up reasons (Settings) for a corrected reason. */
  reasons: readonly string[];
  /** The sub-line: request, visit and customer. */
  title: string;
  onClose: () => void;
  /** After the command succeeded: the correction as returned (null when none came back). */
  onSaved: (correction: VisitCorrection | null, simulated: boolean) => void;
}) {
  const { visits } = useCommands();
  const id = useId();
  const panelRef = useRef<HTMLDivElement>(null);
  /** The current press started on the dimmed background (not in the panel). */
  const pressOnBackdrop = useRef(false);
  const fieldRef = useRef<HTMLSelectElement>(null);
  const valueRef = useRef<HTMLInputElement & HTMLTextAreaElement & HTMLSelectElement>(null);
  const reasonRef = useRef<HTMLTextAreaElement>(null);
  const [field, setField] = useState<CorrectableVisitField | "">("");
  const [draft, setDraft] = useState("");
  const [reason, setReason] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; target: Target } | null>(null);
  const titleId = `${id}-title`;
  const subId = `${id}-sub`;
  const errorId = `${id}-error`;
  const ruleId = `${id}-rule`;
  const valueHintId = `${id}-value-hint`;

  function close() {
    if (busy) return;
    onClose();
  }

  const onKeyDown = useEffectEvent((e: KeyboardEvent) => {
    if (e.key === "Escape") {
      e.preventDefault();
      close();
      return;
    }
    const panel = panelRef.current;
    if (e.key !== "Tab" || !panel) return;
    const items = [...panel.querySelectorAll<HTMLElement>(FOCUSABLE)];
    const first = items[0];
    const last = items[items.length - 1];
    const active = document.activeElement;
    if (!first || !last) {
      e.preventDefault();
      panel.focus();
    } else if (e.shiftKey && (active === first || active === panel)) {
      e.preventDefault();
      last.focus();
    } else if (!e.shiftKey && active === last) {
      e.preventDefault();
      first.focus();
    }
  });

  /** Focus that leaves the open dialog comes back to it. */
  const onFocusIn = useEffectEvent((e: FocusEvent) => {
    const panel = panelRef.current;
    if (!panel || !(e.target instanceof Node) || panel.contains(e.target)) return;
    panel.focus({ preventScroll: true });
  });

  useEffect(() => {
    fieldRef.current?.focus();
    const keydown = (e: KeyboardEvent) => onKeyDown(e);
    const focusin = (e: FocusEvent) => onFocusIn(e);
    document.addEventListener("keydown", keydown);
    document.addEventListener("focusin", focusin);
    return () => {
      document.removeEventListener("keydown", keydown);
      document.removeEventListener("focusin", focusin);
    };
  }, []);

  function fail(text: string, target: Target) {
    setError({ text, target });
    if (target === "field") fieldRef.current?.focus();
    else if (target === "value") valueRef.current?.focus();
    else if (target === "reason") reasonRef.current?.focus();
  }

  function choose(next: CorrectableVisitField | "") {
    setField(next);
    setDraft(next ? draftOf(next, history.current[next]) : "");
    setError(null);
  }

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!field) {
      fail("יש לבחור שדה לתיקון", "field");
      return;
    }
    const newValue = valueOf(field, draft);
    const valueError = correctionValueError(field, newValue);
    if (valueError) {
      fail(valueError, "value");
      return;
    }
    if (sameValue(history.current[field], newValue)) {
      fail("אין שינוי לשמור", "value");
      return;
    }
    if (!reason.trim()) {
      fail("יש לכתוב סיבה לתיקון", "reason");
      return;
    }
    const input: VisitCorrectionInput = {
      visitRef: { req: history.req, n: history.n },
      field,
      newValue,
      reason: reason.trim(),
      expectedVersion: history.version,
    };
    const inputError = visitCorrectionInputError(input);
    if (inputError) {
      fail(inputError, reason.trim().length > CORRECTION_REASON_MAX ? "reason" : null);
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    let saved: { correction: VisitCorrection | null; simulated: boolean } | null = null;
    try {
      const r = await visits.correct(input);
      if (r.ok) saved = { correction: r.data?.correction ?? null, simulated: r.simulated };
      else failure = r.error;
    } catch {
      failure = SAVE_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure || !saved) {
      // About the whole correction (version, permission, server): it describes the form.
      fail(failure ?? SAVE_FAILED, null);
      fieldRef.current?.focus();
      return;
    }
    onSaved(saved.correction, saved.simulated);
  }

  /** aria-invalid and the error id on the control the error is about, after its own hint. */
  const invalid = (target: Target, hint?: string) => {
    const on = error?.target === target;
    const describedBy = [hint, on ? errorId : undefined].filter(Boolean).join(" ");
    return { ...(on ? { "aria-invalid": true as const } : {}), ...(describedBy ? { "aria-describedby": describedBy } : {}) };
  };
  const time = field !== "" && TIME_CORRECTION_FIELDS.includes(field);
  const original = field ? history.original[field] : null;
  const current = field ? history.current[field] : null;
  const valueLabel = time ? "השעה המתוקנת" : "הערך המתוקן";
  const reasonOptions = field === "followupReason" && typeof current === "string" && current && !reasons.includes(current) ? [current, ...reasons] : reasons;
  /** Something was chosen or typed: only Escape, ✕ and "ביטול" close the dialog then. */
  const dirty = field !== "" || reason !== "";

  return createPortal(
    <div
      className="drawer-bg"
      onPointerDown={(e) => {
        pressOnBackdrop.current = e.target === e.currentTarget;
      }}
      onClick={(e) => {
        const fromBackdrop = pressOnBackdrop.current && e.target === e.currentTarget;
        pressOnBackdrop.current = false;
        if (fromBackdrop && !dirty) close();
      }}
    >
      <div
        ref={panelRef}
        className="drawer vc-dialog"
        role="dialog"
        aria-modal="true"
        aria-labelledby={titleId}
        aria-describedby={subId}
        tabIndex={-1}
      >
        <div className="dh">
          <div style={{ minWidth: 0 }}>
            <div id={subId} className="sub">
              {title}
            </div>
            <h2 id={titleId} className="vc-dialog-title">
              תיקון ביקור סגור
            </h2>
          </div>
          <button type="button" className="xbtn" aria-label="סגירה" onClick={close} disabled={busy}>
            <span aria-hidden="true">✕</span>
          </button>
        </div>
        <form className="vc-form" noValidate onSubmit={(e) => void submit(e)} aria-describedby={error && !error.target ? `${ruleId} ${errorId}` : ruleId}>
          <div className="db">
            <p id={ruleId} className="note vc-p">
              התיקון נרשם ביומן הביקורת עם הסיבה, ומי ומתי. הערך המקורי נשמר ונשאר גלוי. נוסח האישור שנחתם, שם החותם והחתימה לא
              ניתנים לתיקון.
            </p>
            <label className="vc-label">
              שדה לתיקון
              <select ref={fieldRef} value={field} onChange={(e) => choose(e.target.value as CorrectableVisitField | "")} disabled={busy} {...invalid("field")}>
                <option value="">בחירת שדה</option>
                {history.correctable.map((f) => (
                  <option key={f} value={f}>
                    {CORRECTABLE_FIELD_LABELS[f]}
                  </option>
                ))}
              </select>
            </label>

            {field && (
              <>
                <div className="kv vc-kv">
                  <span>{time ? "דיווח מהמכשיר" : "המקור מהטכנאי"}</span>
                  <span>
                    <ReviewValueText value={original} />
                  </span>
                  {!sameValue(original, current) && (
                    <>
                      <span>הערך הנוכחי</span>
                      <span>
                        <ReviewValueText value={current} />
                      </span>
                    </>
                  )}
                </div>

                <label className="vc-label">
                  {valueLabel}
                  {field === "followupReason" ? (
                    <select
                      ref={valueRef}
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        if (error) setError(null);
                      }}
                      disabled={busy}
                      {...invalid("value")}
                    >
                      {reasonOptions.map((r) => (
                        <option key={r} value={r} disabled={!reasons.includes(r)}>
                          {reasons.includes(r) ? r : `${r} (לא פעילה)`}
                        </option>
                      ))}
                    </select>
                  ) : time ? (
                    <input
                      ref={valueRef}
                      type="time"
                      step={60}
                      dir="ltr"
                      value={draft}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        if (error) setError(null);
                      }}
                      disabled={busy}
                      {...invalid("value", valueHintId)}
                    />
                  ) : (
                    <textarea
                      ref={valueRef}
                      rows={field === "parts" ? 4 : 5}
                      value={draft}
                      maxLength={field === "summary" ? SUMMARY_MAX : field === "nextNote" ? NEXT_NOTE_MAX : undefined}
                      onChange={(e) => {
                        setDraft(e.target.value);
                        if (error) setError(null);
                      }}
                      disabled={busy}
                      {...invalid("value", field === "parts" ? valueHintId : undefined)}
                    />
                  )}
                </label>
                {field === "parts" && (
                  <p id={valueHintId} className="sub vc-p">
                    חלק אחד בכל שורה · עד {PARTS_MAX} חלפים, עד {PART_MAX} תווים לחלק.
                  </p>
                )}
                {time && (
                  <p id={valueHintId} className="sub vc-p">
                    התיקון נשמר כדיווח זמן חדש. הדיווח מהמכשיר לא נמחק.
                  </p>
                )}
                {time && impossibleSequence(history, field, draft) && (
                  <p className="vc-warn" role="note">
                    סדר הזמנים לא סביר (יציאה, הגעה, סיום). רצף כזה מסומן לבדיקה ולא נדחה.
                  </p>
                )}
              </>
            )}

            <label className="vc-label">
              <span>
                סיבת התיקון <span className="sub">(חובה)</span>
              </span>
              <textarea
                ref={reasonRef}
                rows={3}
                value={reason}
                maxLength={CORRECTION_REASON_MAX}
                required
                onChange={(e) => {
                  setReason(e.target.value);
                  if (error) setError(null);
                }}
                disabled={busy}
                {...invalid("reason")}
              />
            </label>
          </div>
          <div className="df">
            <button type="submit" className="btn pri" disabled={busy}>
              {busy ? "שומר…" : "שמירת התיקון"}
            </button>
            <button type="button" className="btn" onClick={close} disabled={busy}>
              ביטול
            </button>
            {error && (
              <span id={errorId} role="alert" className="set-err vc-err">
                {error.text}
              </span>
            )}
          </div>
        </form>
      </div>
    </div>,
    document.body,
  );
}
