import type { Metadata } from "next";
import { DevicePickups } from "@/components/tech/DevicePickups";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { NextVisitCard, NextVisitEmpty } from "@/components/tech/NextVisitCard";
import { ScheduleList, type ScheduleEntry } from "@/components/tech/ScheduleList";
import { TechHomeHeader } from "@/components/tech/TechHomeHeader";
import { TechShell } from "@/components/tech/TechShell";
import { PlaceWazeLink } from "@/components/tech/VisitLinks";
import { UnsentMarker } from "@/components/tech/visit-flow/UnsentMarker";
import { dayName, ddmm } from "@/features/calendar/data/dates";
import { wazeHref } from "@/features/visits/data/links";
import { TECH_DONE_PATH, techVisitPath } from "@/features/visits/data/paths";
import { greetingAt, jerusalemToday } from "@/features/visits/data/today";
import type { TechDayVisitWithId } from "@/features/visits/data/types";
import { requireArea } from "@/lib/auth/guards";
import { techVisitsQueries } from "@/lib/data/supabase/tech-visits";
import { TECH_START_HREFS, TECH_START_TABS } from "./_tabs";

export const metadata: Metadata = { title: "היום · ניהול טכנאים" };

// The technician home, "היום" (docs/demo.html techHome() L477-516; TE-01 to TE-04, TE-31 to TE-33;
// Step 3, QA T-02, T-03, T-07), on real data only (D61): the signed-in Technician's own visits of
// today (Asia/Jerusalem), read under his own session (RLS and my_technician_id(), Migration 3;
// lib/data/supabase/tech-visits.ts). Everything on it is derived from the server's rows on every
// request (T-02): the counters "ביקורים היום" (open visits) and "הושלמו ›" (visits closed as "טופל"
// or "המשך טיפול", both complete the visit, D60 (2), T-03), the next-visit card (in progress, else en
// route, else the first scheduled), the empty-day message, "מה לאסוף לפני יציאה" (hidden when there
// is nothing to collect, T-07) and "לו"ז היום". Five statuses only (D60 (1)): a cancelled visit is
// never listed or counted.
// TEMPORARY (Step 3; the visit flow follows in the next screen): the next-visit card offers "ניווט ·
// Waze" (a plain Waze link, no status change) instead of "יוצא · Waze"; "נאסף" is kept on this
// device (DevicePickups, labelled); no bell (no notifications until Step 7, TE-28); no "יומן ›"
// until the calendar is built.
// The guard runs here (requireArea("tech")): anonymous visitors go to /login, other roles to the
// no-access state. A failed read throws (a code only, logged): the page fails closed.
export default async function TechHomePage() {
  const me = await requireArea("tech");
  const queries = await techVisitsQueries(me);
  const now = new Date();
  const date = jerusalemToday(now);
  const day = await queries.day(date);

  const entry = (v: TechDayVisitWithId): ScheduleEntry => ({ visit: v, href: techVisitPath(v.id) });
  // D95 (22.11 (e)): "לא נשלח" while this device holds data of an open visit not yet confirmed.
  const openEntry = (v: TechDayVisitWithId): ScheduleEntry => ({ ...entry(v), sync: <UnsentMarker visitId={v.id} userId={me.id} /> });
  const placeActions = Object.fromEntries(day.pickups.map((g) => [g.place, <PlaceWazeLink key={g.place} place={g.place} address={g.placeAddress} />]));
  const next = day.next;
  const nextWaze = next ? wazeHref(next.address) : null;
  const showsTestData = me.isTest || [...day.open, ...day.closed].some((v) => v.isTest);

  return (
    <TechShell
      head={
        <TechHomeHeader
          dateLine={`יום ${dayName(day.date)} · ${ddmm(day.date)}.${day.date.slice(0, 4)}`}
          greeting={`${greetingAt(now)}, ${day.technician.name}`}
          isTest={me.isTest}
          initial={day.technician.name.trim().charAt(0)}
          avatarColor={day.technician.color}
          visitsToday={day.stats.open}
          completed={day.stats.completed}
          completedHref={TECH_DONE_PATH}
        />
      }
      activeTab="home"
      navTabs={TECH_START_TABS}
      navHrefs={TECH_START_HREFS}
    >
      {showsTestData && <TestDataBanner />}
      {next ? (
        <NextVisitCard visit={next} detailsHref={techVisitPath(next.id)} navigate={nextWaze ? { href: nextWaze } : undefined} />
      ) : (
        <NextVisitEmpty completed={day.stats.completed} />
      )}
      <DevicePickups groups={day.pickups} technicianId={day.technician.id} date={day.date} placeActions={placeActions} />
      <ScheduleList open={day.open.map(openEntry)} closed={day.closed.map(entry)} />
    </TechShell>
  );
}
