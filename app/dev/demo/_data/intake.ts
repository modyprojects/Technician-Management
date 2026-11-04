// FICTITIOUS DATA ONLY: invitations the ingestion service could not ingest ("זימונים שלא נקלטו").
// Allowed only under app/dev (G-05). Server-side, for the fixture adapter only.
// One example per problem kind (spec "Invitation intake", IN-03, IN-04): a missing required label
// (also "מק"ט": a missing SKU is a problem, an unknown SKU is not, IN-02, D19), an unknown pickup
// place, an invalid value, and invitations with more than one problem. Every invitation comes from
// the invitation simulator ("🧪 זימון בדיקה", SIM-14, D24): Microsoft 365 is not connected (D23).
// People and addresses are fictional (example.test).
import "server-only";
import type { TemplateFieldKey } from "@/features/settings/data/types";
import type { VisitSource } from "./types";

export type DemoUnparsedProblem =
  | { kind: "missing"; field: TemplateFieldKey }
  | { kind: "unknown-place"; value: string }
  | { kind: "invalid"; field: TemplateFieldKey; value: string; expected: string };

export type DemoUnparsedInvitation = {
  id: string;
  /** ISO timestamp, Asia/Jerusalem offset. */
  receivedAt: string;
  source: VisitSource;
  subject: string;
  organizer: string;
  attendee: string;
  date: string;
  start: string;
  end: string;
  req: string | null;
  customer: string | null;
  problems: DemoUnparsedProblem[];
};

const CALL_TYPE_EXPECTED = "ערך מרשימת סוגי הקריאה בהגדרות";

/** Newest first is the adapter's order; listed here in the same order. */
export const UNPARSED_INVITATIONS: readonly DemoUnparsedInvitation[] = [
  {
    id: "inv-1007",
    receivedAt: "2026-10-21T09:02:00+03:00",
    source: "simulator",
    subject: "[קריאת שירות] רחל אברהם · רחובות",
    organizer: "shirel@example.test",
    attendee: "yoram@example.test",
    date: "2026-10-25",
    start: "09:00",
    end: "10:30",
    req: null,
    customer: "רחל אברהם",
    problems: [{ kind: "missing", field: "req" }],
  },
  {
    id: "inv-1006",
    receivedAt: "2026-10-21T08:12:00+03:00",
    source: "simulator",
    subject: "[קריאת שירות] 48262 · יעקב לוי",
    organizer: "shirel@example.test",
    attendee: "edi@example.test",
    date: "2026-10-22",
    start: "12:00",
    end: "13:30",
    req: "48262",
    customer: "יעקב לוי",
    problems: [{ kind: "missing", field: "customerNo" }],
  },
  {
    id: "inv-1005",
    receivedAt: "2026-10-21T07:40:00+03:00",
    source: "simulator",
    subject: "[קריאת שירות] 48261 · גלית שלום",
    organizer: "rep2@example.test",
    attendee: "shmuel@example.test",
    date: "2026-10-22",
    start: "15:00",
    end: "16:30",
    req: "48261",
    customer: "גלית שלום",
    problems: [{ kind: "unknown-place", value: "מחסן חולון" }],
  },
  {
    id: "inv-1004",
    receivedAt: "2026-10-20T16:05:00+03:00",
    source: "simulator",
    subject: "[קריאת שירות] 48259 · אריאל מלכה",
    organizer: "shirel@example.test",
    attendee: "yoram@example.test",
    date: "2026-10-26",
    start: "10:00",
    end: "11:30",
    req: "48259",
    customer: "אריאל מלכה",
    problems: [{ kind: "invalid", field: "type", value: "החלפה", expected: CALL_TYPE_EXPECTED }],
  },
  {
    id: "inv-1003",
    receivedAt: "2026-10-20T11:30:00+03:00",
    source: "simulator",
    subject: "[קריאת שירות] 48258 · סיגל נחום",
    organizer: "rep2@example.test",
    attendee: "edi@example.test",
    date: "2026-10-25",
    start: "13:00",
    end: "14:30",
    req: "48258",
    customer: "סיגל נחום",
    problems: [
      { kind: "missing", field: "phone" },
      { kind: "missing", field: "desc" },
    ],
  },
  {
    id: "inv-1002",
    receivedAt: "2026-10-19T09:15:00+03:00",
    source: "simulator",
    subject: "[קריאת שירות] 48257 · עומר דהן",
    organizer: "shirel@example.test",
    attendee: "shmuel@example.test",
    date: "2026-10-22",
    start: "08:00",
    end: "09:30",
    req: "48257",
    customer: "עומר דהן",
    problems: [
      // An invalid value of a required, list-backed field (the call type comes from the Settings
      // list). Whether an invalid value in an OPTIONAL field (for example "באחריות") blocks intake
      // is not specified (D17 makes warranty optional; TE-08 falls back to "לא צוין"): an owner
      // question, so no fixture shows it.
      { kind: "invalid", field: "type", value: "ביקור חוזר", expected: CALL_TYPE_EXPECTED },
      { kind: "unknown-place", value: "סניף חיפה" },
    ],
  },
  {
    id: "inv-1001",
    receivedAt: "2026-10-18T14:20:00+03:00",
    source: "simulator",
    subject: "[קריאת שירות] 48256 · ליאור ביטון",
    organizer: "office@example.test",
    attendee: "yoram@example.test",
    date: "2026-10-26",
    start: "14:00",
    end: "15:30",
    req: "48256",
    customer: "ליאור ביטון",
    problems: [{ kind: "missing", field: "sku" }],
  },
];
