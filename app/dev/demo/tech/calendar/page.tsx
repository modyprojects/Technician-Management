import type { Metadata } from "next";
import { notFound } from "next/navigation";
import { CalendarDayStrip, CalendarDayTimeline } from "@/components/tech/CalendarDay";
import { shiftCalendarDate } from "@/components/tech/CalendarDates";
import { CalendarHeader } from "@/components/tech/CalendarHeader";
import { CalendarMonth } from "@/components/tech/CalendarMonth";
import { CalendarViewSwitch } from "@/components/tech/CalendarViewSwitch";
import { CalendarWeek } from "@/components/tech/CalendarWeek";
import { parseTechCalendarState, techCalendarHref } from "@/features/calendar/data/search-params";
import type { CalendarVisit } from "@/features/calendar/data/types";
import { isClosedVisitStatus } from "@/features/visits/data/types";
import { DemoTechFrame } from "../../_components/DemoFrames";
import { demoDataAccess } from "../../_data/adapter";
import { TODAY } from "../../_data/dates";
import { DEMO_TECHNICIAN_ID } from "../../_data/roles";
import { demoHref } from "../../_data/routes";

export const metadata: Metadata = { title: "היומן שלי · טכנאי · הדגמה" };

// Technician "היומן שלי" (docs/demo.html techCalendar() L603-643 and its actions L1135-1137;
// TE-27: same look, dynamic dates). Read-only: scheduling stays in Outlook (OF-03).
// The URL is the state (?view=day|week|month&date=YYYY-MM-DD; features/calendar/data/search-params),
// so every control is a link: the "יומי / שבועי / חודשי" segments, the "‹ ›" arrows (previous or
// next work day, week or month), the day strip, the week's day headings and the month's days
// (each opens that day), and the visit blocks. A block of an open visit opens its visit card; a
// block of a closed visit opens its read-only view (TE-26, D14), whose "› חזרה" returns to this
// calendar view (the link carries ?view&date).
// Reads only through the data-access layer: calendar.techWeek (day and week views; the strip's
// counts are each day's visits.total) or calendar.techMonth (month view), and
// notifications.unreadCount for the bell (G-03: production takes the technician from the
// session). No commands: nothing on this screen changes data.
export default async function TechCalendarPage({ searchParams }: PageProps<"/dev/demo/tech/calendar">) {
  const state = parseTechCalendarState(await searchParams, TODAY);
  const { view, date } = state;
  const [unread, week, month] = await Promise.all([
    demoDataAccess.notifications.unreadCount(DEMO_TECHNICIAN_ID),
    view === "month" ? null : demoDataAccess.calendar.techWeek(DEMO_TECHNICIAN_ID, date),
    view === "month" ? demoDataAccess.calendar.techMonth(DEMO_TECHNICIAN_ID, date.slice(0, 7)) : null,
  ]);
  if (view === "month" ? !month : !week) notFound();

  const dayHref = (d: string) => demoHref.techCalendar("day", d);
  const visitHref = (v: CalendarVisit) =>
    isClosedVisitStatus(v.status)
      ? techCalendarHref(demoHref.techDoneVisit(v.req, v.n), { view, date })
      : demoHref.visit(v.req, v.n);
  const chosenDay = week?.days.find((d) => d.date === date);

  return (
    <DemoTechFrame
      activeTab="cal"
      head={
        <CalendarHeader
          view={view}
          date={date}
          prevHref={demoHref.techCalendar(view, shiftCalendarDate(view, date, -1, TODAY))}
          nextHref={demoHref.techCalendar(view, shiftCalendarDate(view, date, 1, TODAY))}
          backHref={demoHref.tech()}
          backAriaLabel="חזרה למסך היום"
          notificationsHref={demoHref.techNotifications()}
          unread={unread}
        />
      }
    >
      <CalendarViewSwitch view={view} hrefOf={(v) => demoHref.techCalendar(v, date)} />
      {view === "day" && week && (
        <>
          <CalendarDayStrip days={week.days} selected={date} dayHref={dayHref} />
          <CalendarDayTimeline
            date={date}
            visits={chosenDay?.visits.items ?? []}
            hiddenCount={chosenDay ? chosenDay.visits.total - chosenDay.visits.items.length : 0}
            visitHref={visitHref}
          />
        </>
      )}
      {view === "week" && week && <CalendarWeek week={week} today={TODAY} dayHref={dayHref} visitHref={visitHref} />}
      {view === "month" && month && <CalendarMonth month={month} today={TODAY} dayHref={dayHref} />}
    </DemoTechFrame>
  );
}
