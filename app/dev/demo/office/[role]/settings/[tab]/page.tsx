import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { AccountAdminScreen } from "@/components/office/AccountAdminScreen";
import { SettingsCallTypes } from "@/components/office/SettingsCallTypes";
import { SettingsMail } from "@/components/office/SettingsMail";
import { SettingsPlaces } from "@/components/office/SettingsPlaces";
import { SettingsReasons } from "@/components/office/SettingsReasons";
import { SettingsReasonsFixedText } from "@/components/office/SettingsReasonsFixedText";
import { SettingsShell } from "@/components/office/SettingsShell";
import { SettingsTechs } from "@/components/office/SettingsTechs";
import { SettingsTemplate } from "@/components/office/SettingsTemplate";
import { SettingsUsersTab } from "@/components/office/SettingsUsersTab";
import type { OfficeRole } from "@/features/reference/data/types";
import { isSettingsSection, SETTINGS_SECTION_LABELS, type SettingsSection } from "@/features/settings/data/types";
import { DemoOfficeFrame } from "../../../../_components/DemoFrames";
import { SimulatedCommandsProvider, type SimulatedServerState } from "../../../../_components/SimulatedCommands";
import { demoDataAccess } from "../../../../_data/adapter";
import { officeSettingsParams } from "../../../../_data/params";
import { accountAdminScope, demoLandingBack, isOfficeRole, settingsTabsOffered, VIEWPOINTS } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";
import { NoAccessPlaceholder } from "../../_Placeholder";
import { accountAdminState, settingsTabState } from "../../_simulatedState";
import { loadAccountAdmin } from "../../users/_accounts";
import { loadSettingsUsers } from "./_users";

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
 * inside those components (simulated in the UI demo). `state` is what the tab's simulated commands
 * check against stored data (scoped to the tab; ../../_simulatedState.ts).
 */
async function tabBody(role: OfficeRole, tab: SettingsSection): Promise<{ body: ReactNode; state: SimulatedServerState }> {
  switch (tab) {
    case "users": {
      // Account administration and the permission matrix (SE-01 to SE-03): ./_users.ts reads them
      // through the layer; offered to the Creator only (settingsTabsOffered).
      const props = await loadSettingsUsers(role);
      return { body: <SettingsUsersTab {...props} />, state: accountAdminState(props.admin) };
    }
    case "accounts": {
      // The Manager's account administration (SE-01, D34; D57 (1)): Customer Service and Technician
      // accounts and the Manager's own requests, read through demoDataAccess.accounts
      // (../../users/_accounts.ts). A fixed capability (accountAdminScope "cs-tech"), never the
      // matrix key `settings` (SE-03). Never the matrix (loadSettingsUsers / SettingsMatrix): that
      // stays Creator-only (D33). The page offers this tab only to the Manager; the check here is
      // defence in depth, so no other role reads account data through it.
      if (accountAdminScope(role) !== "cs-tech") return { body: null, state: {} };
      const admin = await loadAccountAdmin(role);
      if (!admin) return { body: null, state: {} };
      // The simulated commands check the accounts and requests in the Manager's scope only.
      return { body: <AccountAdminScreen {...admin} />, state: accountAdminState(admin) };
    }
    case "techs":
      return { body: <SettingsTechs technicians={await demoDataAccess.settings.technicians()} />, state: {} };
    case "places":
      return {
        body: <SettingsPlaces places={await demoDataAccess.settings.places()} />,
        state: await settingsTabState(tab),
      };
    case "reasons": {
      const [reasons, approvalText, state] = await Promise.all([
        demoDataAccess.settings.reasons(),
        demoDataAccess.reference.approvalText(),
        settingsTabState(tab),
      ]);
      return {
        body: (
          <>
            <SettingsReasons reasons={reasons} />
            <SettingsReasonsFixedText approvalText={approvalText} />
          </>
        ),
        state,
      };
    }
    case "types":
      return { body: <SettingsCallTypes types={await demoDataAccess.settings.callTypes()} />, state: {} };
    case "mail":
      return { body: <SettingsMail mail={await demoDataAccess.settings.mail()} note="בהדגמה לא נשלחים מיילים." />, state: {} };
    case "template":
      return { body: <SettingsTemplate template={await demoDataAccess.settings.template()} />, state: {} };
  }
}

/**
 * Why a role does not get a tab (display only, G-04). The matrix and every account are fixed
 * Creator capabilities (D33, D34); the Manager's accounts tab is the Manager's fixed capability
 * (D34, D57 (1)); "טכנאים" and "מיילים והתראות" are not D35 operational settings, so they stay
 * Creator-only until the owner decides (temporary deny by default, recorded as an open owner
 * question); the other tabs follow the matrix key `settings` (D35).
 */
