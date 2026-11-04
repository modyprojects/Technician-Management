// Device sync DTOs: the technician's work queue and its honest states (TE-23, TE-24; D06 partial
// offline with manual sync, D46 the work queue, D25 no background jobs). Pure types, labels and
// rules (no data). See features/data-access/common.ts.
// The work queue holds reports, photos, videos, audio, signatures and time reports until the
// server confirms receipt and integrity (`offline_operations`, idempotent operation ids); it is
// never emptied because the workday ended, an assignment was cancelled or access was lost (D46).
// Sync runs while the app is open, on demand ("סנכרן עכשיו") and as safe retries; never a
// scheduled background job (D25), and never a claim of guaranteed background sync.
import type { Bounded, IsoTimestamp, TestMarker } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type { MediaKind, MediaPhase, VisitRef } from "@/features/visits/data/types";

/**
 * TE-23 states, in the order a new item moves through them: saved on the device, waiting for
 * sync, syncing, sent (the server confirmed it). "failed": the last attempt failed; the item stays
 * on the device for a manual retry ("נסה שוב").
 */
export const DEVICE_SYNC_STATES = ["saved-on-device", "pending", "syncing", "sent", "failed"] as const;
export type DeviceSyncState = (typeof DEVICE_SYNC_STATES)[number];

export const isDeviceSyncState = (value: unknown): value is DeviceSyncState =>
  typeof value === "string" && (DEVICE_SYNC_STATES as readonly string[]).includes(value);

/** TE-23 labels. */
export const DEVICE_SYNC_LABELS: Readonly<Record<DeviceSyncState, string>> = {
  "saved-on-device": "נשמר במכשיר",
  pending: "ממתין לסנכרון",
  syncing: "מסתנכרן",
  sent: "נשלח לשרת",
  failed: "נכשל",
};

/**
 * What the close confirmation shows after a closure, step by step, instead of any "email sent"
 * claim (TE-23): the email goes out only after the server accepts the closure (EM-05).
 */
export const DEVICE_SYNC_PROGRESSION: readonly DeviceSyncState[] = ["saved-on-device", "pending", "syncing", "sent"];

/** The state of an item still in the queue (a confirmed item leaves the queue: "sent"). */
export type QueuedOperationState = Exclude<DeviceSyncState, "sent">;

export const QUEUED_OPERATION_STATES: readonly QueuedOperationState[] = ["saved-on-device", "pending", "syncing", "failed"];

/** Kinds of work-queue items (D46: reports, photos, videos, audio, signatures, time reports). */
export const DEVICE_OPERATION_KINDS = ["time-report", "pickup", "summary", "parts", "media", "recording", "close"] as const;
export type DeviceOperationKind = (typeof DEVICE_OPERATION_KINDS)[number];

/** Hebrew labels of the item kinds ("media" is labelled by its photo or video kind). */
export const DEVICE_OPERATION_LABELS: Readonly<Record<DeviceOperationKind, string>> = {
  "time-report": "דיווח זמן",
  pickup: "סימון איסוף",
  summary: "סיכום הטיפול",
  parts: "חלפים",
  media: "תמונה או סרטון",
  recording: "הקלטת סיכום",
  close: "סיום ביקור וחתימה",
};

/** One work-queue item of a visit. */
export type DeviceOperation = TestMarker & {
  /** The device's idempotent operation id (`offline_operations.operation_id`): a retry never duplicates. */
  opId: string;
  ref: VisitRef;
  kind: DeviceOperationKind;
  /** For "media": the photo or video and when it was taken; otherwise null. */
  media: { kind: MediaKind; when: MediaPhase } | null;
  state: QueuedOperationState;
  /** Device time the item was saved (D45: a reported value). */
  savedAt: IsoTimestamp;
  /** Send attempts so far (safe retries with backoff, D46). */
  attempts: number;
  lastAttemptAt: IsoTimestamp | null;
  /** Short Hebrew reason of the last failure ("failed" only); never a stack trace. */
  error: string | null;
  /** Size of a file item in bytes; null for a record. */
  sizeBytes: number | null;
};

/** Cap of the queue items listed per visit; `total` gives the rest. */
export const VISIT_OPERATIONS_LIMIT = 20;

/** Cap of the visits a device snapshot lists; `total` gives the rest. */
export const DEVICE_SYNC_VISITS_LIMIT = 30;

/**
 * A visit's sync state on the device: the most urgent state of its queue items (visitSyncState),
 * or "sent" when the queue holds nothing for it and the server confirmed it (`confirmedAt`).
 */
export type VisitDeviceSync = TestMarker &
  VisitRef & {
    state: DeviceSyncState;
    /** Items still in the queue, oldest first. */
    operations: Bounded<DeviceOperation>;
    /** The server's last confirmation for this visit; null when nothing was confirmed yet. */
    confirmedAt: IsoTimestamp | null;
  };

/** The device's queue as the technician home shows it (the pending-operations banner and the pills). */
export type DeviceSyncSnapshot = TestMarker & {
  technicianId: TechnicianId;
  /** The last completed sync; null when the device never synced. */
  lastSyncAt: IsoTimestamp | null;
  /** Queue items per state (every visit). */
  counts: Readonly<Record<QueuedOperationState, number>>;
  /** Visits with queue items first (failed, then the others), then recently confirmed ones. */
  visits: Bounded<VisitDeviceSync>;
};

const URGENCY: readonly QueuedOperationState[] = ["failed", "syncing", "pending", "saved-on-device"];

/** A visit's state from its queue items: failed, else syncing, else pending, else saved on device; "sent" when none. */
export function visitSyncState(operations: readonly { state: QueuedOperationState }[]): DeviceSyncState {
  return URGENCY.find((s) => operations.some((o) => o.state === s)) ?? "sent";
}

/** "נסה שוב" (TE-24): one failed item. */
export type SyncRetryInput = { opId: string };
