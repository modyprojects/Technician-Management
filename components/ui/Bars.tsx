import type { ReactNode } from "react";

// Horizontal bar rows (docs/demo.html bars(), L871, and .bar/.track, L145-147): a label, a track
// filled in proportion to the largest value, and the value. Presentational and server-safe; the
// caller passes ready rows (labels and colours from DTOs, e.g. dashboards BarRow).
// A row may be stacked (`segments`), as in the demo's "ביקורים לפי טכנאי ותוצאה" (L885).

/** One part of a stacked bar. */
export type BarSegment = { label: string; value: number; color: string };

export type BarsRow = {
  /** Stable React key; defaults to the label when it is a string. */
  key?: string;
  label: ReactNode;
  value: number;
  /** Fill colour; the chart's `color` when missing. */
  color?: string;
  /** Text shown instead of the number, e.g. "34 דק׳". */
  display?: string;
  /** Stacked fill instead of one colour; each segment's width follows its own value. */
  segments?: readonly BarSegment[];
};

const width = (value: number, max: number): string => `${Math.max(0, Math.min(100, (value / max) * 100))}%`;

export function Bars({
  rows,
  color = "var(--accent)",
  max,
  emptyText = "אין נתונים להצגה",
}: {
  rows: readonly BarsRow[];
  /** Default fill colour (the demo passes one per chart). */
  color?: string;
  /** Value of a full track; default the largest row value (at least 1), as in the demo. */
  max?: number;
  emptyText?: string;
}) {
  if (!rows.length) return <div className="sub">{emptyText}</div>;
  const full = Math.max(1, max ?? Math.max(...rows.map((r) => r.value)));
  return (
    <div>
      {rows.map((r, i) => (
        <div className="bar" key={r.key ?? (typeof r.label === "string" ? r.label : i)}>
          <span style={{ minWidth: 0, overflowWrap: "anywhere" }}>{r.label}</span>
          <div className="track" aria-hidden="true">
            {r.segments ? (
              r.segments.map((s) => (
                <span key={s.label} title={`${s.label}: ${s.value}`} style={{ width: width(s.value, full), background: s.color }} />
              ))
            ) : (
              <span style={{ width: width(r.value, full), background: r.color ?? color }} />
            )}
          </div>
          <span className="num">
            {r.display ?? r.value}
            {r.segments && (
              <span className="sr-only">{` (${r.segments.map((s) => `${s.label} ${s.value}`).join(", ")})`}</span>
            )}
          </span>
        </div>
      ))}
    </div>
  );
}
