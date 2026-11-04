// Reference-data port. Implemented by app/dev/demo/_data/adapter.ts (fictional fixtures) and,
// later, by a server-side Supabase adapter. Every method is async and returns DTOs only.
// Every list is bounded: the catalogue is paged; the Settings lists are short, owner-maintained
// lists capped at MAX_PAGE_LIMIT (100) by the adapter.
import type { Page, PageRequest } from "@/features/data-access/common";
import type { ApprovalText, OfficeRole, Place, Product, Reason, RolePermissions, Technician } from "./types";

export interface ReferenceQueries {
  /** Technicians in Settings order (active and inactive); at most MAX_PAGE_LIMIT. */
  technicians(): Promise<Technician[]>;
  /** Product catalogue by SKU, paged (default 40, at most 100). It grows with every new SKU (D19). */
  products(page?: PageRequest): Promise<Page<Product>>;
  /** Follow-up reasons in Settings order; at most MAX_PAGE_LIMIT. */
  reasons(): Promise<Reason[]>;
  /** Pickup places in Settings order; at most MAX_PAGE_LIMIT. */
  places(): Promise<Place[]>;
  /** The current "טופל" approval text and its version, shown on the close screen (D43, TE-19). */
  approvalText(): Promise<ApprovalText>;
  /**
   * What the office role's screens offer. Manager and Customer Service: their permission-matrix
   * values (D33; status "temporary" until the owner approves the final matrix, D51). Creator:
   * every key true with the status "fixed" (D33: Creator capabilities are fixed, never matrix
   * values). Screens and navigation read them here (helpers in ./permissions) and use them for
   * display only; enforcement is on the server and in the database (G-04). A value that is not an
   * office role is a RangeError.
   */
  permissions(role: OfficeRole): Promise<RolePermissions>;
}
