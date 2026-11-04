import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import type { OfficeCalendarDay, PlacedCalendarVisit } from "@/features/calendar/data/types";
import type { VisitRef } from "@/features/visits/data/types";
import { calVisitKey, hourLabel, hourRange, toMinutes, visitCountLabel } from "./CalendarParts";

// Office calendar, day view (docs/demo.html offCal() L760-768): one column per technician (colour
// dot, name, visit count) beside an hour scale, each visit a block in its status colours (the
// .ev look), overlapping visits side by side in lanes (the demo's laneLayout, placed by the data
// layer). A block is a link that opens the visit drawer (`req&n` in the URL); the URL keeps the
// scroll position. Sideways scrolling inside .scrollx on narrow screens, as in the demo.
// The grid shows 08:00-18:00 as in the demo and widens only when a visit falls outside it.
// Presentational: takes the calendar DTO and a link builder.

/** Pixels per hour (the demo's H). */
const H = 60;

/** The demo's minimum block height. */
const MIN_BLOCK = 36;

function DayBlock({ v, from, href }: { v: PlacedCalendarVisit; from: number; href: string }) {
  const s = VISIT_STATUSES[v.status];
  const start = toMinutes(v.start);
  const end = toMinutes(v.end);
  const top = ((start - from) / 60) * H;
  const height = Math.max(MIN_BLOCK, ((end - start) / 60) * H - 4);
  const lanes = Math.max(1, v.lanes);
  const w = 100 / lanes;
  return (
    <Link
      href={href}
      prefetch={false}
      scroll={false}
      className="ev ocal-ev"
      data-cal-visit={calVisitKey(v)}
      style={{
        top: top + 2,
        height,
        right: `calc(${v.lane * w}% + 4px)`,
        left: "auto",
        width: `calc(${w}% - 8px)`,
        background: s.bg,
        color: s.fg,
        borderRightColor: s.c,
      }}
    >
      <span className="ev-body">
        <b>{v.customerName}</b> <span className="num">{v.start}</span> · {v.city}
        {v.n > 1 && ` · ביקור ${v.n}`} <br />
        {s.label}
        <span className="sr-only">
          {" "}
          · עד {v.end} · {v.technician.name}
        </span>
      </span>
    </Link>
  );
}

export function CalendarDayView({ day, visitHref }: { day: OfficeCalendarDay; visitHref: (visit: VisitRef) => string }) {
  const lanes = day.lanes;
  const { from, to } = hourRange(lanes.flatMap((l) => l.visits.items));
  const hours = Math.round((to - from) / 60);
  const height = hours * H;
  const grid = `56px repeat(${lanes.length}, minmax(0, 1fr))`;
  const cut = lanes.filter((l) => l.visits.total > l.visits.items.length);
  return (
    <>
      {lanes.length > 0 && (
        <div className="scrollx">
          <div className="cal" style={{ minWidth: lanes.length > 1 ? 640 : 320 }}>
            <div className="calhead" style={{ gridTemplateColumns: grid }}>
              <div />
              {lanes.map((l) => (
                <div key={l.technician.id}>
                  <span className="dot" style={{ background: l.technician.color }} aria-hidden="true" /> {l.technician.name}{" "}
                  <span className="sub" style={{ fontWeight: 400 }}>
                    · {visitCountLabel(l.visits.total)}
                  </span>
                </div>
              ))}
            </div>
            <div className="calbody" style={{ gridTemplateColumns: grid }}>
              <div aria-hidden="true" style={{ position: "relative", height }}>
                {Array.from({ length: hours }, (_, i) => (
                  <span key={i} className="num" style={{ position: "absolute", top: i * H + 2, right: 8, fontSize: 11, color: "var(--muted)" }}>
                    {hourLabel(from + i * 60)}
                  </span>
                ))}
              </div>
              {lanes.map((l) => (
                <div
                  key={l.technician.id}
                  className="calcol"
                  style={{ height }}
                  role="group"
                  aria-label={`${l.technician.name} · ${visitCountLabel(l.visits.total)}`}
                >
                  {Array.from({ length: Math.max(0, hours - 1) }, (_, i) => (
                    <div key={i} className="hr" style={{ top: (i + 1) * H }} aria-hidden="true" />
                  ))}
                  {l.visits.items.map((v) => (
                    <DayBlock key={calVisitKey(v)} v={v} from={from} href={visitHref({ req: v.req, n: v.n })} />
                  ))}
                </div>
              ))}
            </div>
          </div>
        </div>
      )}
      {cut.map((l) => (
        <div key={l.technician.id} className="sub">
          {l.technician.name}: מוצגים {l.visits.items.length} הראשונים מתוך {l.visits.total} ביקורים.
        </div>
      ))}
      {day.total === 0 && <div className="empty">אין ביקורים ביום הזה</div>}
    </>
  );
}
