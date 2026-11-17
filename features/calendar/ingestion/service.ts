// The single entry point of calendar ingestion (SIM-06, D08, D24): every adapter (the Outlook
// invitation simulator now, the Microsoft Graph adapter later) calls ingestInvitation with a
// normalized event and a store. The pure plan decides "ignored", "rejected" or one command; the
// store runs the command in one database transaction (lib/calendar, private.ingest_calendar_event),
// which is where idempotency is enforced. decideDelivery states that rule in TypeScript, as the
// contract the database implements and the unit tests check.
import type { IsoTimestamp } from "@/features/data-access/common";
import { planIngestion } from "./plan";
import type { InvitationTemplate } from "./template";
import type { IngestionResult, IngestionStore } from "./types";

/** Runs one invitation event through the service. */
export async function ingestInvitation(
  input: unknown,
  store: IngestionStore,
  template?: InvitationTemplate,
): Promise<IngestionResult> {
  const plan = planIngestion(input, template);
  if (plan.kind !== "command") return plan;
  const outcome = await store.apply(plan.command);
  return { kind: "ingested", command: plan.command.kind, outcome };
}

/** What the database already holds for one event (`external_calendar_events`, `calendar_event_changes`). */
export type DeliveryState = {
  /** The change time of the newest change processed for the event (null: none yet). */
  lastChangedAt: IsoTimestamp | null;
  /** Payload hash of every change key received for the event. */
  received: ReadonlyMap<string, string>;
};

/** One incoming change of that event. */
export type IncomingDelivery = { changeKey: string; changedAt: IsoTimestamp; payloadSha256: string };

/**
 * The idempotency and ordering rule (database-schema.md §10; Migration 6 section 6):
 *   - "replay": the change key was received before with the same payload: the stored outcome is
 *     returned and nothing changes (a duplicate delivery never duplicates anything);
 *   - "conflict": the change key was received before with another payload: refused (23505);
 *   - "stale": a new change key whose change time is not after the newest one processed (an
 *     out-of-order older change, or an equal time with another key): recorded, never applied;
 *   - "new": processed.
 */
export function decideDelivery(state: DeliveryState, incoming: IncomingDelivery): "new" | "replay" | "conflict" | "stale" {
  const known = state.received.get(incoming.changeKey);
  if (known !== undefined) return known === incoming.payloadSha256 ? "replay" : "conflict";
  if (state.lastChangedAt !== null && Date.parse(incoming.changedAt) <= Date.parse(state.lastChangedAt)) return "stale";
  return "new";
}
