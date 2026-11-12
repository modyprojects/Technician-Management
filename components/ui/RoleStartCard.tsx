import type { ReactNode } from "react";
import { TestBadge } from "./TestBadge";

// A role's temporary start screen before its screens are built (Step 2 PR 2.3; TEMPORARY, Step 2
// plan Q18; AU-03 PROPOSED, PENDING the owner's §9 Q-A): the user's name and role, one sentence that
// the role's screens arrive in later steps, the visible pending label and, where the shell has no
// user block (the technician), "יציאה". No hooks: usable from Server Components. No "next" link
// (not in Q18). The name, role and test marker come from the session user (SessionUser), never from
// a fixture; the caller passes display text only.

export function RoleStartCard({
  greeting,
  roleLabel,
  isTest,
  signOut,
}: {
  /** "שלום, {name}": shown as the card's heading (the office); the technician's is in the header. */
  greeting?: string;
  roleLabel: string;
  /** The 🧪 badge beside the greeting (SIM-18, D47). */
  isTest: boolean;
  /** The sign-out control (the technician: his shell has no user block). */
  signOut?: ReactNode;
}) {
  return (
    <section className="card start-card" aria-labelledby={greeting ? "start-greeting" : undefined} aria-label={greeting ? undefined : "מסך פתיחה זמני"}>
      <div className="start-body">
        {greeting && (
          <div className="start-hello">
            <h2 id="start-greeting">{greeting}</h2>
            {isTest && <TestBadge />}
          </div>
        )}
        <div className="start-role">הרשאה: {roleLabel}</div>
        <p className="start-p">מסכי העבודה יתווספו בשלבים הבאים של הפיתוח.</p>
        <p className="sub start-p start-pending">מסך פתיחה זמני · ממתין להחלטת בעלים</p>
      </div>
      {signOut && (
        <div className="tnp-row start-row">
          <span>יציאה מהחשבון</span>
          {signOut}
        </div>
      )}
    </section>
  );
}
