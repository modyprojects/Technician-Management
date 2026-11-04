import Link from "next/link";
import { TestBadge } from "@/components/ui/TestBadge";
import type { CustomerSummary } from "@/features/customers/data/types";

// "לקוחות" table (spec office screens, OF-16; matrix key `calls`). The demo has no such screen,
// so it follows the calls table (docs/demo.html callsTable(), L824-832): a card with a sideways
// scroller, short columns centred and sized to content (G-07), the customer's name as the link to
// the customer card. Presentational: the server searched, sorted (latest activity first) and
// paged the rows (OF-04); the caller passes the total for "מציג X מתוך Y".
// - Customer number (OF-05) has its own column; 🧪 on test customers (SIM-16), in the name cell.
// - "קריאות": the number of calls and whether any is still active (open, awaiting scheduling or
//   follow-up, D38) or every call is resolved. The list DTO carries no per-call status.
// - "↩ מוצר חזר": a product of the customer came back within the return window (the card says
//   which and why).
// - At 520px stage width and below the number, city and phone move under the name
//   (styles/ui.css .set-col-wide / .set-inline-narrow), so the table fits a phone without
//   scrolling sideways.

export type CustomersTableRow = {
  customer: CustomerSummary;
  /** The customer card. */
  href: string;
  /** Date of the latest activity as the list shows it ("היום", "21.10"). */
  lastActivity: string;
};

const SHORT = "col-center col-fit";

/** "N פעילות" (calls not resolved) or "הכל טופל" (every call resolved, D38). */
function ActivityPill({ active }: { active: number }) {
  return active > 0 ? (
    <span className="pill" style={{ background: "var(--accent-l)", color: "var(--accent-d)" }}>
      {active === 1 ? "פעילה אחת" : `${active} פעילות`}
    </span>
  ) : (
    <span className="pill" style={{ background: "var(--s-done-bg)", color: "var(--s-done-fg)" }}>
      הכל טופל
    </span>
  );
}

/** A product of the customer came back within the return window. */
export function ReturnedMark({ text }: { text: string }) {
  return (
    <span className="pill" style={{ background: "var(--danger-bg)", color: "var(--danger-fg)" }}>
      <span aria-hidden="true">↩ </span>
      {text}
    </span>
  );
}

export function CustomersTable({
  rows,
  total,
  query,
}: {
  /** The current page of matching customers. */
  rows: readonly CustomersTableRow[];
  /** Matching customers before paging. */
  total: number;
  /** The search text, for the empty state. */
  query: string;
}) {
  return (
    <section className="card" style={{ overflow: "hidden" }} aria-label="רשימת הלקוחות">
      {rows.length > 0 && (
        // position: relative keeps the 🧪 badge's screen-reader text inside the sideways scroller.
        <div className="scrollx" style={{ position: "relative" }}>
          <table aria-label="לקוחות">
            <thead>
              <tr>
                <th scope="col" className={`${SHORT} set-col-wide`}>
                  מס׳ לקוח
                </th>
                <th scope="col">לקוח</th>
                <th scope="col" className="col-fit set-col-wide">
                  עיר
                </th>
                <th scope="col" className={`${SHORT} set-col-wide`}>
                  טלפון
                </th>
                <th scope="col" className={SHORT}>
                  קריאות
                </th>
                <th scope="col" className={SHORT}>
                  פעילות אחרונה
                </th>
              </tr>
            </thead>
            <tbody>
              {rows.map(({ customer: c, href, lastActivity }) => (
                <tr key={c.id}>
                  <td className={`${SHORT} num set-col-wide`}>{c.number}</td>
                  <td style={{ whiteSpace: "normal", minWidth: 120 }}>
                    <span className="set-name">
                      <Link className="lnk" href={href} prefetch={false} aria-label={`${c.name} · לקוח ${c.number}`}>
                        {c.name}
                      </Link>
                      {c.isTest && <TestBadge />}
                    </span>
                    {c.returnedProductCount > 0 && (
                      <span style={{ display: "block", marginTop: 4 }}>
                        <ReturnedMark text={c.returnedProductCount === 1 ? "מוצר חזר" : `${c.returnedProductCount} מוצרים חזרו`} />
                      </span>
                    )}
                    {/* Narrow widths: number, city and phone under the name (their columns are hidden). */}
                    <span className="sub set-inline-narrow" style={{ fontSize: 12, marginTop: 3 }}>
                      <span style={{ display: "block" }}>
                        מס׳ לקוח <span className="num">{c.number}</span> · {c.city}
                      </span>
                      <bdi dir="ltr" className="num" style={{ display: "block", textAlign: "right" }}>
                        {c.phone}
                      </bdi>
                    </span>
                  </td>
                  <td className="col-fit set-col-wide">{c.city}</td>
                  <td className={`${SHORT} num set-col-wide`} dir="ltr">
                    {c.phone}
                  </td>
                  <td className={SHORT}>
                    <b className="num">{c.callCount}</b>
                    <span style={{ display: "block", marginTop: 3 }}>
                      <ActivityPill active={c.activeCallCount} />
                    </span>
                  </td>
                  <td className={`${SHORT} num`}>{lastActivity}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      )}
      <div aria-live="polite">
        {total ? (
          <div className="sub" style={{ padding: "10px 14px" }}>
            מציג <span className="num">{rows.length}</span> מתוך <span className="num">{total}</span>
          </div>
        ) : (
          <div className="empty">{query ? `לא נמצאו לקוחות עבור "${query}"` : "אין לקוחות"}</div>
        )}
      </div>
    </section>
  );
}
