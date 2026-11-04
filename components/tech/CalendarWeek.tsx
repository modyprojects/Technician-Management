import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { CalendarVisit, TechWeek } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { hiddenLabel, visitBlockName } from "./CalendarDay";
import { dayName, dayOfMonth, dayShort, ddmm } from "@/features/calendar/data/dates";
import { GRID_HOURS, gridSpan } from "./CalendarDates";

// Week view of the technician's "היומן שלי" (docs/demo.html techCalendar() L620-626; TE-27):
// Sunday to Thursday as columns on the 08:00-18:00 grid (hour marks every two hours), today's
// column tinted and its date in the accent colour, a compact block per visit (customer's first
// name, city, "09:00-11:00") in its status colours, and the legend below.
// The day headings and the blocks are links (navigation): a heading opens that day's view, a
// block opens the visit (the caller decides where).
// Additions: a 🧪 mark on test visits (SIM-15; the blocks are too narrow for the badge), accessible
// names with the time window and the status (WCAG 1.4.1), a line break allowed after the dash of
// the time so a narrow column never clips it, and "ועוד N" for a day the bounded list cut.
// Presentational: TechWeek DTO plus links.

/** Pixels per hour (the demo's W). */
const HOUR_PX = 62;

const COLUMNS = "24px repeat(5, minmax(0, 1fr))";

/** The demo's legend: scheduled, in progress, resolved, follow-up. */
const LEGEND = ["new", "work", "done", "cont"] as const;

/** The customer's first word (the demo's `customer.split(' ')[0]`). */
const firstWord = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

export function CalendarWeek({
  week,
  today,
  dayHref,
  visitHref,
}: {
  week: TechWeek;
  today: IsoDate;
  dayHref: (date: IsoDate) => string;
  visitHref: (v: CalendarVisit) => string;
}) {
  const hidden = week.days.reduce((sum, d) => sum + d.visits.total - d.visits.items.length, 0);
  return (
    <>
      <section className="card" aria-label="השבוע שלי" style={{ overflow: "hidden", flex: "none" }}>
        <div style={{ display: "grid", gridTemplateColumns: COLUMNS, borderBottom: "1px solid var(--line)" }}>
          <div />
          {week.days.map(({ date }) => (
            <Link
              key={date}
              href={dayHref(date)}
              aria-current={date === today ? "date" : undefined}
              style={{
                display: "block",
                padding: "6px 0",
                textAlign: "center",
                textDecoration: "none",
                color: date === today ? "var(--accent)" : "inherit",
              }}
            >
              <div style={{ fontSize: 11, color: "var(--muted)" }}>{dayShort(date)}</div>
              <b className="num">{dayOfMonth(date)}</b>
              <span className="sr-only">{` · ${dayName(date)} ${ddmm(date)} · תצוגה יומית`}</span>
            </Link>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: COLUMNS, height: GRID_HOURS * HOUR_PX }}>
          <div aria-hidden="true" style={{ position: "relative" }}>
            {[0, 2, 4, 6, 8].map((i) => (
              <span key={i} className="num" style={{ position: "absolute", top: i * HOUR_PX + 1, right: 3, fontSize: 10, color: "var(--muted)" }}>
                {String(8 + i).padStart(2, "0")}
              </span>
            ))}
          </div>
          {week.days.map(({ date, visits }) => (
            <div
              key={date}
              role="group"
              aria-label={`${dayName(date)} ${ddmm(date)}`}
              style={{
                position: "relative",
                borderRight: "1px solid var(--line2)",
                ...(date === today ? { background: "var(--accent-l)" } : null),
              }}
            >
              {visits.items.map((v) => {
                const s = VISIT_STATUSES[v.status];
                const { from, to } = gridSpan(v.start, v.end);
                return (
                  <Link
                    key={`${v.req}-${v.n}`}
                    href={visitHref(v)}
                    aria-label={visitBlockName(v)}
                    style={{
                      position: "absolute",
                      top: (from / 60) * HOUR_PX + 1,
                      height: Math.max(18, ((to - from) / 60) * HOUR_PX - 2),
                      right: 2,
                      left: 2,
                      background: s.bg,
                      color: s.fg,
                      border: 0,
                      borderRight: `3px solid ${s.c}`,
                      borderRadius: 5,
                      padding: "3px 4px",
                      fontSize: 10,
                      fontWeight: 700,
                      lineHeight: 1.25,
                      overflow: "hidden",
                      overflowWrap: "anywhere",
                      textAlign: "right",
                      textDecoration: "none",
                      display: "flex",
                      flexDirection: "column",
                      gap: 1,
                    }}
                  >
                    <span style={{ fontSize: 11 }}>
                      {firstWord(v.customerName)}
                      {v.isTest && <span aria-hidden="true"> 🧪</span>}
                    </span>
                    <span style={{ fontWeight: 600, opacity: 0.9 }}>{v.city}</span>
                    <span
                      className="num"
                      dir="ltr"
                      style={{ fontWeight: 600, opacity: 0.9, textAlign: "right", fontSize: 9.5, letterSpacing: -0.2 }}
                    >
                      {v.start}-<wbr />
                      {v.end}
                    </span>
                  </Link>
                );
              })}
            </div>
          ))}
        </div>
      </section>
      {hidden > 0 && (
        <div className="sub" style={{ textAlign: "center" }}>
          {hiddenLabel(hidden)}
        </div>
      )}
      <div aria-label="מקרא צבעים" role="note" style={{ display: "flex", gap: 10, fontSize: 11, justifyContent: "center", flexWrap: "wrap" }}>
        {LEGEND.map((k) => (
          <span key={k}>
            <span className="dot" style={{ background: VISIT_STATUSES[k].c }} /> {VISIT_STATUSES[k].label}
          </span>
        ))}
      </div>
    </>
  );
}
