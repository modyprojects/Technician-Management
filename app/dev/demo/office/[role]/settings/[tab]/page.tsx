import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { SettingsCallTypes } from "@/components/office/SettingsCallTypes";
import { SettingsMail } from "@/components/office/SettingsMail";
import { SettingsPlaces } from "@/components/office/SettingsPlaces";
import { SettingsReasons } from "@/components/office/SettingsReasons";
import { SettingsReasonsFixedText } from "@/components/office/SettingsReasonsFixedText";
import { SettingsShell } from "@/components/office/SettingsShell";
import { SettingsTechs } from "@/components/office/SettingsTechs";
import { SettingsTemplate } from "@/components/office/SettingsTemplate";
import type { OfficeRole } from "@/features/reference/data/types";
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
 * The body of one tab, read only through the data-access layer (demoDataAccess.settings /
 * .reference) and passed to components/office as DTO props; actions run through useCommands()
 * inside those components (simulated in the UI demo).
 */
async function tabBody(role: OfficeRole, tab: SettingsSection): Promise<ReactNode> {
  switch (tab) {
    case "users":
      // TEMPORARY placeholder: SettingsUsersTab (account administration and the permission
      // matrix, SE-01 to SE-03) is being built in parallel and replaces this body.
      return (
        <ScreenPlaceholder
          id="set-users-placeholder"
          heading={SETTINGS_SECTION_LABELS.users}
          items={[
            "טבלת המשתמשים: שם, מייל, הרשאה, מצב וכניסה אחרונה, עם 🧪 למשתמשי בדיקה",
            "בקשות של המנהל לחשבונות שירות לקוחות: אישור, או דחייה עם סיבה",
            "מטריצת ההרשאות למנהל ולשירות לקוחות, עם סימון \"ערך זמני\" עד אישור הבעלים; היוצר קבוע ✓ 🔒",
          ]}
        />
      );
    case "techs":
      return <SettingsTechs technicians={await demoDataAccess.settings.technicians()} />;
    case "places":
      return <SettingsPlaces places={await demoDataAccess.settings.places()} />;
    case "reasons": {
      const [reasons, approvalText] = await Promise.all([
        demoDataAccess.settings.reasons(),
        demoDataAccess.reference.approvalText(),
      ]);
      return (
        <>
          <SettingsReasons reasons={reasons} />
          <SettingsReasonsFixedText approvalText={approvalText} />
        </>
      );
    }
    case "types":
      return <SettingsCallTypes types={await demoDataAccess.settings.callTypes()} />;
    case "mail":
      return <SettingsMail mail={await demoDataAccess.settings.mail()} />;
    case "template":
      return <SettingsTemplate template={await demoDataAccess.settings.template()} />;
  }
  // Unreachable while `role` is unused by the bodies; kept so a new tab fails the type check.
  void role;
  return null;
}

// Settings (docs/demo.html offSettings(), L935-976, as amended by demo-deviations SE-01 to SE-16):
// one page per tab, "הגדרות · <tab>" with the tab column and the body. Which tabs a role sees
// follows settingsTabsOffered() (the Creator every tab, fixed, D33; a matrix role only where its
// `settings` value offers the operational tabs, D35; display only, G-04: enforcement is on the
// server and in the database). A role without the tab gets the "🔒 אין הרשאה" card, and no
// settings data is read for it. No "מדדי שימוש" (OF-15 PENDING d13).
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

  const tabs = offered.map((key) => ({
    key,
    label: SETTINGS_SECTION_LABELS[key],
    href: demoHref.settings(role, key),
    current: key === tab,
  }));

  return (
    <DemoOfficeFrame role={role} active="settings">
      <SettingsShell title={title} sub="הדגמה: שינויים כאן מדומים ולא נשמרים" tabs={tabs}>
        {await tabBody(role, tab)}
      </SettingsShell>
    </DemoOfficeFrame>
  );
}
