import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import { dayName, ddmm } from "@/features/calendar/data/dates";
import { techVisitPath } from "@/features/visits/data/paths";
import { gridHourLabel, GRID_HOURS, gridSpan } from "../CalendarDates";
import type { FakeDay, FakeVisit } from "./types";

// Day view (demo techCalendar() L612-619): the 08:00-18:00 grid and a block per visit in its
// status colours; "אין ביקורים" on an empty day. A block opens the full visit card (D83).
const HOUR_PX = 44;

export const subject = (v: FakeVisit): string => (v.isFollowUp ? "↻ ביקור המשך" : v.product);
export const blockName = (v: FakeVisit): string => `${v.customer} · ${v.start}–${v.end} · ${v.city} · ${subject(v)} · ${VISIT_STATUSES[v.status].label} · נתוני בדיקה`;

export function TechCalDay({ day }: { day: FakeDay }) {
  return (
    <section className="card" aria-label={`ביקורים ביום ${dayName(day.date)} ${ddmm(day.date)}`} style={{ position: "relative", height: GRID_HOURS * HOUR_PX, overflow: "hidden", flex: "none" }}>
      <div aria-hidden="true">
        {Array.from({ length: GRID_HOURS }, (_, i) => (
          <div key={i} className="hr" style={{ top: i * HOUR_PX }}>
            <span style={{ position: "absolute", top: 2, right: 6, fontSize: 11, color: "var(--muted)" }}>{gridHourLabel(i)}</span>
          </div>
        ))}
      </div>
      {day.visits.map((v) => {
        const s = VISIT_STATUSES[v.status];
        const { from, to } = gridSpan(v.start, v.end);
        return (
          <Link
            key={v.id}
            href={techVisitPath(v.id)}
            className="ev"
            aria-label={blockName(v)}
            style={{ top: (from / 60) * HOUR_PX + 2, height: ((to - from) / 60) * HOUR_PX - 4, right: 52, left: 8, background: s.bg, color: s.fg, borderRightColor: s.c, textDecoration: "none", overflowWrap: "anywhere" }}
          >
            <span className="ev-body">
              <b>
                {v.customer} · <span className="num">{v.start}</span> <TestPill />
              </b>
              {v.city} · {subject(v)}
            </span>
          </Link>
        );
      })}
      {!day.visits.length && (
        <div className="empty" style={{ position: "absolute", inset: 0, display: "flex", alignItems: "center", justifyContent: "center" }}>
          אין ביקורים
        </div>
      )}
    </section>
  );
}
