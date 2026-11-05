// "יציאה" in the UI demo (Step 2 PR 2.3, Q4 TEMPORARY; AU-02 PROPOSED): a plain button whose click
// the demo toast answers (data-sim, DemoToast). Nothing is signed out: the demo has no session. The
// real app (Step 2 PR 2.5) passes a `<form action={signOut}>` button into the same slots (the office
// sidebar's user block, the technician profile's "חשבון", the sign-in screen's no-access state):
// a server action, not a port. No hooks: usable from Server Components.
// The visible label "יציאה" starts the accessible name "יציאה מהחשבון" (WCAG 2.5.3); the wording is
// an owner question (Step 2 PR 2.3 §9 Q-B: "יציאה", "התנתקות" or "יציאה מהחשבון").

const CLASS: Readonly<Record<"side" | "light" | "row", string>> = {
  // The office sidebar's user block (and, at 900 px and below, the end of the top bar).
  side: "signout",
  // On a light card (the sign-in screen's no-access state).
  light: "btn",
  // A row action (the technician profile and start card): the demo's small chip.
  row: "chip",
};

export function DemoSignOut({ variant }: { variant: "side" | "light" | "row" }) {
  return (
    <button
      type="button"
      className={CLASS[variant]}
      aria-label="יציאה מהחשבון"
      data-sim="יציאה מהחשבון · בהדגמה אין חשבון מחובר · שום דבר לא נשלח"
    >
      יציאה
    </button>
  );
}
