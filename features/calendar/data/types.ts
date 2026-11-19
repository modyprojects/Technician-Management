// Calendar DTOs: the office "יומן טכנאים" (docs/demo.html offCal() L752-802, OF-03: day / week /
// month, technician filter chips, legend, visit drawer, read-only) and the technician's "היומן
// שלי" (techCalendar() L603-643, TE-27: day / week / month). Pure types and enums (no data).
// The calendars are read-only: scheduling stays in Outlook (OF-03); the intake service
// (features/calendar/ingestion, later) is separate from these read models.
// Every list is bounded (docs/security.md: query bounds): visits per technician per day and per
// day column are capped (below); month views carry counts only; lanes are at most one per
// technician (MAX_PAGE_LIMIT).
import type { Bounded, HourMinute, IsoDate, IsoTimestamp, Page, TestMarker } from "@/features/data-access/common";
import type { Customer } from "@/features/customers/data/types";
import type { Product, TechnicianId, TechnicianRef } from "@/features/reference/data/types";
import type { VisitRef, VisitSource, VisitStatus } from "@/features/visits/data/types";
import type { PendingSetting, TemplateFieldKey } from "@/features/settings/data/types";

/** Calendar month "YYYY-MM". */
export type YearMonth = string;

/** Calendar views (demo segments "יום / שבוע / חודש" in the office, "יומי / שבועי / חודשי" for the technician). */
export const CALENDAR_VIEW_VALUES = ["day", "week", "month"] as const;
export type CalendarView = (typeof CALENDAR_VIEW_VALUES)[number];

export const isCalendarView = (value: unknown): value is CalendarView =>
  typeof value === "string" && (CALENDAR_VIEW_VALUES as readonly string[]).includes(value);

/** Visit statuses a calendar shows. Cancelled visits are never on a calendar (demo inF / myVisits). */
export const CALENDAR_STATUS_VALUES = ["new", "go", "work", "done", "cont"] as const satisfies readonly VisitStatus[];
export type CalendarVisitStatus = (typeof CALENDAR_STATUS_VALUES)[number];

export const isCalendarVisitStatus = (value: unknown): value is CalendarVisitStatus =>
  typeof value === "string" && (CALENDAR_STATUS_VALUES as readonly string[]).includes(value);

/** Cap of one technician's visits on one day (office day lane, technician day). A field day is 08:00-18:00. */
export const CALENDAR_LANE_LIMIT = 30;

/** Cap of one day column in the office week view (every technician together); `total` gives the rest. */
export const CALENDAR_WEEK_DAY_LIMIT = 100;

/** A visit block on a calendar. */
export type CalendarVisit = TestMarker &
  VisitRef & {
    date: IsoDate;
    start: HourMinute;
    end: HourMinute;
    /** Never "cancel" on a calendar. */
    status: VisitStatus;
    /** Invitation source (SIM-14): the drawer shows it. */
    source: VisitSource;
    technician: Pick<TechnicianRef, "id" | "name" | "color">;
    customerName: string;
    city: string;
    productName: string;
    /** Visit 2 or later ("↻ ביקור המשך" / "ביקור n"). */
    isFollowUp: boolean;
  };

/**
 * A block placed in a technician's day column (the demo's laneLayout): overlapping visits sit
 * side by side. `lane` is the block's 0-based column inside its overlap cluster and `lanes` the
 * cluster's column count (a visit with no overlap: lane 0 of 1).
 */
export type PlacedCalendarVisit = CalendarVisit & { lane: number; lanes: number };

/** Office calendar filter. Both optional; adapters validate it (normalizeCalendarFilter). */
export type OfficeCalendarFilter = {
  /** One technician ("כולם" when missing). */
  technicianId?: TechnicianId;
  /** Visit statuses to include; empty or missing = every calendar status. */
  statuses?: readonly CalendarVisitStatus[];
};

/** The filter after validation, as the result echoes it. */
export type NormalizedCalendarFilter = {
  technicianId: TechnicianId | null;
  /** Empty = every calendar status. */
  statuses: CalendarVisitStatus[];
};

/** One technician's column in the office day view. */
export type OfficeDayLane = {
  technician: TechnicianRef;
  /** The technician's visits on the date, by start time, placed in overlap lanes; at most CALENDAR_LANE_LIMIT. */
  visits: Bounded<PlacedCalendarVisit>;
};

