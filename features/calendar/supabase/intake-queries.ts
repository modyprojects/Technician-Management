// The real IntakeQueries ("זימונים שלא נקלטו"; QA S-05, D60 (4), (11); spec "Invitation intake",
// IN-01 to IN-04) over a Supabase client under the CALLER'S OWN SESSION: RLS decides which rows of
// `calendar_ingestion_errors` (Migration 6) the caller reads; this module only asks for the open
// ones, newest first, bounded, and turns each into the screen's read model. No secret key and no
// environment here: lib/data/supabase/intake.ts wires it per request, and the local-stack tests run
// this same code with real local clients.
// Who sees the screen is open decision #15 (TEMPORARY fixed rule: every office role,
// features/auth/roles.ts workQueueScreensOffered); the rows a role may read are the database's
// decision (Migration 6 policies; Step 6 OQ-1). A viewer that is no office role gets nothing (deny
// by default), whatever RLS would allow.
// Every stored value is checked before it is shown: the problems with the ingestion service's own
// schema (an unreadable problem makes the read fail closed, a code only), the addresses and the
// request number with their formats. Invitation text is untrusted: it stays plain text, cut to
// UNPARSED_VALUE_MAX characters. A failed read throws IntakeQueryError (a code only, never the
// database's text); the page fails closed.
import type { SupabaseClient } from "@supabase/supabase-js";
import { z } from "zod";
import type { IntakeQueries } from "@/features/calendar/data/ports";
import type { UnparsedInvitation, UnparsedInvitationsPage } from "@/features/calendar/data/types";
import { invitationText, reasonListsNeeded, unparsedProblemsOf, type ReasonLists } from "@/features/calendar/data/unparsed-reasons";
import { problemSchema } from "@/features/calendar/ingestion/outcome";
import type { IngestionProblem } from "@/features/calendar/ingestion/types";
import { jerusalemDate, jerusalemTime } from "@/features/dashboards/data/time";
import type { SessionUser } from "@/features/auth/data/types";
import { clampLimit, clampPage, isUuid, type PageRequest } from "@/features/data-access/common";
import { isTechnicianColorToken, technicianColorCss } from "@/features/reference/data/types";

/** A failed read: `code` is the PostgREST or SQLSTATE code (or "invalid-row"), never a message. */
export class IntakeQueryError extends Error {
  readonly code: string;
  constructor(code: unknown) {
    const safe = typeof code === "string" && /^[A-Za-z0-9_-]{1,32}$/.test(code) ? code : "unknown";
    super(`intake query failed (${safe})`);
    this.name = "IntakeQueryError";
    this.code = safe;
  }
}

/** The office roles that see "זימונים שלא נקלטו" (the TEMPORARY #15 rule; never a Technician). */
export const readsIntake = (viewer: Pick<SessionUser, "role"> | null | undefined): boolean =>
  viewer?.role === "creator" || viewer?.role === "mgr" || viewer?.role === "cs";

/** Columns of an unparsed invitation (Migration 6 `calendar_ingestion_errors`); never the change or event ids. */
export const ERROR_COLUMNS =
  "id, created_at, subject, organizer_email, attendee_emails, event_start, event_end, request_number, customer_name, problems, is_test";

/** A stored row as PostgREST returns it, validated before use. */
const errorRowSchema = z.object({
  id: z.string().refine(isUuid),
  created_at: z.string().max(64),
  subject: z.string().max(1000).nullable(),
  organizer_email: z.string().max(254).nullable(),
  attendee_emails: z.array(z.string().max(254)).max(20),
  event_start: z.string().max(64).nullable(),
  event_end: z.string().max(64).nullable(),
  request_number: z.string().regex(/^[A-Za-z0-9-]{1,32}$/).nullable(),
  customer_name: z.string().max(1000).nullable(),
  problems: z.array(problemSchema).min(1).max(30),
  is_test: z.boolean(),
});
export type ErrorRow = z.infer<typeof errorRowSchema>;

/** A technician as the matcher reads him (Migration 1 `technicians`). */
type TechnicianRow = { id: string; display_name: string; color: string; outlook_email: string };

/** Most attendee addresses one page asks the technician list about (each row holds at most 20). */
export const MAX_MATCHED_ADDRESSES = 200;

