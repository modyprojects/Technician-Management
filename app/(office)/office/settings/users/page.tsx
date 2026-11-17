import type { Metadata } from "next";
import { AccountNoticesCard } from "@/components/office/AccountNoticesCard";
import type { CreatorNoticeEntry, CreationIntentEntry } from "@/components/office/AccountAdminParts";
import { SettingsNoAccess } from "@/components/office/SettingsNoAccess";
import { SettingsShell } from "@/components/office/SettingsShell";
import { UserManagementScreen } from "@/components/office/UserManagementScreen";
import { USER_MANAGEMENT_TITLES, userManagementRowOf } from "@/components/office/UserManagementRules";
import type { AccountActions } from "@/features/accounts/data/actions";
import { ownIntents } from "@/features/accounts/data/offers";
import { accountTimeLabel } from "@/features/accounts/data/time-label";
import { OFFICE_START_PATH, officeStartItem } from "@/features/auth/landing";
import { accountAdminScope } from "@/features/auth/roles";
import { MAX_PAGE_LIMIT } from "@/features/data-access/common";
import { isOfficeRole } from "@/features/reference/data/types";
import {
  activateAccount,
  cancelCreation,
  changeEmail,
  changeRole,
  completeCreation,
  completeTechnicianProfile,
  createAccount,
  createTechnician,
  deactivateAccount,
  deleteAccount,
  setPassword,
  updateProfile,
  updateTechnician,
} from "@/lib/actions/accounts";
import { requireArea } from "@/lib/auth/guards";
import { accountsQueries } from "@/lib/data/supabase/accounts";
import { OfficeFrame } from "../../_OfficeFrame";

export const metadata: Metadata = { title: "הגדרות · משתמשים · ניהול טכנאים" };

/** The real account actions handed to the screen (components/ never imports lib/actions). */
const ACTIONS: AccountActions = {
  createAccount,
  createTechnician,
  completeCreation,
  cancelCreation,
  completeTechnicianProfile,
  deactivateAccount,
  activateAccount,
  updateProfile,
  updateTechnician,
  changeRole,
  setPassword,
  changeEmail,
  deleteAccount,
};

/** The notices card's sub-line on the real screen (no "בקשות לאישור", C-02; a Manager's creations, D67 (b)). */
const NOTICES_SUB = 'חשבונות שהמנהל יצר או השבית, ושינויים במייל ב-Outlook של טכנאים שביצעו אחרים. אין סימון "נקרא".';

// Settings › "משתמשים" (the Manager) and Settings › "משתמשים והרשאות" (the Creator): the real
// unified user management (D60 (7); QA M-06, M-10, C-01, C-02, C-09; D57 (1), D60 (8)), one screen
// component for both roles (components/office/UserManagementScreen.tsx) with the controls of the
// viewer's scope. Real data only (D61): every list is read under the viewer's own session (RLS) by
// lib/data/supabase/accounts.ts, bounded (at most 100), deleted accounts left out; every action is a
// server action that re-validates its input, takes the caller from the session and lets the
// database decide before any Auth Admin call (lib/actions/accounts.ts).
// Guard, at the time of the request (never a layout or the proxy): requireArea("office") sends
// anonymous visitors to /login and Technicians or accounts without access to the no-access state;
// an office role without account administration (Customer Service) gets "אין הרשאה" and no account
// data is read for it. A failed read throws (a code only, logged): the page fails closed.
export default async function SettingsUsersPage() {
  const me = await requireArea("office");
  const scope = isOfficeRole(me.role) ? accountAdminScope(me.role) : null;
  if (!scope) {
    const start = officeStartItem(me.role);
    return (
      <OfficeFrame me={me} active="settings">
        <div className="ptitle">
          <h1>הגדרות</h1>
        </div>
        <SettingsNoAccess
          text="ניהול המשתמשים זמין למנהל וליוצר בלבד."
          backHref={OFFICE_START_PATH}
          backLabel={start?.label ?? "מסך הפתיחה"}
        />
      </OfficeFrame>
    );
  }

  const queries = await accountsQueries();
  const now = new Date();
  const [list, intents, notices] = await Promise.all([
    queries.list({ limit: MAX_PAGE_LIMIT }),
    queries.openCreations({ limit: MAX_PAGE_LIMIT }),
    scope === "all" ? queries.creatorNotices({ limit: MAX_PAGE_LIMIT }) : Promise.resolve(null),
  ]);
  // The Manager: his own intents only (the query already asks for them; kept as defence in depth).
  // The Creator: every open intent, so he can cancel another's (review S3); completing stays the
  // requester's (the screen offers it on his own rows only, the server checks it).
  const own = scope === "all" ? intents : ownIntents(intents, me.id);
  const intentEntries: CreationIntentEntry[] = own.items.map((intent) => ({ intent, startedLabel: accountTimeLabel(intent.authorizedAt, now) }));
  const noticeEntries: CreatorNoticeEntry[] | null = notices
    ? notices.items.map((notice) => ({ notice, atLabel: accountTimeLabel(notice.at, now) }))
    : null;

  return (
    <OfficeFrame me={me} active="settings">
      <SettingsShell title={USER_MANAGEMENT_TITLES[scope]} tabs={[]}>
        {notices && noticeEntries && (
          <AccountNoticesCard notices={{ items: noticeEntries, total: notices.total, limit: notices.limit }} sub={NOTICES_SUB} />
        )}
        <UserManagementScreen
          scope={scope}
          self={{ id: me.id, name: me.name }}
          rows={{ items: list.items.map(userManagementRowOf), total: list.total, limit: list.limit }}
          intents={{ items: intentEntries, total: own.total, limit: own.limit }}
          actions={ACTIONS}
        />
        {scope === "all" && (
          // The permission matrix (SE-02, D33) is not built on the real screen yet (Step 10, D51).
          <div className="note">מטריצת ההרשאות (&quot;מה כל הרשאה רואה&quot;) עדיין לא נבנתה במסך הזה. היא תתווסף בשלב מסכי ההגדרות.</div>
        )}
      </SettingsShell>
    </OfficeFrame>
  );
}
