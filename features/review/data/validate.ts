// Input checks for the review list and the resolution (D44), shared by every implementation
// (simulated now, the server later; the server always re-validates under the caller's session and
// checks the row version). Each error is a short Hebrew message, or null when valid. Errors never
// name a decision code.
import { clampLimit, clampPage, isUuid, ownValue } from "@/features/data-access/common";
import {
  isReviewDecision,
  isReviewFieldChoice,
  isReviewStatus,
  REVIEW_FIELD_KEY_MAX,
  REVIEW_NOTE_MAX,
  type ReviewDecision,
  type ReviewListQuery,
  type ReviewResolveInput,
  type ReviewStatus,
} from "./types";

const KEY = /^[A-Za-z0-9-]{1,64}$/;
const FIELD_KEY = new RegExp(`^[A-Za-z][A-Za-z0-9]{0,${REVIEW_FIELD_KEY_MAX - 1}}$`);

/** Review item ids: fixture keys now, database UUIDs later. */
export const isReviewItemId = (value: unknown): value is string => isUuid(value) || (typeof value === "string" && KEY.test(value));

/** The list query with every field validated: an unknown status means every item; page and limit clamped. */
export function normalizeReviewListQuery(query: ReviewListQuery | undefined): { status: ReviewStatus | undefined; page: number; limit: number } {
  const q = query ?? {};
  return { status: isReviewStatus(q.status) ? q.status : undefined, page: clampPage(q.page), limit: clampLimit(q.limit) };
}

/**
 * The resolution input: a valid id and version, a known decision, per-field choices only (and
 * always) with "per-field", and an optional note within REVIEW_NOTE_MAX. Whether the item offers
 * the decision, the fields and the note rule are checked against stored data (reviewResolutionError).
 */
export function reviewResolveInputError(input: ReviewResolveInput): string | null {
  if (!input || typeof input !== "object") return "קלט לא תקין";
  if (!isReviewItemId(input.id)) return "פריט לא תקין";
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) return "גרסה לא תקינה";
  if (!isReviewDecision(input.decision)) return "יש לבחור החלטה";
  if (input.decision === "per-field") {
    const fields = input.fields;
    if (!fields || typeof fields !== "object" || Array.isArray(fields)) return "יש לבחור ערך לכל שדה";
    const entries = Object.entries(fields);
    if (entries.length === 0) return "יש לבחור ערך לכל שדה";
    if (entries.some(([key, choice]) => !FIELD_KEY.test(key) || !isReviewFieldChoice(choice))) return "בחירת שדה לא תקינה";
  } else if (input.fields !== undefined) {
    return "בחירה לפי שדה אפשרית רק בהחלטה לפי שדה";
  }
  if (input.note !== undefined) {
    if (typeof input.note !== "string") return "הערה לא תקינה";
    if (input.note.trim().length > REVIEW_NOTE_MAX) return `ההערה ארוכה מ-${REVIEW_NOTE_MAX} תווים`;
  }
  return null;
}

/** What is stored for a resolution's checks (undefined: not found, or not visible to the caller). */
export type ReviewResolveStored = {
  version: number;
  status: ReviewStatus;
  /** Decisions the item offers. */
  decisions: readonly ReviewDecision[];
  /** Fields that offer a per-field choice. */
  choosable: readonly string[];
  /** Fields in conflict: a per-field decision must choose each of them. */
  conflicts: readonly string[];
  noteRequired: boolean;
  /** Whether the caller may resolve this item (D14 cases: Manager and Creator; others: `conflicts`). */
  canResolve: boolean;
  /** Where the item came from: an invitation, or a technician's device. */
  source: "invitation" | "device";
  /**
   * The item's visit is server-closed now (it may have closed after the item was created): an
   * invitation never changes a closed visit (D39), so only "keep-current" stays possible.
   */
  targetVisitClosed: boolean;
};

/**
 * Every check of a resolution, in order: the input, the item, the caller, the status, the version
 * (D44), the decision, an invitation's change to a visit that is closed now (D39: never applied),
 * the per-field choices and the note. Deny by default: with nothing stored the resolution fails
 * ("הפריט לא נמצא").
 */
export function reviewResolutionError(input: ReviewResolveInput, stored: ReviewResolveStored | undefined): string | null {
  const inputError = reviewResolveInputError(input);
  if (inputError) return inputError;
  if (!stored) return "הפריט לא נמצא";
  if (!stored.canResolve) return "אין הרשאה לטפל בפריט הזה";
  if (stored.status !== "open") return "כבר התקבלה החלטה בפריט הזה";
  if (stored.version !== input.expectedVersion) return "הפריט עודכן בינתיים · יש לרענן את הדף";
  if (!stored.decisions.includes(input.decision)) return "ההחלטה לא זמינה לפריט הזה";
  if (stored.source === "invitation" && stored.targetVisitClosed && input.decision !== "keep-current") {
    return "זימון לא משנה ביקור סגור";
  }
  if (input.decision === "per-field") {
    const fields = input.fields ?? {};
    const choosable = Object.fromEntries(stored.choosable.map((k) => [k, true] as const));
    if (Object.keys(fields).some((k) => !ownValue(choosable, k))) return "שדה לא מוכר בפריט הזה";
    if (stored.conflicts.some((k) => ownValue(fields, k) === undefined)) return "יש לבחור ערך לכל שדה בהתנגשות";
  }
  if (stored.noteRequired && !(typeof input.note === "string" && input.note.trim())) return "יש לכתוב הערת החלטה";
  return null;
}
