import Form from "next/form";
import Link from "next/link";

// The Technicians tab's toolbar (D57 (3): technician buttons and compact date controls; spec-final
// §6.6; reference .controls / .pill / .periodNav). One card; above 850px a three-column grid, so
// the date group is geometrically centred whatever the widths of the side groups. DOM order and
// position in RTL follow spec §7.2 (C24): technicians on the RIGHT, the date navigation in the
// CENTER, the periods on the LEFT; below 850px the three groups stack in that order.
// - Technicians: one link per technician, active first; inactive ones are marked "(לא פעיל)" and
//   stay selectable (SE-05). No dropdown and no next / previous technician arrows.
// - Date navigation: previous "›" on the right, the period label, next "‹" on the left. Next is a
//   dimmed, non-link element at the current period (no future navigation); previous likewise at
//   the oldest allowed period.
// - Custom range ("מותאם"): a GET form (next/form: client navigation without a full reload, and a
//   plain form without JavaScript) with "מתאריך", "עד תאריך" and "הצג" (PROPOSED, C30). The server
//   checks from ≤ to ≤ today and at most a year; an invalid range shows an inline error.
// Presentational and server-safe; the page builds every link.

export type ToolbarTechnician = { id: string; name: string; active: boolean; href: string };
export type ToolbarPeriod = { key: string; label: string; href: string; on: boolean };

export function DashboardPeriodControls({
  technicians,
  selectedId,
  periods,
  dateNav,
  custom,
}: {
  technicians: readonly ToolbarTechnician[];
  selectedId: string | null;
  periods: readonly ToolbarPeriod[];
  /** Previous / next for day, week, month and year; null for a custom range. */
  dateNav: { label: string; prevHref: string | null; nextHref: string | null } | null;
  /** The custom range form; null for the other periods. */
  custom: {
    /** The dashboard address (without a query string). */
    action: string;
    /** Hidden inputs that keep the tab and technician. */
    hidden: Readonly<Record<string, string>>;
    from?: string;
    to?: string;
    /** Today (the latest date allowed). */
    max: string;
    invalid: boolean;
  } | null;
}) {
  return (
    <div className="ma-controls">
      <div className="ma-cgroup ma-cgroup-tech" role="group" aria-labelledby="ma-tech-label">
        <b id="ma-tech-label" className="ma-glabel">
          טכנאי:
        </b>
        {technicians.map((t) => (
          <Link
            key={t.id}
            href={t.href}
            prefetch={false}
            scroll={false}
            className={t.id === selectedId ? "ma-pill on" : "ma-pill"}
            aria-current={t.id === selectedId ? "true" : undefined}
          >
            {t.name}
            {!t.active && " (לא פעיל)"}
          </Link>
        ))}
      </div>

      <div className="ma-cgroup ma-cgroup-date">
        {dateNav ? (
          <div className="ma-pnav">
            {dateNav.prevHref ? (
              <Link className="ma-navbtn" href={dateNav.prevHref} prefetch={false} scroll={false} aria-label="התקופה הקודמת">
                <span aria-hidden="true">›</span>
              </Link>
            ) : (
              <span className="ma-navbtn" aria-disabled="true">
                <span aria-hidden="true">›</span>
                <span className="sr-only">התקופה הקודמת (לא זמינה)</span>
              </span>
            )}
            <span className="ma-plabel num" aria-live="polite">
              {dateNav.label}
            </span>
            {dateNav.nextHref ? (
              <Link className="ma-navbtn" href={dateNav.nextHref} prefetch={false} scroll={false} aria-label="התקופה הבאה">
                <span aria-hidden="true">‹</span>
              </Link>
            ) : (
              <span className="ma-navbtn" aria-disabled="true">
                <span aria-hidden="true">‹</span>
                <span className="sr-only">התקופה הבאה (לא זמינה)</span>
              </span>
            )}
          </div>
        ) : custom ? (
          <Form
            key={`${custom.from ?? ""}|${custom.to ?? ""}`}
            action={custom.action}
            prefetch={false}
            scroll={false}
            className="ma-range"
            aria-label="טווח תאריכים מותאם"
          >
            {Object.entries(custom.hidden).map(([name, value]) => (
              <input key={name} type="hidden" name={name} value={value} />
            ))}
            <label>
              מתאריך
              <input
                type="date"
                name="from"
                defaultValue={custom.from}
                max={custom.max}
                required
                aria-invalid={custom.invalid || undefined}
                aria-describedby={custom.invalid ? "ma-range-error" : undefined}
              />
            </label>
            <label>
              עד תאריך
              <input
                type="date"
                name="to"
                defaultValue={custom.to}
                max={custom.max}
                required
                aria-invalid={custom.invalid || undefined}
                aria-describedby={custom.invalid ? "ma-range-error" : undefined}
              />
            </label>
            <button type="submit" className="btn">
              הצג
            </button>
            {custom.invalid && (
              <p id="ma-range-error" className="ma-range-error" role="alert">
                טווח התאריכים לא תקין: עד היום ולא יותר משנה
              </p>
            )}
          </Form>
        ) : null}
      </div>

      <nav className="ma-cgroup ma-cgroup-period" aria-labelledby="ma-period-label">
        <b id="ma-period-label" className="ma-glabel">
          תקופה:
        </b>
        {periods.map((p) => (
          <Link
            key={p.key}
            href={p.href}
            prefetch={false}
            scroll={false}
            className={p.on ? "ma-pill on" : "ma-pill"}
            aria-current={p.on ? "true" : undefined}
          >
            {p.label}
          </Link>
        ))}
      </nav>
    </div>
  );
}
