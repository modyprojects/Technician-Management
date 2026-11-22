import Link from "next/link";
import { VISIT_STATUSES } from "@/components/ui/StatusPill";
import { TEST_DATA_LABEL, TestPill } from "@/components/ui/TestBadge";
import { dayName, ddmm } from "@/features/calendar/data/dates";
import { techVisitPath } from "@/features/visits/data/paths";
import { blockBox, hourLabel, hourRange } from "./grid";
import { TechCalStatusChip } from "./TechCalLegend";
import type { CalDay, CalVisit } from "./types";

// Day view (demo techCalendar() L612-619): the hour grid (08:00-17:00, widened to the visits, D89
// (e)) and a block per visit in its status colours: "request · customer · time" (D89 (d)), the
// status as a text chip (fix b), the quiet "בדיקה" on a test record (D74). "אין ביקורים" on an empty
// day. A block opens the full visit card (D85 (e)).
const HOUR_PX = 44;

export const subject = (v: CalVisit): string => (v.isFollowUp ? "↻ ביקור המשך" : v.product);
export const blockName = (v: CalVisit): string =>
  [v.request && `פנייה ${v.request}`, v.customer, `${v.start}–${v.end}`, v.city, subject(v), VISIT_STATUSES[v.status].label, v.isTest && TEST_DATA_LABEL]
    .filter(Boolean)
    .join(" · ");

/** `visitHref` (optional): where a block links; default the technician's own visit card (D85 (e)). */
export function TechCalDay({ day, visitHref = (v) => techVisitPath(v.id) }: { day: CalDay; visitHref?: (v: CalVisit) => string }) {
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
        const second = [v.city, subject(v)].filter(Boolean).join(" · ");
        return (
          <Link
            key={v.id}
            href={visitHref(v)}
            className="ev"
            aria-label={blockName(v)}
            style={{ top: top + 2, height: height - 4, right: 52, left: 8, background: s.bg, color: s.fg, borderRightColor: s.c, textDecoration: "none", overflowWrap: "anywhere", alignItems: "flex-start", gap: 6 }}
          >
            <span className="ev-body" style={{ flex: 1 }}>
              <b>
                {v.request && <span className="num">{v.request} · </span>}
                {v.customer && `${v.customer} · `}
                <span className="num">{v.start}</span> {v.isTest && <TestPill />}
              </b>
              {second}
            </span>
            <span style={{ flex: "none" }}>
              <TechCalStatusChip status={v.status} />
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
