"use client";

// The UI demo's sign-in form (Step 2 PR 2.3, AU-01 PROPOSED): the shared LoginForm with a simulated
// submit. There are no accounts in the demo and nothing is checked or sent: the toast says so. The
// email and password are never put into the toast's text (they are not even read here), and the
// page does not navigate afterwards. The real sign-in is Step 2 PR 2.5.
import { LoginForm } from "@/components/ui/LoginForm";
import { useSimulate } from "../_components/DemoToast";

export function DemoLoginForm() {
  const simulate = useSimulate();
  return <LoginForm onSubmit={() => simulate("כניסה · בהדגמה אין חשבונות ואין בדיקת פרטים · שום דבר לא נשלח")} />;
}
