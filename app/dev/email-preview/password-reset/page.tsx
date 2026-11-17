import type { Metadata } from "next";
import { passwordResetEmail } from "@/features/auth/password-reset/email";
import { RESET_LINK_MINUTES } from "@/features/auth/password-reset/paths";
import { FIXTURE_SENTINEL } from "../../showcase/_fixtures";

export const metadata: Metadata = { title: "תצוגת מייל · איפוס סיסמה · תצוגת פיתוח" };

// Dev-only preview of the password-reset email (D65) for the owner's visual review: the real
// template (features/auth/password-reset/email.ts) with a FICTIONAL link, never sent. Served only
// where the /dev gate opens (proxy.ts, app/dev/_gate.ts: Preview, the testing-period Production and
// localhost with ENABLE_DEV_ROUTES=1), all behind Vercel Authentication (D29, D31).
// The HTML version is shown in a sandboxed iframe (`sandbox=""`: no script, no navigation, no
// same-origin access) through `srcdoc`; the text version below it.
const FICTIONAL_LINK = `https://technician-management.example.test/login/reset?token_hash=${"0f1e2d3c".repeat(7)}`;

export default function PasswordResetEmailPreview() {
  const email = passwordResetEmail({ link: FICTIONAL_LINK, expiresMinutes: RESET_LINK_MINUTES });
  return (
    <main data-fixtures={FIXTURE_SENTINEL} data-email-preview="password-reset" className="flex flex-col gap-4 p-4 sm:p-6" style={{ maxWidth: 760 }}>
      <div className="ptitle">
        <div>
          <h1>תצוגת מייל · איפוס סיסמה</h1>
          <div className="sub">המייל שנשלח לבקשת איפוס סיסמה. הקישור כאן פיקטיבי, והמייל אינו נשלח מהדף הזה.</div>
        </div>
      </div>
      <section className="card sec">
        <h2>נושא</h2>
        <p style={{ margin: 0 }}>{email.subject}</p>
      </section>
      <section className="card sec">
        <h2>גרסת HTML</h2>
        <iframe
          title="תצוגת המייל (HTML)"
          sandbox=""
          srcDoc={email.html}
          style={{ display: "block", width: "100%", height: 880, border: "1px solid var(--line)", borderRadius: 8, background: "var(--bg)" }}
        />
      </section>
      <section className="card sec">
        <h2>גרסת טקסט</h2>
        <pre style={{ margin: 0, whiteSpace: "pre-wrap", overflowWrap: "anywhere", fontFamily: "var(--body)", fontSize: 14, lineHeight: 1.6 }}>
          {email.text}
        </pre>
      </section>
    </main>
  );
}
