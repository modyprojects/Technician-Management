import type { Metadata } from "next";
import { DoneList, DoneListHeader } from "@/components/tech/DoneList";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { TechShell } from "@/components/tech/TechShell";
import { TECH_HOME_PATH, techVisitPath } from "@/features/visits/data/paths";
import { jerusalemToday } from "@/features/visits/data/today";
import { requireArea } from "@/lib/auth/guards";
import { techVisitsQueries } from "@/lib/data/supabase/tech-visits";
import { TECH_START_HREFS, TECH_START_TABS } from "../_tabs";

export const metadata: Metadata = { title: "הושלמו היום · ניהול טכנאים" };

// "הושלמו היום" (docs/demo.html techDoneList() L657-662; TE-26; QA T-02, T-03), on real data only
// (D61): the signed-in Technician's visits of today closed as "טופל" or "המשך טיפול" (both complete
// the visit, D60 (2)), from the same server read as the home screen, so the list and the home's
// "הושלמו" counter always agree. Each row opens the visit's read-only view (D14). A cancelled visit
// is never listed (D60 (1)). The day is bounded (at most 100 visits), so no pager is needed.
export default async function TechDonePage() {
  const me = await requireArea("tech");
  const queries = await techVisitsQueries(me);
  const day = await queries.day(jerusalemToday());
  return (
    <TechShell
      head={<DoneListHeader total={day.closed.length} backHref={TECH_HOME_PATH} />}
      activeTab="home"
      activeIsCurrent={false}
      navTabs={TECH_START_TABS}
      navHrefs={TECH_START_HREFS}
    >
      {(me.isTest || day.closed.some((v) => v.isTest)) && <TestDataBanner />}
      <DoneList entries={day.closed.map((v) => ({ visit: v, href: techVisitPath(v.id) }))} />
    </TechShell>
  );
}
