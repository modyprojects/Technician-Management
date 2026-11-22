import type { Metadata } from "next";
import { redirect } from "next/navigation";
import type { ReactNode } from "react";
import { CalendarDayView } from "@/components/office/CalendarDayView";
import { CalendarNoAccess } from "@/components/office/CalendarNoAccess";
import { CalendarToolbar, type CalendarLink } from "@/components/office/CalendarToolbar";
import { CalendarWeekView } from "@/components/office/CalendarWeekView";
import { CallDrawer } from "@/components/office/CallDrawer";
import { TechSelect } from "@/components/office/tech-calendar/TechSelect";
import { TechCalDay } from "@/components/tech/calendar/TechCalDay";
import { TechCalStrip } from "@/components/tech/calendar/TechCalStrip";
import { TechCalWeek } from "@/components/tech/calendar/TechCalWeek";
import { TestDataBanner } from "@/components/ui/TestBadge";
import { OFFICE_CALENDAR_PATH, OFFICE_CALLS_PATH, OFFICE_START_PATH, officeCallPath } from "@/features/auth/landing";
import { LOGIN_NO_ACCESS_PATH } from "@/features/auth/session-state";
import { ALL, parseOfficeCalendarState } from "@/features/calendar/data/search-params";
import { addDays, CALENDAR_SHIFT_LABELS, ddmm, dayName, weekStartOf } from "@/features/calendar/data/dates";
import type { IsoDate } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";
import { jerusalemToday } from "@/features/visits/data/today";
import { requireArea } from "@/lib/auth/guards";
import { calendarRangeOf, clampToRange, inRange, officeCalendarRole, officeDayOf, officeWeekOf, stepsOf, weekDaysOf } from "@/features/office-calendar/data/office-calendar";
import { phoneDaysOf, phoneTechOf } from "@/features/office-calendar/data/phone";
import { callsPermitted } from "@/lib/data/supabase/calls";
import { officeCalendarQueries } from "@/lib/data/supabase/office-calendar";
import { OfficeFrame } from "../_OfficeFrame";

export const metadata: Metadata = { title: "יומן טכנאים · ניהול טכנאים" };

type View = "day" | "week";

const VIEWS: readonly { view: View; label: string }[] = [
  { view: "day", label: "יום" },
  { view: "week", label: "שבוע" },
];

/** The arrows' accessible names: the day arrows move one calendar day (Friday and Saturday included, D94 (a)). */
const STEP_LABELS: Record<View, { prev: string; next: string }> = {
  day: { prev: "יום קודם", next: "יום הבא" },
  week: CALENDAR_SHIFT_LABELS.week,
};

/** What a link on the page asks for: `view` null keeps the device's default (D94 (b)). */
type LinkState = { view: View | null; date: IsoDate | null; tech: string; visit: VisitRef | null };

function calendarHref(s: LinkState): string {
  const q = new URLSearchParams();
  if (s.view) q.set("view", s.view);
  if (s.date) q.set("date", s.date);
  if (s.tech !== ALL) q.set("tech", s.tech);
  if (s.visit) {
    q.set("req", s.visit.req);
    q.set("n", String(s.visit.n));
  }
  const qs = q.toString();
  return qs ? `${OFFICE_CALENDAR_PATH}?${qs}` : OFFICE_CALENDAR_PATH;
}

const first = (v: string | string[] | undefined) => (Array.isArray(v) ? v[0] : v);

