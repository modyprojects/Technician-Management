// What the technician pages' simulated sync commands check (SimulatedServerState.deviceQueue): the
// demo technician's device work queue, read through the data-access layer (sync.device). In
// production the queue lives on the device and the offline module checks it itself (D46); the
// server keeps the idempotency record per operation (`offline_operations`).
import type { SimulatedServerState } from "../_components/SimulatedCommands";
import { demoDataAccess } from "../_data/adapter";
import { DEMO_TECHNICIAN_ID } from "../_data/roles";

/** The queue items by operation id (state only): "נסה שוב" only for a failed one, "סנכרן עכשיו" with the queue. */
export async function deviceQueueState(): Promise<SimulatedServerState> {
  const snapshot = await demoDataAccess.sync.device(DEMO_TECHNICIAN_ID);
  if (!snapshot) return {};
  return {
    deviceQueue: Object.fromEntries(
      snapshot.visits.items.flatMap((v) => v.operations.items.map((o) => [o.opId, { state: o.state }] as const)),
    ),
  };
}
