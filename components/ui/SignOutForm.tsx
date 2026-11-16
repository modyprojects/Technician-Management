// "יציאה" in the real app (Step 2 PR 2.5; Q4 TEMPORARY placements, AU-02 PROPOSED): a form whose
// submit runs the caller's sign-out server action (lib/actions/auth.ts `signOut`, passed in by the
// page, so components/ never imports lib/actions). A POST, never a link: no GET signs anyone out,
// and Next.js checks the Origin of the action. Same classes and accessible name as the UI demo's
// DemoSignOut. No hooks: usable from Server Components.

const CLASS: Readonly<Record<"side" | "light" | "row", string>> = {
  // The office sidebar's user block (and, at 900 px and below, the end of the top bar).
  side: "signout",
  // On a light card (the sign-in screen's no-access state).
  light: "btn",
  // A row action (the technician profile and start card).
  row: "chip",
};

export function SignOutForm({ action, variant }: { action: () => Promise<void>; variant: "side" | "light" | "row" }) {
  return (
    <form action={action} className="signout-form">
      <button type="submit" className={CLASS[variant]} aria-label="יציאה מהחשבון">
        יציאה
      </button>
    </form>
  );
}
