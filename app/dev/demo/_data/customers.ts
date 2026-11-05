// FICTITIOUS DATA ONLY: the demo's customers, derived from the seeded calls. Allowed only under
// app/dev (G-05). Server-side, for the fixture adapter only (adapter.ts, params.ts).
// A customer is one customer number ("מספר לקוח", unique, D17); its contact details come from its
// latest call (D39: the latest valid invitation). In the database a customer has its own uuid; the
// fixture id is "cu-" + the customer number, so screens never treat the number as the id.
import "server-only";
import type { CallStartDates } from "@/features/calls/data/types";
import { jerusalemDate } from "@/features/dashboards/data/time";
import { PRODUCT_RETURN_WINDOW_DAYS } from "@/features/products/data/types";
import { atJerusalem, daysBetween } from "./dates";
import { CALLS, lastVisit, sortCalls } from "./queries";
import { isClosedVisit } from "./status";
import type { Call } from "./types";

export type DemoCustomer = {
  id: string;
  number: string;
  /** The customer's calls, newest first (the calls-list order). */
  calls: readonly Call[];
  /** The newest call: contact details and the latest visit's address. */
  latest: Call;
  /** Date of the newest call's latest or next visit (the calls-list order, sortCalls). */
  latestVisitDate: string;
};

/** Fixture customer id of a customer number. */
export const customerIdOf = (customerNo: string): string => `cu-${customerNo}`;

function buildCustomers(): DemoCustomer[] {
  const byNumber = new Map<string, Call[]>();
  for (const c of CALLS) byNumber.set(c.customerNo, [...(byNumber.get(c.customerNo) ?? []), c]);
  const customers = [...byNumber.entries()].map(([number, calls]): DemoCustomer => {
    const sorted = sortCalls(calls);
    const latest = sorted[0] as Call;
    return { id: customerIdOf(number), number, calls: sorted, latest, latestVisitDate: lastVisit(latest).date };
  });
  // Latest or next visit first (date and start of the newest call's last visit), then the customer number.
  const key = (x: DemoCustomer): string => lastVisit(x.latest).date + lastVisit(x.latest).start;
  return customers.sort((a, b) => key(b).localeCompare(key(a)) || a.number.localeCompare(b.number));
}

/** Every customer, latest or next visit first (computed once). */
export const CUSTOMERS: readonly DemoCustomer[] = buildCustomers();

const BY_ID = new Map(CUSTOMERS.map((x) => [x.id, x]));

export const findCustomer = (id: string): DemoCustomer | undefined => BY_ID.get(id);

// D57 (9) (owner message 6): a call's opening date is its `openedAt` (service_calls.opened_at), never
// its first visit's date. The former helper `openedOn` (which returned the first visit's date and
// fed "opened" texts and rules) is retired so its misleading name cannot be reused.

/** "נפתחה": the Asia/Jerusalem date of the call's opened_at (D57 (9)). */
export function openedDate(c: Call): string {
  const date = jerusalemDate(c.openedAt);
  if (date === null) throw new Error(`Call ${c.req}: invalid opened_at`);
  return date;
}

/** Oldest opened first (the opened_at instant), then the request number. */
export const byOpening = (a: Call, b: Call): number => Date.parse(a.openedAt) - Date.parse(b.openedAt) || a.req.localeCompare(b.req);

/**
 * "תחילת טיפול": when the technician started working at the customer, the arrival of the call's
 * first visit (the first recorded arrival by visit number, its current value; a cancelled visit has
 * none). Null before any arrival (screens show "טרם התחיל"; never a fabricated value). D57 (9).
 */
export function workStartAt(c: Call): string | null {
  const first = [...c.visits].sort((a, b) => a.n - b.n).find((v) => v.arriveAt !== null);
  return first?.arriveAt ? atJerusalem(first.date, first.arriveAt) : null;
}

/** The call's "נפתחה" and "תחילת טיפול" (D57 (9)). */
export const callStartDates = (c: Call): CallStartDates => ({ req: c.req, openedAt: c.openedAt, workStartAt: workStartAt(c) });

/** Date of a call's latest closed visit ("טופל" or "המשך טיפול"), or null when none closed. */
export function lastClosedOn(c: Call): string | null {
  const closed = c.visits.filter(isClosedVisit);
  return closed.length ? (closed[closed.length - 1] as Call["visits"][number]).date : null;
}

export type DemoProductReturn = { req: string; previousReq: string; openedDate: string; days: number };

/** One SKU of a customer: its calls oldest opened first and the returns within the window. */
export type DemoCustomerProduct = { sku: string; calls: Call[]; returns: DemoProductReturn[] };

/**
 * The customer's products and their returns (features/products/data/types
 * PRODUCT_RETURN_WINDOW_DAYS): call k is a return when the previous call for the same SKU (by
 * opening time, opened_at) has a closed visit and call k was opened (its opened_at date, D57 (9)) at
 * most the window's days after that call's latest closed visit.
 */
export function customerProducts(customer: DemoCustomer): DemoCustomerProduct[] {
  const bySku = new Map<string, Call[]>();
  for (const c of customer.calls) bySku.set(c.sku, [...(bySku.get(c.sku) ?? []), c]);
  return [...bySku.entries()].map(([sku, calls]) => {
    const oldestFirst = [...calls].sort(byOpening);
    const returns: DemoProductReturn[] = [];
    oldestFirst.forEach((c, i) => {
      const prev = oldestFirst[i - 1];
      const closedOn = prev ? lastClosedOn(prev) : null;
      if (!prev || !closedOn) return;
      const opened = openedDate(c);
      const days = daysBetween(closedOn, opened);
      if (days >= 0 && days <= PRODUCT_RETURN_WINDOW_DAYS) returns.push({ req: c.req, previousReq: prev.req, openedDate: opened, days });
    });
    return { sku, calls: oldestFirst, returns };
  });
}
