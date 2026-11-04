"use client";

// The calls list's interactive controls for the UI demo (D53). The rows come from the server,
// already filtered and paged by the data-access layer (calls.list); this component only keeps
// the controls in the URL (?q=&status=&tech=&page=), so the same query works against Supabase
// later (OF-04). Search is debounced; chips and the technician select update the URL at once.
import { usePathname, useRouter } from "next/navigation";
import { useEffect, useOptimistic, useRef, useState, useTransition } from "react";
import { CallFilters, type CallStatusFilter, type CallStatusOption, type CallTechOption } from "@/components/office/CallFilters";
import { CallsTable, type CallsTableRow } from "@/components/office/CallsTable";
import { Pager } from "@/components/ui/Pager";
import { callsListHref, type CallsListState } from "@/features/calls/data/search-params";
import { normalizeQuery } from "@/features/data-access/common";

const SEARCH_DEBOUNCE_MS = 300;

export function CallsBrowser({
  rows,
  total,
  pageCount,
  state,
  statusOptions,
  techOptions,
}: {
  /** The current page of matching calls, newest first. */
  rows: readonly CallsTableRow[];
  /** Matching calls before paging. */
  total: number;
  pageCount: number;
  /** The URL state the server used for `rows`. */
  state: CallsListState;
  statusOptions: readonly CallStatusOption[];
  techOptions: readonly CallTechOption[];
}) {
  const router = useRouter();
  const pathname = usePathname();
  const [pending, startTransition] = useTransition();

  // Chips and select show the new value at once, while the server renders the new rows.
  const [shown, setShown] = useOptimistic({ status: state.status, tech: state.tech });

  // The search box keeps what the user types; it follows the URL only when the URL changes
  // from outside (back / forward), not when it catches up with our own debounced update.
  const [query, setQuery] = useState(state.q);
  const [urlQ, setUrlQ] = useState(state.q);
  const [sentQ, setSentQ] = useState(state.q);
  if (state.q !== urlQ) {
    setUrlQ(state.q);
    if (state.q !== sentQ) {
      setQuery(state.q);
      setSentQ(state.q);
    }
  }

  const timer = useRef<ReturnType<typeof setTimeout> | undefined>(undefined);
  useEffect(() => () => clearTimeout(timer.current), []);

  function go(next: Partial<CallsListState>) {
    clearTimeout(timer.current);
    const target: CallsListState = { q: query, status: shown.status, tech: shown.tech, ...next, page: 1 };
    setSentQ(normalizeQuery(target.q));
    startTransition(() => {
      setShown({ status: target.status, tech: target.tech });
      router.replace(callsListHref(pathname, target), { scroll: false });
    });
  }

  function onQueryChange(next: string) {
    setQuery(next);
    clearTimeout(timer.current);
    timer.current = setTimeout(() => go({ q: next }), SEARCH_DEBOUNCE_MS);
  }

  const pageHref = (page: number) => callsListHref(pathname, { ...state, page });

  return (
    <>
      <CallFilters
        query={query}
        onQueryChange={onQueryChange}
        tech={shown.tech}
        techOptions={techOptions}
        onTechChange={(tech) => go({ tech })}
        status={shown.status}
        statusOptions={statusOptions}
        onStatusChange={(status: CallStatusFilter) => go({ status })}
      />
      <div aria-busy={pending} style={{ display: "contents" }}>
        <CallsTable rows={rows} total={total} />
      </div>
      <Pager
        page={state.page}
        pageCount={pageCount}
        prevHref={state.page > 1 ? pageHref(state.page - 1) : null}
        nextHref={state.page < pageCount ? pageHref(state.page + 1) : null}
      />
    </>
  );
}
