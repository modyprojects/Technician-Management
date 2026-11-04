"use client";

// Technician close screen body (docs/demo.html techClose(), L579-602; TE-18 to TE-22): the
// outcome ("✓ טופל" / "↻ המשך טיפול"); for "טופל" the approval text, signer name and signature;
// for "המשך טיפול" the follow-up reason, "מה צריך בביקור הבא" (TE-21) and who gets the email
// (TE-22, D09). The send button is CloseFooter (same visit draft). After a successful close the
// body shows the result as the command reported it (TE-23: never claims a save or an email that
// did not happen); leaving the screen then forgets the draft, as the demo's sendClose() does.
import Link from "next/link";
import { useEffect, useId, useRef, type CSSProperties } from "react";
import type { ApprovalText } from "@/features/reference/data/types";
import type { VisitRef } from "@/features/visits/data/types";
import { NEXT_NOTE_MAX, SIGNER_MAX } from "@/features/visits/data/validate";
import { SignaturePad } from "./SignaturePad";
import {
  clearVisitDraft,
  isVisitDraftSent,
  useVisitDraft,
  withClose,
  workHint,
  workReady,
  type CloseDraft,
  type CloseOutcome,
  type VisitDraft,
  type WorkSeed,
} from "./WorkDraft";

const Req = () => (
  <span style={{ color: "var(--danger)" }} aria-hidden="true">
    *
  </span>
);

const OUTCOMES: readonly { value: CloseOutcome; label: string; note: string }[] = [
  { value: "done", label: "✓ טופל", note: "הקריאה תיסגר" },
  { value: "cont", label: "↻ המשך טיפול", note: "חוזר למשרד" },
];

/** The chosen outcome tile (demo: inline border, background and text colour). */
const OUTCOME_STYLE: Record<CloseOutcome, CSSProperties> = {
  done: { borderColor: "var(--s-done)", background: "var(--s-done-bg)", color: "var(--s-done-fg)" },
  cont: { borderColor: "var(--s-cont)", background: "var(--s-cont-bg)", color: "var(--s-cont-fg)" },
};

/** A form change: clears an earlier send error. */
const edit = (d: VisitDraft, patch: Partial<CloseDraft>): VisitDraft =>
  withClose(d, d.close.submit.state === "error" ? { ...patch, submit: { state: "idle" } } : patch);

function CloseDone({ outcome, simulated, message }: { outcome: CloseOutcome; simulated: boolean; message: string }) {
  const titleRef = useRef<HTMLHeadingElement>(null);
  useEffect(() => {
    titleRef.current?.focus();
  }, []);
  const done = outcome === "done";
  return (
    <section
      className="card"
      style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 8, borderColor: done ? "var(--s-done)" : "var(--s-cont)" }}
    >
      <h2 ref={titleRef} tabIndex={-1} style={{ fontSize: 18, color: done ? "var(--s-done-fg)" : "var(--s-cont-fg)" }}>
        סיום הביקור · {done ? "✓ טופל" : "↻ המשך טיפול"}
      </h2>
      {simulated ? (
        <>
          <div>
            <span className="pill" style={{ background: "var(--warn-bg)", color: "var(--warn-fg)" }}>
              🧪 {message || "פעולה מדומה · לא נשמר"}
            </span>
          </div>
          <div style={{ fontSize: 14, lineHeight: 1.5 }}>בהדגמה שום דבר לא נשמר ולא נשלח מייל.</div>
          <div className="sub" style={{ lineHeight: 1.5 }}>
            באפליקציה הסיום נשמר קודם במכשיר ונשלח לשרת. רק אחרי שהשרת מאשר את הקבלה יישלח מייל למנהל ולתיבת שירות הלקוחות.
          </div>
        </>
      ) : (
        message && <div style={{ fontSize: 14 }}>{message}</div>
      )}
    </section>
  );
}

