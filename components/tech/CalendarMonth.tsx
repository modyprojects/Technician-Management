import Link from "next/link";
import type { CSSProperties } from "react";
import type { TechMonth } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { DAY_SHORT, dayName, dayOfMonth, ddmm, monthCells, monthName, visitsCountLabel, weekdayOf } from "./CalendarDates";

// Month view of the technician's "היומן שלי" (docs/demo.html techCalendar() L627-640; TE-27):
// a Sunday-first grid of whole weeks, each day of the month with its visit count ("4 ביק׳"),
// today in the accent colour, Friday and Saturday and the neighbouring months' days muted, and
// "N ביקורים ב<חודש> · לחיצה על יום פותחת אותו" below.
// Each day of the month is a link to its day view (navigation); the neighbouring months' days
// are not interactive (the demo's disabled buttons). Dynamic month (TE-27, G-01): any month, five
// or six rows as the month needs (the demo was fixed to October 2026). Change: Friday and
// Saturday of the month are links, so their numbers use --muted instead of the demo's --soft
// (2.7:1 on --tint, under WCAG 1.4.3); the other months' days keep --soft (not interactive).
// Presentational: TechMonth DTO (counts only) plus links.

const CELL: CSSProperties = {
  display: "block",
  border: "1px solid var(--line2)",
  borderRadius: 8,
  padding: "5px 2px",
  minHeight: 54,
  textAlign: "center",
  textDecoration: "none",
};

export function CalendarMonth({
  month,
  today,
  dayHref,
}: {
  month: TechMonth;
  today: IsoDate;
  dayHref: (date: IsoDate) => string;
}) {
  const counts = new Map(month.days.map((d) => [d.date, d.count]));
  const cells = monthCells(month.days.map((d) => d.date));
  return (
    <>
      <section className="card" aria-label={`חודש ${monthName(month.month)}`} style={{ padding: 10, flex: "none" }}>
        <div
          aria-hidden="true"
          style={{
            display: "grid",
            gridTemplateColumns: "repeat(7, minmax(0, 1fr))",
            gap: 4,
            marginBottom: 6,
            textAlign: "center",
            fontSize: 12,
            color: "var(--muted)",
            fontWeight: 700,
          }}
        >
          {DAY_SHORT.map((d) => (
            <div key={d}>{d}</div>
          ))}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: "repeat(7, minmax(0, 1fr))", gap: 4 }}>
          {cells.map(({ date, inMonth }) => {
            const number = (
              <div className="num" style={{ fontFamily: "var(--display)", fontWeight: 600 }}>
                {dayOfMonth(date)}
              </div>
            );
            if (!inMonth) {
              return (
                <div key={date} aria-hidden="true" style={{ ...CELL, background: "var(--tint)", color: "var(--soft)" }}>
                  {number}
                </div>
              );
            }
            const n = counts.get(date) ?? 0;
            const on = date === today;
            const weekend = weekdayOf(date) >= 5;
            const look: CSSProperties = on
              ? { background: "var(--accent)", color: "var(--on-dark)" }
              : weekend
                ? { background: "var(--tint)", color: "var(--muted)" }
                : { background: "var(--card)", color: "inherit" };
            return (
              <Link
                key={date}
                href={dayHref(date)}
                aria-current={on ? "date" : undefined}
                aria-label={`${dayOfMonth(date)} · ${dayName(date)} ${ddmm(date)} · ${n ? visitsCountLabel(n) : "אין ביקורים"}`}
                style={{ ...CELL, ...look }}
              >
                {number}
                {n > 0 && (
                  <div style={{ fontSize: 10, fontWeight: 700, ...(on ? null : { color: "var(--accent)" }) }}>{n} ביק׳</div>
                )}
              </Link>
            );
          })}
        </div>
      </section>
      <div className="sub" style={{ textAlign: "center" }}>
        {visitsCountLabel(month.total)} ב{monthName(month.month)} · לחיצה על יום פותחת אותו
      </div>
    </>
  );
}
