// FICTITIOUS DATA ONLY: the demo's product catalogue as the "מוצרים" screen sees it (PR-01 to
// PR-07, D19). Allowed only under app/dev (G-05). Server-side, for the fixture adapter only.
// Each product's first-seen invitation is its earliest opened call (opened_at, D57 (9)) and that
// call's first visit; brand and supplier ids come from the BRANDS and SUPPLIERS names ("" = not
// entered, PR-04).
import "server-only";
import { byOpening } from "./customers";
import { CALLS } from "./queries";
import { BRANDS, CATALOGUE, SUPPLIERS } from "./reference";
import type { Call, Product } from "./types";

export type DemoCatalogueProduct = {
  product: Product;
  brandId: string | null;
  supplierId: string | null;
  /** The product's calls, oldest opened first (opened_at, D57 (9)). */
  calls: readonly Call[];
  customerCount: number;
  /** Row version (D44): 1 at creation; TB-75 had its brand added once (PR-06). */
  version: number;
};

const idOf = (list: readonly { id: string; name: string }[], name: string): string | null =>
  name ? (list.find((x) => x.name === name)?.id ?? null) : null;

/** Edits made after creation (version above 1). */
const EDITED: Readonly<Record<string, number>> = { "TB-75": 2 };

/** Every product by SKU (computed once). */
export const CATALOGUE_BY_SKU: readonly DemoCatalogueProduct[] = [...CATALOGUE]
  .sort((a, b) => a.sku.localeCompare(b.sku))
  .map((p) => {
    const calls = CALLS.filter((c) => c.sku === p.sku).sort(byOpening);
    return {
      product: p,
      brandId: idOf(BRANDS, p.brand),
      supplierId: idOf(SUPPLIERS, p.sup),
      calls,
      customerCount: new Set(calls.map((c) => c.customerNo)).size,
      version: EDITED[p.sku] ?? 1,
    };
  });

const BY_SKU = new Map(CATALOGUE_BY_SKU.map((x) => [x.product.sku, x]));

export const findCatalogueProduct = (sku: string): DemoCatalogueProduct | undefined => BY_SKU.get(sku);
