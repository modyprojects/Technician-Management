// FICTITIOUS DATA ONLY: the mock completion-email outbox (X-06, EM-01 to EM-05, D09; schema
// `email_outbox`, Step 7). Allowed only under app/dev (G-05). Server-side, and only for the fixture
// adapter: the /dev outbox viewer reads it through demoDataAccess.outbox.
// One row per closed visit of the seed (D09: both outcomes; one logical notification per closure,
// unique (visit, event)). The row is a snapshot written when the server accepted the closure, so
// it reads the seeded calls before any later audited correction (corrections.ts). Nothing is ever
// sent: every row is test data (SIM-09, D24).
import "server-only";
import { fromMin, toMin } from "./dates";
import { CALLS as SEEDED_CALLS } from "./seed";
import type { Call, Visit } from "./types";

export type DemoOutboxRow = {
  id: string;
  idempotencyKey: string;
  /** The call and the visit as they were at closure. */
  c: Call;
  v: Visit;
  /** Written with the server's acceptance of the closure (a minute after the reported end). */
  createdAt: string;
};

const isClosed = (v: Visit): boolean => v.status === "done" || v.status === "cont";

/** The server acceptance time of a closure in the fixtures: one minute after the reported end. */
function acceptedAt(v: Visit): string {
  const end = v.endAt ?? v.end;
  return `${v.date}T${fromMin(Math.min(toMin(end) + 1, 23 * 60 + 59))}:00+03:00`;
}

/** One logical completion notification per visit (D09): the key a database enforces as unique (visit, event). */
export const completionKey = (req: string, n: number): string => `visit-completion:${req}-${n}`;

/** Every row, newest first (ties: request number, then visit number). */
export const OUTBOX_ROWS: readonly DemoOutboxRow[] = SEEDED_CALLS.flatMap((c) =>
  c.visits.filter(isClosed).map((v) => ({ id: `ob-${c.req}-${v.n}`, idempotencyKey: completionKey(c.req, v.n), c, v, createdAt: acceptedAt(v) })),
).sort((a, b) => b.createdAt.localeCompare(a.createdAt) || b.c.req.localeCompare(a.c.req) || b.v.n - a.v.n);

const BY_ID = new Map(OUTBOX_ROWS.map((r) => [r.id, r]));

/** One row by id (own entries only). */
export const findOutboxRow = (id: string): DemoOutboxRow | undefined => BY_ID.get(id);
