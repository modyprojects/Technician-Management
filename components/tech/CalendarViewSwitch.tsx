import Link from "next/link";
import type { CSSProperties } from "react";
import { CALENDAR_VIEW_VALUES, type CalendarView } from "@/features/calendar/data/types";

// "יומי / שבועי / חודשי" segments of the technician calendar (docs/demo.html techCalendar() L609;
// TE-27). Each segment opens its view, so it is a link (navigation) with the look of the demo's
// ".seg button" (styles/ui.css L89-91, repeated inline because those rules target buttons);
// the selected view carries aria-current="page".

const LABELS: Record<CalendarView, string> = { day: "יומי", week: "שבועי", month: "חודשי" };

const SEGMENT: CSSProperties = {
  flex: 1,
  border: 0,
  background: "transparent",
  padding: 7,
  borderRadius: 8,
  fontWeight: 700,
  color: "var(--muted)",
  fontSize: 14,
  textAlign: "center",
  textDecoration: "none",
};

const SEGMENT_ON: CSSProperties = { ...SEGMENT, background: "var(--card)", color: "var(--ink)" };

export function CalendarViewSwitch({ view, hrefOf }: { view: CalendarView; hrefOf: (view: CalendarView) => string }) {
  return (
    <nav className="seg" aria-label="תצוגת היומן" style={{ flex: "none" }}>
      {CALENDAR_VIEW_VALUES.map((v) => (
        <Link key={v} href={hrefOf(v)} aria-current={v === view ? "page" : undefined} style={v === view ? SEGMENT_ON : SEGMENT}>
          {LABELS[v]}
        </Link>
      ))}
    </nav>
  );
}
