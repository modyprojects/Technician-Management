import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { dayName, dayOfMonth, dayShort, ddmm } from "@/features/calendar/data/dates";
import { techVisitPath } from "@/features/visits/data/paths";
import { GRID_HOURS, gridSpan } from "../CalendarDates";
import { blockName } from "./TechCalDay";
import type { FakeDay } from "./types";

// Week view (demo L620-626): the same 7 days (today to today+6) as columns on the 08:00-18:00
// grid. A heading opens that day; a block opens the full visit card. A day without visits says
// "אין ביקורים" in its column. The blocks are too narrow for the "בדיקה" marker: the legend line
// carries it and each block's accessible name says "נתוני בדיקה".
const HOUR_PX = 62;
const COLUMNS = "24px repeat(7, minmax(0, 1fr))";
const LEGEND = ["new", "work", "done", "cont"] as const;
const firstWord = (name: string): string => name.trim().split(/\s+/)[0] ?? name;

export function TechCalWeek({ days, today, dayHref }: { days: FakeDay[]; today: string; dayHref: (d: string) => string }) {
  return (
    <>
      <section className="card" aria-label="7 הימים הקרובים" style={{ overflow: "hidden", flex: "none" }}>
        <div style={{ display: "grid", gridTemplateColumns: COLUMNS, borderBottom: "1px solid var(--line)" }}>
          <div />
          {days.map(({ date }) => (
            <Link key={date} href={dayHref(date)} aria-current={date === today ? "date" : undefined} style={{ display: "block", padding: "6px 0", textAlign: "center", textDecoration: "none", color: date === today ? "var(--accent)" : "inherit" }}>
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
          {days.map(({ date, visits }) => (
            <div key={date} role="group" aria-label={`${dayName(date)} ${ddmm(date)}`} style={{ position: "relative", borderRight: "1px solid var(--line2)", ...(date === today ? { background: "var(--accent-l)" } : null) }}>
              {visits.map((v) => {
                const s = VISIT_STATUSES[v.status];
                const { from, to } = gridSpan(v.start, v.end);
                return (
                  <Link
                    key={v.id}
                    href={techVisitPath(v.id)}
                    aria-label={blockName(v)}
                    style={{ position: "absolute", top: (from / 60) * HOUR_PX + 1, height: Math.max(18, ((to - from) / 60) * HOUR_PX - 2), right: 1, left: 1, background: s.bg, color: s.fg, borderRight: `3px solid ${s.c}`, borderRadius: 5, padding: "3px 3px", fontSize: 10, fontWeight: 700, lineHeight: 1.25, overflow: "hidden", overflowWrap: "anywhere", textAlign: "right", textDecoration: "none", display: "flex", flexDirection: "column", gap: 1 }}
                  >
                    <span style={{ fontSize: 10.5 }}>{firstWord(v.customer)}</span>
                    <span className="num" dir="ltr" style={{ fontWeight: 600, opacity: 0.9, textAlign: "right", fontSize: 9 }}>
                      {v.start}
                    </span>
                  </Link>
                );
              })}
              {!visits.length && (
                <div className="sub" style={{ position: "absolute", top: 8, right: 0, left: 0, textAlign: "center", fontSize: 10, lineHeight: 1.2 }}>
                  אין ביקורים
                </div>
              )}
            </div>
          ))}
        </div>
      </section>
      <div aria-label="מקרא צבעים" role="note" style={{ display: "flex", gap: 10, fontSize: 11, justifyContent: "center", flexWrap: "wrap" }}>
        {LEGEND.map((k) => (
          <span key={k}>
            <span className="dot" style={{ background: VISIT_STATUSES[k].c }} /> {VISIT_STATUSES[k].label}
          </span>
        ))}
        <span className="test-mark">בדיקה = נתוני בדיקה</span>
      </div>
    </>
  );
}
