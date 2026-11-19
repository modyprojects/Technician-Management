import Link from "next/link";
import { StatusPill, VISIT_STATUSES } from "@/components/ui/StatusPill";
import { VisitSourceIcon } from "@/components/ui/TestBadge";
import type { LaneVisit, TechnicianLane } from "@/features/dashboards/data/types";
import type { TechnicianId } from "@/features/reference/data/types";
import { TimeRange } from "@/components/ui/TimeRange";

// Technicians' day, one card per technician (docs/demo.html dashGen() "עכשיו בשטח", L882: colour
// edge, name, current-status pill or "פנוי", current / next customer, "היום: X/Y הושלמו"), plus
// what the office home needs from the day calendar (offCal() day view, L762-768): the day as a
// lane of status-coloured blocks (the .ev colours) and the visit list, each visit a link to its
// call card. Presentational; takes the dashboards DTO (TechnicianLane).

const DAY_START = 8 * 60;
const DAY_END = 18 * 60;

const toMin = (t: string): number => {
  const [h = 0, m = 0] = t.split(":").map(Number);
  return h * 60 + m;
};

/** The day from 08:00 to 18:00 (wider when a visit falls outside), whole hours. */
function dayRange(visits: readonly LaneVisit[]): { from: number; to: number } {
  const starts = visits.map((v) => toMin(v.start));
  const ends = visits.map((v) => toMin(v.end));
  const from = Math.floor(Math.min(DAY_START, ...starts) / 60) * 60;
  const to = Math.ceil(Math.max(DAY_END, ...ends) / 60) * 60;
  return { from, to: Math.max(to, from + 60) };
}

/** The day as a lane: status-coloured blocks on an hour grid (decorative; the list below links). */
function LaneTimeline({ visits }: { visits: readonly LaneVisit[] }) {
  const { from, to } = dayRange(visits);
  const span = to - from;
  const at = (min: number): string => `${((min - from) / span) * 100}%`;
  const hours: number[] = [];
  for (let m = from; m <= to; m += 60) hours.push(m);
  return (
    <div aria-hidden="true">
      <div className="od-tl">
        {hours.slice(1, -1).map((m) => (
          <span key={m} className="od-tl-hr" style={{ insetInlineStart: at(m) }} />
        ))}
        {visits.map((v) => {
          const s = VISIT_STATUSES[v.status];
          const start = toMin(v.start);
          const end = Math.max(toMin(v.end), start + 15);
          return (
            <span
              key={`${v.req}-${v.n}`}
              className="od-tl-ev"
              title={`${v.start}–${v.end} · ${v.customerName} · ${s.label}`}
              style={{ insetInlineStart: at(start), width: `${((end - start) / span) * 100}%`, background: s.bg, borderRightColor: s.c }}
            />
          );
        })}
      </div>
      <div className="od-tl-axis num">
        {hours
          .filter((m) => (m - from) % 120 === 0 || m === to)
          .map((m) => (
            <span
              key={m}
              style={{
                insetInlineStart: at(m),
                transform: m === from ? undefined : m === to ? "translateX(100%)" : "translateX(50%)",
              }}
            >
              {String(m / 60).padStart(2, "0")}
            </span>
          ))}
      </div>
    </div>
  );
}

function stateLine(lane: TechnicianLane): string {
  if (lane.current) return `${lane.current.customerName}, ${lane.current.city}`;
  if (lane.next) return `הבא: ${lane.next.customerName} ${lane.next.start}`;
  return lane.total ? "אין עוד ביקורים היום" : "אין ביקורים היום";
}

export function TechLanes({
  lanes,
  callHref,
  technicianHref,
  idPrefix = "od-lane",
}: {
  lanes: readonly TechnicianLane[];
  /** Call card URL of a request number. */
  callHref: (req: string) => string;
  /** Optional link on the technician's name (the demo's drill-down, matrix key dashTech). */
  technicianHref?: (id: TechnicianId) => string;
  /** Prefix of the per-technician heading ids; give each instance on one page its own prefix. */
  idPrefix?: string;
}) {
  if (!lanes.length) return <div className="empty">אין טכנאים פעילים</div>;
  return (
    <div className="cols3">
      {lanes.map((lane) => {
        const t = lane.technician;
        const headingId = `${idPrefix}-${t.id}`;
        const donePct = lane.total ? (lane.completed / lane.total) * 100 : 0;
        return (
          <article key={t.id} className="card od-lane" style={{ borderRightColor: t.color }} aria-labelledby={headingId}>
            <div className="od-lane-head">
              <h3 id={headingId}>
                <span className="dot" style={{ background: t.color }} aria-hidden="true" />{" "}
                {technicianHref ? (
                  <Link href={technicianHref(t.id)} prefetch={false} className="lnk" aria-label={`${t.name} · פירוט הטכנאי`}>
                    {t.name} <span aria-hidden="true">›</span>
                  </Link>
                ) : (
                  t.name
                )}
              </h3>
              {lane.current ? (
                <StatusPill status={lane.current.status} />
              ) : (
                <span className="pill" style={{ background: "var(--bg)", color: "var(--muted)" }}>
                  פנוי
                </span>
              )}
            </div>
            <div className="sub">{stateLine(lane)}</div>
            {lane.visits.length > 0 && <LaneTimeline visits={lane.visits} />}
            {lane.visits.length > 0 && (
              <ul className="od-vlist" aria-label={`הביקורים של ${t.name} היום`}>
                {lane.visits.map((v) => (
                  <li key={`${v.req}-${v.n}`}>
                    <Link href={callHref(v.req)} prefetch={false} className="od-visit">
                      <span className="num od-visit-t">
                        <TimeRange start={v.start} end={v.end} />
                      </span>
                      <span className="od-visit-c">
                        <b>{v.customerName}</b>
                        {` · ${v.city}`}
                        {v.n > 1 && ` · ביקור ${v.n}`}
                      </span>
                      <VisitSourceIcon className="od-visit-src" source={v.source} />
                      <StatusPill status={v.status} />
                    </Link>
                  </li>
                ))}
              </ul>
            )}
            <div className="od-lane-foot">
              <span style={{ whiteSpace: "nowrap" }}>
                היום:{" "}
                <b className="num">
                  {lane.completed}/{lane.total}
                </b>{" "}
                הושלמו
              </span>
              <div className="track" aria-hidden="true">
                <span style={{ width: `${donePct}%`, background: "var(--s-done)" }} />
              </div>
            </div>
          </article>
        );
      })}
    </div>
  );
}
