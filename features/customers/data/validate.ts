// Input checks for the customers list and card, shared by every implementation (fixtures now, the
// server later; the server always re-validates and authorizes `calls` in the database).
import { clampLimit, clampPage, isUuid, normalizeQuery } from "@/features/data-access/common";
import type { CustomerId, CustomerListQuery } from "./types";

const KEY = /^[A-Za-z0-9-]{1,64}$/;

/** Customer id: a database uuid, or a short fixture key. Never a customer number on its own. */
export const isCustomerId = (value: unknown): value is CustomerId => isUuid(value) || (typeof value === "string" && KEY.test(value));

/** The list query with every field validated: search cut to 100 characters, page and limit clamped. */
export function normalizeCustomerListQuery(query: CustomerListQuery | undefined): Required<Pick<CustomerListQuery, "q" | "page" | "limit">> {
  const f = query ?? {};
  return { q: normalizeQuery(f.q), page: clampPage(f.page), limit: clampLimit(f.limit) };
}
