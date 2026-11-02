import type { Metadata } from "next";
import Link from "next/link";
import { ActionTile, BigButton } from "@/components/ui/BigButton";
import { Button } from "@/components/ui/Button";
import { Chip } from "@/components/ui/Chip";
import { PhoneIcon, PinIcon, UserIcon, WhatsAppIcon } from "@/components/ui/Icons";
import { Kpi } from "@/components/ui/Kpi";
import { ListItem } from "@/components/ui/ListItem";
import { Segmented } from "@/components/ui/Segmented";
import { StatusPill, VISIT_STATUSES, type VisitStatus } from "@/components/ui/StatusPill";
import { Tabs } from "@/components/ui/Tabs";
import { Toggle } from "@/components/ui/Toggle";
import { FIXTURE_SENTINEL } from "./_fixtures";
import { TokenSwatch } from "./TokenSwatch";

export const metadata: Metadata = { title: "תצוגת רכיבים · תצוגת פיתוח" };

const TOKEN_GROUPS: { title: string; names: string[] }[] = [
  {
    title: "בסיס",
    names: ["--ink", "--ink2", "--ink3", "--muted", "--soft", "--line", "--line2", "--bg", "--card", "--tint"],
  },
  {
    title: "הדגשה וטקסט על רקע כהה",
    names: ["--accent", "--accent-d", "--accent-l", "--on-dark", "--on-dark2", "--on-dark3"],
  },
  {
    title: "אזהרה ושגיאה",
    names: ["--warn-bg", "--warn-bd", "--warn-fg", "--warn-ink", "--danger", "--danger-bg", "--danger-fg"],
  },
  {
    title: "סטטוסים",
    names: [
      "--s-new", "--s-new-bg", "--s-new-fg",
      "--s-go", "--s-go-bg", "--s-go-fg",
      "--s-work", "--s-work-bg", "--s-work-fg",
      "--s-done", "--s-done-bg", "--s-done-fg",
      "--s-cont", "--s-cont-bg", "--s-cont-fg",
      "--s-cancel", "--s-cancel-bg", "--s-cancel-fg",
    ],
  },
  { title: "צבעי טכנאים (נתוני דוגמה)", names: ["--t-y", "--t-e", "--t-s"] },
  {
    title: "צבעים קבועים מהדמו",
    names: ["--control-line", "--danger-line", "--seg-bg", "--stat-line", "--note-line"],
  },
];

const STATUS_KEYS = Object.keys(VISIT_STATUSES) as VisitStatus[];

function Section({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section className="card sec">
      <h2>{title}</h2>
      {children}
    </section>
  );
}

