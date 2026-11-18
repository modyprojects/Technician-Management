// Types of the single calendar ingestion service (Step 6; D08, D18, D19, D24, D39, D47; S-05,
// X-01, X-03). One normalized invitation event comes in from an adapter (the Outlook invitation
// simulator now, the Microsoft Graph adapter later); the pure core (./parse.ts, ./plan.ts) turns
// it into one database command or an "ignored" result; the store (lib/calendar) runs the command
// in one database transaction (private.ingest_calendar_event, Migration 6), which owns idempotency,
// ordering, lookups, D39 review routing and test marking. Pure types: no data, no I/O.
import type { IsoDate, IsoTimestamp } from "@/features/data-access/common";
import type { TemplateFieldKey } from "@/features/settings/data/types";

/**
 * Where an invitation comes from (`external_calendar_events.data_source`). Only the simulator until
 * an approved Step 11 migration adds Microsoft Graph (D23, D24; fail closed).
 */
export const INGESTION_SOURCES = ["simulator"] as const;
export type IngestionSource = (typeof INGESTION_SOURCES)[number];

/** The event a calendar adapter delivers: a created or changed invitation, or its deletion. */
export type InvitationEvent = {
  source: IngestionSource;
  /** The calendar (mailbox) the event lives in; "simulator" for simulated events. */
  calendarId: string;
  /** The calendar's event id: identifies the invitation across updates, re-assignment and deletion. */
  eventId: string;
  /**
   * Identifies this version of the event (Graph `changeKey`; the simulator draws a new one for every
   * change). The same key delivered again is a replay and changes nothing.
   */
  changeKey: string;
  /** When this version was made at the source (Graph `lastModifiedDateTime`); orders the changes. */
  changedAt: IsoTimestamp;
  change: InvitationUpsert | InvitationDeletion;
};

/** A created, updated, rescheduled or re-assigned invitation: the full current snapshot. */
export type InvitationUpsert = {
  type: "upsert";
  subject: string;
  /** The representative who sent it; null when the source does not say. */
  organizerEmail: string | null;
  /** Every attendee; the technician is matched by his Outlook email (D18, SE-05). */
  attendeeEmails: string[];
  /** Date and times come from the invitation itself, never from the body. */
  start: IsoTimestamp;
  end: IsoTimestamp;
  /** The body as plain text (an adapter converts HTML to text first). */
  body: string;
};

/** The invitation was deleted (cancelled) at the source. */
export type InvitationDeletion = { type: "delete" };

/** Where a problem was found: a template field, or a part of the event itself. */
export type ProblemField = TemplateFieldKey | "subject" | "attendee" | "organizer" | "schedule" | "body";

/** Why a value is invalid (machine-readable; the screen maps each code to Hebrew). */
export const INVALID_RULES = [
  "format",
  "length",
  "duplicate_label",
  "warranty_format",
  "unknown_call_type",
  "end_before_start",
  "too_many_attendees",
] as const;
export type InvalidRule = (typeof INVALID_RULES)[number];

/** Why an invitation conflicts with what is stored (machine-readable). */
export const CONFLICT_RULES = ["request_number_changed", "real_service_call", "real_customer", "real_product"] as const;
export type ConflictRule = (typeof CONFLICT_RULES)[number];

/**
 * One reason an invitation was not ingested (S-05: "an unparsed invitation shows the reason and the
 * information needed to fix it"). `value` is the text read, sanitized (./text.ts sanitizeForReport).
 * An unknown SKU is never a problem: the product is created (D19, IN-02).
 */
export type IngestionProblem =
  | { kind: "missing"; field: ProblemField }
  | { kind: "invalid"; field: ProblemField; rule: InvalidRule; value: string | null }
  | { kind: "unknown_place"; field: "collectFrom"; value: string | null }
  | { kind: "unknown_technician"; field: "attendee"; value: string | null }
  | { kind: "inactive_technician"; field: "attendee"; value: string | null }
  | { kind: "ambiguous_technician"; field: "attendee"; value: string | null }
  | { kind: "conflict"; field: ProblemField; rule: ConflictRule; value: string | null };

export type IngestionProblemKind = IngestionProblem["kind"];

/** Warranty as parsed (D17 optional, D42 expiry month; TEMPORARY Migration 3 OQ-7). */
export type ParsedWarranty = {
  status: "yes" | "no";
  /** First day of the expiry month, or null. */
  until: IsoDate | null;
  /** The text as written. */
  raw: string;
};

/** Every template field of a valid invitation, validated against the database's formats. */
export type ParsedInvitationFields = {
  requestNumber: string;
  taskNumber: string;
  handlingRepName: string;
  customerNumber: string;
  customerName: string;
  phone: string;
  phoneAlt: string | null;
  city: string;
  street: string;
  building: string | null;
  floor: string | null;
  apartment: string | null;
  arrivalNotes: string | null;
  callType: string;
  productName: string;
  /** The SKU as written, trimmed (`products.sku_display`). */
  sku: string;
  /** Trimmed and upper-cased (D19, PR-07; `products.sku_normalized`). */
  skuNormalized: string;
  faultDescription: string;
  warranty: ParsedWarranty | null;
  pickupItem: string | null;
  pickupLocation: string | null;
  techNotes: string | null;
};

/** The parts of the event every command carries (sanitized for the unparsed list). */
export type CommandEvent = {
  subject: string | null;
  organizerEmail: string | null;
  attendeeEmails: string[];
  start: IsoTimestamp | null;
  end: IsoTimestamp | null;
};

/** Identity and delivery of one change (the idempotency key is source + calendar + event + change key). */
export type CommandDelivery = {
  source: IngestionSource;
  calendarId: string;
  eventId: string;
  changeKey: string;
  changedAt: IsoTimestamp;
};

/** What the store runs: one change of one invitation. */
export type IngestionCommand =
  | (CommandDelivery & { kind: "upsert"; event: CommandEvent & { start: IsoTimestamp; end: IsoTimestamp }; fields: ParsedInvitationFields })
  | (CommandDelivery & {
      kind: "unparsed";
      event: CommandEvent;
      problems: IngestionProblem[];
      /** Values read to recognise the invitation on the list (null when missing or unreadable). */
      recognised: { requestNumber: string | null; customerName: string | null };
    })
  | (CommandDelivery & { kind: "delete" });

/** The stored outcome of a change (`calendar_event_changes.outcome`). */
export const INGESTION_OUTCOMES = ["applied", "review", "unparsed", "stale", "no_effect"] as const;
export type IngestionOutcomeCode = (typeof INGESTION_OUTCOMES)[number];

/** What the database answered for one change. */
export type IngestionOutcome = {
  outcome: IngestionOutcomeCode;
  /** True when this exact change was received before: the stored outcome is returned, nothing changes. */
  replay: boolean;
  changeId: string;
  requestNumber: string | null;
  visitNumber: number | null;
  serviceCallId: string | null;
  visitId: string | null;
  /** Review items this change opened (D39, D44). */
  reviewItems: number;
  /** Fields applied by this change (for example "visits.scheduled_start", "customers.phone"). */
  appliedFields: string[];
  problems: IngestionProblem[];
};

/** What the single entry point returns. */
export type IngestionResult =
  | { kind: "ignored"; reason: "not-a-service-call" }
  | { kind: "rejected"; issues: string[] }
  | { kind: "ingested"; command: IngestionCommand["kind"]; outcome: IngestionOutcome };

/** The database side of the service (implemented in lib/calendar under the caller's session). */
export interface IngestionStore {
  apply(command: IngestionCommand): Promise<IngestionOutcome>;
}
