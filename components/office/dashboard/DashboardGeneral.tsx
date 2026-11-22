import Link from "next/link";
import { GroupedBars } from "@/components/office/GroupedBars";
import { KpiGrid, type KpiTile } from "@/components/office/KpiGrid";
import { RankedBars } from "@/components/office/RankedBars";
import { MONTH_NAMES, monthLabel } from "@/features/calendar/data/dates";
import type { YearMonth } from "@/features/calendar/data/types";
import { METRIC_DEFINITIONS, NOT_ENOUGH_DATA_TEXT, type DashboardMetricKey } from "@/features/dashboards/data/metric-definitions";
import { dateLabel, monthOfDate, rangeLabel } from "@/features/dashboards/data/periods";
import { jerusalemTime } from "@/features/dashboards/data/time";
import { TREND_MONTH_OPTIONS, type GeneralDashboard, type TrendMonths } from "@/features/dashboards/data/types";
import { SERVICE_LABELS, serviceCaption } from "./service-labels";

// The real "דשבורד" › "כללי" tab (D57 (3); docs/design/manager-dashboard-spec.md §4-§6), ported
// from the demo's AnalyticsGeneral (components/office/AnalyticsGeneral.tsx, left unchanged for
// /dev/demo) with the QA corrections 01 applied (D60 (6)): no "התקדמות הביקורים" bar, percentage
// or legend (QA-10); the service metrics renamed, each with its unit and period. Layout order:
// "פעילות היום", "מדדי שירות" (current calendar month, D56 (2)), "מוצרים וספקים מובילים" (last 30
// days; suppliers on the right) and "מגמת קריאות שירות" (3 / 6 / 12 completed months). No
// follow-up or review counters and no "דורש טיפול" (D57 (2)).
// Presentational Server Component. Skeleton (D96): the tiles and bars are not links yet; the
// details dialog is wired with the real data.

const LABEL = (key: DashboardMetricKey): string => METRIC_DEFINITIONS[key].label;

const NUMBER = new Intl.NumberFormat("he-IL");

/** "מאי–אוקטובר 2026", or "נובמבר 2025–אוקטובר 2026" across years. */
function monthRange(first: YearMonth, last: YearMonth): string {
  if (first === last) return monthLabel(first);
  const name = (m: YearMonth) => MONTH_NAMES[Number(m.slice(5, 7)) - 1] ?? m;
  return first.slice(0, 4) === last.slice(0, 4) ? `${name(first)}–${monthLabel(last)}` : `${monthLabel(first)}–${monthLabel(last)}`;
}

export function DashboardGeneral({
  general,
  monthsHref,
  productsHref,
  describedBy,
}: {
  general: GeneralDashboard;
  /** The General tab with another chart range. */
  monthsHref: (months: TrendMonths) => string;
  /** "לניתוח המלא": the Products & Suppliers tab; null when it is not offered. */
  productsHref: string | null;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  const { today, service, highlights, trend } = general;
  const servicePeriod = monthLabel(monthOfDate(service.period.from));

  const todayTiles: KpiTile[] = [
    { key: "planned", label: LABEL("today.planned"), metric: today.planned },
    { key: "done", label: LABEL("today.done"), metric: today.done },
    { key: "pending", label: LABEL("today.pending"), metric: today.pending },
    {
      key: "missed",
      label: LABEL("today.missed"),
      metric: today.missed,
      // Red only for a genuine exception (spec §9).
      color: (today.missed.value ?? 0) > 0 ? "var(--dash-danger)" : undefined,
    },
  ];
  const serviceTiles: KpiTile[] = (["treat", "travel", "firstVisit", "closeTime"] as const).map((k) => ({
    key: k,
    label: SERVICE_LABELS[k],
    metric: service[k],
    caption: serviceCaption(service[k], servicePeriod),
  }));

  const time = jerusalemTime(general.now);
  const firstMonth = trend.rows[0]?.month;
  const lastMonth = trend.rows[trend.rows.length - 1]?.month;

  const toProducts = productsHref ? (
    <Link className="ma-link" href={productsHref} prefetch={false}>
      לניתוח המלא ‹
    </Link>
  ) : null;

  return (
    <>
      <section className="ma-section">
        <div className="ma-sec-head">
          <h2 id="ma-today-h">פעילות היום</h2>
          <span className="ma-label num">
            כלל הטכנאים · {dateLabel(general.asOf)}
            {time && ` · נכון ל-${time}`}
          </span>
        </div>
        <KpiGrid tiles={todayTiles} label="פעילות היום" describedBy={describedBy} className="ma-kpis" noDataText={NOT_ENOUGH_DATA_TEXT} />
      </section>

      <section className="ma-section">
        <div className="ma-sec-head">
          <h2 id="ma-service-h">מדדי שירות</h2>
          <span className="ma-label">{servicePeriod} · החודש הנוכחי</span>
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
              <RankedBars tone="compare" label={LABEL("top.suppliers")} rows={highlights.suppliers.items} />
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
              <RankedBars tone="blue" sku label={LABEL("top.skus")} rows={highlights.skus.items} />
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
        <GroupedBars rows={trend.rows} months={trend.months} />
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
                    {([r.opened, r.closed] as const).map((v, i) => (
                      <td key={i} className="col-center col-fit num">
                        {v === null ? <span className="ma-mini">אין נתונים</span> : NUMBER.format(v)}
                      </td>
                    ))}
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
