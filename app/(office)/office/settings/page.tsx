import { redirect } from "next/navigation";
import { OFFICE_SETTINGS_USERS_PATH } from "@/features/auth/landing";
import { requireArea } from "@/lib/auth/guards";

// "הגדרות" (D57 (1), D60 (8)): opens the role's first built Settings screen, the user management
// (D60 (7)). The guard runs first, at the time of the request (requireArea: anonymous → /login,
// another area or no access → /login?state=no-access); the target page checks the role again.
export default async function OfficeSettingsPage() {
  await requireArea("office");
  redirect(OFFICE_SETTINGS_USERS_PATH);
}
