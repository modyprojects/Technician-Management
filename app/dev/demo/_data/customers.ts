// FICTITIOUS DATA ONLY: the demo's customers, derived from the seeded calls. Allowed only under
// app/dev (G-05). Server-side, for the fixture adapter only (adapter.ts, params.ts).
// A customer is one customer number ("מספר לקוח", unique, D17); its contact details come from its
// latest call (D39: the latest valid invitation). In the database a customer has its own uuid; the
// fixture id is "cu-" + the customer number, so screens never treat the number as the id.
import "server-only";
import { PRODUCT_RETURN_WINDOW_DAYS } from "@/features/products/data/types";
import { daysBetween } from "./dates";
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
  /** Date of the latest visit over every call. */
  lastActivity: string;
};

/** Fixture customer id of a customer number. */
export const customerIdOf = (customerNo: string): string => `cu-${customerNo}`;

function buildCustomers(): DemoCustomer[] {
  const byNumber = new Map<string, Call[]>();
  for (const c of CALLS) byNumber.set(c.customerNo, [...(byNumber.get(c.customerNo) ?? []), c]);
  const customers = [...byNumber.entries()].map(([number, calls]): DemoCustomer => {
    const sorted = sortCalls(calls);
    const latest = sorted[0] as Call;
    return { id: customerIdOf(number), number, calls: sorted, latest, lastActivity: lastVisit(latest).date };
  });
  // Latest activity first (latest visit date and start), then the customer number.
  const key = (x: DemoCustomer): string => lastVisit(x.latest).date + lastVisit(x.latest).start;
  return customers.sort((a, b) => key(b).localeCompare(key(a)) || a.number.localeCompare(b.number));
}

/** Every customer, latest activity first (computed once). */
export const CUSTOMERS: readonly DemoCustomer[] = buildCustomers();

const BY_ID = new Map(CUSTOMERS.map((x) => [x.id, x]));

export const findCustomer = (id: string): DemoCustomer | undefined => BY_ID.get(id);

/** First visit date of a call ("opened"). */
export const openedOn = (c: Call): string => (c.visits[0] as Call["visits"][number]).date;

/** Date of a call's latest closed visit ("טופל" or "המשך טיפול"), or null when none closed. */
export function lastClosedOn(c: Call): string | null {
  const closed = c.visits.filter(isClosedVisit);
  return closed.length ? (closed[closed.length - 1] as Call["visits"][number]).date : null;
}

export type DemoProductReturn = { req: string; previousReq: string; date: string; days: number };

/** One SKU of a customer: its calls oldest first and the returns within the window. */
export type DemoCustomerProduct = { sku: string; calls: Call[]; returns: DemoProductReturn[] };

/**
 * The customer's products and their returns (features/products/data/types
 * PRODUCT_RETURN_WINDOW_DAYS): call k is a return when the previous call for the same SKU (by
 * opening date) has a closed visit and call k opened at most the window's days after that call's
 * latest closed visit.
 */
export function customerProducts(customer: DemoCustomer): DemoCustomerProduct[] {
  const bySku = new Map<string, Call[]>();
  for (const c of customer.calls) bySku.set(c.sku, [...(bySku.get(c.sku) ?? []), c]);
  return [...bySku.entries()].map(([sku, calls]) => {
    const oldestFirst = [...calls].sort((a, b) => openedOn(a).localeCompare(openedOn(b)) || a.req.localeCompare(b.req));
    const returns: DemoProductReturn[] = [];
    oldestFirst.forEach((c, i) => {
      const prev = oldestFirst[i - 1];
      const closedOn = prev ? lastClosedOn(prev) : null;
      if (!prev || !closedOn) return;
      const days = daysBetween(closedOn, openedOn(c));
      if (days >= 0 && days <= PRODUCT_RETURN_WINDOW_DAYS) returns.push({ req: c.req, previousReq: prev.req, date: openedOn(c), days });
    });
    return { sku, calls: oldestFirst, returns };
  });
}
