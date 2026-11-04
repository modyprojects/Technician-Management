// Input checks for the calendar queries, shared by every implementation (fixtures now, the server
// later; the server always re-validates). Pure: no data, no I/O.
import { isTechnicianId } from "@/features/reference/data/validate";
import {
  CALENDAR_STATUS_VALUES,
  isCalendarVisitStatus,
  type NormalizedCalendarFilter,
  type OfficeCalendarFilter,
  type YearMonth,
} from "./types";

const YEAR_MONTH = /^\d{4}-(0[1-9]|1[0-2])$/;

export const isYearMonth = (value: unknown): value is YearMonth => typeof value === "string" && YEAR_MONTH.test(value);

/** Unknown statuses dropped, duplicates removed, "every status" sent as none; a malformed technician id dropped. */
export function normalizeCalendarFilter(filter: OfficeCalendarFilter | undefined): NormalizedCalendarFilter {
  const f = filter ?? {};
  const statuses = Array.isArray(f.statuses) ? [...new Set(f.statuses.filter(isCalendarVisitStatus))] : [];
  return {
    technicianId: isTechnicianId(f.technicianId) ? f.technicianId : null,
    statuses: statuses.length === CALENDAR_STATUS_VALUES.length ? [] : statuses,
  };
}
