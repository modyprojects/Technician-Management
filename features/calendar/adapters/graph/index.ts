// Microsoft Graph adapter: the boundary only (D08, D18, D23; ROADMAP Step 6 "Graph adapter
// boundary only"; Step 11 builds it after Microsoft 365 exists and the owner and IT approve).
// No network code, no credentials, no subscription and no polling here: the real adapter receives
// Graph change notifications (event-driven, never polling, D08), validates the subscription and
// clientState, fetches the changed event server-side, converts it to the normalized
// InvitationEvent and calls the same ingestInvitation entry point as the simulator (SIM-06). It is
// read-only towards Outlook: it never writes to a calendar (X-08).
// Adding "microsoft_graph" as a source needs an approved Step 11 migration (the database accepts
// only "simulator" and "automated_test" until then: fail closed, D23).
import type { IsoTimestamp } from "@/features/data-access/common";
import type { IngestionResult, InvitationEvent } from "@/features/calendar/ingestion/types";

/** One Graph change notification as the webhook receives it (the fields the adapter will read). */
export type GraphChangeNotification = {
  subscriptionId: string;
  clientState: string;
  changeType: "created" | "updated" | "deleted";
  /** The changed resource, for example "users/{id}/events/{id}". */
  resource: string;
  subscriptionExpirationDateTime: IsoTimestamp;
};

/** The parts of a Graph event the adapter will map to an InvitationEvent. */
export type GraphEventSnapshot = {
  id: string;
  changeKey: string;
  lastModifiedDateTime: IsoTimestamp;
  subject: string;
  organizer: { emailAddress: { address: string } } | null;
  attendees: { emailAddress: { address: string } }[];
  start: { dateTime: string; timeZone: string };
  end: { dateTime: string; timeZone: string };
  body: { contentType: "text" | "html"; content: string };
  isCancelled: boolean;
};

/** What Step 11 implements. Nothing implements it now. */
export interface GraphCalendarAdapter {
  /** Validates one notification and returns the normalized event to ingest, or null to skip it. */
  toInvitationEvent(notification: GraphChangeNotification): Promise<InvitationEvent | null>;
  /** Runs the event through the single ingestion service. */
  ingest(event: InvitationEvent): Promise<IngestionResult>;
}

/** The adapter is not built: true only after Step 11. */
export const GRAPH_ADAPTER_AVAILABLE = false;
