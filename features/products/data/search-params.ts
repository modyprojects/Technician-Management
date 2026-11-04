// Products-list URL state (?q=&page=) ↔ ProductListQuery. Pure: used by the list page on the
// server (to query the layer) and by the browser (to update the URL). Unknown or malformed values
// fall back to defaults.
import { clampPage, normalizeQuery } from "@/features/data-access/common";
import type { ProductListQuery } from "./types";

export type ProductsListState = { q: string; page: number };

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseProductsListState(sp: SearchParamsLike | URLSearchParams): ProductsListState {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? undefined) : first(sp[k]));
  return { q: normalizeQuery(get("q")), page: clampPage(get("page")) };
}

/** The query the layer receives for this state. */
export const productListQueryOf = (state: ProductsListState, limit?: number): ProductListQuery => ({
  q: state.q,
  page: state.page,
  limit,
});

/** `pathname?q=…&page=…` with defaults left out. */
export function productsListHref(pathname: string, state: Partial<ProductsListState> = {}): string {
  const sp = new URLSearchParams();
  const q = normalizeQuery(state.q);
  if (q) sp.set("q", q);
  if (state.page !== undefined && Number.isInteger(state.page) && state.page > 1) sp.set("page", String(state.page));
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
