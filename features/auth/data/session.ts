// The session user from the user's own profile, as every SessionQueries implementation builds it
// (Step 2 plan §3.3, §3.7 b). Pure: no I/O. Fail closed: no profile, an inactive one, or one whose
// role or id is not a known value means "no access" (null), never a guessed user.
import { isAccountRole, type AccountId, type AccountRole } from "@/features/accounts/data/types";
import type { TechnicianId } from "@/features/reference/data/types";
import type { SessionUser } from "./types";

/** The fields of the user's own profile that the session reads (Migration 1 `profiles`, `my_technician_id()`). */
export type SessionProfile = {
  id: AccountId;
  role: AccountRole;
  name: string;
  active: boolean;
  technicianId: TechnicianId | null;
  isTest: boolean;
};

/** The SessionUser of a profile, or null (no access) when there is none, it is inactive or malformed. */
export function sessionUserOf(profile: SessionProfile | null | undefined): SessionUser | null {
  if (!profile || typeof profile !== "object" || profile.active !== true) return null;
  if (typeof profile.id !== "string" || profile.id === "" || !isAccountRole(profile.role) || typeof profile.name !== "string") return null;
  return {
    id: profile.id,
    role: profile.role,
    name: profile.name,
    technicianId: typeof profile.technicianId === "string" ? profile.technicianId : null,
    isTest: profile.isTest !== false,
  };
}
