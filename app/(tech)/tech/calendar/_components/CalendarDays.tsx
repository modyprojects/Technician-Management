import { StatusPill } from "@/components/ui/StatusPill";
import { TestPill } from "@/components/ui/TestBadge";
import { dayName, ddmm } from "@/features/calendar/data/dates";
import type { FakeCalendarDay, FakeCalendarVisit } from "./calendar-fake";

// The technician calendar skeleton (D81, D83): a list of days, today first, each with its visits,
// styled as the "לו"ז היום" rows. Read-only; rows are not links until the owner decides what a
// tap opens. D79 (closed visits from the day after closing show only address, status and summary)
// does not show here: the scope is today and later (D83), so a closed visit appears only today, in full.
function Row({ v }: { v: FakeCalendarVisit }) {
  return (
    <div className="li">
      <span className="t num">{v.start}</span>
      <span style={{ flex: 1, minWidth: 0 }}>
        <b style={{ fontSize: 14 }}>{v.customer}</b> <TestPill />
        <div className="sub">{v.city} · {v.isFollowUp ? "↻ ביקור המשך" : v.product}</div>
      </span>
      <StatusPill status={v.status} />
    </div>
  );
}

function dayTitle(d: FakeCalendarDay): string {
  const label = d.offset === 0 ? "היום" : d.offset === 1 ? "מחר" : `יום ${dayName(d.date)}`;
  return `${label} · ${ddmm(d.date)}`;
}

export function CalendarDays({ days }: { days: FakeCalendarDay[] }) {
  return (
    <>
      {days.map((d) => (
        <section key={d.date} className="card" aria-label={dayTitle(d)}>
          <div style={{ padding: "10px 14px 4px" }}>
            <h2 style={{ fontFamily: "var(--body)", fontWeight: 700, fontSize: 14 }}>{dayTitle(d)}</h2>
          </div>
          {d.visits.length ? d.visits.map((v) => <Row key={v.start} v={v} />) : <div className="empty">אין ביקורים</div>}
        </section>
      ))}
    </>
  );
}