// "יומן טכנאים" (D88 office module 2; OF-03; D60 (4); D94) on real data: the technicians' visits of
// one week, read under the viewer's own session (RLS; lib/data/supabase/office-calendar.ts). D94:
// (a) the week is Sunday to Saturday; (b) without ?view the desktop shows the week and the phone
// (<= 600 px) the day, each in its own block (one server render, no client switch); (c) visibility is
// the matrix key `cal`, checked on the server before any read (the database checks every row again);
// (d) one month back and three months forward from today (Asia/Jerusalem): the date is clamped and
// the arrows stop at the edges; no month view; (e) read-only: no drag, no edit (scheduling stays in
// Outlook). Phone (owner review 22.11, amends D94 (b)): one technician at a time, chosen in the
// "בחר טכנאי" dropdown (?tech=, default the first technician; an unknown id falls back to the
// first), drawn by the technician calendar's own grids (D85 (b)): the day = the week's day strip and
// the hour grid, the week = the 7-column grid; no explanation line and no legend. A visit opens the
// visit drawer, which links to the call card only where the role has `calls`.
// Guard, at the time of the request: requireArea("office") (anonymous → /login; Technicians and
// accounts without access → the no-access state), then `cal` on the server: without it "אין הרשאה"
// and nothing is read. A failed read throws (a code only, logged): the page fails closed.
export default async function OfficeTechCalendarPage({ searchParams }: { searchParams: Promise<Record<string, string | string[] | undefined>> }) {
  const me = await requireArea("office");
  if (!officeCalendarRole(me)) redirect(LOGIN_NO_ACCESS_PATH);
  const queries = await officeCalendarQueries();
  if (!(await queries.permitted())) {
    const back = me.role === "cs" ? { href: OFFICE_CALLS_PATH, label: "קריאות" } : { href: OFFICE_START_PATH, label: "דשבורד" };
    return (
      <OfficeFrame me={me} active="cal">
        <div className="ptitle">
          <h1>יומן טכנאים</h1>
        </div>
        <CalendarNoAccess backHref={back.href} backLabel={back.label} />
      </OfficeFrame>
    );
  }

  const today = jerusalemToday();
  const range = calendarRangeOf(today);
  const sp = await searchParams;
  const parsed = parseOfficeCalendarState(sp, today);
  const rawView = first(sp.view);
  const asked: View | null = rawView === "day" || rawView === "week" ? rawView : null;
  const date = clampToRange(parsed.date, range);
  const askedDate = first(sp.date) !== undefined ? date : null;

  const [data, canOpenCard, drawer] = await Promise.all([
    queries.week(date, range),
    callsPermitted(),
    parsed.visit ? queries.visit(parsed.visit, range) : Promise.resolve(null),
  ]);
  const tech = parsed.tech !== ALL && data.technicians.some((t) => t.id === parsed.tech) ? parsed.tech : ALL;
  const techFilter = tech === ALL ? null : tech;
  const within = (d: IsoDate) => inRange(d, range);
  const showsTestData = me.isTest || data.visits.some((v) => v.isTest) || drawer?.isTest === true;

  const current: LinkState = { view: asked, date: askedDate, tech, visit: null };

  /** The phone's technician (one at a time): the chosen one when shown, else the first. */
  const phoneTech = phoneTechOf(tech === ALL ? null : tech, data.technicians);

  /** One block of the screen (toolbar and calendar) in `view`; `phone`: one technician on the technician calendar's grids. */
  const block = (view: View, phone: boolean) => {
    const base: LinkState = { ...current, view };
    const href = (next: Partial<LinkState>): string => calendarHref({ ...base, ...next });
    const visitHref = (v: VisitRef): string => href({ visit: { req: v.req, n: v.n } });
    const dayHref = (d: IsoDate): string => href({ view: "day", date: d });
    const steps = stepsOf(view, date, range);
    const ws = weekStartOf(date);
    const title = view === "week" ? `שבוע ${ddmm(ws)}–${ddmm(addDays(ws, 6))}` : `${dayName(date)} ${ddmm(date)}`;
    const views: CalendarLink[] = VIEWS.map((v) => ({ key: v.view, label: v.label, href: href({ view: v.view }), on: view === v.view }));
    const techChips: CalendarLink[] = [
      { key: ALL, label: "כולם", href: href({ tech: ALL }), on: tech === ALL },
      ...data.technicians.map((t) => ({ key: t.id, label: t.name, color: t.color, href: href({ tech: t.id }), on: tech === t.id })),
    ];
    const toolbar = (picker?: ReactNode) => (
      <CalendarToolbar
        title={title}
        views={views}
        prev={{ href: steps.prev ? href({ date: steps.prev }) : null, label: STEP_LABELS[view].prev }}
        todayHref={href({ date: null })}
        next={{ href: steps.next ? href({ date: steps.next }) : null, label: STEP_LABELS[view].next }}
        technicians={techChips}
        picker={picker}
      />
    );
    if (phone) {
      const options = data.technicians.map((t) => ({ id: t.id, name: t.name, href: href({ tech: t.id }) }));
      const days = phoneDaysOf(data, weekDaysOf(date), phoneTech);
      const visitOf = (id: string): string => {
        const [req = "", n = ""] = id.split(":");
        return visitHref({ req, n: Number(n) });
      };
      const day = days.find((d) => d.date === date) ?? { date, visits: [] };
      return (
        <>
          {toolbar(phoneTech ? <TechSelect value={phoneTech} options={options} /> : <div className="empty">אין טכנאים להצגה</div>)}
          {phoneTech && view === "day" && (
            <>
              <TechCalStrip days={days.filter((d) => within(d.date))} selected={date} dayHref={dayHref} label="ימי השבוע" />
              <TechCalDay day={day} visitHref={(v) => visitOf(v.id)} />
            </>
          )}
          {phoneTech && view === "week" && (
            <TechCalWeek
              days={days}
              today={today}
              label={title}
              dayHref={(d) => (within(d) ? dayHref(d) : null)}
              visitHref={(v) => visitOf(v.id)}
              greyed={(d) => (within(d) ? null : "מחוץ לטווח היומן")}
            />
          )}
        </>
      );
    }
    const day = view === "day" ? officeDayOf(data, date, techFilter) : null;
    const week = view === "week" ? officeWeekOf(data, date, techFilter) : null;
    return (
      <>
        {toolbar()}
        {day && <CalendarDayView day={day} visitHref={visitHref} showRequest />}
        {week && <CalendarWeekView week={week} today={today} dayHref={dayHref} visitHref={visitHref} quietTest showRequest inRange={within} />}
        {week && week.total === 0 && <div className="empty">אין ביקורים בשבוע הזה</div>}
      </>
    );
  };

  return (
    <OfficeFrame me={me} active="cal">
      {showsTestData && <TestDataBanner />}
      <div className="max-[600px]:hidden" data-calendar-block="desktop">
        {block(asked ?? "week", false)}
      </div>
      <div className="min-[601px]:hidden" data-calendar-block="phone">
        {block(asked ?? "day", true)}
      </div>
      {data.capped && <div className="sub">מוצגים רק חלק מהביקורים של השבוע הזה.</div>}
      {drawer && (
        <CallDrawer
          key={`${drawer.req}:${drawer.n}`}
          visit={drawer}
          closeHref={calendarHref(current)}
          cardHref={canOpenCard ? officeCallPath(drawer.req) : null}
          dial={
            drawer.technician.phone ? (
              <a className="btn" href={`tel:${drawer.technician.phone}`}>
                חיוג לטכנאי
              </a>
            ) : null
          }
        />
      )}
    </OfficeFrame>
  );
}
