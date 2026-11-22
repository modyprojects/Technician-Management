// The visit's data kept on the device (D46; D95 as corrected by the owner 22.11: Version 1 is
// online only, D06): "הגעתי" and the closure, with its photos and signature, are stored on the
// device first and sent only when the technician acts (the tap itself, or "שלח שוב"). Pure engine
// over two ports, so the ordering, resend, persistence and error rules are unit-tested without a
// browser: a store (IndexedDB on the device, features/visit-flow/idb.ts) and the server API (the
// server actions of lib/actions/visit-flow.ts).
// Rules:
// - Every operation carries its own stable operation_id, created once when it is stored; the
//   Migration 7 writers are idempotent, so a resend returns the stored outcome (never twice).
// - Order per visit: arrive → media (add_visit_media → upload to the returned path →
//   confirm_visit_media) → close. A visit's later items wait while an earlier one is not done.
// - A missing connection stops the send and keeps everything. A refusal (PT409, 55000, 42501,
//   22023, 23505 …) keeps the item with its error, shown inline; nothing is ever dropped. An item
//   is deleted from the device only after the server confirmed it.
// - No automatic sending: no `online` event, no app-open run, no timers.
// - Values a later item needs from an earlier one are written into the later item before the
//   earlier one is removed: the field_version after "הגעתי" (the closure's expected version) and
//   the signature's media id. Once written they never change, so a resend hashes the same payload.
import type { CloseOutcome, MediaMime, PhotoPhase } from "./rules";

/** The device's clock values sent with each action (D45: reported values, not proof; the time of the tap). */
export type DeviceClock = { reportedAt: string; deviceTz: string; deviceUtcOffsetMin: number };

/** The device's time zone and UTC offset now, in the database's accepted form. */
export function deviceClock(now: Date = new Date()): DeviceClock {
  let tz = "UTC";
  try {
    const resolved = Intl.DateTimeFormat().resolvedOptions().timeZone;
    if (resolved && resolved.length <= 64 && /^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/.test(resolved)) tz = resolved;
  } catch {
    // keep UTC
  }
  const offset = Math.max(-840, Math.min(840, -now.getTimezoneOffset()));
  return { reportedAt: now.toISOString(), deviceTz: tz, deviceUtcOffsetMin: offset };
}

/** A refusal kept on an item (the database's code, or the action's own rule). */
export type QueueErrorCode =
  | "PT409"
  | "55000"
  | "42501"
  | "22023"
  | "23505"
  | "limit"
  | "after-required"
  | "invalid"
  | "upload"
  | "unknown";

type ItemBase = {
  /** Store key, assigned when the item is added; the queue's order. */
  seq: number;
  /** The signed-in user who queued it; only that user's session sends it. */
  userId: string;
  visitId: string;
  /** Stable operation id (uuid), created once. */
  opId: string;
  queuedAt: string;
  attempts: number;
  error: QueueErrorCode | null;
};

export type ArriveItem = ItemBase & { kind: "arrive"; expectedFieldVersion: number; clock: DeviceClock };

export type MediaItem = ItemBase & {
  kind: "media";
  /** The device's own key of this file (the closure names its signature by it). */
  ref: string;
  mediaKind: "photo" | "signature";
  phase: PhotoPhase | null;
  mime: MediaMime;
  size: number;
  /** The compressed file (D95 (i)); never the original. */
  blob: Blob;
  clock: DeviceClock;
  /** Set once add_visit_media answered (a replay answers the same id). */
  mediaId: string | null;
};

export type CloseItem = ItemBase & {
  kind: "close";
  outcome: CloseOutcome;
  summary: string;
  signerName: string | null;
  ackTextSha256: string | null;
  signatureRef: string | null;
  /** Filled from the signature's media item once it is stored. */
  signatureMediaId: string | null;
  followupReasonId: string | null;
  nextVisitNotes: string | null;
  /** The visit's field_version the closure is based on; filled after a queued "הגעתי". */
  expectedFieldVersion: number | null;
  clock: DeviceClock;
};

export type QueueItem = ArriveItem | MediaItem | CloseItem;
export type NewQueueItem = DistributiveOmit<QueueItem, "seq">;
type DistributiveOmit<T, K extends keyof T> = T extends unknown ? Omit<T, K> : never;

/** A photo of the work screen, kept on the device until the closure is queued. */
export type DraftPhoto = { id: string; phase: PhotoPhase; blob: Blob; mime: MediaMime; size: number; capturedAt: string };
export type WorkDraft = { visitId: string; userId: string; summary: string; photos: DraftPhoto[] };

