// Mock outbox viewer URL state (?page=&id=). Pure: used by the viewer page on the server and by
// links. Unknown or malformed values fall back to defaults (page 1, no selection).
import { clampPage } from "@/features/data-access/common";
import { isOutboxId } from "./validate";

/** The list page and the selected row (null: the page's first row). */
export type OutboxViewState = { page: number; id: string | null };

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

export function parseOutboxViewState(sp: SearchParamsLike | URLSearchParams): OutboxViewState {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? undefined) : first(sp[k]));
  const id = get("id");
  return { page: clampPage(get("page")), id: isOutboxId(id) ? id : null };
}

/** `pathname?page=…&id=…` with defaults left out. */
export function outboxHref(pathname: string, state: Partial<OutboxViewState> = {}): string {
  const sp = new URLSearchParams();
  if (state.page !== undefined && Number.isInteger(state.page) && state.page > 1) sp.set("page", String(state.page));
  if (state.id && isOutboxId(state.id)) sp.set("id", state.id);
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
