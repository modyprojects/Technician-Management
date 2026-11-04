import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AnalyticsTabs } from "@/components/office/AnalyticsTabs";
import { isSettingsSection, SETTINGS_SECTION_LABELS, type SettingsSection } from "@/features/settings/data/types";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { demoDataAccess } from "../../../../_data/adapter";
import { officeSettingsParams } from "../../../../_data/params";
import { accountAdminScope, isOfficeRole, officeHomeLabel, settingsTabsOffered, VIEWPOINTS } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { NoAccessPlaceholder, ScreenPlaceholder } from "../../_Placeholder";

// Every role x tab is built: a role without the tab gets "אין הרשאה" instead of a 404.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeSettingsParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/settings/[tab]">): Promise<Metadata> {
  const { role, tab } = await params;
  if (!isOfficeRole(role) || !isSettingsSection(tab)) return {};
  return { title: `הגדרות · ${SETTINGS_SECTION_LABELS[tab]} · ${VIEWPOINTS[role].label} · הדגמה` };
}

/**
 * What each tab will show (docs/demo.html setUsers() ... setTemplate(), L942-976, as amended by
 * demo-deviations SE-01 to SE-16). The screens read through demoDataAccess.settings / .accounts
 * and act through useCommands().settings / .accounts.
 */
const PLANNED: Record<SettingsSection, readonly string[]> = {
  users: [
    "טבלת המשתמשים: שם, מייל, הרשאה, מצב וכניסה אחרונה, עם 🧪 למשתמשי בדיקה",
    "בקשות של המנהל לחשבונות שירות לקוחות: אישור, או דחייה עם סיבה",
    "מטריצת ההרשאות למנהל ולשירות לקוחות, עם סימון \"ערך זמני\" עד אישור הבעלים; היוצר קבוע ✓ 🔒",
  ],
  techs: [
    "טבלת הטכנאים: צבע, שם, טלפון, מייל ב-Outlook, מכשיר ופעיל",
    "\"פעיל\" קובע אם הטכנאי מקבל זימונים חדשים; ההיסטוריה נשמרת",
    "הוספת טכנאי; שינוי המייל ב-Outlook מודיע ליוצר באפליקציה",
  ],
  places: [
    "טבלת מקומות האיסוף: שם, סוג, כתובת (ל-Waze), טלפון, שעות פתיחה ופעיל",
    "הוספת מקום; מקום שבשימוש אפשר רק לכבות, ומחיקה רק למקום שלא בשימוש",
  ],
  reasons: [
    "סיבות המשך טיפול לפי הסדר, עם שימוש החודש ומתג פעיל",
    "הוספת סיבה; מחיקה רק לסיבה שלא בשימוש, וסיבה שבשימוש אפשר רק לכבות",
    "נוסח אישור \"טופל\": עריכה שומרת גרסה חדשה, וחתימות קודמות לא משתנות",
  ],
  types: ["סוגי הקריאה \"תיקון\" ו\"התקנה\": הוספה וכיבוי", "ערכים ראשוניים, לאימות עם שירות הלקוחות"],
  mail: [
    "מייל סיום ביקור: תמיד למנהל ולתיבת שירות הלקוחות, בשתי התוצאות (קבוע)",
    "נמען \"הנציגה המטפלת\", צירוף תמונות ומייל על זימון שלא נקלט: ממתין להחלטה",
    "התראות לטכנאי באפליקציה: זימון חדש או שינוי ביומן, ביטול ביקור",
  ],
  template: [
    "זיהוי זימון: נושא שמתחיל ב-[קריאת שירות], מתעדכן אוטומטית כשזימון נוצר או משתנה",
    "מספר פנייה שכבר קיים מצטרף לקריאה כביקור נוסף",
    "טבלת התוויות עם מתג חובה; \"מספר פנייה\" ו\"מספר לקוח\" תמיד חובה",
  ],
};

// Settings (docs/demo.html offSettings(), L935-976): one page per tab. PLACEHOLDER (phase E
// ports): the tab bar and the access state are real, the tab bodies come next. Which tabs a role
// sees follows settingsTabsOffered() (the Creator every tab; a matrix role only with `settings`;
// display only, G-04). Reads only through the data-access layer (reference.permissions).
export default async function OfficeSettingsPage({ params }: PageProps<"/dev/demo/office/[role]/settings/[tab]">) {
  const { role, tab } = await params;
  if (!isOfficeRole(role) || !isSettingsSection(tab)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = settingsTabsOffered(role, permissions);
  const title = SETTINGS_SECTION_LABELS[tab];

  if (!offered.includes(tab)) {
    const usersScreen = accountAdminScope(role) === "cs-tech" ? { href: demoHref.users(role), label: "לניהול משתמשים" } : undefined;
    return (
      <DemoOfficeFrame role={role} active="settings">
        <div className="ptitle">
          <div>
            <h1>הגדרות · {title}</h1>
          </div>
        </div>
        <NoAccessPlaceholder
          id="set-no-access"
          text={
            tab === "users" && usersScreen
              ? "משתמשים והרשאות מנוהלים על ידי היוצר. חשבונות שירות לקוחות וטכנאים מנוהלים במסך \"משתמשים\"."
              : "לתפקיד הזה אין הרשאה למסך ההגדרות הזה. את ההרשאות קובע היוצר במטריצת ההרשאות."
          }
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
          extra={usersScreen}
        />
      </DemoOfficeFrame>
    );
  }

  return (
    <DemoOfficeFrame role={role} active="settings">
      <div className="ptitle">
        <div>
          <h1>הגדרות · {title}</h1>
          <div className="sub">הדגמה: שינויים כאן מדומים ולא נשמרים</div>
        </div>
      </div>
      <AnalyticsTabs
        label="לשוניות ההגדרות"
        tabs={offered.map((key) => ({
          key,
          label: SETTINGS_SECTION_LABELS[key],
          href: demoHref.settings(role, key),
          on: key === tab,
          current: key === tab,
        }))}
      />
      <ScreenPlaceholder id="set-placeholder" heading={title} items={PLANNED[tab]} />
    </DemoOfficeFrame>
  );
}
