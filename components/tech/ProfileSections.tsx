import type { ReactNode } from "react";
import type { TechnicianProfile } from "@/features/profile/data/types";

// Display parts of the technician's profile (docs/demo.html techProfile() L685-692). No hooks:
// usable from Server Components. The notification toggles are ProfilePreferences (client).
// - ProfileWeek: "ביקורים השבוע" and "טופלו" for the work week (TE-29).
// - ProfileHelp: "עזרה". "📞 חיוג למשרד" with the caller's dial element (navigation: a `tel:` link
//   in production); disabled when the office phone is not set. "⚠ דיווח על תקלה באפליקציה" is
//   PENDING (TE-30, open decision d26: where the report goes), so it is a disabled placeholder
//   with no logic.
// - ProfileSignOut: "התנתקות" is not in the demo; sign-in and sign-out come with Supabase Auth in
//   Step 2, so until then it is a disabled placeholder that says so (no fake action).
// The demo's "גרסה 2.0 · דמו" line is demo chrome (X-01) and is not shown.

const HEADING_STYLE = { fontFamily: "var(--body)", fontWeight: 700 } as const;
const PENDING_STYLE = { opacity: 0.55 } as const;
const REPORT_HINT_ID = "profile-report-pending";
const SIGN_OUT_HINT_ID = "profile-sign-out-pending";

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
}: {
  /** The office phone; null when it is not set. */
  officePhone: string | null;
  /** The "חיוג" element for the office phone (production: a `tel:` link). */
  officeDial: ReactNode;
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
              ממתין להחלטת בעלים (d26)
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

export function ProfileSignOut() {
  return (
    <div style={{ display: "flex", flexDirection: "column", gap: 4 }}>
      <button type="button" className="btn" disabled aria-describedby={SIGN_OUT_HINT_ID} style={{ width: "100%" }}>
        התנתקות
      </button>
      <div id={SIGN_OUT_HINT_ID} className="sub" style={{ textAlign: "center" }}>
        ההתחברות למערכת תיבנה בשלב 2 · בהדגמה אין חשבון מחובר
      </div>
    </div>
  );
}
