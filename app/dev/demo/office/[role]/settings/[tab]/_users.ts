// Loader of Settings › "משתמשים והרשאות" (SE-01, SE-02): reads the accounts, the account
// requests and the permission matrix through the data-access layer and returns the DTO props of
// components/office/SettingsUsersTab. Server-only (the adapter is server-only).
// Usage in the settings page, for the "users" tab:
//   <SettingsUsersTab {...await loadSettingsUsers(role)} />
// The tab is offered to the Creator only (roles.ts settingsTabsOffered). For any other role the
// loader returns no account administration and a read-only matrix (display only, G-04; the matrix
// is changed only through a Creator-only server function, D33).
import type { SettingsUsersTabProps } from "@/components/office/SettingsUsersTab";
import type { OfficeRole } from "@/features/reference/data/types";
import { demoDataAccess } from "../../../../_data/adapter";
import { loadAccountAdmin } from "../../users/_accounts";

export async function loadSettingsUsers(role: OfficeRole): Promise<SettingsUsersTabProps> {
  const creator = role === "creator";
  const [admin, matrix] = await Promise.all([creator ? loadAccountAdmin(role) : null, demoDataAccess.settings.permissionMatrix()]);
  return { admin, matrix, matrixEditable: creator };
}
