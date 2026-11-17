// Zod schema of the normalized invitation event (./types.ts InvitationEvent), shared by every
// adapter: the simulator validates its requests with it before anything reaches the database
// (docs/security.md §9: "Inputs validated with the same Zod schemas as the ingestion service").
// Envelope errors (a malformed id, time or list) reject the event; problems inside the invitation
// (subject, schedule, attendees, body) are not envelope errors: they become an "unparsed" record.
import { z } from "zod";
import { MAX_BODY_LENGTH } from "./parse";
import { isOpaqueId } from "./text";
import { INGESTION_SOURCES, type InvitationEvent } from "./types";

/** ISO 8601 with seconds and an explicit offset (the database's timestamptz input). */
const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(\.\d{1,6})?(Z|[+-]\d{2}:\d{2})$/;

export const isoTimestampSchema = z
  .string()
  .regex(ISO_TIMESTAMP)
  .refine((value) => Number.isFinite(Date.parse(value)), "invalid timestamp");

const opaque = (max: number) => z.string().refine((value) => isOpaqueId(value, max), "invalid identifier");

/** Attendees per invitation the service reads (more is refused as an envelope error). */
export const MAX_ATTENDEES = 20;

const upsertSchema = z.object({
  type: z.literal("upsert"),
  subject: z.string().max(1000),
  organizerEmail: z.string().max(320).nullable(),
  attendeeEmails: z.array(z.string().max(320)).max(MAX_ATTENDEES),
  // Checked later as an invitation problem ("schedule"), so a bad time is listed, not lost.
  start: z.string().max(64),
  end: z.string().max(64),
  body: z.string().max(MAX_BODY_LENGTH * 2),
});

const deletionSchema = z.object({ type: z.literal("delete") });

export const invitationEventSchema = z.object({
  source: z.enum(INGESTION_SOURCES),
  calendarId: opaque(256),
  eventId: opaque(512),
  changeKey: opaque(512),
  changedAt: isoTimestampSchema,
  change: z.discriminatedUnion("type", [upsertSchema, deletionSchema]),
}) satisfies z.ZodType<InvitationEvent>;

/** The event, or the envelope issues (paths and codes only: never a value). */
export function parseInvitationEvent(input: unknown): { ok: true; event: InvitationEvent } | { ok: false; issues: string[] } {
  const parsed = invitationEventSchema.safeParse(input);
  if (parsed.success) return { ok: true, event: parsed.data };
  return { ok: false, issues: parsed.error.issues.map((issue) => `${issue.path.join(".") || "event"}: ${issue.code}`) };
}
