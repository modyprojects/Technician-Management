// FICTITIOUS DATA ONLY: audited corrections of server-closed visits (OF-10, D14, D45; schema
// `visit_corrections` and correction rows of `visit_time_reports`). Allowed only under app/dev
// (G-05). Server-side, and only for the fixture adapter: screens read them through
// demoDataAccess.visits.corrections (eslint.config.mjs blocks direct imports).
// queries.ts applies them to the seeded calls, so every screen shows the current value (the
// latest correction) while the history keeps each original, as the database does. The outbox
// (outbox.ts) is a snapshot at closure and reads the seeded calls before corrections.
// Every person is fictional; every record is test data (D47). Times are ISO, +03:00.
import "server-only";
import {
  TIME_CORRECTION_FIELDS,
  type CorrectableVisitField,
  type CorrectionValue,
} from "@/features/visits/data/types";
import type { Call, Visit } from "./types";

export type DemoCorrection = {
  id: string;
  req: string;
  n: number;
  field: CorrectableVisitField;
  /** The value before this correction (checked against the seed at load time). */
  before: CorrectionValue;
  after: CorrectionValue;
  /** Office account id (accounts.ts) and its name. */
  by: { id: string; name: string };
  at: string;
  reason: string;
};

/** Every visit starts at version 1; each correction raises it by one. */
export const VISIT_BASE_VERSION = 1;

/**
 * Two closed visits with a history, oldest first per visit:
 * - 47969/1 (אדי, "טופל" on 20.10): the summary and the parts completed by the Manager the same
 *   evening, and the end time corrected by the Creator the next morning (a correction time report);
 * - 47948/1 (יורם, "המשך טיפול" on 19.10): the next-visit note and the arrival time corrected by the
 *   Manager.
 */
export const VISIT_CORRECTIONS: readonly DemoCorrection[] = [
  {
    id: "co-47969-1-1",
    req: "47969",
    n: 1,
    field: "summary",
    before: "בוצע תיקון, נבדק ותקין.",
    after: "הוחלפה מחסנית המפצל, נבדק מעבר בין ראש המקלחת לפיה ותקין.",
    by: { id: "acc-doron", name: "דורון" },
    at: "2026-10-20T17:42:00+03:00",
    reason: "הטכנאי מסר בטלפון פירוט שחסר בסיכום",
  },
  {
    id: "co-47969-1-2",
    req: "47969",
    n: 1,
    field: "parts",
    before: [],
    after: ["מחסנית מפצל BT-1120"],
    by: { id: "acc-doron", name: "דורון" },
    at: "2026-10-20T17:44:00+03:00",
    reason: "החלק הוחלף ולא נרשם בסיום הביקור",
  },
  {
    id: "co-47969-1-3",
    req: "47969",
    n: 1,
    field: "endAt",
    before: "16:39",
    after: "16:22",
    by: { id: "acc-creator", name: "משתמש יוצר" },
    at: "2026-10-21T08:15:00+03:00",
    reason: "הטכנאי סיים את הביקור באפליקציה רק אחרי שיצא מהבניין",
  },
  {
    id: "co-47948-1-1",
    req: "47948",
    n: 1,
    field: "nextNote",
    before: "להמשיך את הטיפול ולבדוק שאין נזילה",
    after: "להחליף את אטם מנגנון המילוי ולבדוק שאין נזילה לאסלה",
    by: { id: "acc-doron", name: "דורון" },
    at: "2026-10-19T12:10:00+03:00",
    reason: "עודכן לפי שיחה עם הלקוחה",
  },
  {
    id: "co-47948-1-2",
    req: "47948",
    n: 1,
    field: "arriveAt",
    before: "10:04",
    after: "09:58",
    by: { id: "acc-doron", name: "דורון" },
    at: "2026-10-20T08:30:00+03:00",
    reason: "הטכנאי דיווח שלחץ על \"הגעתי\" באיחור",
  },
];

/** The fixture field of a correctable field. */
const VISIT_FIELD: Readonly<Record<CorrectableVisitField, keyof Visit>> = {
  summary: "summary",
  parts: "parts",
  followupReason: "reason",
  nextNote: "nextNote",
  departAt: "departAt",
  arriveAt: "arriveAt",
  endAt: "endAt",
};

/** A correctable value of a fixture visit (the follow-up fields only for "המשך טיפול"). */
export function visitValue(v: Visit, field: CorrectableVisitField): CorrectionValue {
  if ((field === "followupReason" || field === "nextNote") && v.status !== "cont") return null;
  const value = v[VISIT_FIELD[field]];
  if (Array.isArray(value)) return [...value];
  return typeof value === "string" ? value : null;
}

const same = (a: CorrectionValue, b: CorrectionValue): boolean => JSON.stringify(a) === JSON.stringify(b);

/** A visit with one correction applied (a new object; the input is not changed). */
function withValue(v: Visit, field: CorrectableVisitField, value: CorrectionValue): Visit {
  const key = VISIT_FIELD[field];
  if (field === "parts") return { ...v, parts: Array.isArray(value) ? [...value] : [] };
  if (TIME_CORRECTION_FIELDS.includes(field)) return { ...v, [key]: typeof value === "string" ? value : null };
  return { ...v, [key]: typeof value === "string" ? value : "" };
}

/**
 * The seeded calls with every correction applied in order. Each correction's `before` must equal
 * the value it corrects, so the fixture cannot drift from the seed (checked when the module loads).
 */
export function applyCorrections(calls: readonly Call[]): Call[] {
  const byVisit = new Map<string, DemoCorrection[]>();
  for (const x of VISIT_CORRECTIONS) byVisit.set(`${x.req}/${x.n}`, [...(byVisit.get(`${x.req}/${x.n}`) ?? []), x]);
  return calls.map((c) => {
    if (!c.visits.some((v) => byVisit.has(`${c.req}/${v.n}`))) return c;
    return {
      ...c,
      visits: c.visits.map((v) => {
        let out = v;
        for (const x of byVisit.get(`${c.req}/${v.n}`) ?? []) {
          if (v.status !== "done" && v.status !== "cont") throw new Error(`Correction ${x.id}: visit is not closed`);
          if (!same(visitValue(out, x.field), x.before)) throw new Error(`Correction ${x.id}: "before" does not match the seed`);
          out = withValue(out, x.field, x.after);
        }
        return out;
      }),
    };
  });
}

/** The corrections of one visit, oldest first. */
export const correctionsOf = (req: string, n: number): DemoCorrection[] => VISIT_CORRECTIONS.filter((x) => x.req === req && x.n === n);
