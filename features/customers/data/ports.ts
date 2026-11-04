// Customer ports (spec office screens "לקוחות" and the customer card; OF-16, matrix key `calls`).
// Implemented by app/dev/demo/_data/adapter.ts (fictional fixtures) and, later, by a server-side
// Supabase adapter under the caller's session (RLS: rows readable with `cal` or `calls`).
// Read-only: customer details change only through invitations (D39) and audited corrections.
import type { CustomerDetail, CustomerId, CustomerListQuery, CustomersPage } from "./types";

export interface CustomersQueries {
  /**
   * Customers by latest activity, newest first, searched (name, customer number, phone with or
   * without dashes, city) and paged (default 40, at most 100; OF-04, OF-05).
   */
  list(query?: CustomerListQuery): Promise<CustomersPage>;
  /** The customer card; null when not found (or not visible). */
  get(id: CustomerId): Promise<CustomerDetail | null>;
}
