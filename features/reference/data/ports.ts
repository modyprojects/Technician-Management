// Reference-data port. Implemented by app/dev/demo/_data/adapter.ts (fictional fixtures) and,
// later, by a server-side Supabase adapter. Every method is async and returns DTOs only.
import type { OfficeRole, Place, Product, Reason, RolePermissions, Technician } from "./types";

export interface ReferenceQueries {
  /** Technicians in Settings order (active and inactive). */
  technicians(): Promise<Technician[]>;
  /** Product catalogue (built from invitations, D19). */
  products(): Promise<Product[]>;
  /** Follow-up reasons in Settings order. */
  reasons(): Promise<Reason[]>;
  /** Pickup places in Settings order. */
  places(): Promise<Place[]>;
  /** The role's permission-matrix values (display only; D33, temporary per D51). */
  permissions(role: OfficeRole): Promise<RolePermissions>;
}
