import type { Metadata } from "next";
import Link from "next/link";
import { LoginScreen } from "@/components/ui/LoginScreen";
import { loginStateOf, type LoginState } from "@/features/auth/login-state";
import { DemoPage } from "../_components/DemoPage";
import { DemoSignOut } from "../_components/DemoSignOut";
import { demoHref } from "../_data/routes";
import { DemoLoginForm } from "./_DemoLogin";

export const metadata: Metadata = { title: "כניסה · הדגמה" };

/** The demo's state links (dev chrome, not part of the screen). */
const STATES: readonly { state: LoginState; label: string }[] = [
  { state: "form", label: "טופס" },
  { state: "failed", label: "פרטים שגויים" },
  { state: "unavailable", label: "כניסה לא זמינה" },
  { state: "no-access", label: "אין גישה" },
];

// Prototype of the sign-in screen "כניסה" (Step 2 plan §4 #1, §3.4; AU-01 PROPOSED; Step 2 PR 2.3):
// all four states read from `?state=` (loginStateOf: anything unknown is the form). Nothing signs
// in: the form's submit and "יציאה" are simulated (DemoLoginForm, DemoSignOut). No sign-up and no
// "שכחתי סיסמה" (TEMPORARY, Q2). The real `/login` is Step 2 PR 2.5; this page is a /dev prototype
// behind the /dev gate, and adds no route outside it.
export default async function DemoLoginPage({ searchParams }: PageProps<"/dev/demo/login">) {
  const sp = await searchParams;
  const state = loginStateOf(sp.state);
  return (
    <DemoPage>
      <LoginScreen
        state={state}
        form={<DemoLoginForm />}
        signOut={<DemoSignOut variant="light" />}
        extra={
          <nav aria-label="מצבי המסך בהדגמה" className="login-states">
            {STATES.map((s) => (
              <Link key={s.state} href={demoHref.login(s.state)} aria-current={s.state === state ? "page" : undefined}>
                {s.label}
              </Link>
            ))}
          </nav>
        }
      />
    </DemoPage>
  );
}
