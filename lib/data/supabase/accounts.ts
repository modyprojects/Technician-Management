// The real AccountsQueries for this request (D60 (7) unified user management; Step 2 plan §3.7).
// Server-only. The session's user comes from lib/auth/session.ts (server-validated); every read runs
// under that user's own session (RLS), through features/accounts/supabase/queries.ts. Without a
// signed-in Creator or Manager every list is empty and get() is null (deny by default); without the
// Supabase configuration likewise (fail closed). A failed read throws AccountsQueryError (a code
// only), logged here by its code; the page fails closed.
import "server-only";
import type { AccountsQueries } from "@/features/accounts/data/ports";
import { accountsQueriesOf, AccountsQueryError } from "@/features/accounts/supabase/queries";
import { logAuthEvent } from "@/lib/auth/log";
import { getSessionState } from "@/lib/auth/session";
import { createUserSupabaseClient } from "@/lib/supabase/server";

const EMPTY_PAGE = { items: [], total: 0, page: 1, limit: 0, pageCount: 1 } as const;

/** Deny by default: nothing for a caller without a session, configuration or account role. */
const NONE: AccountsQueries = {
  list: async () => ({ ...EMPTY_PAGE, items: [] }),
  get: async () => null,
  openCreations: async () => ({ ...EMPTY_PAGE, items: [] }),
  creatorNotices: async () => ({ ...EMPTY_PAGE, items: [] }),
};

/** Logs a failed read by its code (docs/security.md §8) and rethrows, so the page fails closed. */
function logged(queries: AccountsQueries): AccountsQueries {
  const wrap =
    <A extends unknown[], R>(name: string, fn: (...args: A) => Promise<R>) =>
    async (...args: A): Promise<R> => {
      try {
        return await fn(...args);
      } catch (error) {
        logAuthEvent(`accounts.query.${name}_failed`, error instanceof AccountsQueryError ? error.code : "exception");
        throw error;
      }
    };
  return {
    list: wrap("list", queries.list),
    get: wrap("get", queries.get),
    openCreations: wrap("open_creations", queries.openCreations),
    creatorNotices: wrap("creator_notices", queries.creatorNotices),
  };
}

/** The accounts queries of this request's signed-in user, under his own session. */
export async function accountsQueries(): Promise<AccountsQueries> {
  const state = await getSessionState();
  if (state.kind !== "signed-in") return NONE;
  const client = await createUserSupabaseClient();
  if (!client) return NONE;
  return logged(accountsQueriesOf(client, state.user));
}
