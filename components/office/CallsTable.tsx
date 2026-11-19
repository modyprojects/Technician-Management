"use client";

import { useRouter } from "next/navigation";
import Link from "next/link";
import type { MouseEvent } from "react";
import { CallStatusPill } from "@/components/ui/CallStatusPill";
import { TestPill, VisitSourceIcon } from "@/components/ui/TestBadge";
import type { CallStatus } from "@/features/calls/data/types";
import type { VisitSource } from "@/features/visits/data/types";

// Office calls table (docs/demo.html callsTable(), L824-832): one row per service call, newest
// first; the whole row opens the call card. Presentational: the parent filters, sorts and caps
// the rows and passes the total for "מציג X מתוך Y".
// - Columns follow design-system.md "Tables" (G-07): short columns centred and sized to content,
//   customer and product take the remaining width; phones scroll the table sideways.
// - Status column: the service-call status (OF-17, D38), with the follow-up reason as in the demo.
// - ADD: customer number (OF-05), 🧪 badge on test calls (SIM-15) next to the request number
//   (the call's own cell, so it never reads as a customer badge, SIM-16), source of the shown
//   visit (SIM-14) and "בוטל" when that visit was cancelled. The customer number is a column on
//   desktop and phone and moves under the customer name at 521-900px; there the follow-up reason
//   also moves under the status pill (styles/ui.css "office-calls"), so the table fits at 820px
//   with the extra width going to customer and product (G-07).

export type CallsTableRow = {
  /** Request number ("מספר פנייה"). */
  req: string;
  /** Call card URL. */
  href: string;
  customer: string;
  /** Customer number ("מספר לקוח", OF-05). */
  customerNo: string;
  city: string;
  /** Product name. */
  product: string;
  sku: string;
  /** Technician of the last (or next) visit; null when no visit is shown (D60 (1): every visit cancelled). */
  tech: { name: string; color: string } | null;
  /** Number of visits. */
  visits: number;
  /** Last (or next) visit: day label and start time, e.g. "היום 09:00" or "22.10 13:00"; "" when none. */
  when: string;
  /** Source of that visit (SIM-14); null when no visit is shown. */
  source: VisitSource | null;
  /** That visit was cancelled: "בוטל" after the time. */
  whenCancelled?: boolean;
  /** Service-call status (OF-17). */
  status: CallStatus;
  /** Follow-up reason shown after the status (status "followup"). */
  reason?: string;
  /** Handling rep. */
  rep: string;
  /** Test record (D47): shows the 🧪 badge (SIM-15). */
  isTest: boolean;
};

// Short columns: centred and sized to their content (G-07).
const SHORT = "col-center col-fit";

/**
 * The shown visit's source (SIM-14). An Outlook visit keeps the 📅 icon. A simulated visit shows the
 * quiet "בדיקה" marker (TestPill) only when the row itself is not marked: a test row carries exactly
 * one marker (D74, owner fix 19.11).
 */
function SourceMark({ source, rowIsTest }: { source: VisitSource; rowIsTest: boolean }) {
  if (source !== "simulator") return <VisitSourceIcon source={source} />;
  return rowIsTest ? null : <TestPill />;
}

