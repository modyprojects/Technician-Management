import Link from "next/link";
import { CALL_STATUS_ORDER, CALL_STATUSES, CallStatusPill } from "@/components/ui/CallStatusPill";
import { TestBadge, VisitSourceIcon } from "@/components/ui/TestBadge";
import type { CallStatus, CallSummary } from "@/features/calls/data/types";
import { ddmm } from "@/features/calendar/data/dates";
import type { CustomerDetail, CustomerProduct } from "@/features/customers/data/types";
import type { IsoDate } from "@/features/data-access/common";
import { KpiGrid, type KpiTile } from "./KpiGrid";
import { ReturnedMark } from "./CustomersTable";

// Customer card (spec office screens "Customers and customer card": all calls of a customer and
// products that came back; OF-16, matrix key `calls`). The demo has no such screen; it is built
// in the language of the office call card (docs/demo.html offCard(), L834-859): "› חזרה" link,
// title with 🧪 (SIM-16), cards with key-value rows, status counters in the dashboard's KPI tiles
// (L874-880) and a calls table like the calls list (L824-832).
// - Details come from the latest valid invitation and the address from the latest visit (D39).
// - Counters per service-call status (D38, OF-17); a tile links to the calls list searched by
//   the customer number and filtered by that status (server-side search, OF-04, OF-05).
// - Calls: newest first, service-call status pill with the follow-up reason, visits, the latest
//   visit with its source (SIM-14), 🧪 on test calls (SIM-15). Bounded: when cut, a link to the
//   calls list searched by the customer number.
// - Products: "↩ חזר תוך זמן קצר" when a later call for the same SKU opened within the return
//   window after the earlier call's latest closed visit; the window and its status come from the
//   caller (data, temporary), never written here. Brand and supplier "לא הוזן" when empty
//   (OF-07); 🧪 on test products (SIM-17).
// - At 520px stage width and below the calls table shows technician, visits and date under the
//   product (styles/ui.css .set-col-wide / .set-inline-narrow), so it fits a phone.
// Presentational and hook-free: the caller passes the DTO, the addresses and today's date.

const NOT_ENTERED = "לא הוזן";
const SHORT = "col-center col-fit";

export type CustomerCardData = {
  customer: CustomerDetail;
  /** Today's date ("היום" instead of the date). */
  today: IsoDate;
  /** "› חזרה ללקוחות". */
  backHref: string;
  /** Call card address by request number (calls and returns); a request without one is plain text. */
  callHrefs: Readonly<Record<string, string>>;
  /** The calls list searched by the customer number, per status ("all" for every call). */
  statusHrefs: Readonly<Partial<Record<CallStatus | "all", string>>>;
  /** "מוצרים" searched by SKU, for roles the products screen is offered to; empty otherwise. */
  productHrefs: Readonly<Record<string, string>>;
  /** The line that says the return window is temporary (the page's pending note); the days come from the DTO. */
  returnWindowNote: string;
};

function NotEntered() {
  return <span style={{ color: "var(--muted)" }}>{NOT_ENTERED}</span>;
}

/** A request number: the call card link when there is one, otherwise plain text. */
function ReqLink({ req, href }: { req: string; href: string | undefined }) {
  return href ? (
    <Link className="lnk num" href={href} prefetch={false} aria-label={`פנייה ${req}`}>
      {req}
    </Link>
  ) : (
    <span className="num">{req}</span>
  );
}

