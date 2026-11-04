import Link from "next/link";
import { PinIcon } from "@/components/ui/Icons";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import type { TechDayVisit, VisitStatus } from "@/features/visits/data/types";

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

export function NextVisitCard({
  visit,
  status = visit.status,
  detailsHref,
  onDepart,
  error,
}: {
  visit: TechDayVisit;
  /** Current status; defaults to the DTO's. */
  status?: VisitStatus;
  /** The visit card. */
  detailsHref: string;
  /** Runs "יוצא · Waze" (depart); the button shows only for a scheduled visit when this is given. */
  onDepart?: () => void;
  /** Hebrew error of the last action, if it failed. */
  error?: string | null;
}) {
  const canDepart = status === "new" && onDepart !== undefined;
  return (
    <section className="card" style={{ padding: 14, border: "2px solid var(--accent)" }} aria-label="הביקור הבא">
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <span className="num" style={{ fontSize: 12, fontWeight: 700, color: "var(--accent)" }}>
          {status === "new" ? "הביקור הבא" : "עכשיו"} · {visit.start}–{visit.end}
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
            <TestBadge />
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
            gridColumn: canDepart ? undefined : "1 / -1",
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
