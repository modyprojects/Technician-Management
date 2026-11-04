import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { DoneVisitHeader, DoneVisitView } from "@/components/tech/DoneVisitView";
import { SyncVisitPanel } from "@/components/tech/SyncVisitPanel";
import { parseTechCalendarState } from "@/features/calendar/data/search-params";
import { isIsoDate } from "@/features/data-access/common";
import { DemoTechFrame } from "../../../../_components/DemoFrames";
import { demoDataAccess } from "../../../../_data/adapter";
import { notificationTimeLabel, TODAY } from "../../../../_data/dates";
import { techClosedVisitParams } from "../../../../_data/params";
import { DEMO_TECHNICIAN_ID } from "../../../../_data/roles";
import { demoHref } from "../../../../_data/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return techClosedVisitParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/tech/done/[req]/[n]">): Promise<Metadata> {
  const { req, n } = await params;
  const visit = await demoDataAccess.visits.doneVisit(DEMO_TECHNICIAN_ID, { req, n: Number(n) });
  return { title: visit ? `${visit.customer.name} · ביקור ${visit.n} · הדגמה` : "ביקור שהושלם · הדגמה" };
}

// The technician's own closed visit, read-only (docs/demo.html techDoneView() L663-680; TE-26, D14,
// D43): opened from "הושלמו היום" or from a closed visit's block in "היומן שלי".
// Reads only through the data-access layer: visits.doneVisit(DEMO_TECHNICIAN_ID, ref), null (404)
// for an open visit or another technician's visit (G-03: production takes the technician from
// the session, RLS enforces it), and sync.visit(DEMO_TECHNICIAN_ID, ref), the visit's sync state on
// the device (TE-23, TE-24; nothing when the device holds nothing about it). The visit itself has
// no actions (D14); the sync panel's "נסה שוב" and "סנכרן עכשיו" act on the device's queue only
// (useCommands().sync, simulated).
// "› חזרה" goes back where the visit was opened: the calendar link carries the calendar's
// ?view&date (features/calendar/data/search-params), so a valid `date` returns to that calendar
// view with "יומן" selected below; otherwise it returns to "הושלמו היום" (the demo's back).
export default async function TechDoneVisitPage({ params, searchParams }: PageProps<"/dev/demo/tech/done/[req]/[n]">) {
  const [{ req, n }, sp] = await Promise.all([params, searchParams]);
  const ref = { req, n: Number(n) };
  const [visit, sync] = await Promise.all([
    demoDataAccess.visits.doneVisit(DEMO_TECHNICIAN_ID, ref),
    demoDataAccess.sync.visit(DEMO_TECHNICIAN_ID, ref),
  ]);
  if (!visit) notFound();

  const rawDate = Array.isArray(sp.date) ? sp.date[0] : sp.date;
  const calendar = isIsoDate(rawDate) ? parseTechCalendarState(sp, TODAY) : null;
  const back = calendar
    ? { href: demoHref.techCalendar(calendar.view, calendar.date), label: "חזרה ליומן", tab: "cal" as const }
    : { href: demoHref.techDone(), label: "חזרה לרשימת הושלמו היום", tab: "home" as const };

  return (
    <DemoTechFrame
      activeTab={back.tab}
      activeIsCurrent={false}
      head={<DoneVisitHeader visit={visit} backHref={back.href} backAriaLabel={back.label} />}
    >
      <DoneVisitView visit={visit} sync={sync ? <SyncVisitPanel sync={sync} timeLabel={notificationTimeLabel} /> : undefined} />
    </DemoTechFrame>
  );
}
