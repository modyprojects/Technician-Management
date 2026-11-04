import Link from "next/link";
import type { CSSProperties } from "react";
import { CALENDAR_SHIFT_LABELS } from "@/features/calendar/data/dates";
import type { CalendarView } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { BellLink } from "./BellLink";
import { calendarLabel } from "./CalendarDates";

// Header of the technician's "היומן שלי" (docs/demo.html techCalendar() head L606-608 and the
// "› חזרה" line phone() adds on the calendar, L449; TE-27): back link, title, "‹ label ›" date
// navigation and the bell. The arrows and the bell are links (navigation), the label says what
// the view shows ("רביעי 21.10", "18.10–22.10", "אוקטובר 2026").
// Changes for the app: the arrows get a 28px tap target (WCAG 2.5.8) and names that say what they
// open ("יום העבודה הבא", "השבוע הקודם"; the same as the office calendar); the bell carries the
// unread count as the home header does (TE-28).
// Every top-level element is its own child of .ph-head, so above 900px it aligns with the 760px
// content column (TE-31). Presentational: the caller passes the links.

const ARROW_STYLE: CSSProperties = {
  display: "inline-flex",
  alignItems: "center",
  justifyContent: "center",
  minWidth: 28,
  minHeight: 28,
};

export function CalendarHeader({
  view,
  date,
  prevHref,
  nextHref,
  backHref,
  backAriaLabel,
  notificationsHref,
  unread,
}: {
  view: CalendarView;
  /** The day the view shows (day view) or a day of the week or month shown. */
  date: IsoDate;
  prevHref: string;
  nextHref: string;
  /** "› חזרה" (the technician home). */
  backHref: string;
  /** Accessible name of the back link; contains "חזרה". */
  backAriaLabel: string;
  notificationsHref: string;
  unread: number;
}) {
  const label = calendarLabel(view, date);
  const names = CALENDAR_SHIFT_LABELS[view];
  return (
    <>
      <div>
        <Link className="ph-back" href={backHref} aria-label={backAriaLabel}>
          <span aria-hidden="true">› </span>
          חזרה
        </Link>
      </div>
      <div style={{ display: "flex", justifyContent: "space-between", alignItems: "center", gap: 8 }}>
        <h1 style={{ fontSize: 22 }}>היומן שלי</h1>
        <span style={{ display: "flex", gap: 4, alignItems: "center", color: "var(--on-dark3)" }}>
          <Link className="ph-back" href={prevHref} aria-label={names.prev} style={ARROW_STYLE}>
            <span aria-hidden="true">‹</span>
          </Link>
          <span className="num" aria-live="polite" style={{ fontSize: 14, whiteSpace: "nowrap" }}>
            {label}
          </span>
          <Link className="ph-back" href={nextHref} aria-label={names.next} style={ARROW_STYLE}>
            <span aria-hidden="true">›</span>
          </Link>
          <BellLink href={notificationsHref} unread={unread} style={{ marginInlineStart: 4 }} />
        </span>
      </div>
    </>
  );
}
