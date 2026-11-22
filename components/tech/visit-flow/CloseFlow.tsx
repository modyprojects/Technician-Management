"use client";

// Close screen (TE-18 to TE-22; D43, D60 (2), D95 (b), (c)): two outcomes only. "✓ טופל": the fixed
// Version 1 approval text (from the server; its sha256 is sent and checked by the database), the
// signer's name and the finger signature (PNG). "↻ המשך טיפול": an active continuation reason and
// "מה צריך בביקור הבא", no signature. Both carry the written summary from the work screen. The send
// button stays disabled until the form is complete and lists what is missing. Sending saves the
// closure on the device (the work queue, with its photos and signature) and returns at once; the
// queue sends it when there is a connection, so a closure is never lost to a "try again" (D95 (d)).
// It never claims an email was sent (TE-23). No recorded times (D68).
import { useId, useState, type CSSProperties, type ReactNode } from "react";
import { SignaturePad } from "@/components/tech/SignaturePad";
import { TechShell } from "@/components/tech/TechShell";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { closeMissing, NEXT_NOTES_MAX, SIGNER_MAX, type CloseOutcome } from "@/features/visit-flow/rules";
import { H2, Req } from "./VisitParts";

const OUTCOMES: readonly { value: CloseOutcome; look: "done" | "cont"; label: string; note: string }[] = [
  { value: "done", look: "done", label: "✓ טופל", note: "הקריאה תיסגר" },
  { value: "followup", look: "cont", label: "↻ המשך טיפול", note: "חוזר למשרד" },
];

const chosen = (look: "done" | "cont"): CSSProperties => {
  const s = VISIT_STATUSES[look];
  return { borderColor: s.c, background: s.bg, color: s.fg };
};

export type CloseSubmission =
  | { outcome: "done"; signer: string; signature: string }
  | { outcome: "followup"; reasonId: string; nextNotes: string };

export function CloseFlow({
  head,
  approvalText,
  reasons,
  isTest,
  syncPanel,
  onSubmit,
}: {
  head: ReactNode;
  approvalText: string;
  reasons: readonly { id: string; label: string }[];
  isTest: boolean;
  syncPanel: ReactNode;
  /** Saves the closure on the device; an error message when it could not be saved (the form stays). */
  onSubmit: (s: CloseSubmission) => Promise<string | null>;
}) {
  const [outcome, setOutcome] = useState<CloseOutcome | null>(null);
  const [signer, setSigner] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [reasonId, setReasonId] = useState<string | null>(null);
  const [nextNotes, setNextNotes] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const outcomeTitle = useId();
  const reasonTitle = useId();
  const signerId = useId();
  const noteId = useId();
  const hintId = useId();

  const missing = closeMissing({ outcome, signer, hasSignature: Boolean(signature), reasonId, nextNotes });
  const ready = missing.length === 0 && !busy;
  const look = outcome === "done" ? "done" : outcome === "followup" ? "cont" : null;
  const sendLabel = outcome === "done" ? "שליחה · הקריאה טופלה" : outcome === "followup" ? "שליחה · המשך טיפול" : "בחר תוצאה";

  const send = async () => {
    if (!outcome) return;
    setBusy(true);
    setError(null);
    const why =
      outcome === "done" && signature
        ? await onSubmit({ outcome, signer: signer.trim(), signature })
        : outcome === "followup" && reasonId
          ? await onSubmit({ outcome, reasonId, nextNotes: nextNotes.trim() })
          : "חסרים פרטים";
    setBusy(false);
    setError(why);
  };

  const foot = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      {error && (
        <div role="alert" className="sub" style={{ color: "var(--danger)", textAlign: "center" }}>
          {error}
        </div>
      )}
      <button type="button" className="bigbtn" disabled={!ready} aria-describedby={ready ? undefined : hintId} style={look ? { background: VISIT_STATUSES[look].c } : undefined} onClick={send}>
        {sendLabel}
      </button>
      {missing.length > 0 && (
        <div id={hintId} className="sub" style={{ textAlign: "center" }}>
          חסר: {missing.join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <TechShell head={head} foot={foot}>
      {isTest && <TestDataBanner />}
      {syncPanel}
      <h2 id={outcomeTitle} style={H2}>
        מה התוצאה של הביקור? <Req />
      </h2>
      <div role="group" aria-labelledby={outcomeTitle} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {OUTCOMES.map((o) => (
          <button key={o.value} type="button" className="res" aria-pressed={outcome === o.value} onClick={() => setOutcome(o.value)} style={outcome === o.value ? chosen(o.look) : undefined}>
            {o.label}
            <small>{o.note}</small>
          </button>
        ))}
      </div>

      {outcome === "done" && (
        <section className="card" aria-label="אישור הלקוח" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 10 }}>
          <div style={{ background: VISIT_STATUSES.done.bg, color: VISIT_STATUSES.done.fg, borderRadius: 10, padding: "10px 12px", fontWeight: 700, lineHeight: 1.4 }}>&quot;{approvalText}&quot;</div>
          <label htmlFor={signerId} style={{ fontSize: 13, fontWeight: 700 }}>
            שם החותם <Req />
          </label>
          <input id={signerId} value={signer} placeholder="שם הלקוח" maxLength={SIGNER_MAX} autoComplete="off" aria-required="true" onChange={(e) => setSigner(e.target.value)} />
          <SignaturePad
            value={signature}
            onChange={setSignature}
            label={
              <>
                חתימת הלקוח <Req />
              </>
            }
          />
        </section>
      )}

      {outcome === "followup" && (
        <section className="card" aria-label="המשך טיפול" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 id={reasonTitle} style={{ ...H2, fontSize: 13 }}>
            סיבה <Req />
          </h2>
          <div role="group" aria-labelledby={reasonTitle} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reasons.map((r) => (
              <button key={r.id} type="button" className={reasonId === r.id ? "reason on" : "reason"} aria-pressed={reasonId === r.id} onClick={() => setReasonId(r.id)}>
                {r.label}
                {reasonId === r.id && " ✓"}
              </button>
            ))}
          </div>
          <label htmlFor={noteId} style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
            מה צריך בביקור הבא <Req />
          </label>
          <textarea id={noteId} rows={3} maxLength={NEXT_NOTES_MAX} placeholder="מה להביא, מה לבדוק, עם מי לתאם" aria-required="true" value={nextNotes} onChange={(e) => setNextNotes(e.target.value)} style={{ width: "100%", display: "block" }} />
          <div className="sub">ללא חתימה. המנהל ותיבת שירות הלקוחות יקבלו מייל עם פרטי הקריאה, הסטטוס והסיבה.</div>
        </section>
      )}
    </TechShell>
  );
}
