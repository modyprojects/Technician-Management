import type { Metadata } from "next";
import { TechCalDay } from "@/components/tech/calendar/TechCalDay";
import { TechCalHeader, type TechCalArrows } from "@/components/tech/calendar/TechCalHeader";
import { TechCalLegend } from "@/components/tech/calendar/TechCalLegend";
import { TechCalStrip } from "@/components/tech/calendar/TechCalStrip";
import { TechCalSwitch } from "@/components/tech/calendar/TechCalSwitch";
import { TechCalWeek } from "@/components/tech/calendar/TechCalWeek";
import { calendarModel, calendarWindow } from "@/components/tech/calendar/model";
import type { TechCalView } from "@/components/tech/calendar/types";
import { TechShell } from "@/components/tech/TechShell";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { TimeRange } from "@/components/ui/TimeRange";
import { addDays, dayName, ddmm } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { requireArea } from "@/lib/auth/guards";
import { techVisitsQueries } from "@/lib/data/supabase/tech-visits";
import { TECH_CALENDAR_PATH, TECH_START_HREFS, TECH_START_TABS } from "../_tabs";

export const metadata: Metadata = { title: "יומן · ניהול טכנאים" };

// The technician calendar (D83, D85, D89) on real data: the signed-in Technician's own visits of the
// current calendar week and the next (Sunday to Saturday, Asia/Jerusalem), read under his own session
// (RLS and my_technician_id(); lib/data/supabase/tech-visits.ts `calendar`). Daily: today and the
// next 6 days (day strip, no past days). Weekly: the current week or the next. In the current week
// the days before today are greyed and show only visits closed on them, in the reduced view; a visit
// left open on a previous day is not shown (D79). The rules are components/tech/calendar/model.ts.
// No monthly view, no bell. The URL is the state (?view=day|week&date=...), so every control is a
// link; "today" is always the server's clock (no override from the URL).
// The guard runs here (requireArea("tech")): anonymous visitors go to /login, other roles to the
// no-access state. A failed read throws (a code only, logged): the page fails closed.
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TechCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireArea("tech");
  const queries = await techVisitsQueries(me);
  const today = jerusalemToday();
  const span = calendarWindow(today);
  const visits = await queries.calendar(span.from, span.to, today);

  const sp = await searchParams;
  const m = calendarModel({ view: first(sp.view), date: first(sp.date) }, today, visits);
  const href = (view: TechCalView, date: string) => `${TECH_CALENDAR_PATH}?view=${view}&date=${date}`;

  const dayArrows: TechCalArrows = {
    prevHref: m.date > today ? href("day", addDays(m.date, -1)) : null,
    nextHref: m.date < m.lastStripDay ? href("day", addDays(m.date, 1)) : null,
  };
  const weekArrows: TechCalArrows = {
    prevHref: m.isNextWeek ? href("week", m.thisWeek) : null,
    nextHref: m.isNextWeek ? null : href("week", m.nextWeek),
    prevName: "השבוע הנוכחי",
    nextName: "השבוע הבא",
  };
  // A weekly heading opens the daily view only for a day that is in the strip.
  const stripDays = new Set(m.strip.map((d) => d.date));
  const shown = m.view === "day" ? m.strip : m.week;
  const showsTestData = me.isTest || shown.some((d) => d.visits.some((v) => v.isTest));

  return (
    <TechShell
      head={
        m.view === "day" ? (
          <TechCalHeader label={`${dayName(m.date)} ${ddmm(m.date)}`} arrows={dayArrows} />
        ) : (
          <TechCalHeader label={<TimeRange start={ddmm(m.weekStart)} end={ddmm(addDays(m.weekStart, 6))} />} arrows={weekArrows} />
        )
      }
      activeTab="cal"
      navTabs={TECH_START_TABS}
      navHrefs={TECH_START_HREFS}
    >
      {showsTestData && <TestDataBanner />}
      <TechCalSwitch view={m.view} hrefOf={(v) => (v === "week" ? href("week", m.view === "week" ? m.weekStart : m.date) : href("day", m.date))} />
      {m.view === "day" ? (
        <>
          <TechCalStrip days={m.strip} selected={m.date} dayHref={(d) => href("day", d)} />
          <TechCalLegend />
          <TechCalDay day={m.day} />
        </>
      ) : (
        <>
          <TechCalLegend />
          <TechCalWeek days={m.week} today={today} label={m.isNextWeek ? "השבוע הבא" : "השבוע"} dayHref={(d) => (stripDays.has(d) ? href("day", d) : null)} />
        </>
      )}
    </TechShell>
  );
}
