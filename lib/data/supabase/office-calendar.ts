// The office "יומן טכנאים" reads for this request (D88 office module 2; D94). Server-only. The
// session's user comes from lib/auth/session.ts (server-validated); every read runs under that
// user's own session (RLS), never the secret key, through features/office-calendar/data/office-calendar.ts, which checks
// the matrix key `cal` before any read (D94 (c)). Without a signed-in user or the Supabase
// configuration nothing is read (deny by default, fail closed). A failed read throws
// OfficeCalendarQueryError (a code only), logged here by its code; the page fails closed.
// The D91 scope (test rows left out on Production after go-live) is decided here from VERCEL_ENV and
// config/release.json `testingPeriod`; the value of either is never logged or returned.
import "server-only";
import release from "@/config/release.json";
import type { IsoDate } from "@/features/data-access/common";
import type { VisitRef } from "@/features/visits/data/types";
import {
  officeCalendarQueriesOf,
  OfficeCalendarQueryError,
  showsTestRows,
  type CalendarRange,
  type OfficeCalendarData,
  type OfficeCalendarQueries,
} from "@/features/office-calendar/data/office-calendar";
import { logAuthEvent } from "@/lib/auth/log";
import { getSessionState } from "@/lib/auth/session";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const DENIED: OfficeCalendarQueries = {
  permitted: async () => false,
  week: async (): Promise<OfficeCalendarData> => ({ visits: [], technicians: [], capped: false }),
  visit: async () => null,
};

function logged(q: OfficeCalendarQueries): OfficeCalendarQueries {
  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        logAuthEvent(`office_calendar.query.${name}_failed`, error instanceof OfficeCalendarQueryError ? error.code : "exception");
        throw error;
      }
    };
  return {
    permitted: wrap("permitted", q.permitted),
    week: wrap("week", (date: IsoDate, range: CalendarRange) => q.week(date, range)),
    visit: wrap("visit", (ref: VisitRef, range: CalendarRange) => q.visit(ref, range)),
  };
}

/** Whether test-marked rows are shown on this deployment (D91). */
export function officeCalendarShowsTestRows(): boolean {
  return showsTestRows(process.env.VERCEL_ENV, (release as { testingPeriod?: unknown }).testingPeriod);
}

/** The office calendar queries of this request's signed-in user; every one denies without a session or `cal`. */
export async function officeCalendarQueries(): Promise<OfficeCalendarQueries> {
  const state = await getSessionState();
  if (state.kind !== "signed-in") return DENIED;
  const client = await createUserSupabaseClient();
  if (!client) return DENIED;
  return logged(officeCalendarQueriesOf(client, state.user, officeCalendarShowsTestRows()));
}
