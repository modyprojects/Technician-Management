import Link from "next/link";
import { GroupedBars } from "@/components/office/GroupedBars";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { RankedBars } from "@/components/office/RankedBars";
import { MONTH_NAMES, monthLabel } from "@/features/calendar/data/dates";
import type { YearMonth } from "@/features/calendar/data/types";
import { METRIC_DEFINITIONS, NOT_ENOUGH_DATA_TEXT, type DashboardMetricKey } from "@/features/dashboards/data/metric-definitions";
import { dateLabel, monthOfDate, rangeLabel } from "@/features/dashboards/data/periods";
import { jerusalemTime } from "@/features/dashboards/data/time";
import { TREND_MONTH_OPTIONS, type GeneralDashboard, type Metric, type TrendMonths } from "@/features/dashboards/data/types";

// Manager dashboard, "כללי" tab (D57 (3); docs/design/manager-dashboard-spec.md §4-§6; spec-final
// §6.3), in the reference's layout: "פעילות היום" (four tiles and the progress bar, from one DTO so
// the numbers agree), "מדדי שירות" over the current calendar month (D56 (2), the period is on
// screen), "מוצרים וספקים מובילים" over the last 30 days (suppliers first, on the right) and
// "מגמת קריאות שירות" (opened vs closed, 3 / 6 / 12 completed months). Nothing else: no follow-up
// or review counters, no "דורש טיפול", no live view and no links to work queues (D57 (2)).
// Presentational Server Component; the page builds every link. Metric links open the details
// dialog only when `detailHref` is given (the role is offered `calls`, D33).

const LABEL = (key: DashboardMetricKey): string => METRIC_DEFINITIONS[key].label;

const NUMBER = new Intl.NumberFormat("he-IL");

/** "אפריל–ספטמבר 2026", or "אוקטובר 2025–ספטמבר 2026" across years. */
function monthRange(first: YearMonth, last: YearMonth): string {
  if (first === last) return monthLabel(first);
  const name = (m: YearMonth) => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m;
  return first.slice(0, 4) === last.slice(0, 4) ? `${name(first)}–${monthLabel(last)}` : `${monthLabel(first)}–${monthLabel(last)}`;
}

function Progress({ today }: { today: GeneralDashboard["today"] }) {
  const n = (m: Metric) => m.value ?? 0;
  const planned = n(today.planned);
  const done = n(today.done);
  const pending = n(today.pending);
  const missed = n(today.missed);
  const pct = today.progress.value;
  return (
    <section className="ma-card" aria-labelledby="ma-progress-h">
      <div className="ma-progress-head">
        <b id="ma-progress-h">{LABEL("today.progress")}</b>
        {pct !== null && <b className="ma-progress-pct num">{pct}%</b>}
      </div>
      {planned === 0 ? (
        <div className="ma-empty">אין ביקורים מתוכננים היום</div>
      ) : (
        <>
          <div
            className="ma-progress"
            role="img"
            aria-label={`${LABEL("today.progress")}: ${done} מתוך ${planned} בוצעו, ${pending} טרם בוצעו, ${missed} לא בוצעו במועד`}
          >
            {done > 0 && <span className="ma-seg-done" style={{ flexGrow: done }} />}
            {pending > 0 && <span className="ma-seg-pending" style={{ flexGrow: pending }} />}
            {missed > 0 && <span className="ma-seg-missed" style={{ flexGrow: missed }} />}
          </div>
          <div className="ma-foot">
            <ul className="ma-keys" aria-hidden="true">
              <li>
                <i className="ma-key ma-seg-done" />
                בוצעו
              </li>
              <li>
                <i className="ma-key ma-seg-pending" />
                טרם בוצעו
              </li>
              <li>
                <i className="ma-key ma-seg-missed" />
                לא בוצעו במועד
              </li>
            </ul>
            <span className="ma-mini">
              <span className="num">{done}</span> מתוך <span className="num">{planned}</span> הושלמו
            </span>
          </div>
        </>
      )}
    </section>
  );
}

