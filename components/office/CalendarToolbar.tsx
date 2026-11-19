import Link from "next/link";
import { TimeRange } from "@/components/ui/TimeRange";
import { CalendarLegend } from "./CalendarParts";

const WEEK_TITLE = /^(.*?)(\d\d\.\d\d)–(\d\d\.\d\d)$/;

/** A "שבוע 15.11–19.11" title: the range goes through TimeRange (start–end, design-rules), the rest stays text. */
function PeriodTitle({ title }: { title: string }) {
  const m = WEEK_TITLE.exec(title);
  if (!m) return <>{title}</>;
  return (
    <>
      {m[1]}
      <TimeRange start={m[2] ?? ""} end={m[3] ?? ""} />
    </>
  );
}

// Title row and filter row of the office "יומן טכנאים" (docs/demo.html offCal() L794-801): the
// title with the shown period, the "תצוגה בלבד" note, the יום / שבוע / חודש segments, previous /
// today / next, the technician chips and the status legend. The demo switches these with buttons
// over in-memory state; here each one is a real link to the calendar URL (?view&date&tech, UI
// demo, D53) in the demo's look (.seg, .btn, .chip). The calendar is read-only: scheduling stays
// in Outlook (OF-03). Presentational: the page builds every link.

/** A link in the toolbar: a view segment or a technician chip. */
export type CalendarLink = {
  key: string;
  label: string;
  href: string;
  /** The selected view or technician. */
  on: boolean;
  /** Technician colour (chips only). */
  color?: string;
};

/** Previous / next: an arrow with an accessible name ("השבוע הקודם"). */
export type CalendarStep = { href: string; label: string };

export function CalendarToolbar({
  title,
  views,
  prev,
  todayHref,
  next,
  technicians,
}: {
  /** "רביעי 21.10", "שבוע 18.10–22.10" or "אוקטובר 2026". */
  title: string;
  views: readonly CalendarLink[];
  prev: CalendarStep;
  todayHref: string;
  next: CalendarStep;
  /** "כולם" first, then every technician. */
  technicians: readonly CalendarLink[];
}) {
  return (
    <>
      <div className="ptitle">
        <div>
          <h1>
            יומן טכנאים · <PeriodTitle title={title} />
          </h1>
          <div className="sub">תצוגה בלבד. השיבוץ נעשה ב-Outlook ומתעדכן כאן אוטומטית. לחיצה על ביקור פותחת את פרטי הקריאה.</div>
        </div>
        <div className="ocal-actions">
          <div className="seg ocal-seg" role="group" aria-label="תצוגת היומן">
            {views.map((v) => (
              <Link key={v.key} href={v.href} prefetch={false} className={v.on ? "on" : undefined} aria-current={v.on ? "true" : undefined}>
                {v.label}
              </Link>
            ))}
          </div>
          <div className="ocal-steps" role="group" aria-label="מעבר בין תאריכים">
            <Link className="btn" href={prev.href} prefetch={false} aria-label={prev.label}>
              ‹
            </Link>
            <Link className="btn" href={todayHref} prefetch={false}>
              היום
            </Link>
            <Link className="btn" href={next.href} prefetch={false} aria-label={next.label}>
              ›
            </Link>
          </div>
        </div>
      </div>
      <div className="ocal-filters">
        <div className="ocal-chips" role="group" aria-labelledby="ocal-tech-label">
          <span id="ocal-tech-label" className="sub" style={{ fontWeight: 700 }}>
            טכנאי:
          </span>
          {technicians.map((t) => (
            <Link
              key={t.key}
              href={t.href}
              prefetch={false}
              className={t.on ? "chip on" : "chip"}
              aria-current={t.on ? "true" : undefined}
            >
              {t.color && <span className="dot" style={{ background: t.color }} aria-hidden="true" />}
              {t.color && " "}
              {t.label}
            </Link>
          ))}
        </div>
        <CalendarLegend />
      </div>
    </>
  );
}