/** Longest Settings list a reason names (call types, pickup places). */
const REASON_LIST_MAX = 30;

/**
 * PostgreSQL writes microseconds ("…:33.123456+00:00"); the shared Asia/Jerusalem helpers read ISO
 * instants with up to milliseconds. Anything else is not an instant (null).
 */
export function instantOf(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const m = /^(\d{4}-\d{2}-\d{2})[T ](\d{2}:\d{2}(?::\d{2})?)(?:\.(\d{1,9}))?(Z|[+-]\d{2}(?::?\d{2})?)$/.exec(value);
  if (!m) return null;
  const fraction = m[3] ? `.${m[3].slice(0, 3)}` : "";
  const offset = m[4] === "Z" ? "Z" : /^[+-]\d{2}$/.test(m[4]!) ? `${m[4]}:00` : m[4]!.replace(/^([+-]\d{2})(\d{2})$/, "$1:$2");
  const time = m[2]!.length === 5 ? `${m[2]}:00` : m[2]!;
  return `${m[1]}T${time}${fraction}${offset}`;
}

/** The invitation's own date and times in Asia/Jerusalem, or null when either end is unreadable. */
export function eventTimesOf(start: string | null, end: string | null): UnparsedInvitation["event"] {
  const s = instantOf(start);
  const e = instantOf(end);
  const date = jerusalemDate(s);
  const from = jerusalemTime(s);
  const to = jerusalemTime(e);
  return date && from && to ? { date, start: from, end: to } : null;
}

/** Lower case, trimmed, and a plausible address; anything else is dropped (it is shown as received elsewhere). */
const addressOf = (value: string): string | null => {
  const v = value.trim().toLowerCase();
  return /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(v) && v.length <= 254 ? v : null;
};

/** The one technician whose Outlook address is among the attendees; null for none or more than one. */
export function matchedTechnician(
  emails: readonly string[],
  byAddress: ReadonlyMap<string, TechnicianRow>,
): UnparsedInvitation["attendees"]["technician"] {
  const found = new Map<string, TechnicianRow>();
  for (const email of emails) {
    const t = byAddress.get(email);
    if (t) found.set(t.id, t);
  }
  if (found.size !== 1) return null;
  const [t] = [...found.values()];
  if (!t) return null;
  return { id: t.id, name: t.display_name, color: isTechnicianColorToken(t.color) ? technicianColorCss(t.color) : "var(--muted)" };
}

/** One stored row as the screen shows it. */
export function unparsedInvitationOf(row: ErrorRow, byAddress: ReadonlyMap<string, TechnicianRow>, lists: ReasonLists): UnparsedInvitation {
  const emails = row.attendee_emails.map((e) => invitationText(e));
  const matchable = row.attendee_emails.map(addressOf).filter((e): e is string => e !== null);
  return {
    id: row.id,
    receivedAt: row.created_at,
    // Microsoft 365 is not connected (D23): every source today is a test source (simulator,
    // automated test), labelled "🧪 זימון בדיקה" (SIM-14, D47).
    source: row.is_test ? "simulator" : "outlook",
    subject: invitationText(row.subject),
    organizer: { email: row.organizer_email ? invitationText(row.organizer_email) : null, name: null },
    attendees: { emails, technician: matchedTechnician(matchable, byAddress) },
    event: eventTimesOf(row.event_start, row.event_end),
    requestNumber: row.request_number,
    customerName: row.customer_name ? invitationText(row.customer_name) : null,
    problems: unparsedProblemsOf(row.problems as IngestionProblem[], lists),
    // IN-04 / SE-12: the email to the rep waits for open decision #6 (d09); never shown as sent.
    repMail: { status: "pending", decision: "d09" },
    isTest: row.is_test,
  };
}

