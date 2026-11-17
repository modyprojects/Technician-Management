// Service-call DTOs: the office calls list and call card. Pure types and enums (no data).
// See features/data-access/common.ts.
import type { HourMinute, IsoDate, IsoTimestamp, Page, PageRequest, TestMarker } from "@/features/data-access/common";
import type { Customer, CustomerId } from "@/features/customers/data/types";
import type { Product, TechnicianId, TechnicianRef } from "@/features/reference/data/types";
import type { VisitRecord, VisitRef, VisitSource, VisitStatus } from "@/features/visits/data/types";

export type { Page };

/**
 * Service-call status (D38, demo-deviations OF-17), calculated on the server: any open visit →
 * "open"; otherwise the latest closed visit by number → "resolved" or "followup"; otherwise
 * (every visit cancelled) → "awaiting".
 */
export const CALL_STATUS_VALUES = ["open", "awaiting", "followup", "resolved"] as const;
export type CallStatus = (typeof CALL_STATUS_VALUES)[number];

export const isCallStatus = (value: unknown): value is CallStatus =>
  typeof value === "string" && (CALL_STATUS_VALUES as readonly string[]).includes(value);

/** A visit as the calls list shows it (the call's latest visit by number). */
export type CallVisitBrief = {
  n: number;
  date: IsoDate;
  start: HourMinute;
  end: HourMinute;
  status: VisitStatus;
  source: VisitSource;
  technician: TechnicianRef;
};

/**
 * A call's two start dates (D57 (9), owner message 6): two different fields, each shown with its own
 * label and never one under the other's label.
 * - "נפתחה" = `openedAt`: when the call was opened in the system (`service_calls.opened_at`).
 * - "תחילת טיפול" = `workStartAt`: when the technician started working at the customer, the arrival
 *   of the call's first visit (the first recorded arrival by visit number; a cancelled visit has
 *   none); null before any arrival, shown as "טרם התחיל" (never a fabricated value).
 * ISO instants with an offset; screens show them in Asia/Jerusalem.
 */
export type CallStartDates = {
  req: string;
  openedAt: IsoTimestamp;
  workStartAt: IsoTimestamp | null;
};

/** One calls-list row. */
export type CallSummary = TestMarker & {
  /** Request number ("מספר פנייה"), unique. */
  req: string;
  /** Source of the call's first invitation (D24, SIM-14). */
  source: VisitSource;
  customer: Pick<Customer, "name" | "number" | "phone" | "isTest"> & { city: string };
  product: Product;
  status: CallStatus;
  /** Reason of the visit that set the call to "המשך טיפול"; null otherwise. */
  followupReason: string | null;
  visitCount: number;
  /** "ביקור אחרון / הבא": the call's latest visit by visit number. */
  latestVisit: CallVisitBrief;
  /** Handling representative's name. */
  representative: string;
};

/** The full office call card. */
export type CallDetail = TestMarker & {
  req: string;
  source: VisitSource;
  /** "תיקון" / "התקנה". */
  type: string;
  /** Warranty text as received; "" when not given (TE-08: shown as "לא צוין"). */
  warranty: string;
  status: CallStatus;
  /** The customer, with the id of the customer card ("לקוחות", OF-16). */
  customer: Customer & { id: CustomerId };
  product: Product;
  /** Fault description. */
  problem: string;
  /** "הערות לטכנאי"; "" when none. */
  techNote: string;
  representative: { name: string; phone: string | null };
  /** Every visit, by visit number. */
  visits: VisitRecord[];
};

/**
 * A row of the real calls list (Supabase adapter): D60 (1), a cancelled visit is never shown, so
 * `visitCount` counts the other visits and `latestVisit` is the latest of them, null when every visit
 * was cancelled (the call is then "ממתינה לשיבוץ", D38). A CallSummary is one of these.
 */
export type CallListItem = Omit<CallSummary, "latestVisit"> & { latestVisit: CallVisitBrief | null };

