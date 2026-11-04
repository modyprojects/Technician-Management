// Input checks for call commands and the calls-list filter, shared by every implementation
// (simulated now, the server later; the server always re-validates).
import {
  clampLimit,
  clampPage,
  isHourMinute,
  isIsoDate,
  isRecordKey,
  normalizeQuery,
} from "@/features/data-access/common";
import { isTechnicianId } from "@/features/reference/data/validate";
import { CALL_STATUS_VALUES, isCallStatus, type CallFilter, type VisitSlot } from "./types";

export const NOTE_MAX = 500;
export const CANCEL_REASON_MAX = 300;

/** A filter with every field validated: unknown statuses dropped, bad dates removed, page and limit clamped. */
export type NormalizedCallFilter = Required<Pick<CallFilter, "q" | "statuses" | "page" | "limit">> &
  Pick<CallFilter, "technicianId" | "from" | "to">;

export function normalizeCallFilter(filter: CallFilter | undefined): NormalizedCallFilter {
  const f = filter ?? {};
  const statuses = Array.isArray(f.statuses) ? [...new Set(f.statuses.filter(isCallStatus))] : [];
  return {
    q: normalizeQuery(f.q),
    // Every status selected is the same as none.
    statuses: statuses.length === CALL_STATUS_VALUES.length ? [] : statuses,
    technicianId: isTechnicianId(f.technicianId) ? f.technicianId : undefined,
    from: isIsoDate(f.from) ? f.from : undefined,
    to: isIsoDate(f.to) ? f.to : undefined,
    page: clampPage(f.page),
    limit: clampLimit(f.limit),
  };
}

export function noteError(text: string): string | null {
  const t = typeof text === "string" ? text.trim() : "";
  if (!t) return "ההערה ריקה";
  return t.length > NOTE_MAX ? `ההערה ארוכה מ-${NOTE_MAX} תווים` : null;
}

export function cancelReasonError(reason: string | undefined): string | null {
  return reason !== undefined && (typeof reason !== "string" || reason.length > CANCEL_REASON_MAX)
    ? `הסיבה ארוכה מ-${CANCEL_REASON_MAX} תווים`
    : null;
}

export function slotError(slot: VisitSlot | undefined): string | null {
  if (slot === undefined) return null;
  if (!isIsoDate(slot.date) || !isHourMinute(slot.start) || !isHourMinute(slot.end)) return "מועד לא תקין";
  return slot.end > slot.start ? null : "שעת הסיום חייבת להיות אחרי שעת ההתחלה";
}

export const requestNumberError = (req: string): string | null => (isRecordKey(req) ? null : "מספר פנייה לא תקין");
