// Customer DTOs: the customer as an invitation describes it (calls, visits) and the office
// "לקוחות" screen and customer card (spec office screens; OF-16, matrix key `calls`). Pure types
// (no data). See features/data-access/common.ts.
// A customer is identified by the customer number ("מספר לקוח", required and unique, D17, OF-05);
// contact details come from the latest valid invitation (D39); the address belongs to each visit
// (D39), so the customer card shows the latest visit's address and each call its own city.
import type { Bounded, IsoDate, Page, PageRequest, TestMarker } from "@/features/data-access/common";
import type { CallStatus, CallSummary } from "@/features/calls/data/types";
import type { Product } from "@/features/reference/data/types";

export type Address = {
  city: string;
  /** Street and house number, e.g. "הרצל 14". */
  street: string;
  building: string;
  floor: string;
  apt: string;
};

/** The customer as an invitation describes it (TE-09: customer number required, OF-05). */
export type Customer = TestMarker & {
  name: string;
  /** "מספר לקוח". */
  number: string;
  phone: string;
  /** Second phone; "" when none. */
  phone2: string;
  address: Address;
  /** "הערות הגעה"; "" when none. */
  arrivalNotes: string;
};

/** Customer id (`customers.id`, a uuid in the database; a short key in the fixtures). Never the customer number. */
export type CustomerId = string;

/** One row of the "לקוחות" list. */
export type CustomerSummary = TestMarker & {
  id: CustomerId;
  /** "מספר לקוח" (searchable, OF-05). */
  number: string;
  name: string;
  phone: string;
  /** City of the latest visit (D39: the address is stored per visit). */
  city: string;
  /** Service calls of the customer. */
  callCount: number;
  /** Calls not resolved: open, awaiting scheduling or follow-up (D38). */
  activeCallCount: number;
  /** Date of the customer's latest visit (any status). */
  lastActivity: IsoDate;
  /** Distinct products that came back within PRODUCT_RETURN_WINDOW_DAYS (features/products/data/types). */
  returnedProductCount: number;
};

/** Customers-list query. Every field is optional; adapters validate and clamp it. */
export type CustomerListQuery = PageRequest & {
  /** Search over name, customer number, phone (digits too) and city. */
  q?: string;
};

/** Customers by latest activity, newest first, paged (OF-04 semantics: default 40, at most 100). */
export type CustomersPage = Page<CustomerSummary>;

/**
 * A return of a product at this customer (PRODUCT_RETURN_WINDOW_DAYS): call `req` was opened
 * `days` days after the latest closed visit of the customer's earlier call `previousReq` for the
 * same SKU.
 */
export type ProductReturn = {
  req: string;
  previousReq: string;
  /** First visit date of `req`. */
  date: IsoDate;
  days: number;
};

/** Cap of the calls the customer card lists (newest first); `total` gives the rest (link to the calls list searched by customer number). */
export const CUSTOMER_CALLS_LIMIT = 40;

/** Cap of the products and of the returns per product the customer card lists. */
export const CUSTOMER_PRODUCTS_LIMIT = 20;

/** A product the customer has had calls for. */
export type CustomerProduct = {
  product: Product;
  /** The customer's calls for this SKU. */
  callCount: number;
  /** First visit date of the customer's first and latest call for this SKU. */
  firstDate: IsoDate;
  lastDate: IsoDate;
  /** True when at least one call was a return within the window ("חזר"). */
  cameBack: boolean;
  /** The returns, oldest first (at most CUSTOMER_PRODUCTS_LIMIT). */
  returns: Bounded<ProductReturn>;
};

/** The customer card: details, every call (bounded) and the products that came back. */
export type CustomerDetail = TestMarker & {
  id: CustomerId;
  number: string;
  name: string;
  phone: string;
  /** "" when none. */
  phone2: string;
  /** The latest visit's address (D39: stored per visit). */
  latestAddress: Address;
  /** Calls per service-call status (D38), over every call of the customer. */
  statusCounts: Record<CallStatus, number>;
  /** The customer's calls, newest first (at most CUSTOMER_CALLS_LIMIT), with service-call status and visits summary. */
  calls: Bounded<CallSummary>;
  /** Products by latest call, newest first; returned products first (at most CUSTOMER_PRODUCTS_LIMIT). */
  products: Bounded<CustomerProduct>;
};
