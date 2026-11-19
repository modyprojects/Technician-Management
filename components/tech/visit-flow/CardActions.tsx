"use client";

// The visit card's action area per status (skeleton, D81; TE-02, TE-13, D71):
// - "שובצה": "יוצא · Waze". D71: the departure is recorded first and Waze opens only after the
//   server confirms. In the skeleton nothing is recorded: the fixed fixture result is the failure,
//   so the button shows the inline status message, "נסה שוב" and "פתח Waze בכל זאת".
// - "בדרך": "הגעתי · התחלת טיפול" (records the arrival in the real flow), then the work screen.
// - "בטיפול": "המשך לטיפול ›" back to the work screen.
// Recorded times are never mentioned (D68).
import Link from "next/link";
import { useState } from "react";
import { PinIcon } from "@/components/ui/Icons";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";

const BIG = { height: 52, fontSize: 16 } as const;

export function DepartAction({ wazeHref, result }: { wazeHref: string | null; result: "offline" }) {
  const [failed, setFailed] = useState(false);
  const [busy, setBusy] = useState(false);

  // Skeleton: no request is made; the fixture's fixed result is shown after a short beat.
  const depart = () => {
    setBusy(true);
    window.setTimeout(() => {
      setBusy(false);
      setFailed(result === "offline");
    }, 300);
  };

  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 8 }}>
      {failed && (
        <div role="alert" className="card" style={{ padding: "10px 12px", background: "var(--warn-bg)", borderColor: "var(--warn-bd)", color: "var(--warn-ink)", fontSize: 14 }}>
          הסטטוס לא עודכן ל&apos;בדרך&apos;, אין חיבור. נסה שוב
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

export function ArriveAction({ workHref }: { workHref: string }) {
  return (
    <Link href={workHref} className="bigbtn" style={{ ...BIG, background: VISIT_STATUSES.work.c }}>
      הגעתי · התחלת טיפול
    </Link>
  );
}

export function ContinueWorkAction({ workHref }: { workHref: string }) {
  return (
    <Link href={workHref} className="bigbtn" style={{ ...BIG, background: VISIT_STATUSES.work.c }}>
      המשך לטיפול ›
    </Link>
  );
}
