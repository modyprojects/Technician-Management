import type { ReactNode } from "react";

// A dashboard card with a heading (docs/demo.html "card sec" + h2, L881-889). `flush` is the
// demo's table card: the heading keeps the card padding and the table runs edge to edge
// (L889: section.card overflow hidden, .sec padding-bottom 0, .scrollx table).
export function DashboardSection({
  id,
  title,
  count,
  hint,
  actions,
  flush = false,
  children,
}: {
  /** Anchor and heading id prefix (unique on the page). */
  id: string;
  title: string;
  /** Shown after the title ("· 22"), e.g. the full size of a capped list. */
  count?: number;
  /** One muted line under the heading. */
  hint?: string;
  /** Links on the heading row (left side in RTL). */
  actions?: ReactNode;
  /** Table card: body without side padding. */
  flush?: boolean;
  children: ReactNode;
}) {
  const headingId = `${id}-h`;
  const head = (
    <div className="od-sec-head">
      <div style={{ minWidth: 0 }}>
        <h2 id={headingId}>
          {title}
          {count !== undefined && (
            <span className="sub num" style={{ fontWeight: 400, fontFamily: "var(--body)" }}>
              {` · ${count}`}
            </span>
          )}
        </h2>
        {hint && <div className="sub od-sec-hint">{hint}</div>}
      </div>
      {actions && <div className="od-sec-actions">{actions}</div>}
    </div>
  );
  return flush ? (
    <section id={id} className="card" style={{ overflow: "hidden" }} aria-labelledby={headingId}>
      <div className="sec" style={{ paddingBottom: 0 }}>
        {head}
      </div>
      {children}
    </section>
  ) : (
    <section id={id} className="card sec" aria-labelledby={headingId}>
      {head}
      {children}
    </section>
  );
}
