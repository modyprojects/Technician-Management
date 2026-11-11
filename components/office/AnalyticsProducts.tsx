import Link from "next/link";
import { formatMetric } from "@/components/office/KpiGrid";
import { RankedBars } from "@/components/office/RankedBars";
import { Pager } from "@/components/ui/Pager";
import { TestBadge } from "@/components/ui/TestBadge";
import {
  METRIC_DEFINITIONS,
  METRIC_STATE_TEXT,
  NOT_ENOUGH_DATA_TEXT,
  NOT_ENTERED_LABEL,
  type DashboardMetricKey,
} from "@/features/dashboards/data/metric-definitions";
import { NONE_GROUP_KEY, type BarRow, type Metric, type ProductDashboard, type SkuSort } from "@/features/dashboards/data/types";
import type { Bounded } from "@/features/data-access/common";
import { SHORT_COL } from "./AnalyticsParts";

// Manager dashboard, "מוצרים וספקים" tab (D57 (3); docs/design/manager-dashboard-spec.md §8;
// spec-final §6.5): cumulative since the first recorded call, no date controls and no monthly
// comparison. Calls by supplier (first, on the right) and by brand: unique service calls, never
// visits; a product without a supplier or brand counts under "לא הוזן" (OF-12), whose row is always
// shown. The SKU table in the spec's column order, sortable by calls and paged (20 rows); "תקלה
// נפוצה" is "לא זמין" (no structured issue category, D57 (4)); "% המשך טיפול" follows D57 (5).
// No red highlight: red is reserved for genuine exceptions (spec §9). 🧪 on test products (SIM-17).
// Presentational Server Component; every link comes from the page. A supplier, brand or SKU opens
// its calls in the details dialog only when `detailHref` is given (the role is offered `calls`).

const NUMBER = new Intl.NumberFormat("he-IL");

const LABEL = (key: DashboardMetricKey): string => METRIC_DEFINITIONS[key].label;

function NotEntered() {
  return <span style={{ color: "var(--dash-muted)" }}>{NOT_ENTERED_LABEL}</span>;
}

/** A rate cell: "87%", or "—" with hidden "אין מספיק נתונים". */
function Rate({ metric }: { metric: Metric }) {
  if (metric.value == null && !metric.state) {
    return (
      <span className="ma-none">
        <span aria-hidden="true">—</span>
        <span className="sr-only">{NOT_ENOUGH_DATA_TEXT}</span>
      </span>
    );
  }
  return <>{formatMetric(metric)}</>;
}

function GroupCard({
  id,
  title,
  list,
  tone,
  what,
  linkOf,
}: {
  id: string;
  title: string;
  list: Bounded<BarRow>;
  tone: "compare" | "blue";
  what: string;
  linkOf: ((key: string) => { href: string; detailKey: string } | undefined) | null;
}) {
  // The capped rows plus, when it falls beyond the cap, the appended "לא הוזן" row (spec §8.2).
  const ranked = list.items.filter((r) => r.key !== NONE_GROUP_KEY);
  const more = list.total - list.items.length;
  return (
    <section className="ma-card" aria-labelledby={id}>
      <h3 id={id}>{title}</h3>
      {list.items.length ? (
        <RankedBars tone={tone} label={title} rows={list.items.map((r) => ({ ...r, ...(linkOf ? linkOf(r.key) : {}) }))} />
      ) : (
        <div className="ma-empty">אין עדיין קריאות שירות</div>
      )}
      {more > 0 && (
        <div className="ma-more">
          ועוד <span className="num">{more}</span> {what} · מוצגים <span className="num">{ranked.length}</span> הראשונים
        </div>
      )}
    </section>
  );
}

