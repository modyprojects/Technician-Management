import Link from "next/link";
import { PinIcon } from "@/components/ui/Icons";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import type { TechDayVisit, VisitStatus } from "@/features/visits/data/types";
import { TimeRange } from "@/components/ui/TimeRange";

// Next-visit card on the technician home (docs/demo.html techHome() L489-496; TE-02, TE-33).
// Look as in the demo: accent border, "הביקור הבא" / "עכשיו" with the visit's time, status pill,
// customer (with "↻ ביקור המשך" on a follow-up visit), address and product, then the actions.
// "יוצא · Waze" appears only while the visit is scheduled ("שובצה"); it marks the visit "בדרך"
// (the caller runs the depart command) and, in production, opens Waze to the address (TE-02).
// "פרטי קריאה" is a real link to the visit card. From 600px both actions share the row 50/50
// (TE-33, styles/ui.css .next-actions); alone, "פרטי קריאה" spans the row.
// Additions: 🧪 badge on test calls (SIM-15) and an inline error when the action fails.
// Presentational: no data access. `status` is the caller's current (possibly optimistic) status,
// so a parent that owns state renders it from a client component.
// Real app (Step 3): `navigate` is a plain Waze link instead of the depart action ("ניווט · Waze"),
// for a screen with no departure writer: it opens Waze only and never claims a status change (G-06).
// NextVisitEmpty is the card's place when no visit is left (QA T-02: "a message when no visits remain").

export function NextVisitCard({
  visit,
  status = visit.status,
  detailsHref,
  onDepart,
  navigate,
  error,
}: {
  visit: TechDayVisit;
  /** Current status; defaults to the DTO's. */
  status?: VisitStatus;
  /** The visit card. */
  detailsHref: string;
  /** Runs "יוצא · Waze" (depart); the button shows only for a scheduled visit when this is given. */
  onDepart?: () => void;
  /**
   * A Waze link to the visit's address ("ניווט · Waze", navigation only), shown while the visit is
   * open, when no depart action is given.
   */
  navigate?: { href: string };
  /** Hebrew error of the last action, if it failed. */
  error?: string | null;
}) {
  const canDepart = status === "new" && onDepart !== undefined;
  const canNavigate = !canDepart && navigate !== undefined && (status === "new" || status === "go" || status === "work");
  const twoActions = canDepart || canNavigate;
  return (
    <section className="card" style={{ padding: 14, border: "2px solid var(--accent)" }} aria-label="הביקור הבא">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
          {status === "new" ? "הביקור הבא" : status === "go" || status === "work" ? "עכשיו" : "נסגר"} · <TimeRange start={visit.start} end={visit.end} />
        </span>
        <StatusPill status={status} />
      </div>
      <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 18, marginTop: 6 }}>
        {visit.customerName}
        {visit.isFollowUp && (
          <>
            {" "}
            <span className="pill" style={{ background: "var(--s-cont-bg)", color: "var(--s-cont-fg)" }}>
              ↻ ביקור המשך
            </span>
          </>
        )}
        {visit.isTest && (
          <>
            {" "}
            <TestPill />
          </>
        )}
      </div>
      <div className="sub">
        {visit.address} · {visit.productName}
      </div>
      <div className="next-actions">
        {canDepart && (
          <button
            type="button"
            className="bigbtn"
            style={{ height: 44, fontSize: 15, background: "var(--accent)" }}
            onClick={onDepart}
          >
            <PinIcon /> יוצא · Waze
          </button>
        )}
        {canNavigate && (
          <a
            href={navigate.href}
            target="_blank"
            rel="noopener noreferrer"
            className="bigbtn"
            aria-label={`ניווט ב-Waze אל ${visit.address}`}
            style={{ height: 44, fontSize: 15, background: "var(--accent)" }}
          >
            <PinIcon /> ניווט · Waze
          </a>
        )}
        <Link
          href={detailsHref}
          className="btn"
          aria-label={`פרטי קריאה · ${visit.customerName}`}
          style={{
            flex: 1,
            height: 44,
            display: "flex",
            alignItems: "center",
            justifyContent: "center",
            gridColumn: twoActions ? undefined : "1 / -1",
          }}
        >
          פרטי קריאה
        </Link>
      </div>
      {error && (
        <div role="alert" className="sub" style={{ color: "var(--danger)", marginTop: 8 }}>
          {error}
        </div>
      )}
    </section>
  );
}

/**
 * The next-visit card's place when no open visit is left today (QA T-02): every visit of the day was
 * completed, or none was scheduled. Same card look, no actions.
 */
export function NextVisitEmpty({ completed }: { completed: number }) {
  return (
    <section className="card" aria-label="הביקור הבא" style={{ padding: 14 }}>
      <div style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 16 }}>
        {completed > 0 ? "כל הביקורים של היום הושלמו" : "אין ביקורים מתוכננים להיום"}
      </div>
      <div className="sub" style={{ marginTop: 4 }}>
        {completed > 0 ? "ביקור חדש שישובץ לך יופיע כאן." : "ביקור שישובץ לך יופיע כאן."}
      </div>
    </section>
  );
}