export function CloseScreen({
  visit,
  seed,
  reasons,
  approvalText,
  workHref,
}: {
  visit: VisitRef;
  /** The visit's saved work, so the draft starts the same as on the work screen. */
  seed: WorkSeed;
  /** Active follow-up reasons (reference.reasons()), in Settings order. */
  reasons: readonly string[];
  /** The "טופל" text shown above the signature (reference.approvalText(), D43). */
  approvalText: Pick<ApprovalText, "versionId" | "text">;
  workHref: string;
}) {
  const [draft, update] = useVisitDraft(visit, seed);
  const k = draft.close;
  const signerId = useId();
  const noteId = useId();
  const reasonTitleId = useId();
  const outcomeTitleId = useId();

  // After a successful close, leaving the screen forgets the visit's draft.
  useEffect(() => () => {
    if (isVisitDraftSent(visit)) clearVisitDraft(visit);
  }, [visit]);

  if (k.submit.state === "sent") {
    return <CloseDone outcome={k.submit.outcome} simulated={k.submit.simulated} message={k.submit.message} />;
  }

  return (
    <>
      {!workReady(draft) && (
        <section className="card" style={{ padding: "10px 14px", background: "var(--warn-bg)", borderColor: "var(--warn-bd)" }}>
          <div style={{ fontSize: 12, color: "var(--warn-fg)", fontWeight: 700 }}>לפני הסיום</div>
          <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8, color: "var(--warn-ink)", fontSize: 14 }}>
            <span>{workHint(draft)}</span>
            <Link href={workHref} className="lnk" style={{ fontSize: 13, whiteSpace: "nowrap" }}>
              לטיפול ›
            </Link>
          </div>
        </section>
      )}
      <b id={outcomeTitleId} style={{ fontSize: 14 }}>
        מה התוצאה של הביקור? <Req />
      </b>
      <div role="group" aria-labelledby={outcomeTitleId} style={{ display: "grid", gridTemplateColumns: "1fr 1fr", gap: 10 }}>
        {OUTCOMES.map((o) => (
          <button
            key={o.value}
            type="button"
            className="res"
            aria-pressed={k.outcome === o.value}
            onClick={() => update((d) => edit(d, { outcome: o.value }))}
            style={k.outcome === o.value ? OUTCOME_STYLE[o.value] : undefined}
          >
            {o.label}
            <small>{o.note}</small>
          </button>
        ))}
      </div>

      {k.outcome === "done" && (
        <section className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }} aria-label="אישור הלקוח">
          <div style={{ background: "var(--s-done-bg)", color: "var(--s-done-fg)", borderRadius: 10, padding: "10px 12px", fontWeight: 700, lineHeight: 1.4 }}>
            &quot;{approvalText.text}&quot;
          </div>
          <label htmlFor={signerId} style={{ fontSize: 13, fontWeight: 700 }}>
            שם החותם <Req />
          </label>
          <input
            id={signerId}
            value={k.signer}
            placeholder="שם הלקוח"
            maxLength={SIGNER_MAX}
            autoComplete="off"
            aria-required="true"
            onChange={(e) => {
              const signer = e.target.value;
              update((d) => edit(d, { signer }));
            }}
          />
          <SignaturePad
            value={k.signature}
            onChange={(signature) => update((d) => edit(d, { signature }))}
            label={
              <>
                חתימת הלקוח <Req />
              </>
            }
          />
        </section>
      )}

      {k.outcome === "cont" && (
        <section className="card" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }} aria-label="המשך טיפול">
          <b id={reasonTitleId} style={{ fontSize: 13 }}>
            סיבה <Req />
          </b>
          <div role="group" aria-labelledby={reasonTitleId} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reasons.map((r) => (
              <button
                key={r}
                type="button"
                className={k.reason === r ? "reason on" : "reason"}
                aria-pressed={k.reason === r}
                onClick={() => update((d) => edit(d, { reason: r }))}
              >
                {r}
                {k.reason === r && " ✓"}
              </button>
            ))}
          </div>
          {reasons.length === 0 && <div className="sub">אין סיבות פעילות בהגדרות</div>}
          <label htmlFor={noteId} style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
            מה צריך בביקור הבא <Req />
          </label>
          <textarea
            id={noteId}
            rows={3}
            style={{ width: "100%", display: "block" }}
            maxLength={NEXT_NOTE_MAX}
            placeholder="מה להביא, מה לבדוק, עם מי לתאם"
            aria-required="true"
            value={k.nextNote}
            onChange={(e) => {
              const nextNote = e.target.value;
              update((d) => edit(d, { nextNote }));
            }}
          />
          <div className="sub">ללא חתימה. המנהל ותיבת שירות הלקוחות יקבלו מייל עם פרטי הקריאה, הסטטוס והסיבה.</div>
        </section>
      )}

      {!k.outcome && <div className="empty">בחר תוצאה כדי להמשיך</div>}
    </>
  );
}
