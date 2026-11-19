import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import { dayName, ddmm } from "@/features/calendar/data/dates";
import { techVisitPath } from "@/features/visits/data/paths";
import { blockBox, hourLabel, hourRange } from "./grid";
import type { FakeDay, FakeVisit } from "./types";

// Day view (demo techCalendar() L612-619): the hour grid (08:00-17:00, widened to the visits) and a
// block per visit in its status colours: "request · customer · time". "אין ביקורים" on an empty day.
// A block opens the full visit card (D83).
const HOUR_PX = 44;

export const subject = (v: FakeVisit): string => (v.isFollowUp ? "↻ ביקור המשך" : v.product);
export const blockName = (v: FakeVisit): string => `פנייה ${v.request} · ${v.customer} · ${v.start}–${v.end} · ${v.city} · ${subject(v)} · ${VISIT_STATUSES[v.status].label} · נתוני בדיקה`;

export function TechCalDay({ day }: { day: FakeDay }) {
  const range = hourRange(day.visits);
  const hours = range.endHour - range.startHour;
  return (
    <section className="card" aria-label={`ביקורים ביום ${dayName(day.date)} ${ddmm(day.date)}`} style={{ position: "relative", height: hours * HOUR_PX, overflow: "hidden", flex: "none" }}>
      <div aria-hidden="true">
        {Array.from({ length: hours }, (_, i) => (
          <div key={i} className="hr" style={{ top: i * HOUR_PX }}>
            <span style={{ position: "absolute", top: 2, right: 6, fontSize: 11, color: "var(--muted)" }}>{hourLabel(range.startHour + i)}</span>
          </div>
        ))}
      </div>
      {day.visits.map((v) => {
        const s = VISIT_STATUSES[v.status];
        const { top, height } = blockBox(v, range, HOUR_PX);
        return (
          <Link
            key={v.id}
            href={techVisitPath(v.id)}
            className="ev"
            aria-label={blockName(v)}
            style={{ top: top + 2, height: height - 4, right: 52, left: 8, background: s.bg, color: s.fg, borderRightColor: s.c, textDecoration: "none", overflowWrap: "anywhere" }}
          >
            <span className="ev-body">
              <b>
                <span className="num">{v.request}</span> · {v.customer} · <span className="num">{v.start}</span> <TestPill />
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