/** The device store (IndexedDB in the app; in memory in the unit tests). */
export interface VisitFlowStore {
  /** Every queued item, in seq order. */
  list(): Promise<QueueItem[]>;
  /** Adds items atomically (seq assigned in order); deletes the visit's draft in the same transaction when asked. */
  add(items: NewQueueItem[], deleteDraftOf?: string): Promise<QueueItem[]>;
  put(item: QueueItem): Promise<void>;
  remove(seq: number): Promise<void>;
  getDraft(visitId: string): Promise<WorkDraft | null>;
  putDraft(draft: WorkDraft): Promise<void>;
}

export type ApiResult<T> = { ok: true; value: T } | { ok: false; code: QueueErrorCode };

/**
 * The server, as the queue calls it. A thrown error (no connection, a failed fetch, a server
 * error) means "try again later": the run stops and keeps the item unchanged.
 */
export interface VisitFlowApi {
  arrive(input: { visitId: string; operationId: string; expectedFieldVersion: number; clock: DeviceClock; deviceSentAt: string }): Promise<ApiResult<{ fieldVersion: number }>>;
  addMedia(input: {
    visitId: string;
    operationId: string;
    kind: "photo" | "signature";
    phase: PhotoPhase | null;
    mimeType: MediaMime;
    sizeBytes: number;
    clock: DeviceClock;
    deviceSentAt: string;
  }): Promise<ApiResult<{ mediaId: string; uploadUrl: string | null }>>;
  /** PUT to the signed upload link; an object that is already there counts as uploaded. */
  upload(uploadUrl: string, blob: Blob, mime: MediaMime): Promise<ApiResult<null>>;
  confirmMedia(input: { mediaId: string }): Promise<ApiResult<null>>;
  close(input: {
    visitId: string;
    operationId: string;
    expectedFieldVersion: number;
    outcome: CloseOutcome;
    summary: string;
    signerName: string | null;
    ackTextSha256: string | null;
    signatureMediaId: string | null;
    followupReasonId: string | null;
    nextVisitNotes: string | null;
    clock: DeviceClock;
    deviceSentAt: string;
  }): Promise<ApiResult<{ status: string }>>;
}

export type SyncReport = {
  /** Items the server confirmed in this run. */
  sent: number;
  /** True when the run stopped for a missing connection. */
  offline: boolean;
  /** Items that ended this run with a refusal. */
  failed: number;
  /** The field_version each visit reached through a confirmed "הגעתי" in this run. */
  fieldVersions: Record<string, number>;
  /** The outcome of each closure the server confirmed in this run. */
  closed: Record<string, CloseOutcome>;
};

class Transient extends Error {}

/** One item: ok when the server confirmed it (it is then removed). */
async function runItem(
  store: VisitFlowStore,
  api: VisitFlowApi,
  item: QueueItem,
  all: QueueItem[],
  now: () => Date,
  report: SyncReport,
): Promise<ApiResult<null>> {
  const sentAt = () => now().toISOString();
  const call = async <T>(p: Promise<ApiResult<T>>): Promise<ApiResult<T>> => {
    try {
      return await p;
    } catch {
      throw new Transient();
    }
  };
  const later = all.filter((x) => x.visitId === item.visitId && x.seq > item.seq);

  if (item.kind === "arrive") {
    const r = await call(api.arrive({ visitId: item.visitId, operationId: item.opId, expectedFieldVersion: item.expectedFieldVersion, clock: item.clock, deviceSentAt: sentAt() }));
    if (!r.ok) return r;
    report.fieldVersions[item.visitId] = r.value.fieldVersion;
    for (const c of later) {
      if (c.kind === "close" && c.expectedFieldVersion === null) {
        c.expectedFieldVersion = r.value.fieldVersion;
        await store.put(c);
      }
    }
    return { ok: true, value: null };
  }

  if (item.kind === "media") {
    const r = await call(
      api.addMedia({ visitId: item.visitId, operationId: item.opId, kind: item.mediaKind, phase: item.phase, mimeType: item.mime, sizeBytes: item.size, clock: item.clock, deviceSentAt: sentAt() }),
    );
    if (!r.ok) return r;
    if (item.mediaId !== r.value.mediaId) {
      item.mediaId = r.value.mediaId;
      await store.put(item);
    }
    if (r.value.uploadUrl) {
      const u = await call(api.upload(r.value.uploadUrl, item.blob, item.mime));
      if (!u.ok) return u;
    }
    const c = await call(api.confirmMedia({ mediaId: r.value.mediaId }));
    if (!c.ok) return c;
    if (item.mediaKind === "signature") {
      for (const x of later) {
        if (x.kind === "close" && x.signatureRef === item.ref && x.signatureMediaId === null) {
          x.signatureMediaId = r.value.mediaId;
          await store.put(x);
        }
      }
    }
    return { ok: true, value: null };
  }

  if (item.expectedFieldVersion === null) return { ok: false, code: "invalid" };
  if (item.signatureRef && !item.signatureMediaId) return { ok: false, code: "invalid" };
  const r = await call(
    api.close({
      visitId: item.visitId,
      operationId: item.opId,
      expectedFieldVersion: item.expectedFieldVersion,
      outcome: item.outcome,
      summary: item.summary,
      signerName: item.signerName,
      ackTextSha256: item.ackTextSha256,
      signatureMediaId: item.signatureMediaId,
      followupReasonId: item.followupReasonId,
      nextVisitNotes: item.nextVisitNotes,
      clock: item.clock,
      deviceSentAt: sentAt(),
    }),
  );
  if (!r.ok) return r;
  report.closed[item.visitId] = item.outcome;
  return { ok: true, value: null };
}