function noAccessText(tab: SettingsSection, scope: ReturnType<typeof accountAdminScope>): string {
  switch (tab) {
    case "users":
      return scope === "cs-tech"
        ? "משתמשים והרשאות מנוהלים על ידי היוצר. חשבונות שירות לקוחות וטכנאים מנוהלים בלשונית \"משתמשים\"."
        : "זמין ליוצר בלבד: ניהול החשבונות ומטריצת ההרשאות הם יכולות קבועות של היוצר.";
    case "accounts":
      return scope === "all"
        ? "היוצר מנהל את כל החשבונות ומאשר את בקשות המנהל בלשונית משתמשים והרשאות."
        : "לתפקיד הזה אין ניהול משתמשים. חשבונות מנוהלים על ידי המנהל והיוצר.";
    case "techs":
    case "mail":
      return "בשלב זה הלשונית פתוחה ליוצר בלבד, עד החלטת הבעלים. היא לא נקבעת במטריצת ההרשאות.";
    default:
      return "לתפקיד הזה אין הרשאה למסך ההגדרות הזה. את ההרשאה \"הגדרות\" קובע היוצר במטריצת ההרשאות.";
  }
}

/** Where a role finds the account administration it has, from a tab it does not get (or null). */
function accountsLink(role: OfficeRole, scope: ReturnType<typeof accountAdminScope>, tab: SettingsSection) {
  if (scope === "cs-tech") return { href: demoHref.settings(role, "accounts"), label: "לניהול משתמשים" };
  if (scope === "all" && tab === "accounts") return { href: demoHref.settings(role, "users"), label: "למשתמשים והרשאות" };
  return undefined;
}

/** The sub-line under a tab's title. */
const TAB_SUB: Partial<Record<SettingsSection, string>> = {
  accounts: "חשבונות שירות לקוחות וטכנאים · הדגמה: פעולות מדומות ולא נשמרות",
};

/** The no-access card of a tab (no settings or account data is read for it). */
function NoAccessTab({
  role,
  tab,
  scope,
  back,
}: {
  role: OfficeRole;
  tab: SettingsSection;
  scope: ReturnType<typeof accountAdminScope>;
  /** The "חזרה ל…" link: the role's landing item (D57). */
  back: { backHref: string; backLabel: string };
}) {
  // The Creator is not refused account administration: it is on "משתמשים והרשאות" (a pointer).
  const creatorPointer = scope === "all" && tab === "accounts";
  return (
    <DemoOfficeFrame role={role} active="settings">
      <div className="ptitle">
        <div>
          <h1>הגדרות · {SETTINGS_SECTION_LABELS[tab]}</h1>
        </div>
      </div>
      <NoAccessPlaceholder
        id="set-no-access"
        text={noAccessText(tab, scope)}
        {...back}
        extra={accountsLink(role, scope, tab)}
        {...(creatorPointer ? { heading: "בלשונית משתמשים והרשאות", icon: "⚙️" } : {})}
      />
    </DemoOfficeFrame>
  );
}

// Settings (docs/demo.html offSettings(), L935-976, as amended by demo-deviations SE-01 to SE-16
// and D57 (1)): one page per tab, "הגדרות · <tab>" with the tab column (only with two or more tabs)
// and the body. Which tabs a role sees follows settingsTabsOffered() (the Creator's seven tabs,
// fixed, D33; the Manager's "משתמשים" (accounts), a fixed D34 capability, never `settings`; the
// operational tabs only where a matrix role's `settings` value offers them, D35; display only,
// G-04: enforcement is on the server and in the database). A role without the tab gets the
// "🔒 אין הרשאה" card, and no settings or account data is read for it. No "מדדי שימוש" (OF-15
// PENDING d13).
export default async function OfficeSettingsPage({ params }: PageProps<"/dev/demo/office/[role]/settings/[tab]">) {
  const { role, tab } = await params;
  if (!isOfficeRole(role) || !isSettingsSection(tab)) notFound();
  const permissions = await demoDataAccess.reference.permissions(role);
  const offered = settingsTabsOffered(role, permissions);
  const title = SETTINGS_SECTION_LABELS[tab];
  const scope = accountAdminScope(role);
  const back = demoLandingBack(role, permissions);

  if (!offered.includes(tab)) return <NoAccessTab role={role} tab={tab} scope={scope} back={back} />;

  const tabs = offered.map((key) => ({
    key,
    label: SETTINGS_SECTION_LABELS[key],
    href: demoHref.settings(role, key),
    current: key === tab,
  }));

  const { body, state } = await tabBody(role, tab);
  if (body === null) return <NoAccessTab role={role} tab={tab} scope={scope} back={back} />;
  return (
    <DemoOfficeFrame role={role} active="settings">
      <SettingsShell title={title} sub={TAB_SUB[tab] ?? "הדגמה: שינויים כאן מדומים ולא נשמרים"} tabs={tabs}>
        <SimulatedCommandsProvider state={state}>{body}</SimulatedCommandsProvider>
      </SettingsShell>
    </DemoOfficeFrame>
  );
}
