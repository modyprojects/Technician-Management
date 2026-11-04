"use client";

// The visit card's status-driven parts (docs/demo.html techCall() L528 and L545-548):
// - the Waze tile: on a scheduled visit it runs useCommands().visits.depart ("בדרך", TE-02);
//   otherwise it only navigates (a data-sim affordance in the demo, a Waze deep link later);
// - the footer: "הגעתי · התחלת טיפול" runs useCommands().visits.arrive ("בטיפול", TE-13) and
//   then opens the work screen, as the demo does; on a visit in progress, "המשך לטיפול ›" is a
//   link to the work screen.
// The status lives in VisitStatusProvider (optimistic, reverted with an inline error on failure).
import Link from "next/link";
import { useRouter } from "next/navigation";
import { PinIcon } from "@/components/ui/Icons";
import { StatusPill } from "@/components/ui/StatusPill";
import type { VisitRef, VisitStatus } from "@/features/visits/data/types";
import { useVisitStatus } from "../../../../_VisitStatus";

export function WazeTile({ visit, status, address }: { visit: VisitRef; status: VisitStatus; address: string }) {
  const live = useVisitStatus(visit, status);
  const departs = live.status === "new";
  return (
    <button
      type="button"
      className="act"
      style={{ background: "var(--accent)", color: "var(--on-dark)", borderColor: "var(--accent)" }}
      aria-label={departs ? "Waze · יציאה ללקוח, הסטטוס יהיה בדרך" : "Waze · ניווט ללקוח"}
      data-sim={departs ? undefined : `ניווט ב-Waze אל ${address} · לא נפתח בהדגמה`}
      onClick={departs ? () => void live.depart() : undefined}
    >
      <PinIcon />
      Waze
    </button>
  );
}

export function VisitFoot({ visit, status, workHref }: { visit: VisitRef; status: VisitStatus; workHref: string }) {
  const live = useVisitStatus(visit, status);
  const router = useRouter();

  async function arrive() {
    if (await live.arrive()) router.push(workHref);
  }

  const error = live.error && (
    <div role="alert" className="sub" style={{ textAlign: "center", marginTop: 6, color: "var(--danger)" }}>
      {live.error}
    </div>
  );

  if (live.status === "new" || live.status === "go") {
    return (
      <>
        <button type="button" className="bigbtn" style={{ background: "var(--s-work)" }} onClick={() => void arrive()}>
          הגעתי · התחלת טיפול
        </button>
        <div className="sub" style={{ textAlign: "center", marginTop: 6 }}>
          {live.status === "new" ? "אפשר ללחוץ Waze קודם כדי לסמן \"בדרך\"" : "הסטטוס: בדרך ללקוח"}
        </div>
        {error}
      </>
    );
  }
  if (live.status === "work") {
    return (
      <>
        <Link className="bigbtn" href={workHref} style={{ background: "var(--s-work)" }}>
          המשך לטיפול ›
        </Link>
        {error}
      </>
    );
  }
  return (
    <div className="sub" style={{ textAlign: "center" }}>
      הביקור נסגר · <StatusPill status={live.status} />
    </div>
  );
}
