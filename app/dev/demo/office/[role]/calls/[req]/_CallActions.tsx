// Header actions of the demo call card (docs/demo.html offCard() L849-850, as amended by
// docs/demo-deviations.md):
// - "חיוג לטכנאי": as in the demo (the last visit's technician). A dial is navigation, not a data
//   action, so it stays a data-sim affordance.
// - "ביטול ביקור" (the demo's "ביטול קריאה"; D38: it cancels the open visit, never the whole
//   call): OF-09 and SE-04 are PENDING (open decision d08), so it is a disabled placeholder with
//   no logic until the owner decides (demo-deviations "PENDING"). It shows only where the role's
//   matrix value offers `cancel` (D33, temporary per D51); other roles see why it is missing
//   (G-04: display only, never access control).
// - "פתח זימון ב-Outlook" is not shown until Microsoft 365 is connected (OF-08).
// - No "שינוי מועד" or "הוספת הערה": neither is in the demo, the spec or demo-deviations, and
//   scheduling stays in Outlook (OF-03). Adding them needs an owner decision first.
// No hooks: rendered from the Server Component page.

const CANCEL_HINT_ID = "call-cancel-pending";

export function CallActions({
  tech,
  hasOpenVisit,
  canCancel,
}: {
  /** Technician of the last visit (the demo's "חיוג לטכנאי"); null when the call has no visit. */
  tech: { name: string; phone: string } | null;
  /** The call has an open visit (the only case where the demo offers the cancel button). */
  hasOpenVisit: boolean;
  /** The role's matrix value for `cancel` (display only). */
  canCancel: boolean;
}) {
  return (
    <div style={{ display: "flex", gap: 8, flexWrap: "wrap", alignItems: "center" }}>
      {tech && (
        <button type="button" className="btn" data-sim={`חיוג לטכנאי ${tech.name} · ${tech.phone}`}>
          חיוג לטכנאי
        </button>
      )}
      {hasOpenVisit &&
        (canCancel ? (
          <>
            <button type="button" className="btn dng" disabled aria-describedby={CANCEL_HINT_ID} style={{ opacity: 0.55 }}>
              ביטול ביקור
            </button>
            <span id={CANCEL_HINT_ID} className="sub">
              ממתין להחלטת בעלים (d08)
            </span>
          </>
        ) : (
          <span className="sub">ביטול ביקור: אין הרשאה לתפקיד הזה</span>
        ))}
    </div>
  );
}