export default function ShowcasePage() {
  return (
    <main data-fixtures={FIXTURE_SENTINEL} className="mx-auto flex max-w-[1100px] flex-col gap-4 p-4 sm:p-6">
      <div className="ptitle">
        <div>
          <h1>תצוגת רכיבים</h1>
          <div className="sub">סביבת פיתוח בלבד · נתונים בדויים · לא חלק מהאפליקציה</div>
        </div>
      </div>

      <div className="note">
        המסגרות במסך מלא:{" "}
        <Link className="lnk" href="/dev/showcase/tech">מסגרת טכנאי</Link> ·{" "}
        <Link className="lnk" href="/dev/showcase/office">מסגרת משרד</Link> ·{" "}
        <Link className="lnk" href="/dev/showcase/sizes">השוואת גדלים 390 / 820 / 1440</Link>
      </div>

      <Section title="צבעים (טוקנים מהדמו)">
        <div className="flex flex-col gap-4">
          {TOKEN_GROUPS.map((group) => (
            <div key={group.title}>
              <div className="sub" style={{ fontWeight: 700, marginBottom: 6 }}>
                {group.title}
              </div>
              <div className="grid gap-2" style={{ gridTemplateColumns: "repeat(auto-fill, minmax(190px, 1fr))" }}>
                {group.names.map((name) => (
                  <TokenSwatch key={name} name={name} />
                ))}
              </div>
            </div>
          ))}
        </div>
      </Section>

      <Section title="טיפוגרפיה">
        <div className="flex flex-col gap-2">
          <h1 style={{ fontSize: 24 }}>כותרת ראשית · Rubik 600 · 24px</h1>
          <h2 style={{ fontSize: 16 }}>כותרת משנה · Rubik 600 · 16px</h2>
          <div>טקסט רגיל · Assistant 400 · 15px</div>
          <div style={{ fontWeight: 600 }}>טקסט מודגש חלקית · Assistant 600</div>
          <div style={{ fontWeight: 700 }}>טקסט מודגש · Assistant 700</div>
          <div className="sub">טקסט משני · 13px</div>
          <div className="num" style={{ fontFamily: "var(--display)", fontSize: 28, fontWeight: 600 }}>
            09:00 · 48213 · 1,234
          </div>
        </div>
      </Section>

      <Section title="סטטוסים">
        <div className="flex flex-wrap gap-2">
          {STATUS_KEYS.map((s) => (
            <StatusPill key={s} status={s} />
          ))}
        </div>
      </Section>

      <Section title="כפתורים, צ'יפים ומתגים">
        <div className="flex flex-col gap-3">
          <div className="flex flex-wrap gap-2">
            <Button>רגיל</Button>
            <Button variant="primary">ראשי</Button>
            <Button variant="danger">ביטול קריאה</Button>
            <Button disabled>מושבת</Button>
          </div>
          <div className="flex flex-wrap gap-2">
            <Chip on count={189}>הכל</Chip>
            <Chip count={10}>שובצה</Chip>
            <Chip count={22}>המשך טיפול</Chip>
          </div>
          <div className="flex flex-wrap items-center gap-3">
            <Toggle on label="מתג דלוק" />
            <Toggle on={false} label="מתג כבוי" />
            <Toggle on disabled label="מתג מושבת" />
          </div>
          <div style={{ maxWidth: 360 }}>
            <Segmented options={["✎ כתיבה", "🎙 הקלטה"]} selected={0} label="אופן הסיכום" />
          </div>
          <Tabs tabs={["כללי", "טכנאים", "מוצרים וספקים"]} selected={0} label="לשוניות דשבורד" />
        </div>
      </Section>

      <Section title="כפתורים גדולים ואריחי פעולה (טכנאי)">
        <div className="flex flex-col gap-2" style={{ maxWidth: 420 }}>
          <BigButton color="var(--accent)">
            <PinIcon /> יוצא · Waze
          </BigButton>
          <BigButton color="var(--s-work)">הגעתי · התחלת טיפול</BigButton>
          <BigButton color="var(--ink)">סיום ביקור ›</BigButton>
          <BigButton color="var(--s-done)">שליחה · הקריאה טופלה</BigButton>
          <BigButton color="var(--s-cont)" disabled>
            שליחה · המשך טיפול
          </BigButton>
          <div className="grid grid-cols-4 gap-2">
            <ActionTile primary icon={<PinIcon />} label="Waze" />
            <ActionTile icon={<PhoneIcon />} label="לקוח" />
            <ActionTile icon={<WhatsAppIcon />} label="וואטסאפ" />
            <ActionTile icon={<UserIcon />} label="נציגה" />
          </div>
        </div>
      </Section>

      <Section title="KPI, רשימה, שורות והודעה">
        <div className="flex flex-col gap-4">
          <div className="kpis">
            <Kpi label="ביקורים החודש" value="212" detail="כולל מתוכננים" />
            <Kpi label="נסגר בביקור ראשון" value="84%" detail="מתוך קריאות שבוקרו" />
            <Kpi label="המשך טיפול פתוחים" value="7" detail="ללא ביקור חדש" color="var(--s-cont)" />
          </div>
          <div className="card" style={{ maxWidth: 420 }}>
            <ListItem time="09:00" title="משפחת לוי" sub="רחובות · ברז מטבח נשלף" trailing={<StatusPill status="new" />} />
            <ListItem time="11:30" title="אבי כהן" sub="נס ציונה · ↻ ביקור המשך" trailing={<StatusPill status="go" />} />
          </div>
          <div className="card" style={{ maxWidth: 420, padding: "4px 14px" }}>
            <div className="row">
              <span className="k">כתובת</span>
              <span>הרצל 14, רחובות</span>
            </div>
            <div className="row">
              <span className="k">מק&quot;ט</span>
              <span dir="ltr">KT-2041</span>
            </div>
          </div>
          <div className="note">🔒 ביקור שנסגר מוצג לקריאה בלבד.</div>
        </div>
      </Section>
    </main>
  );
}
