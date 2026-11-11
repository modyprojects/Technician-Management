import type { Bounded } from "@/features/data-access/common";
import type { PermissionMatrix } from "@/features/settings/data/types";
import type { AccountAdminData, CreatorNoticeEntry } from "./AccountAdminParts";
import { AccountAdminScreen } from "./AccountAdminScreen";
import { AccountNoticesCard } from "./AccountNoticesCard";
import { SettingsMatrix } from "./SettingsMatrix";

// Settings › "משתמשים והרשאות" (docs/demo.html setUsers() L942-946, as changed by demo-deviations
// SE-01, SE-02, SE-03, SIM-18). Server Component: it takes DTO props only; the page reads them
// through the data-access layer (the demo's loader: app/dev/demo/office/[role]/settings/[tab]/_users.ts).
// Sections, in the demo's order with the new sections:
// 0. "התראות חשבונות": the Creator's account notices (Step 2 PR 2.3, AccountNoticesCard; first on
//    the tab: TEMPORARY Q13, the demo placement shown to the owner; SE-18 PROPOSED).
// 1. "משתמשים": every account, role pills, 🧪 for test users, "+ הוספת משתמש", the row actions and
//    the incomplete creations (AccountAdminScreen).
// 2. "בקשות לאישור": the Manager's Customer Service requests, approve / reject with a reason.
// 3. "מה כל הרשאה רואה": the permission matrix (SettingsMatrix), editable by the Creator only.
// The tab is offered to the Creator only (the matrix and Manager / Creator accounts are Creator
// capabilities, D33, D34). For any other viewer `admin` is null and the matrix is read-only.
// Display only (G-04): what is offered here is not access control.

export type SettingsUsersTabProps = {
  /** Account administration (the Creator: scope "all"); null shows the matrix only. */
  admin: AccountAdminData | null;
  /** The Creator's account notices; null renders nothing (every other viewer: never loaded). */
  notices: Bounded<CreatorNoticeEntry> | null;
  matrix: PermissionMatrix;
  /** Only the Creator edits the matrix (D33). */
  matrixEditable: boolean;
  /** A line about the data source under the matrix (the UI demo: values only drive the demo, nothing is saved). */
  matrixNote?: string;
};

export function SettingsUsersTab({ admin, notices, matrix, matrixEditable, matrixNote }: SettingsUsersTabProps) {
  return (
    <>
      {notices && <AccountNoticesCard notices={notices} />}
      {admin && <AccountAdminScreen {...admin} />}
      <SettingsMatrix matrix={matrix} editable={matrixEditable} note={matrixNote} />
    </>
  );
}
