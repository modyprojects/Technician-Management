// Input checks for visit commands, shared by every implementation (simulated now, the server
// later; the server always re-validates). Each returns a Hebrew error, or null when valid.
import { isRecordKey } from "@/features/data-access/common";
import type { AddMediaInput, CloseVisitInput, VisitRef } from "./types";

export const SUMMARY_MAX = 4000;
export const PART_MAX = 100;
export const PARTS_MAX = 20;
export const REASON_MAX = 100;
export const SIGNER_MAX = 100;
export const NEXT_NOTE_MAX = 1000;
export const RECORDING_MAX_SECONDS = 60 * 60;
/** Largest accepted signature data URL (about 375 KB of PNG). */
export const SIGNATURE_MAX_CHARS = 500_000;
/** Largest accepted photo or video, in bytes. */
export const MEDIA_MAX_BYTES = 200 * 1024 * 1024;

const INVALID_VISIT = "ביקור לא תקין";

export function visitRefError(ref: VisitRef): string | null {
  return isRecordKey(ref?.req) && Number.isInteger(ref?.n) && ref.n >= 1 && ref.n <= 999 ? null : INVALID_VISIT;
}

export function summaryError(text: string): string | null {
  if (typeof text !== "string") return "סיכום לא תקין";
  return text.length > SUMMARY_MAX ? `הסיכום ארוך מ-${SUMMARY_MAX} תווים` : null;
}

export function partsError(parts: readonly string[]): string | null {
  if (!Array.isArray(parts) || parts.some((p) => typeof p !== "string")) return "רשימת חלפים לא תקינה";
  if (parts.length > PARTS_MAX) return `אפשר לרשום עד ${PARTS_MAX} חלפים`;
  return parts.some((p) => p.trim().length > PART_MAX) ? `שם חלק ארוך מ-${PART_MAX} תווים` : null;
}

export function mediaError(input: AddMediaInput): string | null {
  if (input?.kind !== "img" && input?.kind !== "vid") return "סוג קובץ לא תקין";
  if (input.when !== "before" && input.when !== "after") return "יש לבחור לפני או אחרי הטיפול";
  const prefix = input.kind === "img" ? "image/" : "video/";
  if (input.mimeType !== undefined && !input.mimeType.startsWith(prefix)) return "סוג הקובץ לא מתאים";
  if (input.sizeBytes !== undefined && !(input.sizeBytes > 0 && input.sizeBytes <= MEDIA_MAX_BYTES)) {
    return "הקובץ גדול מדי";
  }
  return null;
}

export function recordingError(seconds: number): string | null {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= RECORDING_MAX_SECONDS ? null : "אורך הקלטה לא תקין";
}

export function closeVisitError(input: CloseVisitInput): string | null {
  if (input?.outcome === "done") {
    const signer = input.signerName?.trim() ?? "";
    if (!signer) return "חסר שם החותם";
    if (signer.length > SIGNER_MAX) return "שם החותם ארוך מדי";
    const sig = input.signatureDataUrl ?? "";
    if (!sig.startsWith("data:image/png;base64,")) return "חסרה חתימת הלקוח";
    if (sig.length > SIGNATURE_MAX_CHARS) return "החתימה גדולה מדי";
    return null;
  }
  if (input?.outcome === "cont") {
    const reason = input.reason?.trim() ?? "";
    if (!reason) return "יש לבחור סיבה להמשך טיפול";
    if (reason.length > REASON_MAX) return "הסיבה ארוכה מדי";
    return (input.nextNote?.length ?? 0) > NEXT_NOTE_MAX ? `ההערה לביקור הבא ארוכה מ-${NEXT_NOTE_MAX} תווים` : null;
  }
  return "יש לבחור תוצאה";
}
