// "פריטים לבדיקה" URL state (?status=&page=) ↔ ReviewListQuery. Pure: used by the list page on the
// server (to query the layer) and by the browser (links). Unknown or malformed values fall back to
// defaults. The default view is the open items ("פתוחים").
import { clampPage } from "@/features/data-access/common";
import { isReviewStatus, type ReviewListQuery, type ReviewStatus } from "./types";

/** "all" or one status; the default is "open". */
export type ReviewListState = { status: ReviewStatus | "all"; page: number };

export const DEFAULT_REVIEW_STATUS: ReviewListState["status"] = "open";

type SearchParamsLike = Record<string, string | string[] | undefined>;

const first = (v: string | string[] | undefined): string | undefined => (Array.isArray(v) ? v[0] : v);

const isStatusParam = (v: unknown): v is ReviewListState["status"] => v === "all" || isReviewStatus(v);

export function parseReviewListState(sp: SearchParamsLike | URLSearchParams): ReviewListState {
  const get = (k: string) => (sp instanceof URLSearchParams ? (sp.get(k) ?? undefined) : first(sp[k]));
  const status = get("status");
  return { status: isStatusParam(status) ? status : DEFAULT_REVIEW_STATUS, page: clampPage(get("page")) };
}

/** The query the layer receives for this state. */
export const reviewListQueryOf = (state: ReviewListState, limit?: number): ReviewListQuery => ({
  status: state.status === "all" ? undefined : state.status,
  page: state.page,
  limit,
});

/** `pathname?status=…&page=…` with defaults left out. */
export function reviewListHref(pathname: string, state: Partial<ReviewListState> = {}): string {
  const sp = new URLSearchParams();
  if (state.status !== undefined && isStatusParam(state.status) && state.status !== DEFAULT_REVIEW_STATUS) sp.set("status", state.status);
  if (state.page !== undefined && Number.isInteger(state.page) && state.page > 1) sp.set("page", String(state.page));
  const qs = sp.toString();
  return qs ? `${pathname}?${qs}` : pathname;
}
