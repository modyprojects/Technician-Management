// Device sync ports (TE-23, TE-24; D06, D46). The work queue lives on the device: in production
// these are implemented on the client by the offline module (Step 4) over the device's queue, and
// the server keeps one idempotency record per operation (`offline_operations`). The UI demo serves
// fixture states through app/dev/demo/_data/adapter.ts (queries) and simulates the commands in
// app/dev/demo/_components/SimulatedCommands.tsx, so pages pass DTO props as everywhere else.
// `techId` is a filter, not identity: the device belongs to the signed-in technician (G-03).
import type { CommandResult } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type { VisitRef } from "@/features/visits/data/types";
import type { DeviceSyncSnapshot, SyncRetryInput, VisitDeviceSync } from "./types";

export interface DeviceSyncQueries {
  /** The technician's device queue: counts per state, the last sync and the visits; null for an unknown technician. */
  device(techId: TechnicianId): Promise<DeviceSyncSnapshot | null>;
  /** One visit's sync state on the device; null when the device holds nothing about it (no pill). */
  visit(techId: TechnicianId, ref: VisitRef): Promise<VisitDeviceSync | null>;
}

/**
 * Manual sync (D06) and retries (TE-24). Never scheduled (D25). A retry reuses the item's
 * operation id, so the server never stores it twice.
 */
export interface SyncCommands {
  /** "סנכרן עכשיו": sends every item still in the queue; returns how many it attempted. */
  now(): Promise<CommandResult<{ attempted: number }>>;
  /** "נסה שוב": sends one failed item again. Rejected for an unknown item or one that did not fail. */
  retry(input: SyncRetryInput): Promise<CommandResult>;
}
