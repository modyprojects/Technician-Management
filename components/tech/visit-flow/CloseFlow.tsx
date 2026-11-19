"use client";

// Close screen skeleton (D81; TE-18 to TE-22, D43, D60 (2)): two outcomes only. "✓ טופל": the fixed
// approval text, the signer's name and the signature (SignaturePad). "↻ המשך טיפול": a reason from
// the Settings list and "מה צריך בביקור הבא", no signature. The send button stays disabled until
// the form is complete and lists what is missing. Fake data only: sending records nothing (the
// real flow calls close_visit, Migration 7) and shows the confirmation with "חזרה להיום"; it never
// claims an email was sent (TE-23). No recorded times (D68).
import Link from "next/link";
import { useEffect, useId, useRef, useState, type CSSProperties, type ReactNode } from "react";
import { SignaturePad } from "@/components/tech/SignaturePad";
import { TechShell } from "@/components/tech/TechShell";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { H2, Req } from "./VisitParts";

type Outcome = "done" | "cont";

const OUTCOMES: readonly { value: Outcome; label: string; note: string }[] = [
  { value: "done", label: "✓ טופל", note: "הקריאה תיסגר" },
  { value: "cont", label: "↻ המשך טיפול", note: "חוזר למשרד" },
];

const chosen = (o: Outcome): CSSProperties => {
  const s = VISIT_STATUSES[o];
  return { borderColor: s.c, background: s.bg, color: s.fg };
};

function Sent({ outcome, homeHref }: { outcome: Outcome; homeHref: string }) {
  const ref = useRef<HTMLHeadingElement>(null);
  useEffect(() => ref.current?.focus(), []);
  const s = VISIT_STATUSES[outcome];
  return (
    <section className="card" style={{ padding: "16px 14px", display: "flex", flexDirection: "column", gap: 10, borderColor: s.c }}>
      <h2 ref={ref} tabIndex={-1} style={{ fontSize: 18, color: s.fg }}>
        הביקור נסגר · {outcome === "done" ? "✓ טופל" : "↻ המשך טיפול"}
      </h2>
      <div style={{ fontSize: 14, lineHeight: 1.5 }}>
        {outcome === "done" ? "הקריאה נסגרה. הביקור עבר להושלמו היום." : "הקריאה נשארת פתוחה במשרד. הביקור עבר להושלמו היום."}
      </div>
      <Link href={homeHref} className="btn" style={{ height: 44, display: "flex", alignItems: "center", justifyContent: "center" }}>
        חזרה להיום
      </Link>
    </section>
  );
}

export function CloseFlow({
  head,
  approvalText,
  reasons,
  homeHref,
}: {
  head: ReactNode;
  approvalText: string;
  reasons: readonly string[];
  homeHref: string;
}) {
  const [outcome, setOutcome] = useState<Outcome | null>(null);
  const [signer, setSigner] = useState("");
  const [signature, setSignature] = useState<string | null>(null);
  const [reason, setReason] = useState<string | null>(null);
  const [nextNote, setNextNote] = useState("");
  const [sent, setSent] = useState(false);
  const outcomeTitle = useId();
  const reasonTitle = useId();
  const signerId = useId();
  const noteId = useId();
  const hintId = useId();

  if (sent && outcome) {
    return (
      <TechShell head={head}>
        <TestDataBanner />
        <Sent outcome={outcome} homeHref={homeHref} />
      </TechShell>
    );
  }

  const missing: string[] = !outcome
    ? ["תוצאה"]
    : outcome === "done"
      ? [!signer.trim() && "שם החותם", !signature && "חתימת הלקוח"].filter((x): x is string => Boolean(x))
      : [!reason && "סיבה", !nextNote.trim() && "מה צריך בביקור הבא"].filter((x): x is string => Boolean(x));
  const ready = missing.length === 0;
  const sendLabel = outcome === "done" ? "שליחה · הקריאה טופלה" : outcome === "cont" ? "שליחה · המשך טיפול" : "בחר תוצאה";

  const foot = (
    <div style={{ display: "flex", flexDirection: "column", gap: 6 }}>
      <button
        type="button"
        className="bigbtn"
        disabled={!ready}
        aria-describedby={ready ? undefined : hintId}
        style={outcome ? { background: VISIT_STATUSES[outcome].c } : undefined}
        onClick={() => setSent(true)}
      >
        {sendLabel}
      </button>
      {!ready && (
        <div id={hintId} className="sub" style={{ textAlign: "center" }}>
          חסר: {missing.join(" · ")}
        </div>
      )}
    </div>
  );

  return (
    <TechShell head={head} foot={foot}>
      <TestDataBanner />
      <h2 id={outcomeTitle} style={H2}>
        מה התוצאה של הביקור? <Req />
      </h2>
      <div role="group" aria-labelledby={outcomeTitle} style={{ display: "grid", gridTemplateColumns: "repeat(2, minmax(0, 1fr))", gap: 10 }}>
        {OUTCOMES.map((o) => (
          <button key={o.value} type="button" className="res" aria-pressed={outcome === o.value} onClick={() => setOutcome(o.value)} style={outcome === o.value ? chosen(o.value) : undefined}>
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
          <input id={signerId} value={signer} placeholder="שם הלקוח" maxLength={120} autoComplete="off" aria-required="true" onChange={(e) => setSigner(e.target.value)} />
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

      {outcome === "cont" && (
        <section className="card" aria-label="המשך טיפול" style={{ padding: "12px 14px", display: "flex", flexDirection: "column", gap: 8 }}>
          <h2 id={reasonTitle} style={{ ...H2, fontSize: 13 }}>
            סיבה <Req />
          </h2>
          <div role="group" aria-labelledby={reasonTitle} style={{ display: "flex", flexDirection: "column", gap: 8 }}>
            {reasons.map((r) => (
              <button key={r} type="button" className={reason === r ? "reason on" : "reason"} aria-pressed={reason === r} onClick={() => setReason(r)}>
                {r}
                {reason === r && " ✓"}
              </button>
            ))}
          </div>
          <label htmlFor={noteId} style={{ fontSize: 13, fontWeight: 700, marginTop: 4 }}>
            מה צריך בביקור הבא <Req />
          </label>
          <textarea id={noteId} rows={3} maxLength={1000} placeholder="מה להביא, מה לבדוק, עם מי לתאם" aria-required="true" value={nextNote} onChange={(e) => setNextNote(e.target.value)} style={{ width: "100%", display: "block" }} />
          <div className="sub">ללא חתימה. המנהל ותיבת שירות הלקוחות יקבלו מייל עם פרטי הקריאה, הסטטוס והסיבה.</div>
        </section>
      )}
    </TechShell>
  );
}
