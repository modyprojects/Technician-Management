// Input checks for call commands and the calls-list filter, shared by every implementation
// (simulated now, the server later; the server always re-validates).
import { clampLimit, clampPage, isIsoDate, isRecordKey, normalizeQuery } from "@/features/data-access/common";
import { isTechnicianId } from "@/features/reference/data/validate";
import { CALL_STATUS_VALUES, isCallStatus, type BackFromFieldQuery, type CallFilter } from "./types";

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

export function cancelReasonError(reason: string | undefined): string | null {
  return reason !== undefined && (typeof reason !== "string" || reason.length > CANCEL_REASON_MAX)
    ? `הסיבה ארוכה מ-${CANCEL_REASON_MAX} תווים`
    : null;
}

export const requestNumberError = (req: string): string | null => (isRecordKey(req) ? null : "מספר פנייה לא תקין");

/** The back-from-field query with every field validated; a malformed `asOf` is a RangeError. */
export function normalizeBackFromFieldQuery(query: BackFromFieldQuery): Required<Pick<BackFromFieldQuery, "asOf" | "page" | "limit">> &
  Pick<BackFromFieldQuery, "technicianId"> {
  if (!query || !isIsoDate(query.asOf)) throw new RangeError("Invalid date");
  return {
    asOf: query.asOf,
    technicianId: isTechnicianId(query.technicianId) ? query.technicianId : undefined,
    page: clampPage(query.page),
    limit: clampLimit(query.limit),
  };
}
