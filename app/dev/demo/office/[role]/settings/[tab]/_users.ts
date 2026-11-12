// Loader of Settings › "משתמשים והרשאות" (SE-01, SE-02): reads the accounts, the account
// requests, the Creator's account notices (Step 2 PR 2.3, "התראות חשבונות") and the permission
// matrix through the data-access layer and returns the DTO props of
// components/office/SettingsUsersTab. Server-only (the adapter is server-only).
// The notices are read only when the viewer is the Creator: the demo adapter has no caller to deny
// (features/accounts/data/ports.ts creatorNotices), so this loader is the gate; production also
// denies any other caller in the adapter.
// Usage in the settings page, for the "users" tab:
//   <SettingsUsersTab {...await loadSettingsUsers(role)} />
// The tab is offered to the Creator only (roles.ts settingsTabsOffered). For any other role the
// loader returns no account administration and a read-only matrix (display only, G-04; the matrix
// is changed only through a Creator-only server function, D33).
import type { CreatorNoticeEntry } from "@/components/office/AccountAdminParts";
import type { SettingsUsersTabProps } from "@/components/office/SettingsUsersTab";
import type { CreatorNotice } from "@/features/accounts/data/types";
import { MAX_PAGE_LIMIT, type Bounded } from "@/features/data-access/common";
import type { OfficeRole } from "@/features/reference/data/types";
import { demoDataAccess } from "../../../../_data/adapter";
import { notificationTimeLabel } from "../../../../_data/dates";
import { loadAccountAdmin } from "../../users/_accounts";

/** The Creator's notices with their times formatted for the card (Asia/Jerusalem, G-01). */
async function loadCreatorNotices(): Promise<Bounded<CreatorNoticeEntry>> {
  const page = await demoDataAccess.accounts.creatorNotices({ limit: MAX_PAGE_LIMIT });
  const entry = (notice: CreatorNotice): CreatorNoticeEntry => ({ notice, atLabel: notificationTimeLabel(notice.at) });
  return { items: page.items.map(entry), total: page.total, limit: page.limit };
}

export async function loadSettingsUsers(role: OfficeRole): Promise<SettingsUsersTabProps> {
  const creator = role === "creator";
  const [admin, notices, matrix] = await Promise.all([
    creator ? loadAccountAdmin(role) : null,
    creator ? loadCreatorNotices() : null,
    demoDataAccess.settings.permissionMatrix(),
  ]);
  return {
    admin,
    notices,
    matrix,
    matrixEditable: creator,
    matrixNote: "בהדגמה הערכים קובעים רק מה מוצג במסכי ההדגמה, ושינוי כאן לא נשמר.",
  };
}
