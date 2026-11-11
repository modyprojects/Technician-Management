import Link from "next/link";
import { TestBadge } from "@/components/ui/TestBadge";
import { NOT_ENTERED_LABEL } from "@/features/dashboards/data/metric-definitions";
import type { BarRow } from "@/features/dashboards/data/types";

// Ranked horizontal bars of the manager dashboard (reference .barline; spec-final §6.7): name,
// track and value, one shared scale per card (the largest value fills the track). Bars cannot
// reuse components/ui/Bars without changing its other users (a fixed 105 / 95 / 72 px name column,
// ellipsis, end-aligned bold values, a whole-row link), hence this component.
// A row links to the records behind it (the details dialog) only when the caller passes `href`
// (the role is offered `calls`); otherwise it is plain text. A truncated name keeps its full text
// in `title` and for screen readers. SKU rows are LTR text with the 🧪 badge (SIM-17) and the
// product name where space allows (spec §5). A link's accessible name is its own content (name,
// value, the hidden unit and "· פירוט", and the badge's "נתוני בדיקה"), so it always contains the
// visible text (WCAG 2.5.3).

export type RankedBarsRow = BarRow & { href?: string; detailKey?: string };

const NUMBER = new Intl.NumberFormat("he-IL");

export function RankedBars({
  rows,
  tone,
  sku = false,
  label,
  unitLabel = "קריאות",
}: {
  rows: readonly RankedBarsRow[];
  /** "compare": the gray of suppliers; "blue": brands and SKUs (spec §9). */
  tone: "compare" | "blue";
  /** SKU rows: LTR SKU text, the test badge and the product name. */
  sku?: boolean;
  /** Accessible name of the list ("3 ספקים מובילים"). */
  label: string;
  /** What the value counts (accessible text of a row). */
  unitLabel?: string;
}) {
  const max = Math.max(1, ...rows.map((r) => r.value));
  return (
    <div className={sku ? "ma-bars ma-bars-sku" : "ma-bars"} role="list" aria-label={label}>
      {rows.map((r) => {
        const name = r.label || NOT_ENTERED_LABEL;
        const full = sku && r.name ? `${name} · ${r.name}` : name;
        const body = (
          <>
            <span className="ma-bar-name" title={full}>
              {sku ? (
                <>
                  <bdi dir="ltr">{name}</bdi>
                  {r.isTest && (
                    <>
                      {" "}
                      <TestBadge />
                    </>
                  )}
                  {r.name && <span className="ma-bar-pname"> · {r.name}</span>}
                </>
              ) : r.label ? (
                name
              ) : (
                <span style={{ color: "var(--dash-muted)" }}>{name}</span>
              )}
            </span>
            <span className="sr-only">: </span>
            <span className="ma-bar-track" aria-hidden="true">
              <span className={tone === "compare" ? "ma-bar-fill ma-compare" : "ma-bar-fill"} style={{ width: `${(r.value / max) * 100}%` }} />
            </span>
            <span className="ma-bar-val num">
              {NUMBER.format(r.value)}
              <span className="sr-only"> {unitLabel}</span>
              {r.href && <span className="sr-only"> · פירוט</span>}
            </span>
          </>
        );
        return (
          <div role="listitem" key={r.key}>
            {r.href ? (
              <Link
                className="ma-barline"
                href={r.href}
                prefetch={false}
                scroll={false}
                aria-haspopup="dialog"
                data-detail-key={r.detailKey}
              >
                {body}
              </Link>
            ) : (
              <div className="ma-barline">{body}</div>
            )}
          </div>
        );
      })}
    </div>
  );
}
