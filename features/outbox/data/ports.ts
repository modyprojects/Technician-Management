// Outbox ports (the /dev mock outbox viewer, X-06; EM-01 to EM-05, D09). Read-only: there is no
// send, resend or delete command. Implemented by app/dev/demo/_data/adapter.ts (fictional
// fixtures) and, in Step 7, by a server-only adapter over `email_outbox` for a developer tool behind
// /dev (never an app screen). The outbox row is written by the server in the same transaction as
// the visit completion, never by a client.
import type { OutboxEmail, OutboxId, OutboxListQuery, OutboxPage } from "./types";

export interface OutboxQueries {
  /** Outbox rows newest first; paged (default 40, at most 100). */
  list(query?: OutboxListQuery): Promise<OutboxPage>;
  /** One row with the full email model; null when not found. */
  get(id: OutboxId): Promise<OutboxEmail | null>;
}
