import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { AccountAdminScreen } from "@/components/office/AccountAdminScreen";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { SimulatedCommandsProvider } from "../../../_components/SimulatedCommands";
import { demoDataAccess } from "../../../_data/adapter";
import { officeRoleParams } from "../../../_data/params";
import { accountAdminScope, isOfficeRole, officeHomeLabel, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder } from "../_Placeholder";
import { accountAdminState } from "../_simulatedState";
import { loadAccountAdmin } from "./_accounts";

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
// a matrix key (SE-03): Customer Service and Technician accounts, "+ בקשת חשבון שירות לקוחות"
// (pending until the Creator approves), "+ הוספת טכנאי" (immediate), immediate deactivation
// (audited, the Creator is notified in the app) and "הבקשות שלי". New UI in the demo's visual
// language (its setUsers() table, L943). Reads through demoDataAccess.accounts (./_accounts.ts);
// acts through useCommands().accounts (simulated in the demo). Who sees it follows
// accountAdminScope() (display only, G-04): the Manager ("cs-tech"); the Creator manages every
// account on Settings › משתמשים והרשאות; customer service has no account administration.
export default async function OfficeUsersPage({ params }: PageProps<"/dev/demo/office/[role]/users">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const scope = accountAdminScope(role);
  const [permissions, admin] = await Promise.all([
    demoDataAccess.reference.permissions(role),
    scope === "cs-tech" ? loadAccountAdmin(role) : null,
  ]);

  return (
    <DemoOfficeFrame role={role} active="users">
      <div className="ptitle">
        <div>
          <h1>ניהול משתמשים</h1>
          {admin && <div className="sub">חשבונות שירות לקוחות וטכנאים · הדגמה: פעולות מדומות ולא נשמרות</div>}
        </div>
      </div>
      {admin ? (
        // The simulated commands check the accounts and requests in the Manager's scope only.
        <SimulatedCommandsProvider state={accountAdminState(admin)}>
          <AccountAdminScreen {...admin} />
        </SimulatedCommandsProvider>
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
