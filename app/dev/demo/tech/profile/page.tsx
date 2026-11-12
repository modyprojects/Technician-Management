import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { ProfileHeader } from "@/components/tech/ProfileHeader";
import { ProfilePreferences } from "@/components/tech/ProfilePreferences";
import { ProfileAccount, ProfileHelp, ProfileWeek } from "@/components/tech/ProfileSections";
import { pendingDecisionHint } from "@/components/ui/pending-hint";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { DemoSignOut } from "../../_components/DemoSignOut";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";
import { demoHref } from "../../_data/routes";

export const metadata: Metadata = { title: "פרופיל · טכנאי · הדגמה" };

// Technician profile, the "פרופיל" tab (docs/demo.html techProfile() L681-693; TE-29, TE-30).
// Reads only through the data-access layer: profile.technician(DEMO_TECHNICIAN_ID, TODAY) (name,
// phone, email, this week's figures, office phone) and notifications.preferences(...) (G-03:
// production takes the technician from the session).
// - "התראות": the toggles save through useCommands().notifications.setPreferences (simulated; the
//   demo's morning pickup toggle is removed, TE-28 / TE-29).
// - "חיוג למשרד": a dial is navigation, not a data action; production uses a `tel:` link, the demo
//   says what would open (data-sim, DemoToast).
// - "דיווח על תקלה באפליקציה" (TE-30, d26) is a disabled placeholder; the demo says it waits for
//   the owner's decision.
// - "חשבון" › "יציאה מהחשבון" (Step 2 PR 2.3, Q4 TEMPORARY; AU-02): simulated (DemoSignOut).
export default async function TechProfilePage() {
  const [profile, preferences] = await Promise.all([
    demoDataAccess.profile.technician(DEMO_TECHNICIAN_ID, TODAY),
    demoDataAccess.notifications.preferences(DEMO_TECHNICIAN_ID),
  ]);
  if (!profile) notFound();
  const office = profile.officePhone;
  return (
    <DemoTechFrame activeTab="prof" head={<ProfileHeader profile={profile} backHref={demoHref.tech()} />}>
      <ProfileWeek week={profile.week} />
      <ProfilePreferences initial={preferences} />
      <ProfileHelp
        officePhone={office}
        reportPendingHint={pendingDecisionHint("d26")}
        officeDial={
          office && (
            <button
              type="button"
              className="chip"
              aria-label={`חיוג למשרד · ${office}`}
              data-sim={`חיוג למשרד · ${office} · לא מתבצעת שיחה בהדגמה`}
            >
              חיוג
            </button>
          )
        }
      />
      <ProfileAccount signOut={<DemoSignOut variant="row" />} />
    </DemoTechFrame>
  );
}
