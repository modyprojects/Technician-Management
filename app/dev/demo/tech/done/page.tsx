import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DoneList, DoneListHeader } from "@/components/tech/DoneList";
import { Pager } from "@/components/ui/Pager";
import { clampPage } from "@/features/data-access/common";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";
import { demoHref } from "../../_data/routes";

export const metadata: Metadata = { title: "הושלמו היום · טכנאי · הדגמה" };

// "הושלמו היום" (docs/demo.html techDoneList() L657-662; TE-26: same look, read-only, D14), opened
// from "הושלמו ›" on the technician home. Reads only through the data-access layer:
// visits.doneVisits(DEMO_TECHNICIAN_ID, TODAY, { page }) (paged, at most 100 per page; G-03:
// production takes the technician from the session). Each row is a link to the closed visit's
// read-only view (demoHref.techDoneVisit). No commands: nothing on this screen changes data.
// The fixtures have no visit closed today, so the demo's empty state shows; a close simulated on
// the close screen is not saved (G-02) and does not appear here.
export default async function TechDonePage({ searchParams }: PageProps<"/dev/demo/tech/done">) {
  const { page } = await searchParams;
  const done = await demoDataAccess.visits.doneVisits(DEMO_TECHNICIAN_ID, TODAY, { page: clampPage(page) });
  if (!done) notFound();
  return (
    <DemoTechFrame activeTab="home" activeIsCurrent={false} head={<DoneListHeader total={done.total} backHref={demoHref.tech()} />}>
      <DoneList
        entries={done.items.map((v) => ({ visit: v, href: demoHref.techDoneVisit(v.req, v.n) }))}
        pager={
          <Pager
            page={done.page}
            pageCount={done.pageCount}
            prevHref={done.page > 1 ? demoHref.techDone(done.page - 1) : null}
            nextHref={done.page < done.pageCount ? demoHref.techDone(done.page + 1) : null}
            label="עמודי הביקורים שהושלמו"
          />
        }
      />
    </DemoTechFrame>
  );
}