/** Office calendar, day view (technician columns, 08:00-18:00 grid). */
export type OfficeCalendarDay = {
  date: IsoDate;
  filter: NormalizedCalendarFilter;
  /** True in test environments when test data is shown ("נתוני בדיקה", SIM-08). */
  includesTestData: boolean;
  /**
   * One lane per technician in the filter, in Settings order (every technician when no
   * technician is chosen, including those without visits; none for an unknown technician).
   */
  lanes: OfficeDayLane[];
  /** Visits on the date after the filter. */
  total: number;
};

/** One day column of the office week view. */
export type OfficeWeekDay = {
  date: IsoDate;
  /** Visits by start time, then technician; at most CALENDAR_WEEK_DAY_LIMIT. */
  visits: Bounded<CalendarVisit>;
};

/** Office calendar, week view: the five work days Sunday to Thursday (the demo's look, TE-27 / OF-03). */
export type OfficeCalendarWeek = {
  /** Sunday of the week (normalized from the date asked for). */
  weekStart: IsoDate;
  filter: NormalizedCalendarFilter;
  includesTestData: boolean;
  /** Sunday to Thursday. */
  days: OfficeWeekDay[];
  /** Visits in the five days after the filter. */
  total: number;
};

/** One day cell of the office month view: counts only. */
export type OfficeMonthDay = {
  date: IsoDate;
  /** Visits on the day after the filter ("X ביק׳"). */
  total: number;
  /** Visits per technician, only technicians with visits, in Settings order. */
  byTechnician: { technician: Pick<TechnicianRef, "id" | "name" | "color">; count: number }[];
  /** Visits closed as "המשך טיפול" ("X המשך טיפול"). */
  followups: number;
};

/** Office calendar, month view. */
export type OfficeCalendarMonth = {
  month: YearMonth;
  filter: NormalizedCalendarFilter;
  includesTestData: boolean;
  /** Every day of the month, in order (the screen pads the grid with the neighbouring months). */
  days: OfficeMonthDay[];
  /** Visits in the month after the filter. */
  total: number;
};

/**
 * The office calendar's visit drawer (docs/demo.html drawerHtml() L803-815): when, technician,
 * phone, address, product, SKU, representative, fault and "מצב בשטח". Field times are office-only
 * (TE-25). The drawer's "לכרטיס הקריאה המלא" opens calls.get(req) where the role's matrix offers it.
 */
export type CalendarVisitDetail = TestMarker &
  VisitRef & {
    date: IsoDate;
    start: HourMinute;
    end: HourMinute;
    status: VisitStatus;
    source: VisitSource;
    technician: TechnicianRef;
    customer: Pick<Customer, "name" | "phone" | "isTest"> & {
      /** "הרצל 14, רחובות". */
      address: string;
    };
    product: Pick<Product, "sku" | "name" | "isTest">;
    /** Handling representative's name ("נציגה"). */
    representative: string;
    /** Fault description. */
    problem: string;
    /** "מצב בשטח" (office only, TE-25). */
    departAt: HourMinute | null;
    arriveAt: HourMinute | null;
    endAt: HourMinute | null;
    /** Signer name (status "done"). */
    signerName: string | null;
    /** Follow-up reason (status "cont"). */
    followupReason: string | null;
  };

/** One day of the technician's calendar. */
export type TechCalendarDay = {
  date: IsoDate;
  /** The technician's visits on the day, by start time (cancelled excluded); at most CALENDAR_LANE_LIMIT. */
  visits: Bounded<CalendarVisit>;
};

/**
 * The technician's week (day and week views): the five work days Sunday to Thursday. The day
 * view's strip shows each day's `visits.total`; its timeline shows the chosen day's visits.
 */
export type TechWeek = {
  technician: TechnicianRef;
  /** Sunday of the week (normalized from the date asked for). */
  weekStart: IsoDate;
  /** Sunday to Thursday. */
  days: TechCalendarDay[];
  /** Visits in the five days. */
  total: number;
};

/** The technician's month view: counts per day ("X ביק׳") and the month total ("X ביקורים באוקטובר"). */
export type TechMonth = {
  technician: TechnicianRef;
  month: YearMonth;
  /** Every day of the month, in order. */
  days: { date: IsoDate; count: number }[];
  total: number;
};

