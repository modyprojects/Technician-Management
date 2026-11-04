// Input checks for visit commands, shared by every implementation (simulated now, the server
// later; the server always re-validates). Each returns a Hebrew error, or null when valid.
import { isHourMinute, isRecordKey } from "@/features/data-access/common";
import {
  FOLLOWUP_CORRECTION_FIELDS,
  isCorrectableVisitField,
  TIME_CORRECTION_FIELDS,
  UNCORRECTABLE_VISIT_FIELDS,
  type AddMediaInput,
  type CloseVisitInput,
  type CorrectableValues,
  type CorrectableVisitField,
  type CorrectionValue,
  type VisitCorrectionInput,
  type VisitRef,
} from "./types";

export const SUMMARY_MAX = 4000;
export const PART_MAX = 100;
export const PARTS_MAX = 20;
export const REASON_MAX = 100;
export const SIGNER_MAX = 100;
export const NEXT_NOTE_MAX = 1000;
/** D13 (provisional) and TE-15: a recording is at most 180 seconds (the work screen uses the same limit). */
export const RECORDING_MAX_SECONDS = 180;
/** Largest accepted signature data URL (about 375 KB of PNG). */
export const SIGNATURE_MAX_CHARS = 500_000;
/** Largest accepted photo or video, in bytes. */
export const MEDIA_MAX_BYTES = 200 * 1024 * 1024;

const INVALID_VISIT = "ביקור לא תקין";

export function visitRefError(ref: VisitRef): string | null {
  return isRecordKey(ref?.req) && Number.isInteger(ref?.n) && ref.n >= 1 && ref.n <= 999 ? null : INVALID_VISIT;
}

export function pickupCollectedError(collected: boolean): string | null {
  return typeof collected === "boolean" ? null : "סימון איסוף לא תקין";
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
  if (input.mimeType !== undefined && !(typeof input.mimeType === "string" && input.mimeType.startsWith(prefix))) {
    return "סוג הקובץ לא מתאים";
  }
  if (input.sizeBytes !== undefined && !(input.sizeBytes > 0 && input.sizeBytes <= MEDIA_MAX_BYTES)) {
    return "הקובץ גדול מדי";
  }
  return null;
}

/** Media ids: fixture keys now, database UUIDs later. */
export function mediaIdError(id: string): string | null {
  return typeof id === "string" && /^[A-Za-z0-9-]{1,64}$/.test(id) ? null : "קובץ לא תקין";
}

export function recordingError(seconds: number): string | null {
  return Number.isInteger(seconds) && seconds >= 1 && seconds <= RECORDING_MAX_SECONDS ? null : "אורך הקלטה לא תקין";
}

// TODO(D43): require approvalTextVersionId for "טופל" once reference.approvalText() is served by
// the production adapter (the close screen always sends it; only the server can verify it).
export function closeVisitError(input: CloseVisitInput): string | null {
  if (input?.outcome === "done") {
    const signer = typeof input.signerName === "string" ? input.signerName.trim() : "";
    if (!signer) return "חסר שם החותם";
    if (signer.length > SIGNER_MAX) return "שם החותם ארוך מדי";
    const sig = typeof input.signatureDataUrl === "string" ? input.signatureDataUrl : "";
    if (!sig.startsWith("data:image/png;base64,")) return "חסרה חתימת הלקוח";
    if (sig.length > SIGNATURE_MAX_CHARS) return "החתימה גדולה מדי";
    return null;
  }
  if (input?.outcome === "cont") {
    const reason = typeof input.reason === "string" ? input.reason.trim() : "";
    if (!reason) return "יש לבחור סיבה להמשך טיפול";
    if (reason.length > REASON_MAX) return "הסיבה ארוכה מדי";
    // TE-21 (ADD): "מה צריך בביקור הבא" is required for "המשך טיפול".
    const nextNote = typeof input.nextNote === "string" ? input.nextNote.trim() : "";
    if (!nextNote) return "יש לכתוב מה צריך בביקור הבא";
    return nextNote.length > NEXT_NOTE_MAX ? `ההערה לביקור הבא ארוכה מ-${NEXT_NOTE_MAX} תווים` : null;
  }
  return "יש לבחור תוצאה";
}

// ---------------------------------------------------------------------------------------------
// Audited corrections of a server-closed visit (OF-10, D14, D43, D45)

