import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { officeRoleParams } from "../../../_data/params";
import { accountAdminScope, isOfficeRole, officeHomeLabel, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder, ScreenPlaceholder } from "../_Placeholder";

// Every office role is built: customer service gets "אין הרשאה", the Creator a link to Settings.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/users">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `ניהול משתמשים · ${VIEWPOINTS[role].label} · הדגמה` };
}

// "ניהול משתמשים": the Manager's account administration (SE-01, D34), a fixed capability, never
// a matrix key (SE-03). PLACEHOLDER (phase E ports): the body comes next and reads
// demoDataAccess.accounts (list, requests) and acts through useCommands().accounts. Who sees it
// follows accountAdminScope() (display only, G-04): the Manager ("cs-tech"); the Creator manages
// every account on Settings › משתמשים והרשאות; customer service has no account administration.
export default async function OfficeUsersPage({ params }: PageProps<"/dev/demo/office/[role]/users">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const scope = accountAdminScope(role);

  return (
    <DemoOfficeFrame role={role} active="users">
      <div className="ptitle">
        <div>
          <h1>ניהול משתמשים</h1>
          {scope === "cs-tech" && <div className="sub">חשבונות שירות לקוחות וטכנאים · הדגמה: פעולות מדומות</div>}
        </div>
      </div>
      {scope === "cs-tech" ? (
        <ScreenPlaceholder
          id="users-placeholder"
          heading="משתמשים"
          items={[
            "חשבונות שירות לקוחות וטכנאים: שם, מייל, טלפון, מצב וכניסה אחרונה, עם 🧪 למשתמשי בדיקה",
            "יצירה, הפעלה, הפעלה מחדש ושינוי תפקיד של שירות לקוחות: בקשה שממתינה לאישור היוצר",
            "הוספה והפעלה של טכנאי: מיידית",
            "השבתת חשבון: מיידית, והיוצר מקבל התראה באפליקציה",
            "הבקשות שלי לפי מצב: ממתינה, אושרה, נדחתה (עם הסיבה), בוטלה",
            "המנהל לא קובע סיסמאות ולא משנה מייל של חשבון",
          ]}
        />
      ) : scope === "all" ? (
        <NoAccessPlaceholder
          id="users-creator"
          heading="בהגדרות"
          icon="⚙️"
          text="היוצר מנהל את כל החשבונות ומאשר את בקשות המנהל בהגדרות › משתמשים והרשאות."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
          extra={{ href: demoHref.settings(role, "users"), label: "למשתמשים והרשאות" }}
        />
      ) : (
        <NoAccessPlaceholder
          id="users-no-access"
          text="לתפקיד הזה אין ניהול משתמשים. חשבונות מנוהלים על ידי המנהל והיוצר."
          backHref={demoHref.officeHome(role)}
          backLabel={officeHomeLabel(permissions)}
        />
      )}
    </DemoOfficeFrame>
  );
}
