import { toMinutes } from "@/features/calendar/data/dates";
import type { CalendarVisit } from "@/features/calendar/data/types";
import type { IsoDate } from "@/features/data-access/common";
import type { TechnicianRef } from "@/features/reference/data/types";
import type { TechCalendarVisit } from "@/features/visits/supabase/tech";
import type { OfficeCalendarData } from "./office-calendar";

// The phone view of "יומן טכנאים" (owner review 22.11, amends D94 (b)): ONE technician at a time,
// chosen in a "בחר טכנאי" dropdown, drawn by the technician calendar's own day and week grids
// (components/tech/calendar, D85 (b)). Pure: the page passes the week it read.

/** The phone's technician: the one in the address when it is shown, else the first; null when there is none. */
export function phoneTechOf(requested: string | null, technicians: readonly Pick<TechnicianRef, "id">[]): string | null {
  if (requested && technicians.some((t) => t.id === requested)) return requested;
  return technicians[0]?.id ?? null;
}

/**
 * An office calendar visit in the technician calendar's shape. The office read has no street address
 * or summary: the city stands for the address and the summary is empty (the office never uses the
 * technician calendar's reduced view of a past day). The id is the visit ref ("request:n").
 */
export function techCalVisitOf(v: CalendarVisit): TechCalendarVisit {
  return {
    id: `${v.req}:${v.n}`,
    isTest: v.isTest,
    date: v.date,
    request: v.req,
    start: v.start,
    end: v.end,
    customer: v.customerName === "—" ? "" : v.customerName,
    city: v.city,
    address: v.city,
    product: v.productName === "—" ? "" : v.productName,
    summary: "",
    status: v.status,
    isFollowUp: v.isFollowUp,
  };
}

/** The given days, each with the technician's visits by start time (cancelled visits are never in `data`). */
export function phoneDaysOf(data: OfficeCalendarData, days: readonly IsoDate[], tech: string | null): { date: IsoDate; visits: TechCalendarVisit[] }[] {
  return days.map((date) => ({
    date,
    visits: data.visits
      .filter((v) => v.date === date && v.technician.id === tech)
      .sort((a, b) => toMinutes(a.start) - toMinutes(b.start) || a.req.localeCompare(b.req) || a.n - b.n)
      .map(techCalVisitOf),
  }));
}
