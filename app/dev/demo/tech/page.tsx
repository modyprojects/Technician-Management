import type { Metadata } from "next";
import Link from "next/link";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { PickupsCard } from "@/components/tech/PickupsCard";
import { ScheduleList, type ScheduleEntry } from "@/components/tech/ScheduleList";
import { queueItemRef } from "@/components/tech/SyncLabels";
import { SyncVisitPill } from "@/components/tech/SyncQueue";
import { SyncQueueBanner, type SyncVisitInfo } from "@/components/tech/SyncQueueBanner";
import { TechHomeHeader } from "@/components/tech/TechHomeHeader";
import type { DeviceSyncSnapshot } from "@/features/sync/data/types";
import { visitRefKey, type TechDayVisit, type VisitRef } from "@/features/visits/data/types";
import { DemoTechFrame } from "../_components/DemoFrames";
import { demoDataAccess } from "../_data/adapter";
import { dayName, ddmm, notificationTimeLabel, TODAY } from "../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../_data/roles";
import { demoHref } from "../_data/routes";
import { PlaceWazeButton } from "./_DemoNav";
import { NextVisit } from "./_NextVisit";
import { LiveStatusPill } from "./_VisitStatus";

export const metadata: Metadata = { title: "היום · טכנאי · הדגמה" };

// Technician home, "היום" (docs/demo.html techHome() L477-516; TE-01 to TE-04, TE-33).
// Reads only through the data-access layer: visits.techDay(DEMO_TECHNICIAN_ID, TODAY) and
// notifications.unreadCount(DEMO_TECHNICIAN_ID) (G-03: production takes the technician from the
// session). Header: date, greeting, avatar, bell with the unread count (link to the
// notifications), "ביקורים היום" and "הושלמו ›" (link to "הושלמו היום"). Then the next-visit card ("יוצא · Waze" runs useCommands().visits.depart, TE-02),
// "מה לאסוף לפני יציאה" grouped by place (TE-03) and "לו"ז היום" (TE-04) linking to each visit
// card, with "יומן ›" linking to the calendar. The visit statuses on this screen follow the depart, arrive and close actions
// (VisitStatusProvider in app/dev/demo/tech/layout.tsx).
// Device sync (TE-23, TE-24; D06, D46): sync.device(DEMO_TECHNICIAN_ID) gives the work queue. While
// it holds items, a small banner above the next visit says how many have not reached the server,
// with "סנכרן עכשיו" and one line per visit with its sync pill (customer and link read through
// visits.get; the visit card's sync panel has each item and "נסה שוב"); a visit of today that the
// device holds work of shows its sync pill in "לו"ז היום". The actions are simulated
// (useCommands().sync, nested in the technician layout).
export default async function TechHomePage() {
  const [day, unread, device] = await Promise.all([
    demoDataAccess.visits.techDay(DEMO_TECHNICIAN_ID, TODAY),
    demoDataAccess.notifications.unreadCount(DEMO_TECHNICIAN_ID),
    demoDataAccess.sync.device(DEMO_TECHNICIAN_ID),
  ]);
  if (!day) notFound();
  const [visitInfo, syncPill] = await deviceViews(device);

  const refOf = (v: TechDayVisit) => ({ req: v.req, n: v.n });
  const open: ScheduleEntry[] = day.open.map((v) => ({
    visit: v,
    href: demoHref.visit(v.req, v.n),
    status: <LiveStatusPill visit={refOf(v)} status={v.status} />,
    sync: syncPill(v),
  }));
  // A closed visit opens its read-only view (the same view as "הושלמו היום", TE-26, D14).
  const closed: ScheduleEntry[] = day.closed.map((v) => ({
    visit: v,
    href: demoHref.techDoneVisit(v.req, v.n),
    sync: syncPill(v),
  }));
  const placeActions = Object.fromEntries(
    day.pickups.map((g) => [g.place, <PlaceWazeButton key={g.place} place={g.place} address={g.placeAddress} />]),
  );

  return (
    <DemoTechFrame
      activeTab="home"
      head={
        <TechHomeHeader
          dateLine={`יום ${dayName(day.date)} · ${ddmm(day.date)}.${day.date.slice(0, 4)}`}
          greeting={`בוקר טוב, ${day.technician.name}`}
          initial={day.technician.name.trim().charAt(0)}
          avatarColor={day.technician.color}
          unread={unread}
          visitsToday={day.stats.open}
          completed={day.stats.completed}
          notificationsHref={demoHref.techNotifications()}
          completedHref={demoHref.techDone()}
        />
      }
    >
      {device && <SyncQueueBanner snapshot={device} visitInfo={visitInfo} timeLabel={notificationTimeLabel} />}
      {day.next && <NextVisit visit={day.next} detailsHref={demoHref.visit(day.next.req, day.next.n)} />}
      <PickupsCard groups={day.pickups} placeActions={placeActions} />
      <ScheduleList
        open={open}
        closed={closed}
        calendarAction={
          <Link href={demoHref.techCalendar()} className="chip" style={{ padding: "4px 10px", fontSize: 12, minHeight: 24 }}>
            יומן ›
          </Link>
        }
      />
    </DemoTechFrame>
  );
}

/**
 * From the device snapshot: each queued visit's customer and link (the technician's own visits,
 * read through visits.get; the visit card shows a closed visit read-only, with "› היום" back to
 * this screen) and the sync pill of a visit the device holds work of (none otherwise).
 */
async function deviceViews(
  device: DeviceSyncSnapshot | null,
): Promise<[(ref: VisitRef) => SyncVisitInfo | null, (ref: VisitRef) => ReactNode]> {
  const visits = device?.visits.items ?? [];
  const queued = visits.filter((v) => v.operations.items.length > 0);
  const details = await Promise.all(queued.map((v) => demoDataAccess.visits.get({ req: v.req, n: v.n })));
  const info = new Map<string, SyncVisitInfo>();
  for (const d of details) {
    if (d && d.technician.id === DEMO_TECHNICIAN_ID) info.set(visitRefKey(d), { title: d.customer.name, href: demoHref.visit(d.req, d.n) });
  }
  const byKey = new Map(visits.map((v) => [visitRefKey(v), v]));
  return [
    (ref) => info.get(visitRefKey(ref)) ?? null,
    (ref) => {
      const v = byKey.get(visitRefKey(ref));
      return v ? <SyncVisitPill items={v.operations.items.map(queueItemRef)} fallback={v.state} /> : undefined;
    },
  ];
}
