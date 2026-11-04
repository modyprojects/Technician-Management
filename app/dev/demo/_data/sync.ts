// FICTITIOUS DATA ONLY: the demo technician's device work queue (TE-23, TE-24; D06, D46). Allowed
// only under app/dev (G-05). Server-side, and only for the fixture adapter: screens read it through
// demoDataAccess.sync. In production the queue lives on the device (the offline module, Step 4).
// יורם's closures of 20.10 were accepted by the server; three files of two of those visits are
// still on his phone: two waiting for the next sync and one that failed three times (a manual
// "נסה שוב"). The files are not among the visits' media on the server (the office sees only what
// arrived). His visits of today have no device work yet. Times are ISO, +03:00.
import "server-only";
import type { DeviceOperationKind, QueuedOperationState } from "@/features/sync/data/types";
import type { MediaKind, MediaPhase } from "@/features/visits/data/types";
import type { TechId } from "./types";

export type DemoDeviceOperation = {
  opId: string;
  req: string;
  n: number;
  kind: DeviceOperationKind;
  media: { kind: MediaKind; when: MediaPhase } | null;
  state: QueuedOperationState;
  savedAt: string;
  attempts: number;
  lastAttemptAt: string | null;
  error: string | null;
  sizeBytes: number | null;
};

export type DemoDeviceQueue = {
  lastSyncAt: string | null;
  /** Still in the queue. */
  operations: readonly DemoDeviceOperation[];
  /** Visits whose items the server confirmed, with the last confirmation. */
  confirmed: readonly { req: string; n: number; at: string }[];
};

export const DEVICE_QUEUES: Readonly<Partial<Record<TechId, DemoDeviceQueue>>> = {
  y: {
    lastSyncAt: "2026-10-20T16:32:00+03:00",
    operations: [
      {
        opId: "op-47963-1-img2",
        req: "47963",
        n: 1,
        kind: "media",
        media: { kind: "img", when: "after" },
        state: "failed",
        savedAt: "2026-10-20T14:41:00+03:00",
        attempts: 3,
        lastAttemptAt: "2026-10-20T16:32:00+03:00",
        error: "ההעלאה נכשלה · הקובץ לא הגיע שלם לשרת",
        sizeBytes: 3_400_000,
      },
      {
        opId: "op-47964-1-img2",
        req: "47964",
        n: 1,
        kind: "media",
        media: { kind: "img", when: "after" },
        state: "pending",
        savedAt: "2026-10-20T16:30:00+03:00",
        attempts: 1,
        lastAttemptAt: "2026-10-20T16:33:00+03:00",
        error: null,
        sizeBytes: 2_900_000,
      },
      {
        opId: "op-47964-1-vid1",
        req: "47964",
        n: 1,
        kind: "media",
        media: { kind: "vid", when: "after" },
        state: "pending",
        savedAt: "2026-10-20T16:30:00+03:00",
        attempts: 1,
        lastAttemptAt: "2026-10-20T16:33:00+03:00",
        error: null,
        sizeBytes: 48_000_000,
      },
    ],
    confirmed: [
      { req: "47960", n: 1, at: "2026-10-20T08:57:00+03:00" },
      { req: "47961", n: 1, at: "2026-10-20T10:36:00+03:00" },
      { req: "47962", n: 1, at: "2026-10-20T12:34:00+03:00" },
      { req: "47963", n: 1, at: "2026-10-20T14:45:00+03:00" },
      { req: "47964", n: 1, at: "2026-10-20T16:32:00+03:00" },
    ],
  },
};
