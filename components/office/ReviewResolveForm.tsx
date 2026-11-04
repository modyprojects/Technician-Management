"use client";

// The decision form of an open "פריטים לבדיקה" item (D44): apply the submitted change, keep the
// system's value, or choose per field where the item offers it; a decision note, required where
// the item says so (D14: a change to a server-closed or cancelled visit is audited with its
// reason). Runs useCommands().review.resolve with the item version it started from (D44); both
// versions stay stored whatever is decided.
// - Per field: a field that only one side changed is pre-selected to the changed side (D44: merge
//   automatically only when it is safe); a field in conflict has no default and must be chosen.
// - Checks run before the command with the shared validator (reviewResolveInputError) and the
//   item's own rules, so a missing choice or note gets an inline error (aria-invalid, focus on the
//   control) instead of a toast.
// - A simulated result shows the decision marked "לא נשמר · פעולה מדומה" and says the item stays
//   open (nothing was stored); a stored result refreshes the page from the server.
import { useRouter } from "next/navigation";
import { useEffect, useId, useRef, useState, type FormEvent } from "react";
import { useCommands } from "@/features/data-access/commands-context";
import {
  REVIEW_DECISION_LABELS,
  REVIEW_NOTE_MAX,
  type ReviewDecision,
  type ReviewField,
  type ReviewFieldChoice,
  type ReviewItemDetail,
  type ReviewResolveInput,
} from "@/features/review/data/types";
import { reviewResolveInputError } from "@/features/review/data/validate";
import { reviewDecisionHint, reviewValueExcerpt, type ReviewVersionLabels } from "./ReviewParts";
import { SettingsNotSaved } from "./SettingsShell";

const SAVE_FAILED = "ההחלטה לא נשמרה. נסה שוב.";

const same = (a: unknown, b: unknown): boolean => JSON.stringify(a) === JSON.stringify(b);

/** The safe default of a field that is not in conflict: the side that changed it. */
function defaultChoice(f: ReviewField): ReviewFieldChoice | undefined {
  if (f.conflict) return undefined;
  if (!same(f.incoming, f.base) && same(f.current, f.base)) return "incoming";
  return "current";
}

type ErrorTarget = "decision" | "note" | { field: string } | null;

type Result = {
  simulated: boolean;
  decision: ReviewDecision;
  choices: Readonly<Record<string, ReviewFieldChoice>> | null;
  note: string;
};

