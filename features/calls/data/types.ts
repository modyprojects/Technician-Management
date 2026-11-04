// Service-call DTOs: the office calls list and call card. Pure types and enums (no data).
// See features/data-access/common.ts.
import type { HourMinute, IsoDate, Page, TestMarker } from "@/features/data-access/common";
import type { Customer } from "@/features/customers/data/types";
import type { Product, TechnicianId, TechnicianRef } from "@/features/reference/data/types";
import type { VisitRecord, VisitSource, VisitStatus } from "@/features/visits/data/types";

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
  customer: Customer;
  product: Product;
  /** Fault description. */
  problem: string;
  /** "הערות לטכנאי"; "" when none. */
  techNote: string;
  representative: { name: string; phone: string | null };
  /** Every visit, by visit number. */
  visits: VisitRecord[];
};

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
};

/** New time for an open visit. */
export type VisitSlot = { date: IsoDate; start: HourMinute; end: HourMinute };
