import Link from "next/link";
import type { CSSProperties } from "react";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import { dayName, dayOfMonth, dayShort, ddmm } from "@/features/calendar/data/dates";
import { techVisitPath } from "@/features/visits/data/paths";
import { blockBox, hourLabel, hourRange } from "./grid";
import { blockName } from "./TechCalDay";
import type { FakeDay, FakeVisit } from "./types";

// Week view (demo L620-626): a calendar week, Sunday to Saturday, as 7 columns on the hour grid
// (08:00-17:00, widened to the visits). Days before today are greyed and show only visits closed
// that day, in the reduced form (address, status, summary). A heading opens that day in the daily
// view only when the day is in the day strip; a block opens the full visit card. A block shows the
// request number: at 390 request + time; from 820 request · customer · time, with the quiet "בדיקה"
// marker (at 390 the legend line carries it and each block's accessible name says "נתוני בדיקה").
const HOUR_PX = 56;
const COLUMNS = "24px repeat(7, minmax(0, 1fr))";
const LEGEND = ["new", "work", "done", "cont"] as const;
const PAST: CSSProperties = { opacity: 0.55, filter: "grayscale(1)" };
const NARROW = "flex flex-col gap-px min-[820px]:hidden";
const WIDE = "hidden min-[820px]:block";

function Block({ v, past, box }: { v: FakeVisit; past: boolean; box: { top: number; height: number } }) {
  const s = VISIT_STATUSES[v.status];
  return (
    <Link
      href={techVisitPath(v.id)}
      aria-label={past ? `${blockName(v)} · ${v.address} · ${v.summary}` : blockName(v)}
      style={{ position: "absolute", top: box.top + 1, height: Math.max(18, box.height - 2), right: 1, left: 1, background: s.bg, color: s.fg, borderRight: `3px solid ${s.c}`, borderRadius: 5, padding: "3px 3px", fontSize: 10, fontWeight: 700, lineHeight: 1.25, overflow: "hidden", overflowWrap: "anywhere", textAlign: "right", textDecoration: "none" }}
    >
      <span className={NARROW}>
        <span className="num" style={{ fontSize: 10.5 }}>{v.request}</span>
        <span className="num" dir="ltr" style={{ fontWeight: 600, opacity: 0.9, textAlign: "right", fontSize: 9 }}>
          {v.start}
        </span>
      </span>
      {past ? (
        <span className={WIDE} style={{ fontWeight: 600 }}>
          <b className="num">{v.request}</b> · {v.address}
          <br />
          {s.label} · {v.summary}
        </span>
      ) : (
        <span className={WIDE}>
          <span className="num">{v.request}</span> · {v.customer} · <span className="num">{v.start}</span> <TestPill />
        </span>
      )}
    </Link>
  );
}

export function TechCalWeek({ days, today, label, dayHref }: { days: FakeDay[]; today: string; label: string; dayHref: (d: string) => string | null }) {
  const range = hourRange(days.flatMap((d) => d.visits));
  const hours = range.endHour - range.startHour;
  const rows = Array.from({ length: hours }, (_, i) => range.startHour + i);
  return (
    <>
      <section className="card" aria-label={label} style={{ overflow: "hidden", flex: "none" }}>
        <div style={{ display: "grid", gridTemplateColumns: COLUMNS, borderBottom: "1px solid var(--line)" }}>
          <div />
          {days.map(({ date }) => {
            const href = dayHref(date);
            const past = date < today;
            const style: CSSProperties = { display: "block", padding: "6px 0", textAlign: "center", textDecoration: "none", color: date === today ? "var(--accent)" : "inherit", ...(past ? PAST : null) };
            const inner = (
              <>
                <div style={{ fontSize: 11, color: "var(--muted)" }}>{dayShort(date)}</div>
                <b className="num">{dayOfMonth(date)}</b>
                <span className="sr-only">{` · ${dayName(date)} ${ddmm(date)}${href ? " · תצוגה יומית" : ""}`}</span>
              </>
            );
            return href ? (
              <Link key={date} href={href} aria-current={date === today ? "date" : undefined} style={style}>
                {inner}
              </Link>
            ) : (
              <div key={date} aria-current={date === today ? "date" : undefined} style={style}>
                {inner}
              </div>
            );
          })}
        </div>
        <div style={{ display: "grid", gridTemplateColumns: COLUMNS, height: hours * HOUR_PX }}>
          <div aria-hidden="true" style={{ position: "relative" }}>
            {rows.map((h, i) => (
              <span key={h} className="num" style={{ position: "absolute", top: i * HOUR_PX + 1, right: 3, fontSize: 10, color: "var(--muted)" }}>
                {hourLabel(h).slice(0, 2)}
              </span>
            ))}
          </div>
          {days.map(({ date, visits }) => {
            const past = date < today;
            return (
              <div
                key={date}
                role="group"
                aria-label={`${dayName(date)} ${ddmm(date)}${past ? " · יום שעבר" : ""}`}
                style={{ position: "relative", borderRight: "1px solid var(--line2)", backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${HOUR_PX - 1}px, var(--line2) ${HOUR_PX - 1}px, var(--line2) ${HOUR_PX}px)`, ...(date === today ? { backgroundColor: "var(--accent-l)" } : null), ...(past ? { backgroundColor: "var(--line2)" } : null) }}
              >
                <div style={past ? PAST : undefined}>
                  {visits.map((v) => (
                    <Block key={v.id} v={v} past={past} box={blockBox(v, range, HOUR_PX)} />
                  ))}
                </div>
                {!visits.length && (
                  <div className="sub" style={{ position: "absolute", top: 8, right: 0, left: 0, textAlign: "center", fontSize: 10, lineHeight: 1.2 }}>
                    אין ביקורים
                  </div>
                )}
              </div>
            );
          })}
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
