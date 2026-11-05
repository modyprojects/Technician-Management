import Link from "next/link";
import { MONTH_NAMES, monthLabel } from "@/features/calendar/data/dates";
import type { YearMonth } from "@/features/calendar/data/types";

// "מגמת קריאות שירות": opened vs closed service calls per month as grouped bars (reference .trends;
// spec-final §6.8). Server-safe. The oldest month is first in the DOM, so it is on the right in
// RTL; each month shows opened (--dash-blue, start side) then closed (--dash-compare). Gridlines at
// 25/50/75% of a "nice" maximum (the smallest 1/2/5 × 10ⁿ at least the largest value) are labelled
// (PROPOSED, C27). A month entirely before the first recorded call shows "—" at the baseline.
// No value labels on the bars (as the reference): the values are in each bar's title and in the
// table under the chart. The two series differ in hue but hardly in lightness, so the fixed order,
// the legend and the table carry the distinction (docs/design-system.md, "Manager dashboard").
// Accessibility: the plot is one named image; the bars are pointer shortcuts only (aria-hidden
// links, tabindex -1, present only when the role is offered `calls`); the <details> table is the
// keyboard and screen-reader path and the equivalent control for WCAG 2.5.8 (PROPOSED, C22).

export type GroupedBarsRow = {
  month: YearMonth;
  opened: number | null;
  closed: number | null;
  openedHref?: string;
  closedHref?: string;
};

/** 3-letter month forms for the 12-month chart (spec-final §6.8). */
const SHORT_MONTHS = ["ינו׳", "פבר׳", "מרץ", "אפר׳", "מאי", "יוני", "יולי", "אוג׳", "ספט׳", "אוק׳", "נוב׳", "דצמ׳"] as const;

const NUMBER = new Intl.NumberFormat("he-IL", { maximumFractionDigits: 1 });

/** The smallest 1, 2 or 5 × 10ⁿ that is at least `max` (at least 1). */
export function niceMax(max: number): number {
  if (!(max > 1)) return 1;
  const power = 10 ** Math.floor(Math.log10(max));
  for (const step of [1, 2, 5, 10]) if (step * power >= max) return step * power;
  return 10 * power;
}

const monthIndex = (m: YearMonth): number => Number(m.slice(5, 7)) - 1;

function Bar({
  value,
  scale,
  tone,
  title,
  href,
}: {
  value: number | null;
  scale: number;
  tone: "o" | "c";
  title: string;
  href?: string;
}) {
  const height = value === null || value === 0 ? 0 : (value / scale) * 100;
  const bar =
    value === null || value === 0 ? null : (
      <span className={`ma-gbar ma-gbar-${tone}`} style={{ height: `max(3px, ${height}%)` }} title={title} />
    );
  const cls = `ma-ghalf ma-ghalf-${tone}`;
  return href && bar ? (
    <Link className={cls} href={href} prefetch={false} scroll={false} tabIndex={-1} aria-hidden="true" title={title}>
      {bar}
    </Link>
  ) : (
    <span className={cls} title={value === null ? undefined : title}>
      {bar}
    </span>
  );
}

export function GroupedBars({ rows, months }: { rows: readonly GroupedBarsRow[]; months: 3 | 6 | 12 }) {
  const values = rows.flatMap((r) => [r.opened, r.closed]).filter((v): v is number => v !== null);
  if (!values.length) return <div className="ma-empty">אין נתונים לתקופה</div>;
  const scale = niceMax(Math.max(...values));
  const first = rows[0];
  const last = rows[rows.length - 1];
  const range = first && last ? `${monthLabel(first.month)}–${monthLabel(last.month)}` : "";
  return (
    <div
      className={months === 12 ? "ma-trend ma-trend-12" : "ma-trend"}
      role="img"
      aria-label={`מגמת קריאות שירות לפי חודש, נפתחו ונסגרו (${range}); הנתונים בטבלה שמתחת לתרשים`}
    >
      <div className="ma-plot">
        <div className="ma-gridlines" aria-hidden="true">
          {[25, 50, 75].map((p) => (
            <div key={p} className="ma-gridline" style={{ bottom: `${p}%` }}>
              <span className="num">{NUMBER.format((scale * p) / 100)}</span>
            </div>
          ))}
        </div>
        {rows.map((r, i) => {
          const name = MONTH_NAMES[monthIndex(r.month)] ?? r.month;
          const label = months === 12 ? (SHORT_MONTHS[monthIndex(r.month)] ?? name) : name;
          const full = monthLabel(r.month);
          const none = r.opened === null && r.closed === null;
          return (
            <div key={r.month} className={i % 2 === 1 ? "ma-month ma-alt" : "ma-month"}>
              <Bar value={r.opened} scale={scale} tone="o" title={`${full}: ${r.opened ?? 0} נפתחו`} href={r.openedHref} />
              <Bar value={r.closed} scale={scale} tone="c" title={`${full}: ${r.closed ?? 0} נסגרו`} href={r.closedHref} />
              {none && (
                <span className="ma-gnull" aria-hidden="true">
                  —
                </span>
              )}
              <span className="ma-mlabel" aria-hidden="true">
                {label}
              </span>
            </div>
          );
        })}
      </div>
    </div>
  );
}
