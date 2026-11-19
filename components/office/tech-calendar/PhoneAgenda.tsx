import Link from "next/link";
import { StatusPill } from "@/components/ui/StatusPill";
import { TestBadge } from "@/components/ui/TestBadge";
import { TimeRange } from "@/components/ui/TimeRange";
import { dayName, ddmm, visitCountLabel } from "@/features/calendar/data/dates";
import type { CalendarVisit, OfficeCalendarDay, OfficeCalendarWeek } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";
import { calVisitKey } from "../CalendarParts";

// Phone layout of "יומן טכנאים" (D72, D73; design-rules "phone = cards"): the hour grid does not
// fit 390 px, so the day is one section per technician and the week one section per day, each
// visit a card: time range, request number, customer and city, a status chip (text, never colour
// alone) and the technician's colour on the edge. A card opens the visit drawer. Presentational.

function VisitCard({ v, href, showTech }: { v: CalendarVisit; href: string; showTech: boolean }) {
  return (
    <li>
      <Link
        href={href}
        prefetch={false}
        scroll={false}
        className="card"
        data-cal-visit={calVisitKey(v)}
        style={{ display: "block", padding: "10px 12px", borderRight: `4px solid ${v.technician.color}`, color: "inherit", textDecoration: "none" }}
      >
        <span style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
          <b className="num">
            <TimeRange start={v.start} end={v.end} />
          </b>
          <StatusPill status={v.status} />
        </span>
        <span style={{ display: "block", marginTop: 4 }}>
          <b>{v.customerName}</b> · {v.city} {v.isTest && <TestBadge />}
        </span>
        <span className="sub" style={{ display: "block" }}>
          מס׳ פנייה{" "}
          <bdi dir="ltr" className="num">
            {v.req}
          </bdi>
          {v.n > 1 && ` · ביקור ${v.n}`}
          {showTech && ` · ${v.technician.name}`}
        </span>
      </Link>
    </li>
  );
}

const listStyle = { listStyle: "none", margin: 0, padding: 0, display: "flex", flexDirection: "column", gap: 8 } as const;
const stackStyle = { display: "flex", flexDirection: "column", gap: 16 } as const;

export function PhoneDayAgenda({ day, visitHref }: { day: OfficeCalendarDay; visitHref: (v: VisitRef) => string }) {
  if (day.total === 0) return <div className="empty">אין ביקורים ביום הזה</div>;
  return (
    <div style={stackStyle}>
      {day.lanes.map((l) => (
        <section key={l.technician.id} aria-labelledby={`pa-${l.technician.id}`}>
          <h2 id={`pa-${l.technician.id}`} style={{ fontSize: 16, margin: "0 0 8px" }}>
            <span className="dot" style={{ background: l.technician.color }} aria-hidden="true" /> {l.technician.name}{" "}
            <span className="sub" style={{ fontWeight: 400 }}>
              · {visitCountLabel(l.visits.total)}
            </span>
          </h2>
          {l.visits.items.length ? (
            <ul style={listStyle}>
              {l.visits.items.map((v) => (
                <VisitCard key={calVisitKey(v)} v={v} href={visitHref({ req: v.req, n: v.n })} showTech={false} />
              ))}
            </ul>
          ) : (
            <div className="sub">אין ביקורים</div>
          )}
        </section>
      ))}
    </div>
  );
}

export function PhoneWeekAgenda({
  week,
  today,
  visitHref,
  dayHref,
}: {
  week: OfficeCalendarWeek;
  today: IsoDate;
  visitHref: (v: VisitRef) => string;
  dayHref: (d: IsoDate) => string;
}) {
  return (
    <div style={stackStyle}>
      {week.days.map((d) => (
        <section key={d.date} aria-labelledby={`pw-${d.date}`}>
          <h2 id={`pw-${d.date}`} style={{ fontSize: 16, margin: "0 0 8px" }}>
            <Link href={dayHref(d.date)} prefetch={false} className="lnk">
              {dayName(d.date)} {ddmm(d.date)}
            </Link>
            {d.date === today && <span className="sub"> · היום</span>}{" "}
            <span className="sub" style={{ fontWeight: 400 }}>
              · {visitCountLabel(d.visits.total)}
            </span>
          </h2>
          {d.visits.items.length ? (
            <ul style={listStyle}>
              {d.visits.items.map((v) => (
                <VisitCard key={calVisitKey(v)} v={v} href={visitHref({ req: v.req, n: v.n })} showTech />
              ))}
            </ul>
          ) : (
            <div className="sub">אין ביקורים</div>
          )}
        </section>
      ))}
    </div>
  );
}
