import { redirect } from "next/navigation";
import { rootRedirect } from "@/features/auth/session-state";
import { getSessionState } from "@/lib/auth/session";

// The role-based start (Step 2 plan §1.1 S5; Step 2 PR 2.5), replacing the temporary home page of
// 2026-11-01: a signed-in user goes to his own area (office roles `/office`, technicians `/tech`),
// a session without access to the no-access state, everyone else to the sign-in screen.
export default async function RootPage() {
  redirect(rootRedirect(await getSessionState()));
}