export function ReviewResolveForm({ item, labels }: { item: ReviewItemDetail; labels: ReviewVersionLabels }) {
  const { review } = useCommands();
  const router = useRouter();
  const id = useId();
  const choosable = item.fields.filter((f) => f.choosable);
  const [decision, setDecision] = useState<ReviewDecision | null>(null);
  const [choices, setChoices] = useState<Readonly<Record<string, ReviewFieldChoice>>>(() =>
    Object.fromEntries(choosable.flatMap((f) => {
      const c = defaultChoice(f);
      return c ? [[f.key, c] as const] : [];
    })),
  );
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<{ text: string; target: ErrorTarget } | null>(null);
  const [result, setResult] = useState<Result | null>(null);
  const decisionRef = useRef<HTMLInputElement>(null);
  const noteRef = useRef<HTMLTextAreaElement>(null);
  const fieldRefs = useRef(new Map<string, HTMLInputElement>());
  const resultRef = useRef<HTMLDivElement>(null);
  const errorId = `${id}-error`;
  const noteHintId = `${id}-note-hint`;
  const emailHintId = `${id}-email`;

  useEffect(() => {
    if (result) resultRef.current?.focus();
  }, [result]);

  function fail(text: string, target: ErrorTarget) {
    setError({ text, target });
    if (target === "decision") decisionRef.current?.focus();
    else if (target === "note") noteRef.current?.focus();
    else if (target) fieldRefs.current.get(target.field)?.focus();
  }

  const invalid = (target: Exclude<ErrorTarget, null>): boolean => {
    const t = error?.target;
    if (!t) return false;
    if (typeof t === "string" || typeof target === "string") return t === target;
    return t.field === target.field;
  };

  async function submit(event: FormEvent<HTMLFormElement>) {
    event.preventDefault();
    if (busy) return;
    if (!decision) {
      fail("יש לבחור החלטה", "decision");
      return;
    }
    if (decision === "per-field") {
      const missing = choosable.find((f) => choices[f.key] === undefined);
      if (missing) {
        fail(missing.conflict ? "יש לבחור ערך לכל שדה בהתנגשות" : "יש לבחור ערך לכל שדה", { field: missing.key });
        return;
      }
    }
    const trimmed = note.trim();
    if (item.noteRequired && !trimmed) {
      fail("יש לכתוב הערת החלטה", "note");
      return;
    }
    const input: ReviewResolveInput = {
      id: item.id,
      expectedVersion: item.version,
      decision,
      ...(decision === "per-field" ? { fields: { ...choices } } : {}),
      ...(trimmed ? { note: trimmed } : {}),
    };
    const inputError = reviewResolveInputError(input);
    if (inputError) {
      fail(inputError, trimmed.length > REVIEW_NOTE_MAX ? "note" : null);
      return;
    }
    setBusy(true);
    setError(null);
    let failure: string | null = null;
    let simulated = false;
    try {
      const r = await review.resolve(input);
      if (r.ok) simulated = r.simulated;
      else failure = r.error;
    } catch {
      failure = SAVE_FAILED;
    } finally {
      setBusy(false);
    }
    if (failure) {
      // About the whole decision (version, permission, server): it describes the form.
      fail(failure, null);
      decisionRef.current?.focus();
      return;
    }
    setResult({ simulated, decision, choices: decision === "per-field" ? { ...choices } : null, note: trimmed });
    if (!simulated) router.refresh();
  }

  if (result) {
    const headingId = `${id}-result`;
    return (
      <div ref={resultRef} tabIndex={-1} className="rv-result" aria-labelledby={headingId}>
        <h3 id={headingId} className="rv-result-h">
          ההחלטה שנבחרה {result.simulated && <SettingsNotSaved />}
        </h3>
        <div className="kv">
          <span>החלטה</span>
          <span>{REVIEW_DECISION_LABELS[result.decision]}</span>
          {result.choices &&
            choosable.map((f) => (
              <ChoiceLine key={f.key} label={f.label} choice={result.choices?.[f.key]} labels={labels} />
            ))}
          <span>הערה</span>
          <span>{result.note ? <bdi>{result.note}</bdi> : "ללא הערה"}</span>
        </div>
        <p className="sub rv-result-p">
          {result.simulated
            ? "בהדגמה ההחלטה לא נשמרת: הפריט נשאר פתוח ברשימה, ושתי הגרסאות נשארות כפי שהיו."
            : "ההחלטה נשמרה. שתי הגרסאות נשמרות עם הפריט."}
        </p>
        {result.simulated && item.completionEmailKey && result.decision === "apply-incoming" && (
          <p className="sub rv-result-p">בהדגמה מייל הסיום לא נכנס לתור ולא נשלח.</p>
        )}
      </div>
    );
  }

  const describedBy = (target: Exclude<ErrorTarget, null>, extra?: string) =>
    [extra, invalid(target) ? errorId : undefined].filter(Boolean).join(" ") || undefined;

  return (
    <form className="rv-form" noValidate onSubmit={(e) => void submit(e)} aria-describedby={error && !error.target ? errorId : undefined}>
      <fieldset
        className="rv-fs"
        role="radiogroup"
        aria-labelledby={`${id}-decision-legend`}
        aria-describedby={describedBy("decision")}
        aria-invalid={invalid("decision") || undefined}
      >
        <legend id={`${id}-decision-legend`}>החלטה</legend>
        {item.decisions.map((d, i) => (
          <label key={d} className="rv-opt">
            <input
              ref={i === 0 ? decisionRef : undefined}
              type="radio"
              name={`${id}-decision`}
              value={d}
              checked={decision === d}
              disabled={busy}
              onChange={() => {
                setDecision(d);
                if (error) setError(null);
              }}
            />
            <span>
              <b>{REVIEW_DECISION_LABELS[d]}</b>
              <span className="sub rv-opt-hint">{reviewDecisionHint(d, item)}</span>
            </span>
          </label>
        ))}
      </fieldset>

      {decision === "per-field" && (
        <fieldset className="rv-fs">
          <legend>בחירה לפי שדה</legend>
          {choosable.map((f) => {
            const target = { field: f.key };
            return (
              <fieldset
                key={f.key}
                className="rv-fs rv-fs-field"
                role="radiogroup"
                aria-labelledby={`${id}-legend-${f.key}`}
                aria-invalid={invalid(target) || undefined}
                aria-describedby={describedBy(target)}
              >
                <legend id={`${id}-legend-${f.key}`}>
                  {f.label}{" "}
                  {f.conflict ? (
                    <span className="pill rv-conflict">התנגשות</span>
                  ) : (
                    <span className="sub">{same(f.current, f.incoming) ? "· ללא הבדל" : "· השתנה רק בצד אחד"}</span>
                  )}
                </legend>
                {(["current", "incoming"] as const).map((c, i) => (
                  <label key={c} className="rv-opt">
                    <input
                      ref={
                        i === 0
                          ? (el) => {
                              if (el) fieldRefs.current.set(f.key, el);
                              else fieldRefs.current.delete(f.key);
                            }
                          : undefined
                      }
                      type="radio"
                      name={`${id}-field-${f.key}`}
                      value={c}
                      checked={choices[f.key] === c}
                      disabled={busy}
                      onChange={() => {
                        setChoices((prev) => ({ ...prev, [f.key]: c }));
                        if (error) setError(null);
                      }}
                    />
                    <span>
                      <b>{labels[c]}:</b> <bdi>{reviewValueExcerpt(f[c])}</bdi>
                    </span>
                  </label>
                ))}
              </fieldset>
            );
          })}
        </fieldset>
      )}

      {item.completionEmailKey && decision === "apply-incoming" && (
        <p id={emailHintId} className="note rv-email">
          מייל הסיום ייכנס לתור פעם אחת בלבד, למנהל ולתיבת שירות הלקוחות. מפתח ייחודי:{" "}
          <bdi dir="ltr" className="rv-code">
            {item.completionEmailKey}
          </bdi>
        </p>
      )}

      <label className="rv-note">
        <span>
          הערת החלטה <span className="sub">{item.noteRequired ? "(חובה)" : "(רשות)"}</span>
        </span>
        <textarea
          ref={noteRef}
          rows={3}
          value={note}
          maxLength={REVIEW_NOTE_MAX}
          disabled={busy}
          required={item.noteRequired}
          aria-invalid={invalid("note") || undefined}
          aria-describedby={describedBy("note", item.noteRequired ? noteHintId : undefined)}
          onChange={(e) => {
            setNote(e.target.value);
            if (error) setError(null);
          }}
        />
        {item.noteRequired && (
          <span id={noteHintId} className="sub">
            ההחלטה משנה ביקור שנסגר במערכת או שבוטל, ולכן נרשמת ביומן הביקורת עם ההערה.
          </span>
        )}
      </label>

      <div className="set-form-actions">
        <button type="submit" className="btn pri" disabled={busy}>
          {busy ? "שומר…" : "שמירת ההחלטה"}
        </button>
        {error && (
          <span id={errorId} role="alert" className="set-err">
            {error.text}
          </span>
        )}
      </div>
    </form>
  );
}

function ChoiceLine({ label, choice, labels }: { label: string; choice: ReviewFieldChoice | undefined; labels: ReviewVersionLabels }) {
  return (
    <>
      <span>{label}</span>
      <span>{choice ? `נשארת הגרסה ${labels[choice]}` : "—"}</span>
    </>
  );
}
