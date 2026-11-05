// The signed-in user as the app sees it (Step 2 plan §3.3, §3.7 b). Pure types. Display and
// identity only: no token, no email, no session material ever reaches a DTO (docs/security.md §8).
import type { AccountId, AccountRole } from "@/features/accounts/data/types";
import type { TestMarker } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";

/**
 * The session's user. The role comes only from the user's own `profiles` row, never from Auth
 * metadata (docs/security.md §5); `technicianId` is the technician record of a Technician
 * (Migration 1 `my_technician_id()`), null for office roles.
 */
export type SessionUser = TestMarker & {
  id: AccountId;
  role: AccountRole;
  name: string;
  technicianId: TechnicianId | null;
};
