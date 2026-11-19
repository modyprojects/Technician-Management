import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TEST_DATA_LABEL, TestBadge } from "@/components/ui/TestBadge";
import { dayName, ddmm, visitCountLabel } from "@/features/calendar/data/dates";
import type { CalendarVisit, OfficeCalendarWeek } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";
import { calVisitKey } from "./CalendarParts";
import { TimeRange } from "@/components/ui/TimeRange";

// Office calendar, week view (docs/demo.html offCal() L769-774): five columns, Sunday to
// Thursday, today tinted; each day's header opens that day's day view, and each visit is a block
// with the technician's colour on its edge and the status colours as its background. A block is a
// link that opens the visit drawer (`req&n` in the URL). Sideways scrolling inside .scrollx on
// narrow screens, as in the demo. Presentational: takes the calendar DTO and link builders.
// Change from the demo (accessibility): the second line of a block is not faded (the demo's
// opacity .85), so it keeps the status colours' contrast. Addition: a 🧪 mark on test visits
// (SIM-15, D47; the blocks are too narrow for the badge), read as "נתוני בדיקה".

/** `quietTest`: the quiet "בדיקה" marker (D74) instead of 🧪; `showRequest`: the request number (D89 (d)). Defaults keep the old look. */
function WeekBlock({ v, href, quietTest, showRequest }: { v: CalendarVisit; href: string; quietTest: boolean; showRequest: boolean }) {
  const s = VISIT_STATUSES[v.status];
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      className="ocal-wk-ev"
      data-cal-visit={calVisitKey(v)}
      style={{ borderRightColor: v.technician.color, background: s.bg, color: s.fg }}
    >
      <b className="num">
        <TimeRange start={v.start} end={v.end} />
      </b>{" "}
      · {v.customerName}
      {v.isTest &&
        (quietTest ? (
          <>
            {" "}
            <TestBadge />
          </>
        ) : (
          <>
            <span aria-hidden="true"> 🧪</span>
            <span className="sr-only"> · {TEST_DATA_LABEL}</span>
          </>
        ))}
      {showRequest && (
        <span style={{ display: "block" }}>
          מס׳ פנייה{" "}
          <bdi dir="ltr" className="num">
            {v.req}
          </bdi>
        </span>
      )}
      <span style={{ display: "block" }}>
        {v.city} · {v.technician.name} · {s.label}
      </span>
    </Link>
  );
}

export function CalendarWeekView({
  week,
  today,
  dayHref,
  visitHref,
  quietTest = false,
  showRequest = false,
}: {
  week: OfficeCalendarWeek;
  today: IsoDate;
  /** The day view of a date. */
  dayHref: (date: IsoDate) => string;
  visitHref: (visit: VisitRef) => string;
  quietTest?: boolean;
  showRequest?: boolean;
}) {
  return (
    <>
      <div className="scrollx">
        <div className="cal ocal-wk">
          {week.days.map((d) => {
            const isToday = d.date === today;
            const more = d.visits.total - d.visits.items.length;
            return (
              <div key={d.date} className={isToday ? "ocal-wk-day today" : "ocal-wk-day"}>
                <Link className="ocal-wk-head" href={dayHref(d.date)} prefetch={false} aria-current={isToday ? "date" : undefined}>
                  {dayName(d.date)} <span className="num">{ddmm(d.date)}</span>{" "}
                  <span className="sub" style={{ fontWeight: 400 }}>
                    · <span className="num">{d.visits.total}</span>
                    <span className="sr-only"> ביקורים</span>
                  </span>
                </Link>
                {d.visits.items.length > 0 ? (
                  <ul className="ocal-wk-list">
                    {d.visits.items.map((v) => (
                      <li key={calVisitKey(v)}>
                        <WeekBlock v={v} href={visitHref({ req: v.req, n: v.n })} quietTest={quietTest} showRequest={showRequest} />
                      </li>
                    ))}
                  </ul>
                ) : (
                  <div className="sub" style={{ textAlign: "center", padding: 12 }}>
                    אין ביקורים
                  </div>
                )}
                {more > 0 && (
                  <div className="sub" style={{ textAlign: "center", padding: "0 8px 10px" }}>
                    ועוד {visitCountLabel(more)}
                  </div>
                )}
              </div>
            );
          })}
        </div>
      </div>
      <div className="sub">הפס בצד כל ביקור הוא צבע הטכנאי, והרקע הוא הסטטוס. לחיצה על כותרת יום פותחת את התצוגה היומית.</div>
    </>
  );
}
