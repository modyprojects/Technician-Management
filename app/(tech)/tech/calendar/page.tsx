import type { Metadata } from "next";
import { TechCalDay } from "@/components/tech/calendar/TechCalDay";
import { TechCalHeader } from "@/components/tech/calendar/TechCalHeader";
import { TechCalStrip } from "@/components/tech/calendar/TechCalStrip";
import { TechCalSwitch } from "@/components/tech/calendar/TechCalSwitch";
import { TechCalWeek } from "@/components/tech/calendar/TechCalWeek";
import type { TechCalView } from "@/components/tech/calendar/types";
import { TechShell } from "@/components/tech/TechShell";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { addDays, dayName, ddmm } from "@/features/calendar/data/dates";
import { jerusalemToday } from "@/features/visits/data/today";
import { requireArea } from "@/lib/auth/guards";
import { TECH_CALENDAR_PATH, TECH_START_HREFS, TECH_START_TABS } from "../_tabs";
import { fakeCalendar } from "./_components/calendar-fake";

export const metadata: Metadata = { title: "יומן · ניהול טכנאים" };

// SKELETON (D81, D83): the technician calendar on fictional data. "יומי" and "שבועי" over today and
// the next 6 days (no past days, no monthly view); the URL is the state (?view=day|week&date=...),
// so every control is a link. No bell. No database and no server logic beyond the role guard.
const href = (view: TechCalView, date: string) => `${TECH_CALENDAR_PATH}?view=${view}&date=${date}`;
const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

export default async function TechCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  await requireArea("tech");
  const sp = await searchParams;
  const today = jerusalemToday();
  const days = fakeCalendar(today);
  const last = addDays(today, 6);
  const view: TechCalView = first(sp.view) === "week" ? "week" : "day";
  const wanted = first(sp.date) ?? today;
  const date = days.some((d) => d.date === wanted) ? wanted : today;
  const day = days.find((d) => d.date === date) ?? days[0]!;
  const arrows = {
    prevHref: date > today ? href("day", addDays(date, -1)) : null,
    nextHref: date < last ? href("day", addDays(date, 1)) : null,
  };

  return (
    <TechShell
      head={
        view === "day" ? (
          <TechCalHeader label={`${dayName(date)} ${ddmm(date)}`} arrows={arrows} />
        ) : (
          <TechCalHeader label={`${ddmm(today)}–${ddmm(last)}`} arrows={null} />
        )
      }
      activeTab="cal"
      navTabs={TECH_START_TABS}
      navHrefs={TECH_START_HREFS}
    >
      <TestDataBanner />
      <TechCalSwitch view={view} hrefOf={(v) => href(v, date)} />
      {view === "day" ? (
        <>
          <TechCalStrip days={days} selected={date} dayHref={(d) => href("day", d)} />
          <TechCalDay day={day} />
        </>
      ) : (
        <TechCalWeek days={days} today={today} dayHref={(d) => href("day", d)} />
      )}
    </TechShell>
  );
}
