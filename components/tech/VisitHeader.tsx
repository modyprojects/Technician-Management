import Link from "next/link";
import type { ReactNode } from "react";

// Technician visit-card header (docs/demo.html techCall() and techDoneView() head, TE-05):
// back link, "פנייה · משימה · ביקור" line, customer name, and the visit status on the other side.
// Every top-level element is its own child of .ph-head, so above 900px it aligns with the
// 760px content column (TE-31). The trailing side (status pill, 🧪 badge of a test call, SIM-15)
// wraps onto a second line instead of squeezing a long customer name on a phone.
export function VisitHeader({
  backHref,
  backLabel = "חזרה",
  backAriaLabel,
  meta,
  title,
  trailing,
}: {
  backHref: string;
  /** Visible back text after "›" (the demo's backBtn() shows "חזרה"). */
  backLabel?: string;
  /** Accessible name; must contain the visible text. */
  backAriaLabel?: string;
  /** "פנייה 48213 · משימה 2 · ביקור 1". */
  meta: string;
  /** Customer name. */
  title: string;
  /** Status pill and badges. */
  trailing?: ReactNode;
}) {
  return (
    <>
      <div>
        <Link className="ph-back" href={backHref} aria-label={backAriaLabel}>
          <span aria-hidden="true">› </span>
          {backLabel}
        </Link>
      </div>
      <div
        style={{
          display: "flex",
          justifyContent: "space-between",
          alignItems: "flex-start",
          gap: 10,
          marginTop: 4,
        }}
      >
        <div style={{ minWidth: 0 }}>
          <div className="sub num" style={{ color: "var(--on-dark2)" }}>
            {meta}
          </div>
          <h1 style={{ fontSize: 21 }}>{title}</h1>
        </div>
        {trailing && (
          <span
            style={{
              display: "flex",
              gap: 6,
              alignItems: "center",
              justifyContent: "flex-end",
              flexWrap: "wrap",
              flex: "none",
              maxWidth: "50%",
            }}
          >
            {trailing}
          </span>
        )}
      </div>
    </>
  );
}
