// Input checks for the device sync commands (TE-24), shared by every implementation (simulated
// now, the offline module later). Each error is a short Hebrew message, or null when valid.
import { isUuid } from "@/features/data-access/common";
import type { QueuedOperationState, SyncRetryInput } from "./types";

const KEY = /^[A-Za-z0-9-]{1,64}$/;

/** Operation ids: the device's UUIDs in production, fixture keys in the demo. */
export const isOperationId = (value: unknown): value is string => isUuid(value) || (typeof value === "string" && KEY.test(value));

/** The device's queue as the commands check it: state per operation id (undefined: unavailable). */
export type DeviceQueueStored = Readonly<Record<string, { state: QueuedOperationState }>>;

/** "סנכרן עכשיו": deny by default when the queue is not available. */
export function syncNowError(queue: DeviceQueueStored | undefined): string | null {
  return queue ? null : "התור במכשיר לא זמין";
}

/** "נסה שוב": a valid id of an item in the queue whose last attempt failed. */
export function syncRetryError(input: SyncRetryInput, stored: { state: QueuedOperationState } | undefined): string | null {
  if (!input || typeof input !== "object" || !isOperationId(input.opId)) return "פעולה לא תקינה";
  if (!stored) return "הפעולה לא נמצאה במכשיר";
  return stored.state === "failed" ? null : "אפשר לנסות שוב רק פעולה שנכשלה";
}
