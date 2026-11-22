import Link from "next/link";
import { dayName, dayOfMonth, dayShort, ddmm, visitCountLabel } from "@/features/calendar/data/dates";
import type { CalDay } from "./types";

// The day strip (demo L611): today and the next 6 days, each with its visit count; Friday and
// Saturday are shown. The chosen day is in the accent colour.
// `label` (optional): the strip's accessible name; default "הימים הקרובים".
export function TechCalStrip({ days, selected, dayHref, label = "הימים הקרובים" }: { days: CalDay[]; selected: string; dayHref: (d: string) => string; label?: string }) {
  return (
    <div role="group" aria-label={label} style={{ display: "flex", gap: 4, flex: "none" }}>
      {days.map(({ date, visits }) => {
        const on = date === selected;
        const n = visits.length;
        return (
          <Link
            key={date}
            href={dayHref(date)}
            aria-current={on ? "true" : undefined}
            aria-label={`${dayName(date)} ${ddmm(date)} · ${visitCountLabel(n)}`}
            style={{
              flex: 1,
              minWidth: 0,
              borderRadius: 12,
              padding: "7px 0",
              textAlign: "center",
              textDecoration: "none",
              ...(on ? { background: "var(--accent)", color: "var(--on-dark)", border: 0 } : { background: "var(--card)", color: "inherit", border: "1px solid var(--line)" }),
            }}
          >
            <div style={{ fontSize: 12, opacity: 0.8 }}>{dayShort(date)}</div>
            <div className="num" style={{ fontFamily: "var(--display)", fontWeight: 600, fontSize: 17 }}>
              {dayOfMonth(date)}
            </div>
            <div className="num" style={{ fontSize: 11, fontWeight: 700, opacity: 0.9 }}>
              {n}
            </div>
          </Link>
        );
      })}
    </div>
  );
}