// ---------------------------------------------------------------------------------------------
// Intake read model: "זימונים שלא נקלטו" (unparsed invitations; spec "Invitation intake", IN-01 to
// IN-06, OF-16). Rows come from the ingestion service's error records
// (`calendar_ingestion_errors`, docs/database-schema.md); this layer only reads them. Intake is
// event-driven (Graph change notifications later, the simulator now; D08, D24), never polling.

/**
 * Why an invitation was not ingested (spec: a missing required field or an unknown pickup place; an
 * invalid value; QA S-05 adds the ingestion service's other structured reasons: the attendee is no
 * known, active, single technician, and a conflict with what is stored).
 */
export const UNPARSED_PROBLEM_KINDS = ["missing", "unknown-place", "invalid", "technician", "conflict"] as const;
export type UnparsedProblemKind = (typeof UNPARSED_PROBLEM_KINDS)[number];

/** Where a problem was found: a template label, or a part of the invitation itself. */
export type UnparsedProblemField = TemplateFieldKey | "subject" | "attendee" | "organizer" | "schedule" | "body";

/** Why the attendee is not the visit's technician (kind "technician"). */
export type UnparsedTechnicianReason = "unknown" | "inactive" | "ambiguous";

/**
 * One problem of an invitation, ready to show. `label` is the template label as configured in
 * Settings › תבנית זימון (for example "מספר לקוח") or the name of the part of the invitation
 * ("מועד הזימון"); `value` is the text read from the invitation, sanitized and cut to
 * UNPARSED_VALUE_MAX characters ("" when nothing was read); `expected` and `explanation` are Hebrew
 * text built by the app (features/calendar/data/unparsed-reasons.ts), never invitation text.
 * Calendar text is untrusted data: screens render it as plain text only, never as HTML or links.
 * An unknown SKU is NEVER a problem: the product is created (IN-02, D19, PR-04).
 */
export type UnparsedProblem =
  | { kind: "missing"; field: UnparsedProblemField; label: string; explanation?: string }
  | { kind: "unknown-place"; field: "collectFrom"; label: string; value: string; explanation?: string }
  | {
      kind: "invalid";
      field: UnparsedProblemField;
      label: string;
      value: string;
      /** What the field accepts, in Hebrew (for example "כן / לא / כן · עד MM/YYYY"). */
      expected: string;
    }
  | { kind: "technician"; field: "attendee"; reason: UnparsedTechnicianReason; label: string; value: string; explanation: string }
  | { kind: "conflict"; field: UnparsedProblemField; label: string; value: string; explanation: string };

/** Longest invitation text a row carries (subject, values). */
export const UNPARSED_VALUE_MAX = 120;

/**
 * Email to the handling representative about an unparsed invitation (IN-04, SE-12): PENDING open
 * decision #6 (d09). A screen shows it as pending, never as sent. Later states (sent, failed) join
 * this union when the owner decides.
 */
export type UnparsedRepMailState = PendingSetting;

/** An invitation the ingestion service could not ingest (unresolved). */
export type UnparsedInvitation = TestMarker & {
  id: string;
  /** When the invitation (or its latest change) was received. */
  receivedAt: IsoTimestamp;
  /** Where it came from: Microsoft 365 ("outlook", later) or the invitation simulator (SIM-14, "🧪 זימון בדיקה"). */
  source: VisitSource;
  /** Subject as received (starts with the "[קריאת שירות]" prefix), cut to UNPARSED_VALUE_MAX; "" when none was read. */
  subject: string;
  /** The organizer: the representative who sent the invitation; `name` null when the address is not an office user; both null when unknown. */
  organizer: { email: string | null; name: string | null };
  /**
   * The attendees' addresses as received; `technician` is the one technician matched by his Outlook
   * email in Settings, null when none (or more than one) matches.
   */
  attendees: { emails: string[]; technician: Pick<TechnicianRef, "id" | "name" | "color"> | null };
  /** Date and times from the invitation itself (never the body), in Asia/Jerusalem; null when they could not be read. */
  event: { date: IsoDate; start: HourMinute; end: HourMinute } | null;
  /** Values that were read, to recognise the invitation; null when missing or unreadable. */
  requestNumber: string | null;
  customerName: string | null;
  /** Every problem found (at least one). */
  problems: UnparsedProblem[];
  repMail: UnparsedRepMailState;
};

/** Unresolved invitations, newest first, paged. A corrected invitation (same event) that ingests resolves its row. */
export type UnparsedInvitationsPage = Page<UnparsedInvitation>;
