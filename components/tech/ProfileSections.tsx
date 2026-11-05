import type { ReactNode } from "react";
import type { TechnicianProfile } from "@/features/profile/data/types";

// Display parts of the technician's profile (docs/demo.html techProfile() L685-692). No hooks:
// usable from Server Components. The notification toggles are ProfilePreferences (client).
// - ProfileWeek: "ביקורים השבוע" and "טופלו" for the work week (TE-29).
// - ProfileHelp: "עזרה". "📞 חיוג למשרד" with the caller's dial element (navigation: a `tel:` link
//   in production); disabled when the office phone is not set. "⚠ דיווח על תקלה באפליקציה" is
//   PENDING (TE-30, open decision d26: where the report goes), so it is a disabled placeholder
//   with no logic; the caller may pass the hint under it (the demo names the open decision).
// - ProfileAccount: "חשבון" with "יציאה מהחשבון" (Step 2 PR 2.3, Q4 TEMPORARY; AU-02, AU-04
//   PROPOSED): the caller's sign-out control (the real app: a `<form action={signOut}>` button,
//   PR 2.5). "במכשיר הזה בלבד": the sign-out ends this device's session only (plan §3.4, `scope:
//   "local"`; PROPOSED wording). The pending-data warning before sign-out is Step 4.
// The demo's "גרסה 2.0 · דמו" line is demo chrome (X-01) and is not shown.

const HEADING_STYLE = { fontFamily: "var(--body)", fontWeight: 700 } as const;
const PENDING_STYLE = { opacity: 0.55 } as const;
const REPORT_HINT_ID = "profile-report-pending";

export function ProfileWeek({ week }: { week: TechnicianProfile["week"] }) {
  return (
    <section className="card" aria-label="השבוע שלי" style={{ padding: 12, display: "flex", textAlign: "center" }}>
      <div style={{ flex: 1 }}>
        <b className="num" style={{ fontFamily: "var(--display)", fontSize: 22 }}>
          {week.visits}
        </b>
        <div className="sub">ביקורים השבוע</div>
      </div>
      <div style={{ flex: 1 }}>
        <b className="num" style={{ fontFamily: "var(--display)", fontSize: 22 }}>
          {week.done}
        </b>
        <div className="sub">טופלו</div>
      </div>
    </section>
  );
}

export function ProfileHelp({
  officePhone,
  officeDial,
  reportPendingHint = "עדיין לא זמין",
}: {
  /** The office phone; null when it is not set. */
  officePhone: string | null;
  /** The "חיוג" element for the office phone (production: a `tel:` link). */
  officeDial: ReactNode;
  /** The line under the disabled "דיווח על תקלה באפליקציה" (TE-30 PENDING). */
  reportPendingHint?: string;
}) {
  return (
    <>
      <h2 id="profile-help" className="sub" style={HEADING_STYLE}>
        עזרה
      </h2>
      <section className="card" aria-labelledby="profile-help">
        <div className="tnp-row">
          <span>
            <span aria-hidden="true">📞 </span>
            חיוג למשרד
            {!officePhone && (
              <span className="sub" style={{ display: "block" }}>
                מספר המשרד לא הוגדר
              </span>
            )}
          </span>
          {officePhone ? (
            officeDial
          ) : (
            <button type="button" className="chip" disabled style={PENDING_STYLE}>
              חיוג
            </button>
          )}
        </div>
        <div className="tnp-row">
          <span>
            <span aria-hidden="true">⚠ </span>
            דיווח על תקלה באפליקציה
            <span id={REPORT_HINT_ID} className="sub" style={{ display: "block" }}>
              {reportPendingHint}
            </span>
          </span>
          <button type="button" className="chip" disabled aria-describedby={REPORT_HINT_ID} style={PENDING_STYLE}>
            דיווח
          </button>
        </div>
      </section>
    </>
  );
}

export function ProfileAccount({ signOut }: { signOut: ReactNode }) {
  return (
    <>
      <h2 id="profile-account" className="sub" style={HEADING_STYLE}>
        חשבון
      </h2>
      <section className="card" aria-labelledby="profile-account">
        <div className="tnp-row">
          <span>
            יציאה מהחשבון
            <span className="sub" style={{ display: "block" }}>
              במכשיר הזה בלבד
            </span>
          </span>
          {signOut}
        </div>
      </section>
    </>
  );
}
