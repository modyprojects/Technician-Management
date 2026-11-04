// Calls-list URL state (?q=&status=&tech=&page=) ↔ CallFilter. Pure: used by the list page on
// the server (to query the layer) and by the browser (to update the URL), so a Supabase adapter
// receives exactly the same filter. Unknown or malformed values fall back to defaults.
import { clampPage, normalizeQuery } from "@/features/data-access/common";
import { isTechnicianId } from "@/features/reference/data/validate";
import { isCallStatus, type CallFilter, type CallStatus } from "./types";

/** What the calls-list controls show. */
export type CallsListState = {
  q: string;
  /** "all" or one service-call status. */
  status: "all" | CallStatus;
  /** "all" or a technician id. */
  tech: string;
  page: number;
};

export const ALL = "all";

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseCallsListState(sp: SearchParamsLike | URLSearchParams): CallsListState {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? undefined) : first(sp[k]));
  const status = get("status");
  const tech = get("tech");
  return {
    q: normalizeQuery(get("q")),
    status: isCallStatus(status) ? status : ALL,
    tech: tech && tech !== ALL && isTechnicianId(tech) ? tech : ALL,
    page: clampPage(get("page")),
  };
}

/** The query the layer receives for this state. */
export function callFilterOf(state: CallsListState, limit?: number): CallFilter {
  return {
    q: state.q,
    statuses: state.status === ALL ? [] : [state.status],
    technicianId: state.tech === ALL ? undefined : state.tech,
    page: state.page,
    limit,
  };
}

/** `pathname?q=…` with defaults left out. */
export function callsListHref(pathname: string, state: CallsListState): string {
  const sp = new URLSearchParams();
  const q = normalizeQuery(state.q);
  if (q) sp.set("q", q);
  if (state.status !== ALL) sp.set("status", state.status);
  if (state.tech !== ALL) sp.set("tech", state.tech);
  if (state.page > 1) sp.set("page", String(state.page));
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
