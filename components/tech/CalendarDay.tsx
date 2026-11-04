import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TEST_DATA_LABEL, TestBadge } from "@/components/ui/TestBadge";
import type { CalendarVisit, TechWeek } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { dayName, dayOfMonth, dayShort, ddmm, gridHourLabel, GRID_HOURS, gridSpan, visitsCountLabel } from "./CalendarDates";

// Day view of the technician's "היומן שלי" (docs/demo.html techCalendar() L611-619; TE-27):
// the Sunday-to-Thursday strip ("ד׳ / 21 / 4 ביקורים", the chosen day in the accent colour) and
// the chosen day's 08:00-18:00 timeline, a block per visit in its status colours ("customer ·
// time", "city · product" or "↻ ביקור המשך"), "אין ביקורים ביום הזה" when none.
// The days and the blocks are links (navigation): a day opens its day view, a block opens the
// visit (the caller decides where: the visit card, or the read-only view of a closed visit).
// Additions: the 🧪 badge on test visits (SIM-15), accessible names with the time window and the
// status (the colour alone does not say it, WCAG 1.4.1), and "ועוד N" when the day has more
// visits than the bounded list carries (CALENDAR_LANE_LIMIT).
// Presentational: TechWeek DTO plus links.

/** Pixels per hour (the demo's H). */
const HOUR_PX = 44;

/** "↻ ביקור המשך" for visit 2 or later, otherwise the product. */
export const visitSubject = (v: CalendarVisit): string => (v.isFollowUp ? "↻ ביקור המשך" : v.productName);

/** A block's accessible name: its visible text first, then the time window, the status and the test marker. */
export function visitBlockName(v: CalendarVisit): string {
  const parts = [`${v.customerName} · ${v.start}–${v.end}`, v.city, visitSubject(v), VISIT_STATUSES[v.status].label];
  if (v.isTest) parts.push(TEST_DATA_LABEL);
  return parts.join(" · ");
}

/** "ועוד N" under a bounded day (CALENDAR_LANE_LIMIT). */
export const hiddenLabel = (n: number): string =>
  n === 1 ? "ועוד ביקור אחד שלא מוצג ביומן" : `ועוד ${n} ביקורים שלא מוצגים ביומן`;

export function CalendarDayStrip({
  days,
  selected,
  dayHref,
}: {
  days: TechWeek["days"];
  selected: IsoDate;
  dayHref: (date: IsoDate) => string;
}) {
  return (
    <nav aria-label="ימי השבוע" style={{ display: "flex", gap: 6, flex: "none" }}>
      {days.map(({ date, visits }) => {
        const on = date === selected;
        const count = visitsCountLabel(visits.total);
        return (
          <Link
            key={date}
            href={dayHref(date)}
            aria-current={on ? "true" : undefined}
            aria-label={`${dayShort(date)} ${dayOfMonth(date)} · ${dayName(date)} ${ddmm(date)} · ${count}`}
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: 12,
              padding: "7px 0",
              textAlign: "center",
              textDecoration: "none",
              ...(on
                ? { background: "var(--accent)", color: "var(--on-dark)", border: 0 }
                : { background: "var(--card)", color: "inherit", border: "1px solid var(--line)" }),
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.8 }}>{dayShort(date)}</div>
            <div className="num" style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 17 }}>
              {dayOfMonth(date)}
            </div>
            <div style={{ fontSize: 10, opacity: 0.85 }}>{count}</div>
          </Link>
        );
      })}
    </nav>
  );
}

export function CalendarDayTimeline({
  date,
  visits,
  hiddenCount,
  visitHref,
}: {
  date: IsoDate;
  /** The day's visits by start time (cancelled never). */
  visits: readonly CalendarVisit[];
  /** Visits of the day the bounded list left out. */
  hiddenCount: number;
  visitHref: (v: CalendarVisit) => string;
}) {
  return (
    <>
      <section
        className="card"
        aria-label={`ביקורים ביום ${dayName(date)} ${ddmm(date)}`}
        style={{ position: "relative", height: GRID_HOURS * HOUR_PX, overflow: "hidden", flex: "none" }}
      >
        <div aria-hidden="true">
          {Array.from({ length: GRID_HOURS }, (_, i) => (
            <div key={i} className="hr" style={{ top: i * HOUR_PX }}>
              <span style={{ position: "absolute", top: 2, right: 6, fontSize: 11, color: "var(--muted)" }}>{gridHourLabel(i)}</span>
            </div>
          ))}
        </div>
        {visits.map((v) => {
          const s = VISIT_STATUSES[v.status];
          const { from, to } = gridSpan(v.start, v.end);
          return (
            <Link
              key={`${v.req}-${v.n}`}
              href={visitHref(v)}
              className="ev"
              aria-label={visitBlockName(v)}
              style={{
                top: (from / 60) * HOUR_PX + 2,
                height: ((to - from) / 60) * HOUR_PX - 4,
                right: 52,
                left: 8,
                background: s.bg,
                color: s.fg,
                borderRightColor: s.c,
                textDecoration: "none",
                overflowWrap: "anywhere",
              }}
            >
              <b>
                {v.customerName} · <span className="num">{v.start}</span>
                {v.isTest && (
                  <>
                    {" "}
                    <TestBadge />
                  </>
                )}
              </b>
              {v.city} · {visitSubject(v)}
            </Link>
          );
        })}
        {!visits.length && (
          <div className="empty" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
            אין ביקורים ביום הזה
          </div>
        )}
      </section>
      {hiddenCount > 0 && (
        <div className="sub" style={{ textAlign: "center" }}>
          {hiddenLabel(hiddenCount)}
        </div>
      )}
    </>
  );
}