/**
 * Sends the user's queued items in order. Each visit's items go one by one; a refusal keeps the
 * item (with its error) and holds that visit's later items; a missing connection stops the run.
 */
export async function syncQueue(store: VisitFlowStore, api: VisitFlowApi, userId: string, now: () => Date = () => new Date()): Promise<SyncReport> {
  const report: SyncReport = { sent: 0, offline: false, failed: 0, fieldVersions: {}, closed: {} };
  const all = (await store.list()).filter((i) => i.userId === userId);
  const blocked = new Set<string>();
  for (const item of all) {
    if (blocked.has(item.visitId)) continue;
    let r: ApiResult<null>;
    try {
      r = await runItem(store, api, item, all, now, report);
    } catch (e) {
      if (e instanceof Transient) {
        report.offline = true;
        return report;
      }
      throw e;
    }
    if (r.ok) {
      await store.remove(item.seq);
      report.sent++;
    } else {
      item.error = r.code;
      item.attempts++;
      await store.put(item);
      report.failed++;
      blocked.add(item.visitId);
    }
  }
  return report;
}

/** What the queue holds for one visit, for the screens. */
export type VisitQueueState = {
  pending: number;
  arrivePending: boolean;
  close: CloseItem | null;
  /** The first refusal of the visit's items, or null. */
  error: QueueErrorCode | null;
};

export function visitQueueState(items: readonly QueueItem[], visitId: string, userId: string): VisitQueueState {
  const mine = items.filter((i) => i.visitId === visitId && i.userId === userId);
  return {
    pending: mine.length,
    arrivePending: mine.some((i) => i.kind === "arrive"),
    close: (mine.find((i) => i.kind === "close") as CloseItem | undefined) ?? null,
    error: mine.find((i) => i.error)?.error ?? null,
  };
}

export type FlowStatus = "new" | "go" | "work" | "done" | "cont";

/** What this screen saw the server confirm, until the page re-reads the visit. */
export type Confirmed = { arrived: boolean; closed: CloseOutcome | null };

/**
 * The status the technician sees: the server's, moved on by what his device still holds or what
 * the server just confirmed (so the screen never steps back while the page re-reads the visit).
 */
export function effectiveStatus(server: FlowStatus, q: VisitQueueState, confirmed: Confirmed = { arrived: false, closed: null }): FlowStatus {
  const open = server === "go" || server === "work";
  const closing = q.close?.outcome ?? confirmed.closed;
  if (closing && open) return closing === "done" ? "done" : "cont";
  if ((q.arrivePending || confirmed.arrived) && server === "go") return "work";
  return server;
}

/** The inline message of a refusal (Hebrew, no recorded times, D68). */
export const QUEUE_ERROR_MESSAGE: Readonly<Record<QueueErrorCode, string>> = {
  PT409: "הביקור שונה במשרד מאז שנפתח במכשיר. הנתונים שמורים בטלפון; פנה למשרד",
  "55000": "מצב הביקור לא מאפשר את הפעולה. הנתונים שמורים בטלפון; פנה למשרד",
  "42501": "אין הרשאה לביקור הזה. הנתונים שמורים בטלפון; פנה למשרד",
  "22023": "השרת דחה את הנתונים. הנתונים שמורים בטלפון; פנה למשרד",
  "23505": "הפעולה כבר נשלחה עם נתונים אחרים. הנתונים שמורים בטלפון; פנה למשרד",
  limit: "הגעת למספר התמונות המרבי. הנתונים שמורים בטלפון; פנה למשרד",
  "after-required": "חסרה תמונה אחרי הטיפול בשרת. הנתונים שמורים בטלפון; לחץ ׳שלח שוב׳",
  invalid: "הפריט לא שלם. הנתונים שמורים בטלפון; פנה למשרד",
  upload: "העלאת הקובץ נכשלה. הנתונים שמורים בטלפון; לחץ ׳שלח שוב׳",
  unknown: "השליחה נכשלה. הנתונים שמורים בטלפון; לחץ ׳שלח שוב׳",
};
