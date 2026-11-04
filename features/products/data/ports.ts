// Product ports (PR-01 to PR-07, D19). Implemented by app/dev/demo/_data/adapter.ts (queries,
// fictional fixtures), app/dev/demo/_components/SimulatedCommands.tsx (commands, simulated) and,
// later, by Supabase adapters that run on the server under the caller's session (RLS; product
// writes only through the `update_product` RPC with the matrix key `products`).
// No import, create or delete: products come only from invitations (the ingestion service).
import type { Bounded, CommandResult } from "@/features/data-access/common";
import type { ProductDetail, ProductListQuery, ProductOption, ProductsPage, ProductUpdateInput } from "./types";

export interface ProductsQueries {
  /** Products by SKU, searched (SKU, name, brand, supplier) and paged (default 40, at most 100). */
  list(query?: ProductListQuery): Promise<ProductsPage>;
  /** One product by normalized SKU, with its latest calls; null when not found (or not visible). */
  get(sku: string): Promise<ProductDetail | null>;
  /** Brands by name (active and inactive), at most MAX_PAGE_LIMIT. */
  brands(): Promise<Bounded<ProductOption>>;
  /** Suppliers by name (active and inactive), at most MAX_PAGE_LIMIT. */
  suppliers(): Promise<Bounded<ProductOption>>;
}

export interface ProductCommands {
  /**
   * Edits name, brand and supplier (PR-06; matrix key `products`, D33). Never the SKU. Every edit
   * is audited with its field history (`entity_changes`). Rejected for an unknown product, a stale
   * version (D44), or an unknown or inactive brand or supplier.
   */
  update(input: ProductUpdateInput): Promise<CommandResult>;
}
