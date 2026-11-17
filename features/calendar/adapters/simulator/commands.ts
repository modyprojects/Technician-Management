// The Outlook invitation simulator (D24, SIM-02 to SIM-07): builds normalized invitation events
// for the single ingestion service, exactly as the Microsoft Graph adapter will (SIM-06: no
// separate business logic for simulated visits). Pure: the server passes the clock and the id
// source. Every request is validated with Zod before anything reaches the database.
//
// Actions (SIM-02 to SIM-05):
//   create      a new simulated invitation (a new event id);
//   update, reschedule, reassign
//               a new version of an existing simulated invitation: the full current snapshot
//               under the same event id (as a Graph update). The names say what the person
//               changed; the service finds the difference itself (time, technician, other fields);
//   cancel      the invitation was deleted (what happens to the visit: open decision 5, see
//               Migration 6; for a visit en route or in progress: review, D39);
//   invalid     an invitation with missing or invalid values (new, or a version of an existing
//               one); it is listed on "זימונים שלא נקלטו" with its reasons (S-05);
//   duplicate   delivers an event built before again, unchanged (same change key): a replay
//               that changes nothing. Delivering an older change after a newer one simulates an
//               out-of-order delivery, which is recorded and ignored.
// Every record the simulator creates is test data (D47): the database marks it from the source.
import { z } from "zod";
import { invitationEventSchema, MAX_ATTENDEES } from "@/features/calendar/ingestion/event";
import { MAX_BODY_LENGTH } from "@/features/calendar/ingestion/parse";
import type { InvitationEvent } from "@/features/calendar/ingestion/types";

/** The calendar id of every simulated event. */
export const SIMULATOR_CALENDAR_ID = "simulator";

/** Simulated event ids and change keys: "sim-" and a UUID (never a Microsoft Graph id). */
const SIM_ID = /^sim-[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/;
export const isSimulatorId = (value: string): boolean => SIM_ID.test(value);

const simId = z.string().regex(SIM_ID);

/** What a person types in the simulator (the demo's Outlook modal, X-05). */
export const simulatedInvitationSchema = z.object({
  subject: z.string().max(1000),
  organizerEmail: z.string().max(320).nullable(),
  attendeeEmails: z.array(z.string().max(320)).max(MAX_ATTENDEES),
  /** ISO 8601 with an offset (the screen converts its date and times, Asia/Jerusalem). */
  start: z.string().max(64),
  end: z.string().max(64),
  body: z.string().max(MAX_BODY_LENGTH * 2),
});
export type SimulatedInvitation = z.infer<typeof simulatedInvitationSchema>;

const simulatedEventSchema = invitationEventSchema.refine(
  (event) =>
    event.source === "simulator" &&
    event.calendarId === SIMULATOR_CALENDAR_ID &&
    SIM_ID.test(event.eventId) &&
    SIM_ID.test(event.changeKey),
  "not a simulated event",
);

export const simulatorRequestSchema = z.discriminatedUnion("action", [
  z.object({ action: z.literal("create"), invitation: simulatedInvitationSchema }),
  z.object({ action: z.literal("update"), eventId: simId, invitation: simulatedInvitationSchema }),
  z.object({ action: z.literal("reschedule"), eventId: simId, invitation: simulatedInvitationSchema }),
  z.object({ action: z.literal("reassign"), eventId: simId, invitation: simulatedInvitationSchema }),
  z.object({ action: z.literal("invalid"), eventId: simId.optional(), invitation: simulatedInvitationSchema }),
  z.object({ action: z.literal("cancel"), eventId: simId }),
  z.object({ action: z.literal("duplicate"), event: simulatedEventSchema }),
]);
export type SimulatorRequest = z.infer<typeof simulatorRequestSchema>;
export type SimulatorAction = SimulatorRequest["action"];

export type SimulatorDeps = {
  /** The server's clock (the change time of a new version). */
  now: () => Date;
  /** A new random UUID (event ids and change keys). */
  newId: () => string;
};

/** The request, or null when it is malformed (no detail is echoed). */
export function parseSimulatorRequest(input: unknown): SimulatorRequest | null {
  const parsed = simulatorRequestSchema.safeParse(input);
  return parsed.success ? parsed.data : null;
}

/** The normalized event for a simulator request. A duplicate is returned exactly as given. */
export function buildSimulatorEvent(request: SimulatorRequest, deps: SimulatorDeps): InvitationEvent {
  if (request.action === "duplicate") return request.event;
  const eventId = request.action === "create" || (request.action === "invalid" && !request.eventId)
    ? `sim-${deps.newId()}`
    : request.eventId!;
  const envelope = {
    source: "simulator" as const,
    calendarId: SIMULATOR_CALENDAR_ID,
    eventId,
    changeKey: `sim-${deps.newId()}`,
    changedAt: deps.now().toISOString(),
  };
  if (request.action === "cancel") return { ...envelope, change: { type: "delete" } };
  const invitation = request.invitation;
  return {
    ...envelope,
    change: {
      type: "upsert",
      subject: invitation.subject,
      organizerEmail: invitation.organizerEmail,
      attendeeEmails: invitation.attendeeEmails,
      start: invitation.start,
      end: invitation.end,
      body: invitation.body,
    },
  };
}
