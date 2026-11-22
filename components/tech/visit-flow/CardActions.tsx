"use client";

// The visit card's action area per status (TE-02, TE-13, D71, D95 (d), (e)):
// - "שובצה": "יוצא · Waze". D71: the departure is recorded first (online, the server action) and
//   Waze opens only after the server confirms. On failure: the inline status message, "נסה שוב"
//   (the same operation id, so a lost answer is never recorded twice) and "פתח Waze בכל זאת".
// - "בדרך": "הגעתי · התחלת טיפול": saved on the device first (the work queue) and sent when there
//   is a connection; the work screen opens at once, also offline.
// - "בטיפול": "המשך לטיפול ›" back to the work screen.
// Recorded times are never mentioned (D68).
import { useState } from "react";
import { PinIcon } from "@/components/ui/Icons";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";

const BIG = { height: 52, fontSize: 16 } as const;

export type DepartOutcome = "ok" | "offline" | "refused";

export function DepartAction({ wazeHref, onDepart }: { wazeHref: string | null; onDepart: () => Promise<DepartOutcome> }) {
  const [failed, setFailed] = useState<DepartOutcome | null>(null);
  const [busy, setBusy] = useState(false);

  const depart = async () => {
    setBusy(true);
    setFailed(null);
    let outcome: DepartOutcome;
    try {
      outcome = await onDepart();
    } catch {
      outcome = "offline";
    }
    setBusy(false);
    if (outcome === "ok") {
      // Within the click's activation the browser lets Waze open; a blocked window leaves the
      // Waze tile, which now appears on the card (D95 (e)).
      if (wazeHref) window.open(wazeHref, "_blank", "noopener,noreferrer");
      return;
    }
    setFailed(outcome);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {failed && (
        <div role="alert" className="card" style={{ padding: "10px 12px", background: "var(--warn-bg)", borderColor: "var(--warn-bd)", color: "var(--warn-ink)", fontSize: 14 }}>
          {failed === "offline" ? <>הסטטוס לא עודכן ל&apos;בדרך&apos;, אין חיבור. נסה שוב</> : <>הסטטוס לא עודכן ל&apos;בדרך&apos;. רענן את המסך ונסה שוב</>}
          {wazeHref && (
            <div style={{ marginTop: 6 }}>
              <a className="lnk" href={wazeHref} target="_blank" rel="noopener noreferrer" style={{ fontSize: 13 }}>
                פתח Waze בכל זאת ›
              </a>
            </div>
          )}
        </div>
      )}
      <button type="button" className="bigbtn" style={{ ...BIG, background: "var(--accent)" }} onClick={depart} disabled={busy} aria-busy={busy}>
        <PinIcon /> {failed ? "נסה שוב · יוצא · Waze" : "יוצא · Waze"}
      </button>
    </div>
  );
}

export function ArriveAction({ onArrive, disabled }: { onArrive: () => void; disabled?: boolean }) {
  return (
    <button type="button" className="bigbtn" style={{ ...BIG, background: VISIT_STATUSES.work.c }} onClick={onArrive} disabled={disabled}>
      הגעתי · התחלת טיפול
    </button>
  );
}

export function ContinueWorkAction({ onContinue }: { onContinue: () => void }) {
  return (
    <button type="button" className="bigbtn" style={{ ...BIG, background: VISIT_STATUSES.work.c }} onClick={onContinue}>
      המשך לטיפול ›
    </button>
  );
}