export function AnalyticsGeneral({
  general,
  detailHref,
  monthsHref,
  productsHref,
  describedBy,
}: {
  general: GeneralDashboard;
  /** Details dialog link of a metric (and group); null when the role is not offered `calls`. */
  detailHref: ((key: DashboardMetricKey, group?: string) => string) | null;
  /** The General tab with another chart range. */
  monthsHref: (months: TrendMonths) => string;
  /** "לניתוח המלא": the Products & Suppliers tab; null when the role is not offered it. */
  productsHref: string | null;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  const { today, service, highlights, trend } = general;
  const link = (key: DashboardMetricKey, group?: string) =>
    detailHref ? { href: detailHref(key, group), detailKey: group === undefined ? key : `${key}|${group}` } : {};

  const todayTiles: KpiTile[] = [
    { key: "planned", label: LABEL("today.planned"), metric: today.planned, ...link("today.planned") },
    { key: "done", label: LABEL("today.done"), metric: today.done, ...link("today.done") },
    { key: "pending", label: LABEL("today.pending"), metric: today.pending, ...link("today.pending") },
    {
      key: "missed",
      label: LABEL("today.missed"),
      metric: today.missed,
      // Red only for a genuine exception (spec §9).
      color: (today.missed.value ?? 0) > 0 ? "var(--dash-danger)" : undefined,
      ...link("today.missed"),
    },
  ];
  const serviceTiles: KpiTile[] = [
    { key: "treat", label: LABEL("service.treat"), metric: service.treat, ...link("service.treat") },
    { key: "travel", label: LABEL("service.travel"), metric: service.travel, ...link("service.travel") },
    { key: "first", label: LABEL("service.firstVisit"), metric: service.firstVisit, ...link("service.firstVisit") },
    { key: "close", label: LABEL("service.closeTime"), metric: service.closeTime, ...link("service.closeTime") },
  ];

  const time = jerusalemTime(general.now);
  const firstMonth = trend.rows[0]?.month;
  const lastMonth = trend.rows[trend.rows.length - 1]?.month;
  const trendRows = trend.rows.map((r) => ({
    ...r,
    ...(detailHref && r.opened ? { openedHref: detailHref("trend.opened", r.month) } : {}),
    ...(detailHref && r.closed ? { closedHref: detailHref("trend.closed", r.month) } : {}),
  }));

  const toProducts = productsHref ? (
    <Link className="ma-link" href={productsHref} prefetch={false}>
      לניתוח המלא ‹
    </Link>
  ) : null;

  return (
    <>
      <section className="ma-section" aria-labelledby="ma-today-h">
        <div className="ma-sec-head">
          <h2 id="ma-today-h">פעילות היום</h2>
          <span className="ma-label num">
            כלל הטכנאים · {dateLabel(general.asOf)}
            {time && ` · נכון ל-${time}`}
          </span>
        </div>
        <KpiGrid tiles={todayTiles} label="פעילות היום" describedBy={describedBy} className="ma-kpis" noDataText={NOT_ENOUGH_DATA_TEXT} />
        <Progress today={today} />
      </section>

      <section className="ma-section" aria-labelledby="ma-service-h">
        <div className="ma-sec-head">
          <h2 id="ma-service-h">מדדי שירות</h2>
          <span className="ma-label">{monthLabel(monthOfDate(service.period.from))} · החודש הנוכחי</span>
        </div>
        <KpiGrid tiles={serviceTiles} label="מדדי שירות" describedBy={describedBy} className="ma-kpis" noDataText={NOT_ENOUGH_DATA_TEXT} />
      </section>

      <section className="ma-section" aria-labelledby="ma-top-h">
        <div className="ma-sec-head">
          <h2 id="ma-top-h">מוצרים וספקים מובילים</h2>
          <span className="ma-label num">30 ימים אחרונים · {rangeLabel(highlights.period.from, highlights.period.to)}</span>
        </div>
        <div className="ma-two">
          <section className="ma-card" aria-labelledby="ma-top-sup-h">
            <div className="ma-card-head">
              <h3 id="ma-top-sup-h">{LABEL("top.suppliers")}</h3>
              {toProducts}
            </div>
            {highlights.suppliers.items.length ? (
              <RankedBars
                tone="compare"
                label={LABEL("top.suppliers")}
                rows={highlights.suppliers.items.map((r) => ({ ...r, ...link("top.suppliers", r.key) }))}
              />
            ) : (
              <div className="ma-empty">אין קריאות ב-30 הימים האחרונים</div>
            )}
          </section>
          <section className="ma-card" aria-labelledby="ma-top-sku-h">
            <div className="ma-card-head">
              <h3 id="ma-top-sku-h">{LABEL("top.skus")}</h3>
              {toProducts}
            </div>
            {highlights.skus.items.length ? (
              <RankedBars
                tone="blue"
                sku
                label={LABEL("top.skus")}
                rows={highlights.skus.items.map((r) => ({ ...r, ...link("top.skus", r.key) }))}
              />
            ) : (
              <div className="ma-empty">אין קריאות ב-30 הימים האחרונים</div>
            )}
          </section>
        </div>
      </section>

      <section className="ma-card" aria-labelledby="ma-trend-h">
        <div className="ma-card-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="ma-trend-h">מגמת קריאות שירות</h2>
            <p className="ma-hint">
              קריאות שנפתחו לעומת קריאות שנסגרו · {trend.months} החודשים המלאים האחרונים
              {firstMonth && lastMonth && ` (${monthRange(firstMonth, lastMonth)})`}
            </p>
          </div>
          <nav className="ma-pills" aria-label="טווח הגרף">
            {TREND_MONTH_OPTIONS.map((m) => (
              <Link
                key={m}
                href={monthsHref(m)}
                prefetch={false}
                scroll={false}
                className={m === trend.months ? "ma-pill on" : "ma-pill"}
                aria-current={m === trend.months ? "true" : undefined}
              >
                {m} חודשים
              </Link>
            ))}
          </nav>
        </div>
        <ul className="ma-keys" style={{ marginTop: 12 }} aria-hidden="true">
          <li>
            <i className="ma-key ma-gbar-o" />
            {LABEL("trend.opened")}
          </li>
          <li>
            <i className="ma-key ma-gbar-c" />
            {LABEL("trend.closed")}
          </li>
        </ul>
        <GroupedBars rows={trendRows} months={trend.months} />
        <p className="ma-hint">הקריאות שנפתחו ונסגרו בכל חודש אינן בהכרח אותן קריאות.</p>
        <details className="ma-details">
          <summary>הנתונים בטבלה</summary>
          <div className="scrollx ma-table-wrap">
            <table aria-label="מגמת קריאות שירות: נפתחו ונסגרו לפי חודש">
              <thead>
                <tr>
                  <th scope="col">חודש</th>
                  <th scope="col" className="col-center col-fit">
                    {LABEL("trend.opened")}
                  </th>
                  <th scope="col" className="col-center col-fit">
                    {LABEL("trend.closed")}
                  </th>
                </tr>
              </thead>
              <tbody>
                {trend.rows.map((r) => (
                  <tr key={r.month}>
                    <td>{monthLabel(r.month)}</td>
                    {(["opened", "closed"] as const).map((which) => {
                      const v = r[which];
                      const key: DashboardMetricKey = which === "opened" ? "trend.opened" : "trend.closed";
                      return (
                        <td key={which} className="col-center col-fit num">
                          {v === null ? (
                            <span className="ma-mini">אין נתונים</span>
                          ) : detailHref && v > 0 ? (
                            <Link
                              className="lnk"
                              href={detailHref(key, r.month)}
                              prefetch={false}
                              scroll={false}
                              aria-haspopup="dialog"
                              data-detail-key={`${key}|${r.month}`}
                              aria-label={`${monthLabel(r.month)}: ${NUMBER.format(v)} ${LABEL(key)} · פירוט`}
                            >
                              {NUMBER.format(v)}
                            </Link>
                          ) : (
                            NUMBER.format(v)
                          )}
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </details>
      </section>
    </>
  );
}
