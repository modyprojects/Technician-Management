// The pure core of the single ingestion service (SIM-06): one normalized invitation event in, one
// database command (or "ignored" / "rejected") out. No I/O and no clock: the same event always gives
// the same command, so a redelivered event is a byte-identical replay that the database recognises
// (docs/security.md §9: stable simulated event ids make replays idempotent).
import { parseInvitationEvent } from "./event";
import { parseInvitationBody } from "./parse";
import { effectiveTemplate, type InvitationTemplate } from "./template";
import { isNormalizedEmail, normalizeEmail, sanitizeForReport } from "./text";
import type { CommandDelivery, CommandEvent, IngestionCommand, IngestionProblem, InvitationEvent } from "./types";

/** Longest subject stored for the unparsed list (`calendar_ingestion_errors.subject`). */
export const MAX_SUBJECT_LENGTH = 255;

export type IngestionPlan =
  | { kind: "ignored"; reason: "not-a-service-call" }
  | { kind: "rejected"; issues: string[] }
  | { kind: "command"; command: IngestionCommand };

/** The canonical form of a timestamp (UTC, milliseconds), so equal instants give equal commands. */
function canonicalInstant(value: string): string | null {
  const ms = Date.parse(value);
  if (!Number.isFinite(ms)) return null;
  const year = new Date(ms).getUTCFullYear();
  // A visit is planned within a sane range (the database also refuses infinite values).
  if (year < 2000 || year > 2100) return null;
  return new Date(ms).toISOString();
}

const ISO_WITH_OFFSET = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

function delivery(event: InvitationEvent): CommandDelivery {
  return {
    source: event.source,
    calendarId: event.calendarId,
    eventId: event.eventId,
    changeKey: event.changeKey,
    changedAt: canonicalInstant(event.changedAt) ?? event.changedAt,
  };
}

/**
 * Plans one event. Deletions need nothing more. An upsert whose subject does not start with the
 * template prefix is not a service call and is ignored (like every other meeting, SE-13). Problems
 * of the event (schedule, attendees) and of the body are collected together: an invitation with
 * any problem becomes one "unparsed" command, which the database lists on "זימונים שלא נקלטו".
 */
export function planIngestion(input: unknown, template?: InvitationTemplate): IngestionPlan {
  const parsed = parseInvitationEvent(input);
  if (!parsed.ok) return { kind: "rejected", issues: parsed.issues };
  const event = parsed.event;
  const base = delivery(event);
  if (canonicalInstant(event.changedAt) === null) return { kind: "rejected", issues: ["changedAt: out_of_range"] };
  if (event.change.type === "delete") return { kind: "command", command: { ...base, kind: "delete" } };

  const effective = effectiveTemplate(template);
  const change = event.change;
  const subject = change.subject.normalize("NFC").trim();
  if (!subject.startsWith(effective.subjectPrefix)) return { kind: "ignored", reason: "not-a-service-call" };

  const problems: IngestionProblem[] = [];

  const organizer = change.organizerEmail === null ? null : normalizeEmail(change.organizerEmail);
  const organizerEmail = organizer !== null && isNormalizedEmail(organizer) ? organizer : null;

  const attendees = [...new Set(change.attendeeEmails.map(normalizeEmail))];
  const invalidAttendee = attendees.find((email) => !isNormalizedEmail(email));
  if (attendees.length === 0) problems.push({ kind: "missing", field: "attendee" });
  else if (invalidAttendee !== undefined) {
    problems.push({ kind: "invalid", field: "attendee", rule: "format", value: sanitizeForReport(invalidAttendee) });
  }
  const attendeeEmails = invalidAttendee === undefined ? attendees : attendees.filter(isNormalizedEmail);

  const start = ISO_WITH_OFFSET.test(change.start) ? canonicalInstant(change.start) : null;
  const end = ISO_WITH_OFFSET.test(change.end) ? canonicalInstant(change.end) : null;
  if (start === null || end === null) {
    problems.push({ kind: "invalid", field: "schedule", rule: "format", value: sanitizeForReport(`${change.start} – ${change.end}`) });
  } else if (Date.parse(end) < Date.parse(start)) {
    problems.push({ kind: "invalid", field: "schedule", rule: "end_before_start", value: null });
  }

  const commandEvent: CommandEvent = {
    subject: sanitizeForReport(subject, MAX_SUBJECT_LENGTH),
    organizerEmail,
    attendeeEmails,
    start: start !== null && end !== null ? start : null,
    end: start !== null && end !== null ? end : null,
  };

  const body = parseInvitationBody(change.body, effective);
  if (!body.ok) problems.push(...body.problems);

  if (problems.length > 0 || !body.ok || commandEvent.start === null || commandEvent.end === null) {
    return {
      kind: "command",
      command: {
        ...base,
        kind: "unparsed",
        event: commandEvent,
        problems,
        recognised: body.ok
          ? { requestNumber: body.fields.requestNumber, customerName: body.fields.customerName }
          : body.recognised,
      },
    };
  }
  return {
    kind: "command",
    command: { ...base, kind: "upsert", event: { ...commandEvent, start: commandEvent.start, end: commandEvent.end }, fields: body.fields },
  };
}

/**
 * The command as the database function reads it (private.ingest_calendar_event, Migration 6):
 * snake_case keys, every field present (null when absent), problems as stored. Deterministic.
 */
export function toDatabaseCommand(command: IngestionCommand): Record<string, unknown> {
  const head = {
    source: command.source,
    calendar_id: command.calendarId,
    event_id: command.eventId,
    change_key: command.changeKey,
    changed_at: command.changedAt,
    kind: command.kind,
  };
  if (command.kind === "delete") return { ...head, event: null, fields: null, problems: null, recognised: null };
  const event = {
    subject: command.event.subject,
    organizer_email: command.event.organizerEmail,
    attendee_emails: command.event.attendeeEmails,
    start: command.event.start,
    end: command.event.end,
  };
  if (command.kind === "unparsed") {
    return {
      ...head,
      event,
      fields: null,
      problems: command.problems,
      recognised: { request_number: command.recognised.requestNumber, customer_name: command.recognised.customerName },
    };
  }
  const f = command.fields;
  return {
    ...head,
    event,
    fields: {
      request_number: f.requestNumber,
      task_number: f.taskNumber,
      handling_rep_name: f.handlingRepName,
      customer_number: f.customerNumber,
      customer_name: f.customerName,
      phone: f.phone,
      phone_alt: f.phoneAlt,
      city: f.city,
      street: f.street,
      building: f.building,
      floor: f.floor,
      apartment: f.apartment,
      arrival_notes: f.arrivalNotes,
      call_type: f.callType,
      product_name: f.productName,
      sku: f.sku,
      fault_description: f.faultDescription,
      warranty_status: f.warranty?.status ?? null,
      warranty_until: f.warranty?.until ?? null,
      warranty_raw: f.warranty?.raw ?? null,
      pickup_item: f.pickupItem,
      pickup_location: f.pickupLocation,
      tech_notes: f.techNotes,
    },
    problems: null,
    recognised: null,
  };
}
