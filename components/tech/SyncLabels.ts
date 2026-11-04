// Hebrew wording of the technician device's work queue (TE-23, TE-24, D46), shared by the home
// banner and the visit's sync panel. Pure: no data, no hooks.
import { DEVICE_OPERATION_LABELS, type DeviceOperation } from "@/features/sync/data/types";
import type { QueueItemRef } from "./SyncQueue";

/** What the client islands need of a queue item (its id and reported state), not the whole DTO. */
export const queueItemRef = (op: Pick<DeviceOperation, "opId" | "state">): QueueItemRef => ({ opId: op.opId, state: op.state });

/** "תמונה אחרי הטיפול", "סרטון לפני הטיפול", "סיכום הטיפול" … */
export function operationLabel(op: Pick<DeviceOperation, "kind" | "media">): string {
  if (op.kind === "media" && op.media) {
    return `${op.media.kind === "vid" ? "סרטון" : "תמונה"} ${op.media.when === "before" ? "לפני הטיפול" : "אחרי הטיפול"}`;
  }
  return DEVICE_OPERATION_LABELS[op.kind];
}

/** File size: "3.4 MB", "48 MB", "900 KB"; null for a record without a file. */
export function sizeLabel(bytes: number | null): string | null {
  if (bytes === null || !Number.isFinite(bytes) || bytes < 0) return null;
  if (bytes >= 1_000_000) {
    const mb = bytes / 1_000_000;
    return `${mb >= 10 ? Math.round(mb) : mb.toFixed(1)} MB`;
  }
  return `${Math.max(1, Math.round(bytes / 1000))} KB`;
}

/** "ניסיון אחד" / "3 ניסיונות". */
export const attemptsLabel = (n: number): string => (n === 1 ? "ניסיון אחד" : `${n} ניסיונות`);

/** "פריט אחד" / "3 פריטים". */
export const itemsLabel = (n: number): string => (n === 1 ? "פריט אחד" : `${n} פריטים`);

/**
 * The pending-data warning (D46): the work stays on the device until the server confirms it; no
 * recovery is promised for what exists only on the device; sync runs only while the app is open
 * (D06, D25: no background sync is claimed).
 */
export const QUEUE_WARNING =
  "העבודה נשמרת במכשיר עד שהשרת מאשר שקיבל אותה, והסנכרון רץ רק כשהאפליקציה פתוחה. עד אז אין להסיר את האפליקציה ואין לנקות את נתוני הדפדפן: מה שנמצא רק במכשיר לא ניתן לשחזר.";
