// Calendar ports (read-only: scheduling stays in Outlook, OF-03). Implemented by
// app/dev/demo/_data/adapter.ts (fictional fixtures) and, later, by a server-side Supabase adapter
// under the caller's session (RLS). `techId` arguments are filters, not identity: production takes
// the technician from the session (G-03). The office calendar is matrix key `cal` (D33; display
// only on screens, enforced on the server, G-04).
// Dates are validated: a malformed date or month is a RangeError (a page passes only parsed values).
import type { IsoDate, PageRequest } from "@/features/data-access/common";
import type { TechnicianId } from "@/features/reference/data/types";
import type { VisitRef } from "@/features/visits/data/types";
import type {
  CalendarVisitDetail,
  OfficeCalendarDay,
  OfficeCalendarFilter,
  OfficeCalendarMonth,
  OfficeCalendarWeek,
  TechMonth,
  TechWeek,
  UnparsedInvitationsPage,
  YearMonth,
} from "./types";

export interface CalendarQueries {
  /** Office day view: one lane per technician in the filter, visits placed in overlap lanes (cancelled excluded). */
  officeDay(date: IsoDate, filter?: OfficeCalendarFilter): Promise<OfficeCalendarDay>;
  /** Office week view of the week containing `weekOf` (Sunday to Thursday). */
  officeWeek(weekOf: IsoDate, filter?: OfficeCalendarFilter): Promise<OfficeCalendarWeek>;
  /** Office month view: counts per day. */
  officeMonth(month: YearMonth, filter?: OfficeCalendarFilter): Promise<OfficeCalendarMonth>;
  /** The office calendar's visit drawer; null when not found, not visible or cancelled (a cancelled visit is never on a calendar). */
  visit(ref: VisitRef): Promise<CalendarVisitDetail | null>;
  /** The technician's week containing `weekOf` (calendar day and week views); null for an unknown technician. */
  techWeek(techId: TechnicianId, weekOf: IsoDate): Promise<TechWeek | null>;
  /** The technician's month view; null for an unknown technician. */
  techMonth(techId: TechnicianId, month: YearMonth): Promise<TechMonth | null>;
}

/**
 * Intake read model (separate from the calendars and from the ingestion service, which writes the
 * rows). Which matrix key gates "זימונים שלא נקלטו" is open decision #15 (d23); the spec lists
 * Customer Service, Manager and Creator. Server gate pending #15: deny by default; the demo's
 * fixed rule (app/dev/demo/_data/roles.ts workQueueScreensOffered) is not a grant.
 */
export interface IntakeQueries {
  /** Unresolved invitations the ingestion service could not ingest, newest first, paged (default 40, at most 100). */
  unparsedInvitations(page?: PageRequest): Promise<UnparsedInvitationsPage>;
}