export function CustomerCard({ customer: x, today, backHref, callHrefs, statusHrefs, productHrefs, returnWindowNote }: CustomerCardData) {
  const day = (d: IsoDate) => (d === today ? "היום" : ddmm(d));
  const totalCalls = CALL_STATUS_ORDER.reduce((n, s) => n + x.statusCounts[s], 0);
  const a = x.latestAddress;

  const tiles: KpiTile[] = [
    {
      key: "all",
      label: "כל הקריאות",
      metric: { value: totalCalls, unit: "count" },
      href: totalCalls ? statusHrefs.all : undefined,
    },
    ...CALL_STATUS_ORDER.map(
      (s): KpiTile => ({
        key: s,
        label: CALL_STATUSES[s].label,
        metric: { value: x.statusCounts[s], unit: "count" },
        color: x.statusCounts[s] ? CALL_STATUSES[s].fg : undefined,
        href: x.statusCounts[s] ? statusHrefs[s] : undefined,
      }),
    ),
  ];

  return (
    <>
      <div>
        <Link className="btn" href={backHref} prefetch={false} style={{ padding: "6px 12px" }}>
          <span aria-hidden="true">› </span>
          חזרה ללקוחות
        </Link>
      </div>

      <div className="ptitle">
        <div style={{ minWidth: 0 }}>
          <div style={{ display: "flex", gap: 10, alignItems: "center", flexWrap: "wrap" }}>
            <h1 style={{ fontSize: 26 }}>{x.name}</h1>
            {x.isTest && <TestBadge />}
          </div>
          <div className="sub">
            מספר לקוח <span className="num">{x.number}</span> · <span className="num">{totalCalls}</span>{" "}
            {totalCalls === 1 ? "קריאה" : "קריאות"}
          </div>
        </div>
      </div>

      <div className="cu-kpis">
        <KpiGrid tiles={tiles} label="קריאות הלקוח לפי סטטוס" />
      </div>

      <div className="cols2" style={{ alignItems: "start" }}>
        <section className="card sec" aria-labelledby="cu-details">
          <h2 id="cu-details" style={{ marginBottom: 4 }}>
            פרטי לקוח
          </h2>
          <div className="sub" style={{ marginBottom: 12 }}>
            מהזימון האחרון · הכתובת של הביקור האחרון
          </div>
          <div className="kv">
            <span>מספר לקוח</span>
            <span className="num">{x.number}</span>
            <span>שם</span>
            <span>{x.name}</span>
            <span>טלפון</span>
            <span dir="ltr" className="num" style={{ textAlign: "right" }}>
              {x.phone}
            </span>
            {x.phone2 && (
              <>
                <span>טלפון נוסף</span>
                <span dir="ltr" className="num" style={{ textAlign: "right" }}>
                  {x.phone2}
                </span>
              </>
            )}
            <span>כתובת</span>
            <span>
              {a.street}, {a.city}
            </span>
            <span>בניין / קומה / דירה</span>
            <span>
              {a.building || "—"} / {a.floor || "—"} / {a.apt || "—"}
            </span>
          </div>
        </section>

        <CustomerProducts
          products={x.products}
          day={day}
          callHrefs={callHrefs}
          productHrefs={productHrefs}
          returnWindow={{ days: x.returnWindowDays, note: returnWindowNote }}
        />
      </div>

      <CustomerCallsTable calls={x.calls} day={day} callHrefs={callHrefs} allCallsHref={statusHrefs.all} />
    </>
  );
}

function CustomerProducts({
  products,
  day,
  callHrefs,
  productHrefs,
  returnWindow,
}: {
  products: CustomerDetail["products"];
  day: (d: IsoDate) => string;
  callHrefs: CustomerCardData["callHrefs"];
  productHrefs: CustomerCardData["productHrefs"];
  /** Days from the DTO (the value the server used) and the page's pending note. */
  returnWindow: { days: number; note: string };
}) {
  const cut = products.total > products.items.length;
  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby="cu-products">
      <div className="sec" style={{ paddingBottom: 8 }}>
        <h2 id="cu-products" style={{ marginBottom: 4 }}>
          מוצרים של הלקוח
          <span className="sub num" style={{ fontWeight: 400, fontFamily: "var(--body)" }}>
            {` · ${products.total}`}
          </span>
        </h2>
        <div className="sub" style={{ lineHeight: 1.5 }}>
          ״חזר תוך זמן קצר״: קריאה חדשה על אותו מק״ט שנפתחה עד <span className="num">{returnWindow.days}</span> ימים אחרי הביקור
          הסגור האחרון של הקריאה הקודמת.
          <span style={{ display: "block", fontWeight: 700 }}>{returnWindow.note}</span>
        </div>
      </div>
      {products.items.length === 0 ? (
        <div className="empty">אין מוצרים</div>
      ) : (
        <ul style={{ listStyle: "none", margin: 0, padding: 0 }}>
          {products.items.map((cp) => (
            <CustomerProductItem key={cp.product.sku} cp={cp} day={day} callHrefs={callHrefs} productHref={productHrefs[cp.product.sku]} />
          ))}
        </ul>
      )}
      {cut && (
        <div className="sub" style={{ padding: "8px 18px" }}>
          מוצגים <span className="num">{products.items.length}</span> מתוך <span className="num">{products.total}</span>
        </div>
      )}
    </section>
  );
}

