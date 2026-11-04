import { formatMetric } from "@/components/office/KpiGrid";
import { Bars } from "@/components/ui/Bars";
import { TestBadge } from "@/components/ui/TestBadge";
import type { Bounded } from "@/features/data-access/common";
import type { BarRow, ManagerAnalytics } from "@/features/dashboards/data/types";
import { SHORT_COL } from "./AnalyticsParts";

// Manager dashboard, "מוצרים וספקים" tab (docs/demo.html dashProd(), L927-933): calls by brand and
// by supplier, and the SKUs with the most calls. OF-12: SKU analysis always works; products
// without a brand or supplier are grouped and shown as "לא הוזן". SIM-17: 🧪 on test products.
// The lists are bounded (DASHBOARD_LIST_LIMIT); when cut, the screen says how many it shows.

type Products = ManagerAnalytics["products"];

/** Above this follow-up rate the SKU row's rate is red (the demo's 40%). */
const FOLLOWUP_ALERT_PERCENT = 40;

const NOT_ENTERED = "לא הוזן";

function NotEntered() {
  return <span style={{ color: "var(--muted)" }}>{NOT_ENTERED}</span>;
}

/** "מוצגים 20 מתוך 26" when a bounded list was cut. */
function Shown({ list, what }: { list: Bounded<unknown>; what: string }) {
  if (list.total <= list.items.length) return null;
  return (
    <div className="sub" style={{ marginTop: 6 }}>
      מוצגים <span className="num">{list.items.length}</span> {what} מתוך <span className="num">{list.total}</span>
    </div>
  );
}

function GroupBars({ list }: { list: Bounded<BarRow> }) {
  return (
    <Bars
      color="var(--accent)"
      emptyText="אין קריאות בתקופה"
      rows={list.items.map((r) => ({
        key: r.key,
        label: r.label ? r.label : <NotEntered />,
        value: r.value,
        color: r.color,
      }))}
    />
  );
}

export function AnalyticsProducts({ products }: { products: Products }) {
  const { byBrand, bySupplier, skus } = products;
  return (
    <>
      <div className="cols2">
        <section className="card sec" aria-labelledby="ma-brand">
          <h2 id="ma-brand">קריאות לפי מותג</h2>
          <GroupBars list={byBrand} />
          <Shown list={byBrand} what="מותגים" />
        </section>
        <section className="card sec" aria-labelledby="ma-supplier">
          <h2 id="ma-supplier">קריאות לפי ספק</h2>
          <GroupBars list={bySupplier} />
          <Shown list={bySupplier} what="ספקים" />
        </section>
      </div>

      <section className="card" style={{ overflow: "hidden" }} aria-labelledby="ma-skus">
        <div
          className="sec"
          style={{ paddingBottom: 0, display: "flex", justifyContent: "space-between", gap: 10, flexWrap: "wrap" }}
        >
          <h2 id="ma-skus">מק&quot;טים עם הכי הרבה קריאות</h2>
          <span className="sub">מסומן באדום: שיעור המשך טיפול מעל {FOLLOWUP_ALERT_PERCENT}%</span>
        </div>
        {skus.items.length ? (
          // Focusable, so a keyboard can scroll the table sideways on a phone (no links inside).
          <div className="scrollx" tabIndex={0} role="region" aria-labelledby="ma-skus">
            <table aria-labelledby="ma-skus">
              <thead>
                <tr>
                  <th scope="col" className={SHORT_COL}>
                    מק&quot;ט
                  </th>
                  <th scope="col">מוצר</th>
                  <th scope="col" className="col-fit">
                    מותג
                  </th>
                  <th scope="col" className="col-fit">
                    ספק
                  </th>
                  <th scope="col" className={SHORT_COL}>
                    קריאות
                  </th>
                  <th scope="col" className={SHORT_COL}>
                    באחריות
                  </th>
                  <th scope="col" className={SHORT_COL}>
                    % המשך טיפול
                  </th>
                  <th scope="col">תקלה נפוצה</th>
                </tr>
              </thead>
              <tbody>
                {skus.items.map((r) => {
                  const p = r.product;
                  const alert = (r.followupRate.value ?? 0) > FOLLOWUP_ALERT_PERCENT;
                  return (
                    <tr key={p.sku}>
                      <td className={SHORT_COL} dir="ltr">
                        {p.sku}
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
                        <b>{r.calls}</b>
                      </td>
                      <td className={`${SHORT_COL} num`}>{formatMetric(r.warrantyRate)}</td>
                      <td
                        className={`${SHORT_COL} num`}
                        style={alert ? { color: "var(--danger)", fontWeight: 700 } : undefined}
                      >
                        {formatMetric(r.followupRate)}
                      </td>
                      <td>{r.topIssue ?? "—"}</td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
            {skus.total > skus.items.length && (
              <div className="sub" style={{ padding: "10px 14px" }}>
                מציג <span className="num">{skus.items.length}</span> מתוך <span className="num">{skus.total}</span> מק&quot;טים
              </div>
            )}
          </div>
        ) : (
          <div className="empty">אין מק&quot;טים להצגה</div>
        )}
      </section>

      <div className="note">
        מק&quot;ט ותיאור התקלה מגיעים מזימון ה-Outlook. מותג וספק מגיעים מקטלוג המוצרים ואינם חובה; מוצר בלי מותג או
        ספק נספר תחת &quot;{NOT_ENTERED}&quot;. כדי שהניתוח יהיה אמין, &quot;מוצר&quot; ו&quot;מק&quot;ט&quot; הם שדות
        חובה בזימון.
      </div>
    </>
  );
}