/** Longest correction reason accepted. */
export const CORRECTION_REASON_MAX = 500;

/** The new value of a field, by the field's own rules (summary, parts, reason, note, "HH:MM"). */
export function correctionValueError(field: CorrectableVisitField, value: CorrectionValue): string | null {
  if (TIME_CORRECTION_FIELDS.includes(field)) return isHourMinute(value) ? null : "שעה לא תקינה";
  if (field === "parts") return Array.isArray(value) ? partsError(value as readonly string[]) : "רשימת חלפים לא תקינה";
  if (typeof value !== "string") return "ערך לא תקין";
  const t = value.trim();
  switch (field) {
    case "summary":
      if (!t) return "יש לכתוב סיכום";
      return summaryError(t);
    case "followupReason":
      if (!t) return "יש לבחור סיבה להמשך טיפול";
      return t.length > REASON_MAX ? "הסיבה ארוכה מדי" : null;
    default:
      if (!t) return "יש לכתוב מה צריך בביקור הבא";
      return t.length > NEXT_NOTE_MAX ? `ההערה לביקור הבא ארוכה מ-${NEXT_NOTE_MAX} תווים` : null;
  }
}

/**
 * The correction input: a valid visit, a correctable field (never the signed approval text, the
 * signer or the signature, D43), a valid new value, a mandatory reason and a version. Whether the
 * visit is closed, the field applies to it and the value changes is checked against stored data
 * (visitCorrectionError).
 */
export function visitCorrectionInputError(input: VisitCorrectionInput): string | null {
  if (!input || typeof input !== "object") return "קלט לא תקין";
  const ref = visitRefError(input.visitRef);
  if (ref) return ref;
  if ((UNCORRECTABLE_VISIT_FIELDS as readonly string[]).includes(input.field as string)) {
    return "נוסח האישור החתום, שם החותם והחתימה אינם ניתנים לתיקון";
  }
  if (!isCorrectableVisitField(input.field)) return "שדה לא ניתן לתיקון";
  const value = correctionValueError(input.field, input.newValue);
  if (value) return value;
  const reason = typeof input.reason === "string" ? input.reason.trim() : "";
  if (!reason) return "יש לכתוב סיבה לתיקון";
  if (reason.length > CORRECTION_REASON_MAX) return `הסיבה ארוכה מ-${CORRECTION_REASON_MAX} תווים`;
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) return "גרסה לא תקינה";
  return null;
}

/** What is stored for a correction's checks (undefined: not found, not visible, or not closed). */
export type VisitCorrectionStored = {
  version: number;
  status: "done" | "cont";
  current: CorrectableValues;
  correctable: readonly CorrectableVisitField[];
  /** Whether the caller may correct a closed visit (Manager and Creator, D14). */
  canCorrect: boolean;
  /** Active follow-up reasons (Settings); a corrected reason must be one of them. */
  reasons: readonly string[];
};

const sameValue = (a: CorrectionValue, b: CorrectionValue): boolean => {
  const norm = (v: CorrectionValue) => (Array.isArray(v) ? JSON.stringify(v.map((x) => String(x).trim())) : typeof v === "string" ? v.trim() : v);
  return norm(a) === norm(b);
};

/**
 * Every check of a correction, in order: the input, the visit (closed), the caller, the version,
 * the field for this visit (follow-up fields only for "המשך טיפול"), a real change, and an active
 * follow-up reason. Deny by default: with nothing stored the correction fails.
 */
export function visitCorrectionError(input: VisitCorrectionInput, stored: VisitCorrectionStored | undefined): string | null {
  const inputError = visitCorrectionInputError(input);
  if (inputError) return inputError;
  if (!stored) return "הביקור לא נמצא או שאינו סגור";
  if (!stored.canCorrect) return "אין הרשאה לתקן ביקור סגור";
  if (stored.version !== input.expectedVersion) return "הביקור עודכן בינתיים · יש לרענן את הדף";
  if (!stored.correctable.includes(input.field) || (stored.status !== "cont" && FOLLOWUP_CORRECTION_FIELDS.includes(input.field))) {
    return "השדה לא ניתן לתיקון בביקור הזה";
  }
  if (sameValue(stored.current[input.field], input.newValue)) return "אין שינוי לשמור";
  if (input.field === "followupReason" && !stored.reasons.includes(String(input.newValue).trim())) return "הסיבה לא נמצאה ברשימה";
  return null;
}