export function AnalyticsProducts({
  products,
  detailHref,
  sortHref,
  pageHref,
  describedBy,
}: {
  products: ProductDashboard;
  /** Details dialog link of a group; null when the role is not offered `calls`. */
  detailHref: ((key: DashboardMetricKey, group: string) => string) | null;
  /** The table sorted the other way (page 1). */
  sortHref: (sort: SkuSort) => string;
  /** Another page of the SKU table (same sort). */
  pageHref: (page: number) => string;
  /** Id of the "נתוני בדיקה" note (SIM-13). */
  describedBy?: string;
}) {
  const { bySupplier, byBrand, skus, sort } = products;
  const linkOf = (key: DashboardMetricKey) =>
    detailHref ? (group: string) => ({ href: detailHref(key, group), detailKey: `${key}|${group}` }) : null;
  const first = (skus.page - 1) * skus.limit + 1;
  const last = first + skus.items.length - 1;
  const next: SkuSort = sort === "calls-desc" ? "calls-asc" : "calls-desc";

  return (
    <>
      <div className="ma-sec-head">
        <div>
          <h2 style={{ fontSize: 17, fontWeight: 700 }}>ניתוח מוצרים וספקים</h2>
          <p className="ma-label" style={{ margin: "4px 0 0" }}>
            נתונים מצטברים מאז תחילת השימוש במערכת · ללא מסנני תאריכים
          </p>
        </div>
      </div>

      <div className="ma-two" aria-describedby={describedBy}>
        <GroupCard id="ma-prod-sup" title={LABEL("prod.bySupplier")} list={bySupplier} tone="compare" what="ספקים" linkOf={linkOf("prod.bySupplier")} />
        <GroupCard id="ma-prod-brand" title={LABEL("prod.byBrand")} list={byBrand} tone="blue" what="מותגים" linkOf={linkOf("prod.byBrand")} />
      </div>

      <section className="ma-card" aria-labelledby="ma-skus-h">
        <div className="ma-card-head">
          <div style={{ minWidth: 0 }}>
            <h2 id="ma-skus-h">מק״טים עם הכי הרבה קריאות</h2>
            <p className="ma-hint">לחיצה על מק״ט פותחת את הקריאות · המשך טיפול נספר כחלק מאותה קריאה</p>
          </div>
          <span className="ma-badge num">{NUMBER.format(skus.total)} מק״טים</span>
        </div>
        {skus.items.length ? (
          <>
            {/* Focusable, so a keyboard can scroll the table sideways on a phone. */}
            <div className="scrollx ma-table-wrap" style={{ marginTop: 14 }} tabIndex={0} role="region" aria-label="טבלת המק״טים">
              <table aria-labelledby="ma-skus-h">
                <thead>
                  <tr>
                    <th scope="col" className={SHORT_COL}>
                      מק״ט
                    </th>
                    <th scope="col">מוצר</th>
                    <th scope="col" className="col-fit">
                      מותג
                    </th>
                    <th scope="col" className="col-fit">
                      ספק
                    </th>
                    <th scope="col" className={SHORT_COL} aria-sort={sort === "calls-desc" ? "descending" : "ascending"}>
                      <Link
                        className="ma-sort"
                        href={sortHref(next)}
                        prefetch={false}
                        scroll={false}
                        aria-label={`${LABEL("prod.skuCalls")}: ${sort === "calls-desc" ? "מהרב למעט" : "מהמעט לרב"}; לחיצה הופכת את הסדר`}
                      >
                        {LABEL("prod.skuCalls")}
                      </Link>
                    </th>
                    <th scope="col" className={SHORT_COL}>
                      {LABEL("prod.warrantyRate")}
                    </th>
                    <th scope="col" className={SHORT_COL}>
                      {LABEL("prod.followupRate")}
                    </th>
                    <th scope="col">{LABEL("prod.topIssue")}</th>
                  </tr>
                </thead>
                <tbody>
                  {skus.items.map((r) => {
                    const p = r.product;
                    const link = linkOf("prod.skuCalls")?.(p.sku);
                    return (
                      <tr key={p.sku}>
                        <td className={SHORT_COL} dir="ltr">
                          {link ? (
                            <Link
                              className="lnk"
                              href={link.href}
                              prefetch={false}
                              scroll={false}
                              aria-haspopup="dialog"
                              data-detail-key={link.detailKey}
                              aria-label={`${p.sku} · ${p.name}: ${r.calls} קריאות · פירוט`}
                            >
                              {p.sku}
                            </Link>
                          ) : (
                            p.sku
                          )}
                        </td>
                        <td>
                          {p.name}
                          {p.isTest && (
                            <>
                              {" "}
                              <TestBadge />
                            </>
                          )}
                        </td>
                        <td className="col-fit">{p.brand || <NotEntered />}</td>
                        <td className="col-fit">{p.supplier || <NotEntered />}</td>
                        <td className={`${SHORT_COL} num`}>
                          <b>{NUMBER.format(r.calls)}</b>
                        </td>
                        <td className={`${SHORT_COL} num`}>
                          <Rate metric={r.warrantyRate} />
                        </td>
                        <td className={`${SHORT_COL} num`}>
                          <Rate metric={r.followupRate} />
                        </td>
                        {/* D57 (4): only from a structured issue category, never from the free-text description. */}
                        <td className="sub">{r.topIssue.state === "computed" ? r.topIssue.value : METRIC_STATE_TEXT.unavailable}</td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
            <div className="ma-foot" style={{ marginTop: 10 }}>
              <span className="ma-mini">
                מציג <span className="num">{first}</span>–<span className="num">{last}</span> מתוך <span className="num">{skus.total}</span> מק״טים
              </span>
              <Pager
                page={skus.page}
                pageCount={skus.pageCount}
                prevHref={skus.page > 1 ? pageHref(skus.page - 1) : null}
                nextHref={skus.page < skus.pageCount ? pageHref(skus.page + 1) : null}
                label="עמודי המק״טים"
              />
            </div>
          </>
        ) : (
          <div className="ma-empty">אין עדיין קריאות שירות</div>
        )}
      </section>
    </>
  );
}