function CustomerProductItem({
  cp,
  day,
  callHrefs,
  productHref,
}: {
  cp: CustomerProduct;
  day: (d: IsoDate) => string;
  callHrefs: CustomerCardData["callHrefs"];
  productHref: string | undefined;
}) {
  const p = cp.product;
  return (
    <li style={{ padding: "12px 18px", borderTop: "1px solid var(--line2)", display: "flex", flexDirection: "column", gap: 4 }}>
      <div style={{ display: "flex", gap: 8, alignItems: "center", flexWrap: "wrap" }}>
        <b>{p.name}</b>
        {p.isTest && <TestBadge />}
        {cp.cameBack && <ReturnedMark text="חזר תוך זמן קצר" />}
      </div>
      <div className="sub">
        <bdi dir="ltr">{p.sku}</bdi> · {p.brand || <NotEntered />} · {p.supplier || <NotEntered />}
      </div>
      <div className="sub">
        <span className="num">{cp.callCount}</span> {cp.callCount === 1 ? "קריאה" : "קריאות"} ·{" "}
        {cp.firstDate === cp.lastDate ? (
          <span className="num">{day(cp.firstDate)}</span>
        ) : (
          <>
            ראשונה <span className="num">{day(cp.firstDate)}</span> · אחרונה <span className="num">{day(cp.lastDate)}</span>
          </>
        )}
      </div>
      {cp.returns.items.length > 0 && (
        <ul aria-label={`קריאות חוזרות על ${p.name}`} style={{ listStyle: "none", margin: "2px 0 0", padding: 0, fontSize: 13, lineHeight: 1.6 }}>
          {cp.returns.items.map((r) => (
            <li key={r.req}>
              פנייה <ReqLink req={r.req} href={callHrefs[r.req]} /> (<span className="num">{day(r.date)}</span>) נפתחה{" "}
              <b className="num">{r.days}</b> {r.days === 1 ? "יום" : "ימים"} אחרי סגירת פנייה <ReqLink req={r.previousReq} href={callHrefs[r.previousReq]} />
            </li>
          ))}
          {cp.returns.total > cp.returns.items.length && (
            <li className="sub">
              ועוד <span className="num">{cp.returns.total - cp.returns.items.length}</span>
            </li>
          )}
        </ul>
      )}
      {productHref && (
        <div>
          <Link className="lnk" href={productHref} prefetch={false} aria-label={`${p.name} במסך מוצרים`} style={{ fontSize: 13 }}>
            במסך מוצרים ›
          </Link>
        </div>
      )}
    </li>
  );
}