/** Calls-list query. Every field is optional; adapters validate and clamp it. */
export type CallFilter = {
  /** Search over request number, customer number, customer name, phone (digits too), SKU, product name and city. */
  q?: string;
  /** Service-call statuses to include; empty or missing = all. */
  statuses?: readonly CallStatus[];
  /** Technician of the latest visit. */
  technicianId?: TechnicianId;
  /** Latest-visit date range, inclusive. */
  from?: IsoDate;
  to?: IsoDate;
  /** 1-based page. */
  page?: number;
  /** Page size, at most MAX_PAGE_LIMIT (100); default 40. */
  limit?: number;
};

/** A page of the calls list, newest first, with the status-chip counts. */
export type CallsPage = Page<CallSummary> & {
  /** Calls per service-call status over every call the viewer may see (not narrowed by the filter, as in the demo). */
  statusCounts: Record<CallStatus, number>;
  /** Every call the viewer may see ("הכל"). */
  allCount: number;
  /**
   * True when the list was searched within a bounded window of the newest calls (the real adapter
   * reads at most a fixed number per request) and more calls matched the status filter than it
   * holds: the screen says so instead of implying the result is complete.
   */
  capped?: boolean;
};

/** A page of the real calls list (its rows may have no shown visit, D60 (1)). */
export type CallsListPage = Omit<CallsPage, "items"> & { items: CallListItem[] };

// ---------------------------------------------------------------------------------------------
// "חזרו מהשטח" (back from field; spec office screens, OF-16)

/** Longest summary excerpt a back-from-field row carries (the call card has the full summary). */
export const SUMMARY_EXCERPT_MAX = 140;

/**
 * A visit that came back from the field as "המשך טיפול" and still needs a new visit. The rule
 * (D38): the call's service-call status is "followup", that is, the call has no open visit
 * (scheduled, en route or in progress) and its latest closed visit by visit number is "המשך
 * טיפול"; the row is that visit. Once a next visit exists (a new invitation was ingested) the call
 * is "open" and the row leaves the list; a later visit that was cancelled does not count as a next
 * visit (`cancelledLaterVisits`), so the call is back on the list.
 */
export type BackFromFieldItem = TestMarker &
  VisitRef & {
    /** Task number ("מספר משימה") of the visit. */
    task: number;
    /** The visit's date and its end time (closed by the technician). */
    date: IsoDate;
    endAt: HourMinute | null;
    /** Invitation source of the visit (SIM-14). */
    source: VisitSource;
    /** "סיבת המשך טיפול". */
    reason: string;
    /** "מה צריך בביקור הבא" (TE-21); "" when none. */
    nextNote: string;
    /** The visit summary cut to SUMMARY_EXCERPT_MAX characters ("…" added); "" when none. */
    summaryExcerpt: string;
    technician: TechnicianRef;
    customer: Pick<Customer, "name" | "number" | "isTest"> & { id: CustomerId };
    /** City of the visit (D39: the address is stored per visit). */
    city: string;
    product: Pick<Product, "sku" | "name" | "isTest">;
    /** Handling representative's name. */
    representative: string;
    /** Whole days from the visit's date to `asOf`. */
    daysWaiting: number;
    /** Later visits of the call that were cancelled. */
    cancelledLaterVisits: number;
  };

/** Back-from-field query: the date the waiting days count to, and optional technician and paging. */
export type BackFromFieldQuery = PageRequest & {
  /** "Today" in Asia/Jerusalem (G-01); a malformed date is a RangeError. */
  asOf: IsoDate;
  /** Technician of the visit; none = every technician. */
  technicianId?: TechnicianId;
};

/** Oldest first (the longest wait first, as the office home's follow-up queue), paged. */
export type BackFromFieldPage = Page<BackFromFieldItem> & {
  /**
   * Whether Microsoft 365 is connected (D23). The row action is a NEW Outlook invitation; until
   * the connection exists the screen shows it disabled with a visible hint and never fakes an
   * Outlook link (OF-08 pattern).
   */
  outlookConnected: boolean;
};