/** The real intake queries for `viewer` (from the server-validated session), under `db`'s session. */
export function intakeQueriesOf(db: SupabaseClient, viewer: Pick<SessionUser, "role"> | null): IntakeQueries {
  return {
    async unparsedInvitations(request?: PageRequest): Promise<UnparsedInvitationsPage> {
      const limit = clampLimit(request?.limit);
      const page = clampPage(request?.page);
      if (!readsIntake(viewer)) return { items: [], total: 0, page: 1, limit, pageCount: 1 };

      const fetchPage = (p: number) => {
        const from = (p - 1) * limit;
        return db
          .from("calendar_ingestion_errors")
          .select(ERROR_COLUMNS, { count: "exact" })
          .eq("status", "open")
          .order("created_at", { ascending: false })
          .order("id", { ascending: false })
          .range(from, from + limit - 1);
      };
      let shown = page;
      let result = await fetchPage(shown);
      // A page past the end (an old link, rows resolved meanwhile): PostgREST answers PGRST103;
      // show the last page instead.
      if (result.error?.code === "PGRST103") {
        const head = await db.from("calendar_ingestion_errors").select("id", { count: "exact", head: true }).eq("status", "open");
        if (head.error) throw new IntakeQueryError(head.error.code);
        shown = Math.max(1, Math.ceil((head.count ?? 0) / limit));
        result = await fetchPage(shown);
      }
      const { data, error, count } = result;
      if (error) throw new IntakeQueryError(error.code);
      const parsed = z.array(errorRowSchema).max(limit).safeParse(data ?? []);
      if (!parsed.success) throw new IntakeQueryError("invalid-row");
      const rows = parsed.data;
      const total = typeof count === "number" ? count : rows.length;
      const pageCount = Math.max(1, Math.ceil(total / limit));

      // The attendees' technicians (D18, SE-05: matched by the Outlook address), one read per page.
      const addresses = [...new Set(rows.flatMap((r) => r.attendee_emails.map(addressOf).filter((e): e is string => e !== null)))].slice(
        0,
        MAX_MATCHED_ADDRESSES,
      );
      const byAddress = new Map<string, TechnicianRow>();
      if (addresses.length > 0) {
        const techs = await db.from("technicians").select("id, display_name, color, outlook_email").in("outlook_email", addresses).limit(MAX_MATCHED_ADDRESSES);
        if (techs.error) throw new IntakeQueryError(techs.error.code);
        for (const t of (techs.data ?? []) as TechnicianRow[]) byAddress.set(t.outlook_email.toLowerCase(), t);
      }

      // The Settings lists a reason names, read only when a row needs them.
      const needed = reasonListsNeeded(rows.flatMap((r) => r.problems as IngestionProblem[]));
      const lists: ReasonLists = {};
      if (needed.callTypes) {
        const types = await db.from("call_types").select("label_he").eq("is_active", true).order("sort_order").limit(REASON_LIST_MAX);
        if (types.error) throw new IntakeQueryError(types.error.code);
        lists.callTypes = ((types.data ?? []) as { label_he: string }[]).map((t) => t.label_he);
      }
      if (needed.pickupPlaces) {
        const places = await db.from("collection_locations").select("name").eq("is_active", true).order("sort_order").limit(REASON_LIST_MAX);
        if (places.error) throw new IntakeQueryError(places.error.code);
        lists.pickupPlaces = ((places.data ?? []) as { name: string }[]).map((p) => p.name);
      }

      return {
        items: rows.map((r) => unparsedInvitationOf(r, byAddress, lists)),
        total,
        page: Math.min(shown, pageCount),
        limit,
        pageCount,
      };
    },
  };
}

/** The "אל" choices of the simulator: technicians that accept invitations, by name, bounded. */
export const SIMULATOR_TECHNICIANS_MAX = 100;

/**
 * Technicians the simulator form offers (D18, SE-05: an invitation names its technician by his
 * Outlook address), read under the caller's session (RLS); empty for a viewer that is no office role.
 */
export async function simulatorTechniciansOf(
  db: SupabaseClient,
  viewer: Pick<SessionUser, "role"> | null,
): Promise<{ id: string; name: string; email: string }[]> {
  if (!readsIntake(viewer)) return [];
  const { data, error } = await db
    .from("technicians")
    .select("id, display_name, outlook_email")
    .eq("accepts_invitations", true)
    .order("display_name")
    .limit(SIMULATOR_TECHNICIANS_MAX);
  if (error) throw new IntakeQueryError(error.code);
  return ((data ?? []) as { id: string; display_name: string; outlook_email: string }[])
    .filter((t) => isUuid(t.id) && addressOf(t.outlook_email) !== null)
    .map((t) => ({ id: t.id, name: t.display_name, email: addressOf(t.outlook_email)! }));
}