export function CallsTable({
  rows,
  total,
  emptyText = "לא נמצאו קריאות",
}: {
  /** The rows to show (already filtered, sorted and capped). */
  rows: readonly CallsTableRow[];
  /** Number of matching calls before the cap. */
  total: number;
  emptyText?: string;
}) {
  const router = useRouter();

  // The demo's tr.click: a click anywhere on the row opens the call card. The request number is
  // the real link (keyboard, middle click, open in new tab); clicks on it, modified clicks and
  // text selection are left to the browser.
  function openRow(e: MouseEvent<HTMLTableRowElement>, href: string) {
    if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
    if (e.target instanceof Element && e.target.closest("a, button, input, select, textarea")) return;
    if (window.getSelection()?.toString()) return;
    router.push(href);
  }

  function openCard(e: MouseEvent<HTMLLIElement>, href: string) {
    if (e.target instanceof Element && e.target.closest("a, button, input, select, textarea")) return;
    router.push(href);
  }

  return (
    <section className="card" style={{ overflow: "hidden" }}>
      <div className="scrollx oc-tablewrap">
        <table aria-label="קריאות שירות">
          <thead>
            <tr>
              <th scope="col" className={SHORT}>
                מס׳ פנייה
              </th>
              <th scope="col">לקוח</th>
              <th scope="col" className={`${SHORT} oc-custno-col`}>
                מס׳ לקוח
              </th>
              <th scope="col" className="col-fit">
                עיר
              </th>
              <th scope="col">מוצר</th>
              <th scope="col" className={SHORT}>
                מק&quot;ט
              </th>
              <th scope="col" className={SHORT}>
                טכנאי
              </th>
              <th scope="col" className={SHORT}>
                ביקורים
              </th>
              <th scope="col" className={SHORT}>
                ביקור אחרון / הבא
              </th>
              <th scope="col" className={SHORT}>
                סטטוס
              </th>
              <th scope="col" className="col-fit">
                נציגה
              </th>
            </tr>
          </thead>
          <tbody>
            {rows.map((r) => (
              <tr key={r.req} className="click" onClick={(e) => openRow(e, r.href)}>
                <td className={SHORT}>
                  <Link href={r.href} prefetch={false} className="lnk num" aria-label={`מס׳ פנייה ${r.req} · ${r.customer}`}>
                    {r.req}
                  </Link>
                  {r.isTest && (
                    <>
                      {" "}
                      <TestPill />
                    </>
                  )}
                </td>
                <td>
                  <b>{r.customer}</b>
                  <div className="sub oc-custno-sub">
                    מס׳ לקוח <span className="num">{r.customerNo}</span>
                  </div>
                </td>
                <td className={`${SHORT} num oc-custno-col`}>{r.customerNo}</td>
                <td className="col-fit">{r.city}</td>
                <td>{r.product}</td>
                <td className={SHORT} dir="ltr">
                  {r.sku}
                </td>
                <td className={SHORT}>
                  {r.tech ? (
                    <>
                      <span className="dot" aria-hidden="true" style={{ background: r.tech.color }} /> {r.tech.name}
                    </>
                  ) : (
                    "—"
                  )}
                </td>
                <td className={`${SHORT} num`}>{r.visits}</td>
                <td className={`${SHORT} num`}>
                  {r.source && <SourceMark source={r.source} rowIsTest={r.isTest} />} {r.when || "—"}
                  {r.whenCancelled && (
                    <span className="oc-when-cancel" style={{ color: "var(--s-cancel-fg)", fontWeight: 700 }}>
                      <span className="oc-sep"> · </span>בוטל
                    </span>
                  )}
                </td>
                <td className={SHORT}>
                  <CallStatusPill
                    status={r.status}
                    extra={r.reason ? <span className="oc-reason-inline">{` · ${r.reason}`}</span> : undefined}
                  />
                  {r.reason && <div className="sub oc-reason-sub">{r.reason}</div>}
                </td>
                <td className="col-fit">{r.rep}</td>
              </tr>
            ))}
          </tbody>
        </table>
        <ul className="oc-cards" aria-label="קריאות שירות">
          {rows.map((r) => (
            <li key={r.req} className="oc-card" onClick={(e) => openCard(e, r.href)}>
              <div className="oc-card-top">
                <Link href={r.href} prefetch={false} className="lnk num" aria-label={`מס׳ פנייה ${r.req} · ${r.customer}`}>
                  {r.req}
                </Link>
                {r.isTest && <TestPill />}
                <span className="oc-card-status">
                  <CallStatusPill status={r.status} />
                </span>
              </div>
              <b>{r.customer}</b>
              <div className="sub">
                {r.product}
                {r.city ? ` · ${r.city}` : ""}
              </div>
              {r.reason && <div className="sub">{r.reason}</div>}
              <div className="sub oc-card-meta">
                {r.tech ? (
                  <span>
                    <span className="dot" aria-hidden="true" style={{ background: r.tech.color }} /> {r.tech.name}
                  </span>
                ) : null}
                {r.when ? (
                  <span className="num">
                    {r.source && <SourceMark source={r.source} rowIsTest={r.isTest} />} {r.when}
                    {r.whenCancelled && <span style={{ color: "var(--s-cancel-fg)", fontWeight: 700 }}> · בוטל</span>}
                  </span>
                ) : null}
              </div>
            </li>
          ))}
        </ul>
        <div aria-live="polite">
          {total ? (
            <div className="sub" style={{ padding: "10px 14px" }}>
              מציג <span className="num">{rows.length}</span> מתוך <span className="num">{total}</span>
            </div>
          ) : (
            <div className="empty">{emptyText}</div>
          )}
        </div>
      </div>
    </section>
  );
}
