// Customers-list URL state (?q=&page=) ↔ CustomerListQuery. Pure: used by the list page on the
// server (to query the layer) and by the browser (to update the URL). Unknown or malformed values
// fall back to defaults.
import { clampPage, normalizeQuery } from "@/features/data-access/common";
import type { CustomerListQuery } from "./types";

export type CustomersListState = { q: string; page: number };

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseCustomersListState(sp: SearchParamsLike | URLSearchParams): CustomersListState {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? undefined) : first(sp[k]));
  return { q: normalizeQuery(get("q")), page: clampPage(get("page")) };
}

/** The query the layer receives for this state. */
export const customerListQueryOf = (state: CustomersListState, limit?: number): CustomerListQuery => ({
  q: state.q,
  page: state.page,
  limit,
});

/** `pathname?q=…&page=…` with defaults left out. */
export function customersListHref(pathname: string, state: Partial<CustomersListState> = {}): string {
  const sp = new URLSearchParams();
  const q = normalizeQuery(state.q);
  if (q) sp.set("q", q);
  if (state.page !== undefined && Number.isInteger(state.page) && state.page > 1) sp.set("page", String(state.page));
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
