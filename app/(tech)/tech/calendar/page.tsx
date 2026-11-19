import type { Metadata } from "next";
import { TechCalDay } from "@/components/tech/calendar/TechCalDay";
import { TechCalHeader, type TechCalArrows } from "@/components/tech/calendar/TechCalHeader";
import { TechCalStrip } from "@/components/tech/calendar/TechCalStrip";
import { TechCalSwitch } from "@/components/tech/calendar/TechCalSwitch";
import { TechCalWeek } from "@/components/tech/calendar/TechCalWeek";
import type { FakeDay, TechCalView } from "@/components/tech/calendar/types";
import { TechShell } from "@/components/tech/TechShell";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { addDays, dayName, ddmm, weekStartOf } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { requireArea } from "@/lib/auth/guards";
import { TECH_CALENDAR_PATH, TECH_START_HREFS, TECH_START_TABS } from "../_tabs";
import { fakeCalendar } from "./_components/calendar-fake";

export const metadata: Metadata = { title: "יומן · ניהול טכנאים" };

// SKELETON (D81, D83): the technician calendar on fictional data. Daily: today and the next 6 days
// (day strip, no past days). Weekly: a calendar week, Sunday to Saturday, the current week and the
// next only. In the current week the days before today are greyed and show only visits closed that
// day; a visit left open on a previous day is not shown. No monthly view. The URL is the state
// (?view=day|week&date=...), so every control is a link. `today=` is a skeleton-only override of
// "today" for the review screenshots (fake data only). No bell. No database, no server logic beyond
// the role guard.
const ISO = /^\d{4}-\d{2}-\d{2}$/;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TechCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireArea("tech");
  const sp = await searchParams;
  const override = first(sp.today);
  const today = override && ISO.test(override) ? override : jerusalemToday();
  const href = (view: TechCalView, date: string) => `${TECH_CALENDAR_PATH}?view=${view}&date=${date}${today === override ? `&today=${today}` : ""}`;

  const all = fakeCalendar(today);
  const view: TechCalView = first(sp.view) === "week" ? "week" : "day";
  const wanted = first(sp.date) ?? today;

  // Daily: today..today+6.
  const last = addDays(today, 6);
  const strip: FakeDay[] = all.filter((d) => d.date >= today && d.date <= last);
  const date = strip.some((d) => d.date === wanted) ? wanted : today;
  const day = strip.find((d) => d.date === date) ?? strip[0]!;

  // Weekly: the current week or the next one (Sunday to Saturday).
  const thisWeek = weekStartOf(today);
  const nextWeek = addDays(thisWeek, 7);
  const weekStart = weekStartOf(wanted) === nextWeek ? nextWeek : thisWeek;
  const isNext = weekStart === nextWeek;
  const week: FakeDay[] = all
    .filter((d) => d.date >= weekStart && d.date <= addDays(weekStart, 6))
    .map((d) => (d.date < today ? { ...d, visits: d.visits.filter((v) => v.status === "done") } : d));

  const dayArrows: TechCalArrows = {
    prevHref: date > today ? href("day", addDays(date, -1)) : null,
    nextHref: date < last ? href("day", addDays(date, 1)) : null,
  };
  const weekArrows: TechCalArrows = {
    prevHref: isNext ? href("week", thisWeek) : null,
    nextHref: isNext ? null : href("week", nextWeek),
    prevName: "השבוע הנוכחי",
    nextName: "השבוע הבא",
  };
  // A weekly heading opens the daily view only for a day that is in the strip.
  const stripDays = new Set(strip.map((d) => d.date));

  return (
    <TechShell
      head={
        view === "day" ? (
          <TechCalHeader label={`${dayName(date)} ${ddmm(date)}`} arrows={dayArrows} />
        ) : (
          <TechCalHeader label={`${ddmm(weekStart)}–${ddmm(addDays(weekStart, 6))}`} arrows={weekArrows} />
        )
      }
      activeTab="cal"
      navTabs={TECH_START_TABS}
      navHrefs={TECH_START_HREFS}
    >
      <TestDataBanner />
      <TechCalSwitch view={view} hrefOf={(v) => (v === "week" ? href("week", view === "week" ? weekStart : date) : href("day", view === "day" ? date : stripDays.has(wanted) ? wanted : today))} />
      {view === "day" ? (
        <>
          <TechCalStrip days={strip} selected={date} dayHref={(d) => href("day", d)} />
          <TechCalDay day={day} />
        </>
      ) : (
        <TechCalWeek days={week} today={today} label={isNext ? "השבוע הבא" : "השבוע"} dayHref={(d) => (stripDays.has(d) ? href("day", d) : null)} />
      )}
    </TechShell>
  );
}
