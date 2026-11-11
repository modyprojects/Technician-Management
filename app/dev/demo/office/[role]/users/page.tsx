import type { Metadata } from "next";
import { notFound, redirect } from "next/navigation";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { officeRoleParams } from "../../../_data/params";
import { accountAdminScope, demoLandingBack, isOfficeRole, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";
import { NoAccessPlaceholder } from "../_Placeholder";

// Every office role is built: the Manager is redirected to Settings › "משתמשים", customer service
// gets "אין הרשאה", the Creator a link to Settings.
export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/users">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `ניהול משתמשים · ${VIEWPOINTS[role].label} · הדגמה` };
}

// The former "ניהול משתמשים" address. Since D57 (1) the Manager's account administration (SE-01,
// D34; a fixed capability, never a matrix key, SE-03) is the Settings tab "משתמשים"
// (../settings/[tab], tab "accounts"): this route stays so old links and bookmarks keep working,
// and for the Manager it only redirects there (307) before rendering, reading no account data.
// Who sees what follows accountAdminScope() (display only, G-04): the Creator manages every
// account on Settings › משתמשים והרשאות; customer service has no account administration.
export default async function OfficeUsersPage({ params }: PageProps<"/dev/demo/office/[role]/users">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const scope = accountAdminScope(role);
  if (scope === "cs-tech") redirect(demoHref.settings(role, "accounts"));
  const back = demoLandingBack(role, await demoDataAccess.reference.permissions(role));

  return (
    <DemoOfficeFrame role={role} active="users">
      <div className="ptitle">
        <div>
          <h1>ניהול משתמשים</h1>
        </div>
      </div>
      {scope === "all" ? (
        <NoAccessPlaceholder
          id="users-creator"
          heading="בהגדרות"
          icon="⚙️"
          text="היוצר מנהל את כל החשבונות ומאשר את בקשות המנהל בהגדרות › משתמשים והרשאות."
          {...back}
          extra={{ href: demoHref.settings(role, "users"), label: "למשתמשים והרשאות" }}
        />
      ) : (
        <NoAccessPlaceholder
          id="users-no-access"
          text="לתפקיד הזה אין ניהול משתמשים. חשבונות מנוהלים על ידי המנהל והיוצר."
          {...back}
        />
      )}
    </DemoOfficeFrame>
  );
}
