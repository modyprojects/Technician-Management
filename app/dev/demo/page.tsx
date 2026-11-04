import type { Metadata } from "next";
import Link from "next/link";
import { DemoPage } from "./_components/DemoPage";
import { demoDataAccess } from "./_data/adapter";
import { VIEWPOINTS, type Viewpoint } from "./_data/roles";
import { demoHref } from "./_data/routes";

export const metadata: Metadata = { title: "הדגמת ממשק · תצוגת פיתוח" };

type ScreenLink = { label: string; sub: string; href: string };

/** Customer name of each example call, read through the data-access layer. */
async function callNames(reqs: readonly string[]): Promise<(req: string) => string> {
  const calls = await Promise.all(reqs.map((req) => demoDataAccess.calls.get(req)));
  const names = new Map(calls.flatMap((c) => (c ? [[c.req, c.customer.name] as const] : [])));
  return (req) => names.get(req) ?? req;
}

// Every demo screen, by viewpoint. Examples are calls from the demo's own story.
const screens = (callName: (req: string) => string): Record<Viewpoint, { intro: string; links: ScreenLink[] }> => ({
  tech: {
    intro: "האפליקציה בטלפון של הטכנאי: היום, כרטיס ביקור, עבודה וסיום.",
    links: [
      { label: "היום", sub: "הביקור הבא, מה לאסוף, לו״ז היום", href: demoHref.tech() },
      { label: `כרטיס ביקור · ${callName("48213")}`, sub: "פנייה 48213 · ביקור ראשון", href: demoHref.visit("48213", 1) },
      { label: `ביקור המשך · ${callName("48205")}`, sub: "פנייה 48205 · ביקור 2, עם הביקור הקודם", href: demoHref.visit("48205", 2) },
      { label: "מסך עבודה", sub: "תמונות, הקלטה, סיכום וחלפים · פנייה 48213", href: demoHref.work("48213", 1) },
      { label: "סיום ביקור וחתימה", sub: "טופל או המשך טיפול · פנייה 48213", href: demoHref.close("48213", 1) },
      { label: `ביקור שנסגר · ${callName("47800")}`, sub: "פנייה 47800 · צפייה בלבד, עם אישור הלקוח", href: demoHref.visit("47800", 1) },
    ],
  },
  mgr: {
    intro: "המשרד מהמחשב, מהטאבלט או מהטלפון: מעקב, קריאות ודשבורד.",
    links: [
      { label: "לוח בקרה", sub: "מסך הבית של המנהל", href: demoHref.officeHome("mgr") },
      { label: "קריאות", sub: "חיפוש וסינון לפי סטטוס וטכנאי", href: demoHref.calls("mgr") },
      { label: `כרטיס קריאה · ${callName("48140")}`, sub: "פנייה 48140 · שלושה ביקורים", href: demoHref.call("mgr", "48140") },
      { label: `קריאה שטופלה · ${callName("47969")}`, sub: "פנייה 47969 · סיכום, תמונות וחתימת לקוח", href: demoHref.call("mgr", "47969") },
      { label: `ממתינה לשיבוץ · ${callName("48230")}`, sub: "פנייה 48230 · הביקור בוטל", href: demoHref.call("mgr", "48230") },
      { label: "דשבורד", sub: "כללי, טכנאים, מוצרים וספקים", href: demoHref.analytics() },
    ],
  },
  cs: {
    intro: "שירות הלקוחות: מעקב אחרי הקריאות. בלי דשבורד ובלי ביטול ביקור.",
    links: [
      { label: "בית", sub: "מסך הבית של שירות הלקוחות", href: demoHref.officeHome("cs") },
      { label: "קריאות", sub: "חיפוש וסינון לפי סטטוס וטכנאי", href: demoHref.calls("cs") },
      { label: `כרטיס קריאה · ${callName("48205")}`, sub: "פנייה 48205 · ביקור המשך", href: demoHref.call("cs", "48205") },
      { label: "דשבורד", sub: "אין הרשאה לתפקיד הזה", href: demoHref.officeAnalytics("cs") },
    ],
  },
});

const ORDER: Viewpoint[] = ["tech", "mgr", "cs"];

export default async function DemoLandingPage() {
  const SCREENS = screens(await callNames(["48213", "48205", "48140", "47800", "47969", "48230"]));
  return (
    <DemoPage>
      <main className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
        <div className="ptitle">
          <div>
            <h1>הדגמת ממשק</h1>
            <div className="sub">סביבת פיתוח בלבד · נתונים בדויים · זו לא האפליקציה</div>
          </div>
        </div>
        <div className="note">
          בוחרים נקודת מבט ועוברים בין המסכים. כל הנתונים בדויים, והפעולות מדומות: שום דבר לא נשמר, לא נשלח ולא מחייג.
          התאריך בהדגמה קבוע: יום רביעי 21.10.2026.
        </div>
        <div className="cols3">
          {ORDER.map((key) => {
            const vp = VIEWPOINTS[key];
            const screens = SCREENS[key];
            return (
              <section key={key} className="card" style={{ overflow: "hidden" }}>
                <div className="sec" style={{ display: "flex", gap: 12, alignItems: "center", paddingBottom: 10 }}>
                  <span
                    aria-hidden="true"
                    style={{
                      width: 40,
                      height: 40,
                      borderRadius: "50%",
                      background: vp.color,
                      color: "var(--on-dark)",
                      display: "flex",
                      alignItems: "center",
                      justifyContent: "center",
                      fontWeight: 700,
                      flex: "none",
                    }}
                  >
                    {vp.who.slice(0, 1)}
                  </span>
                  <div style={{ minWidth: 0 }}>
                    <h2 style={{ margin: 0 }}>{vp.label}</h2>
                    <div className="sub">{screens.intro}</div>
                  </div>
                </div>
                <nav aria-label={`מסכי ${vp.label}`} style={{ borderTop: "1px solid var(--line2)" }}>
                  {screens.links.map((link) => (
                    <Link key={link.href} href={link.href} className="li">
                      <span style={{ flex: 1, minWidth: 0 }}>
                        <b style={{ fontSize: 14 }}>{link.label}</b>
                        <div className="sub">{link.sub}</div>
                      </span>
                      <span aria-hidden="true" style={{ color: "var(--accent)", fontWeight: 700 }}>
                        ‹
                      </span>
                    </Link>
                  ))}
                </nav>
              </section>
            );
          })}
        </div>
      </main>
    </DemoPage>
  );
}