function CustomerCallsTable({
  calls,
  day,
  callHrefs,
  allCallsHref,
}: {
  calls: CustomerDetail["calls"];
  day: (d: IsoDate) => string;
  callHrefs: CustomerCardData["callHrefs"];
  allCallsHref: string | undefined;
}) {
  const cut = calls.total > calls.items.length;
  return (
    <section className="card" style={{ overflow: "hidden" }} aria-labelledby="cu-calls">
      <div className="sec" style={{ paddingBottom: 0 }}>
        <h2 id="cu-calls">
          קריאות הלקוח
          <span className="sub num" style={{ fontWeight: 400, fontFamily: "var(--body)" }}>
            {` · ${calls.total}`}
          </span>
        </h2>
      </div>
      {calls.items.length === 0 ? (
        <div className="empty">אין קריאות</div>
      ) : (
        // position: relative keeps the 🧪 badge's screen-reader text inside the sideways scroller.
        <div className="scrollx" style={{ position: "relative" }}>
          <table aria-labelledby="cu-calls">
            <thead>
              <tr>
                <th scope="col" className={SHORT}>
                  פנייה
                </th>
                <th scope="col">מוצר</th>
                <th scope="col" className={`${SHORT} set-col-wide`}>
                  טכנאי
                </th>
                <th scope="col" className={`${SHORT} set-col-wide`}>
                  ביקורים
                </th>
                <th scope="col" className={`${SHORT} set-col-wide`}>
                  ביקור אחרון / הבא
                </th>
                <th scope="col" className={SHORT}>
                  סטטוס
                </th>
              </tr>
            </thead>
            <tbody>
              {calls.items.map((c) => (
                <CustomerCallRow key={c.req} c={c} day={day} href={callHrefs[c.req]} />
              ))}
            </tbody>
          </table>
        </div>
      )}
      {(cut || calls.items.length > 0) && (
        <div className="od-table-foot sub">
          <span>
            מציג <span className="num">{calls.items.length}</span> מתוך <span className="num">{calls.total}</span>
          </span>
          {cut && allCallsHref && (
            <Link className="lnk" href={allCallsHref} prefetch={false}>
              לכל הקריאות של הלקוח ›
            </Link>
          )}
        </div>
      )}
    </section>
  );
}

function CustomerCallRow({ c, day, href }: { c: CallSummary; day: (d: IsoDate) => string; href: string | undefined }) {
  const v = c.latestVisit;
  const cancelled = v.status === "cancel";
  const visits = c.visitCount === 1 ? "ביקור אחד" : `${c.visitCount} ביקורים`;
  return (
    <tr>
      <td className={SHORT}>
        <ReqLink req={c.req} href={href} />
        {c.isTest && (
          <>
            {" "}
            <TestBadge />
          </>
        )}
      </td>
      <td style={{ whiteSpace: "normal", minWidth: 120 }}>
        <span style={{ display: "block" }}>
          {c.product.name} {c.product.isTest && <TestBadge />}
        </span>
        <span className="sub" style={{ display: "block", fontSize: 12 }}>
          <bdi dir="ltr">{c.product.sku}</bdi>
        </span>
        {/* Narrow widths: technician, visits and the latest visit under the product (their columns are hidden). */}
        <span className="sub set-inline-narrow" style={{ fontSize: 12 }}>
          <span className="dot" aria-hidden="true" style={{ background: v.technician.color }} /> {v.technician.name} · {visits} ·{" "}
          <VisitSourceIcon source={v.source} /> <span className="num">{day(v.date)}</span>
          {cancelled && <span style={{ color: "var(--s-cancel-fg)", fontWeight: 700 }}> · בוטל</span>}
        </span>
      </td>
      <td className={`${SHORT} set-col-wide`}>
        <span className="dot" aria-hidden="true" style={{ background: v.technician.color }} /> {v.technician.name}
      </td>
      <td className={`${SHORT} num set-col-wide`}>{c.visitCount}</td>
      <td className={`${SHORT} num set-col-wide`}>
        <VisitSourceIcon source={v.source} /> {day(v.date)} {v.start}
        {cancelled && <span style={{ color: "var(--s-cancel-fg)", fontWeight: 700 }}> · בוטל</span>}
      </td>
      <td className={SHORT} style={{ whiteSpace: "normal" }}>
        <CallStatusPill status={c.status} />
        {c.followupReason && (
          <span className="sub" style={{ display: "block", fontSize: 12, marginTop: 3 }}>
            {c.followupReason}
          </span>
        )}
      </td>
    </tr>
  );
}
