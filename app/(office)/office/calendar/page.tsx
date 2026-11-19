import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { CalendarDayView } from "@/components/office/CalendarDayView";
import { CalendarToolbar, type CalendarLink, type CalendarStep } from "@/components/office/CalendarToolbar";
import { CalendarWeekView } from "@/components/office/CalendarWeekView";
import { CallDrawer } from "@/components/office/CallDrawer";
import { PhoneDayAgenda, PhoneWeekAgenda } from "@/components/office/tech-calendar/PhoneAgenda";
import {
  SKELETON_TECHNICIANS,
  SKELETON_TODAY,
  skeletonDay,
  skeletonVisitDetail,
  skeletonWeek,
} from "@/components/office/tech-calendar/skeleton-data";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { OFFICE_CALENDAR_PATH, officeCallPath } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { ALL, parseOfficeCalendarState, type OfficeCalendarState } from "@/features/calendar/data/search-params";
import { addDays, CALENDAR_SHIFT_LABELS, ddmm, dayName, shiftCalendarDate, weekStartOf } from "@/features/calendar/data/dates";
import type { CalendarView } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { isOfficeRole } from "@/features/reference/data/types";
import type { VisitRef } from "@/features/visits/data/types";
import { requireArea } from "@/lib/auth/guards";
import { OfficeFrame } from "../_OfficeFrame";

export const metadata: Metadata = { title: "יומן טכנאים · ניהול טכנאים" };

const VIEWS: readonly { view: Exclude<CalendarView, "month">; label: string }[] = [
  { view: "day", label: "יום" },
  { view: "week", label: "שבוע" },
];

function calendarHref(state: OfficeCalendarState): string {
  const q = new URLSearchParams();
  if (state.view !== "day") q.set("view", state.view);
  if (state.date !== SKELETON_TODAY) q.set("date", state.date);
  if (state.tech !== ALL) q.set("tech", state.tech);
  if (state.visit) {
    q.set("req", state.visit.req);
    q.set("n", String(state.visit.n));
  }
  const s = q.toString();
  return s ? `${OFFICE_CALENDAR_PATH}?${s}` : OFFICE_CALENDAR_PATH;
}

// "יומן טכנאים" (D88 office module 2; OF-03; D60 (4)). SKELETON (D81): fictional data only, no
// database, no server logic (components/office/tech-calendar/skeleton-data.ts). Day view with a
// column per technician and a week view on the existing calendar components; on a phone (<= 600 px)
// the same data is cards, one section per technician (day) or per day (week). A visit opens the
// existing visit drawer, which links to the call card. Read-only: scheduling stays in Outlook.
// Guard, at the time of the request: requireArea("office"); every office role may see it for now.
export default async function OfficeTechCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireArea("office");
  if (!isOfficeRole(me.role)) redirect(LOGIN_NO_ACCESS_PATH);

  const parsed = parseOfficeCalendarState(await searchParams, SKELETON_TODAY);
  const known = SKELETON_TECHNICIANS.some((t) => t.id === parsed.tech);
  const state: OfficeCalendarState = {
    ...parsed,
    view: parsed.view === "week" ? "week" : "day",
    tech: known ? parsed.tech : ALL,
  };
  const base: OfficeCalendarState = { ...state, visit: null };
  const href = (next: Partial<OfficeCalendarState>): string => calendarHref({ ...base, ...next });
  const visitHref = (v: VisitRef): string => href({ visit: { req: v.req, n: v.n } });
  const dayHref = (date: IsoDate): string => href({ view: "day", date });

  const title =
    state.view === "week"
      ? `שבוע ${ddmm(weekStartOf(state.date))}–${ddmm(addDays(weekStartOf(state.date), 4))}`
      : `${dayName(state.date)} ${ddmm(state.date)}`;
  const steps = CALENDAR_SHIFT_LABELS[state.view];
  const prev: CalendarStep = { href: href({ date: shiftCalendarDate(state.view, state.date, -1, SKELETON_TODAY) }), label: steps.prev };
  const next: CalendarStep = { href: href({ date: shiftCalendarDate(state.view, state.date, 1, SKELETON_TODAY) }), label: steps.next };
  const views: CalendarLink[] = VIEWS.map(({ view, label }) => ({ key: view, label, href: href({ view }), on: state.view === view }));
  const techChips: CalendarLink[] = [
    { key: ALL, label: "כולם", href: href({ tech: ALL }), on: state.tech === ALL },
    ...SKELETON_TECHNICIANS.map((t) => ({ key: t.id, label: t.name, color: t.color, href: href({ tech: t.id }), on: state.tech === t.id })),
  ];

  const day = state.view === "day" ? skeletonDay(state.date, state.tech) : null;
  const week = state.view === "week" ? skeletonWeek(state.date, state.tech) : null;
  const drawer = state.visit ? skeletonVisitDetail(state.visit.req, state.visit.n) : null;

  return (
    <OfficeFrame me={me} active="cal">
      <TestDataBanner />
      <CalendarToolbar title={title} views={views} prev={prev} todayHref={href({ date: SKELETON_TODAY })} next={next} technicians={techChips} />
      <div className="max-[600px]:hidden">
        {day && <CalendarDayView day={day} visitHref={visitHref} />}
        {week && <CalendarWeekView week={week} today={SKELETON_TODAY} dayHref={dayHref} visitHref={visitHref} />}
        {week && week.total === 0 && <div className="empty">אין ביקורים בשבוע הזה</div>}
      </div>
      <div className="min-[601px]:hidden">
        {day && <PhoneDayAgenda day={day} visitHref={visitHref} />}
        {week && <PhoneWeekAgenda week={week} today={SKELETON_TODAY} visitHref={visitHref} dayHref={dayHref} />}
      </div>
      {drawer && (
        <CallDrawer
          key={`${drawer.req}:${drawer.n}`}
          visit={drawer}
          closeHref={href({})}
          cardHref={officeCallPath(drawer.req)}
          dial={
            <a className="btn" href={`tel:${drawer.technician.phone}`}>
              חיוג לטכנאי
            </a>
          }
        />
      )}
    </OfficeFrame>
  );
}
