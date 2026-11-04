import type { Metadata } from "next";
import { notFound } from "next/navigation";
import type { ReactNode } from "react";
import { CalendarDayView } from "@/components/office/CalendarDayView";
import { CalendarMonthView } from "@/components/office/CalendarMonthView";
import { CalendarNoAccess } from "@/components/office/CalendarNoAccess";
import { CalendarToolbar, type CalendarLink, type CalendarStep } from "@/components/office/CalendarToolbar";
import { CalendarWeekView } from "@/components/office/CalendarWeekView";
import { CallDrawer } from "@/components/office/CallDrawer";
import {
  ALL,
  officeCalendarFilterOf,
  parseOfficeCalendarState,
  type OfficeCalendarState,
} from "@/features/calendar/data/search-params";
import { addDays, CALENDAR_SHIFT_LABELS, ddmm, monthLabel, shiftCalendarDate, weekStartOf } from "@/features/calendar/data/dates";
import type { CalendarView } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { offers } from "@/features/reference/data/permissions";
import type { OfficeRole } from "@/features/reference/data/types";
import type { VisitRef } from "@/features/visits/data/types";
import { DemoOfficeFrame } from "../../../_components/DemoFrames";
import { demoDataAccess } from "../../../_data/adapter";
import { dayAndDate, TODAY } from "../../../_data/dates";
import { officeRoleParams } from "../../../_data/params";
import { isOfficeRole, officeHomeLabel, VIEWPOINTS } from "../../../_data/roles";
import { demoHref } from "../../../_data/routes";

export const dynamicParams = false;

export function generateStaticParams() {
  return officeRoleParams();
}

export async function generateMetadata({ params }: PageProps<"/dev/demo/office/[role]/calendar">): Promise<Metadata> {
  const { role } = await params;
  if (!isOfficeRole(role)) return {};
  return { title: `יומן טכנאים · ${VIEWPOINTS[role].label} · הדגמה` };
}

const VIEWS: readonly { view: CalendarView; label: string }[] = [
  { view: "day", label: "יום" },
  { view: "week", label: "שבוע" },
  { view: "month", label: "חודש" },
];

/** The calendar address of a state; today's date is left out (the default). */
function calendarHref(role: OfficeRole, state: OfficeCalendarState): string {
  return demoHref.officeCalendar(role, { ...state, date: state.date === TODAY ? undefined : state.date });
}

/** The demo's title: "רביעי 21.10", "שבוע 18.10–22.10" or "אוקטובר 2026". */
function periodTitle(view: CalendarView, date: IsoDate): string {
  if (view === "week") {
    const start = weekStartOf(date);
    return `שבוע ${ddmm(start)}–${ddmm(addDays(start, 4))}`;
  }
  if (view === "month") return monthLabel(date.slice(0, 7));
  return dayAndDate(date);
}

// Office "יומן טכנאים" (docs/demo.html offCal() L752-802, drawer drawerHtml() L803-815; OF-03,
// KEEP): day view per technician with visits in overlap lanes, week view (Sunday to Thursday),
// month view with counts; technician chips, status legend, previous / today / next; a visit
// opens the drawer, which links to the full call card. Read-only: scheduling stays in Outlook.
// Reads only through the data-access layer: the URL (?view&date&tech&req&n,
// features/calendar/data/search-params) is the query (calendar.officeDay / officeWeek /
// officeMonth with the technician filter, calendar.visit for the drawer), technicians come from
// reference.technicians() and what the role sees follows its matrix values (`cal` for the
// screen, `calls` for the card link; reference.permissions, display only, G-04).
// No data actions: the drawer's "חיוג לטכנאי" is navigation; the demo passes a data-sim button that
// says no call is made (production: a `tel:` link).
export default async function OfficeCalendarPage({ params, searchParams }: PageProps<"/dev/demo/office/[role]/calendar">) {
  const { role } = await params;
  if (!isOfficeRole(role)) notFound();
  const { calendar, reference } = demoDataAccess;
  const permissions = await reference.permissions(role);
  if (!offers(permissions, "cal")) {
    return (
      <DemoOfficeFrame role={role} active="cal">
        <div className="ptitle">
          <h1>יומן טכנאים</h1>
        </div>
        <CalendarNoAccess backHref={demoHref.officeHome(role)} backLabel={officeHomeLabel(permissions)} />
      </DemoOfficeFrame>
    );
  }

  const state = parseOfficeCalendarState(await searchParams, TODAY);
  const filter = officeCalendarFilterOf(state);
  const base: OfficeCalendarState = { ...state, visit: null };
  const href = (next: Partial<OfficeCalendarState>): string => calendarHref(role, { ...base, ...next });
  const visitHref = (v: VisitRef): string => href({ visit: { req: v.req, n: v.n } });
  const dayHref = (date: IsoDate): string => href({ view: "day", date });

  const viewBody = async (): Promise<ReactNode> => {
    if (state.view === "month") {
      const month = await calendar.officeMonth(state.date.slice(0, 7), filter);
      return <CalendarMonthView month={month} today={TODAY} dayHref={dayHref} />;
    }
    if (state.view === "week") {
      const week = await calendar.officeWeek(state.date, filter);
      return <CalendarWeekView week={week} today={TODAY} dayHref={dayHref} visitHref={visitHref} />;
    }
    const day = await calendar.officeDay(state.date, filter);
    return <CalendarDayView day={day} visitHref={visitHref} />;
  };

  const [body, technicians, drawer] = await Promise.all([
    viewBody(),
    reference.technicians(),
    state.visit ? calendar.visit(state.visit) : Promise.resolve(null),
  ]);

  const views: CalendarLink[] = VIEWS.map(({ view, label }) => ({
    key: view,
    label,
    href: href({ view }),
    on: state.view === view,
  }));
  const techChips: CalendarLink[] = [
    { key: ALL, label: "כולם", href: href({ tech: ALL }), on: state.tech === ALL },
    ...technicians.map((t) => ({ key: t.id, label: t.name, color: t.color, href: href({ tech: t.id }), on: state.tech === t.id })),
  ];
  // The same arrows as the technician calendar: a work day, a week, or a month (to today or the
  // month's first work day, so the day view never opens on a weekend).
  const steps = CALENDAR_SHIFT_LABELS[state.view];
  const prev: CalendarStep = { href: href({ date: shiftCalendarDate(state.view, state.date, -1, TODAY) }), label: steps.prev };
  const next: CalendarStep = { href: href({ date: shiftCalendarDate(state.view, state.date, 1, TODAY) }), label: steps.next };

  return (
    <DemoOfficeFrame role={role} active="cal">
      <CalendarToolbar
        title={periodTitle(state.view, state.date)}
        views={views}
        prev={prev}
        todayHref={href({ date: TODAY })}
        next={next}
        technicians={techChips}
      />
      {body}
      {drawer && (
        <CallDrawer
          key={`${drawer.req}:${drawer.n}`}
          visit={drawer}
          closeHref={href({})}
          cardHref={offers(permissions, "calls") ? demoHref.call(role, drawer.req) : null}
          dial={
            <button
              type="button"
              className="btn"
              data-sim={`חיוג לטכנאי ${drawer.technician.name} · ${drawer.technician.phone} · לא מתבצעת שיחה בהדגמה`}
            >
              חיוג לטכנאי
            </button>
          }
        />
      )}
    </DemoOfficeFrame>
  );
}
