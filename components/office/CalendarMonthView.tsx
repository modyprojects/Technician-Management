import Link from "next/link";
import type { OfficeCalendarMonth, OfficeMonthDay } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { addDays, DAY_NAMES, dayName, ddmm, weekdayOf } from "@/features/calendar/data/dates";

// Office calendar, month view (docs/demo.html offCal() L775-788): a Sunday-first grid of the
// month, padded with the neighbouring months' days (shown greyed and inactive, as the demo's
// disabled cells); each day of the month shows its visit count, visits per technician and the
// "המשך טיפול" count, and opens that day's day view. Weekends (Friday, Saturday) are greyed as
// in the demo. Counts only (the DTO carries no visits). Sideways scrolling inside .scrollx on
// narrow screens, as in the demo. Presentational: takes the calendar DTO and a link builder.

/** The demo's six-row maximum. */
const MAX_CELLS = 42;

function DayCounts({ day }: { day: OfficeMonthDay }) {
  return (
    <>
      {day.byTechnician.map((row) => (
        <span key={row.technician.id} style={{ fontSize: 12 }}>
          <span className="dot" style={{ background: row.technician.color }} aria-hidden="true" /> {row.technician.name}{" "}
          <span className="num">{row.count}</span>
        </span>
      ))}
      {day.followups > 0 && (
        <span className="pill" style={{ background: "var(--s-cont-bg)", color: "var(--s-cont-fg)", fontSize: 11, padding: "1px 7px" }}>
          <span className="num">{day.followups}</span> המשך טיפול
        </span>
      )}
    </>
  );
}

export function CalendarMonthView({
  month,
  today,
  dayHref,
}: {
  month: OfficeCalendarMonth;
  today: IsoDate;
  /** The day view of a date. */
  dayHref: (date: IsoDate) => string;
}) {
  const first = `${month.month}-01`;
  const start = addDays(first, -weekdayOf(first));
  const byDate = new Map(month.days.map((d) => [d.date, d]));
  const cells: { date: IsoDate; day: OfficeMonthDay | undefined }[] = [];
  for (let i = 0; i < MAX_CELLS; i++) {
    const date = addDays(start, i);
    const inMonth = date.startsWith(`${month.month}-`);
    // The demo's rule: no sixth row that holds only the next month.
    if (i >= 35 && !inMonth && i % 7 === 0) break;
    cells.push({ date, day: inMonth ? byDate.get(date) : undefined });
  }

  return (
    <>
      <div className="scrollx">
        <div className="card" style={{ padding: 10, minWidth: 700 }}>
          <div className="ocal-month-head" aria-hidden="true">
            {DAY_NAMES.map((name) => (
              <div key={name}>{name}</div>
            ))}
          </div>
          <div className="ocal-month-grid">
            {cells.map(({ date, day }) => {
              const dayNumber = Number(date.slice(8, 10));
              if (!day) {
                return (
                  <div key={date} className="ocal-mcell off" aria-hidden="true">
                    <span className="ocal-mcell-top">
                      <b className="num ocal-mcell-n">{dayNumber}</b>
                    </span>
                  </div>
                );
              }
              const isToday = date === today;
              const off = !isToday && weekdayOf(date) >= 5;
              return (
                <Link
                  key={date}
                  href={dayHref(date)}
                  prefetch={false}
                  className={`ocal-mcell${isToday ? " today" : off ? " off" : ""}`}
                  aria-current={isToday ? "date" : undefined}
                >
                  <span className="ocal-mcell-top">
                    <b className="num ocal-mcell-n" aria-hidden="true">
                      {dayNumber}
                    </b>
                    <span className="sr-only">
                      {dayName(date)} {ddmm(date)}
                      {day.total === 0 && " · אין ביקורים"}
                    </span>
                    {day.total > 0 && (
                      <span className="sub num" style={{ fontWeight: 700 }}>
                        {day.total} ביק׳
                      </span>
                    )}
                  </span>
                  <DayCounts day={day} />
                </Link>
              );
            })}
          </div>
        </div>
      </div>
      <div className="sub">לחיצה על יום פותחת את התצוגה היומית שלו.</div>
    </>
  );
}
