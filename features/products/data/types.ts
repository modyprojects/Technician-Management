// Product DTOs: the office "מוצרים" screen (PR-06, D19; matrix key `products`) and the product
// facts other screens show (customer card, dashboards). Pure types, enums and rules (no data).
// See features/data-access/common.ts.
// Products are built from invitations (D19, PR-01 to PR-07): no import and no delete; one product
// per normalized SKU; a new SKU creates the product with its SKU and name, brand and supplier
// empty; a later invitation never overwrites an existing name. Only a role offered `products`
// edits name, brand and supplier (D33; display only here, enforced on the server and in RLS).
import type { Bounded, IsoDate, Page, PageRequest, TestMarker } from "@/features/data-access/common";
import type { CallSummary } from "@/features/calls/data/types";
import type { Product } from "@/features/reference/data/types";
import type { VisitSource } from "@/features/visits/data/types";

export type { Product };

/** Brand id (`brands.id`, a uuid in the database; a short key in the fixtures). */
export type BrandId = string;

/** Supplier id (`suppliers.id`, a uuid in the database; a short key in the fixtures). */
export type SupplierId = string;

/** A brand or a supplier (optional product reference data, D19; deactivated, never deleted). */
export type ProductOption = TestMarker & {
  id: string;
  name: string;
  /** Inactive options stay on the products that use them but are not offered for new edits. */
  active: boolean;
};

/**
 * The invitation that created the product (PR-04): its request number, visit number, the date of
 * that visit and its source (SIM-14). Null when the creating call is not visible to the viewer.
 */
export type ProductFirstSeen = TestMarker & {
  req: string;
  n: number;
  date: IsoDate;
  source: VisitSource;
};

/** One row of the products list. `brand` and `supplier` are "" when not entered (screens show "לא הוזן", PR-04, OF-07). */
export type ProductListItem = Product & {
  brandId: BrandId | null;
  supplierId: SupplierId | null;
  firstSeen: ProductFirstSeen | null;
  /** Service calls for this SKU. */
  callCount: number;
  /** Row version for concurrent edits (D44: an edit sends the version it started from). */
  version: number;
};

/** Cap of the calls a product card lists (newest first); `total` gives the rest. */
export const PRODUCT_CALLS_LIMIT = 20;

/** The product with its latest calls (the edit form and a product card). */
export type ProductDetail = ProductListItem & {
  /** Distinct customers with a call for this SKU. */
  customerCount: number;
  /** Latest calls for this SKU, newest first (at most PRODUCT_CALLS_LIMIT). */
  calls: Bounded<CallSummary>;
};

/** Products-list query. Every field is optional; adapters validate and clamp it. */
export type ProductListQuery = PageRequest & {
  /** Search over SKU (normalized, PR-07), name, brand and supplier. */
  q?: string;
};

export type ProductsPage = Page<ProductListItem>;

/**
 * "מוצרים" edit (PR-06): name, brand and supplier. A field left out is unchanged; `null` clears
 * the brand or the supplier ("לא הוזן"). The SKU itself is never edited (PR-05, PR-07).
 */
export type ProductUpdateInput = {
  /** Normalized SKU of the product (normalizeSku). */
  sku: string;
  /** The version the edit started from (D44). */
  expectedVersion: number;
  name?: string;
  brandId?: BrandId | null;
  supplierId?: SupplierId | null;
};

/**
 * "Products that came back within a short time" (spec office screens: customer card and the
 * "מוצרים וספקים" dashboard; OF-13): a service call is a return of a product when the same
 * customer had an earlier call for the same SKU with a closed visit, and the new call's first
 * visit is at most this many days after the earlier call's latest closed visit.
 * TEMPORARY, owner to confirm (the spec says only "within a short time"; open #15 / #20, d23 / d31).
 */
export const PRODUCT_RETURN_WINDOW_DAYS = 30;

/** Longest SKU accepted (PR-07). */
export const SKU_MAX = 40;

/** PR-07: a SKU is matched trimmed and in upper case, so "kt-2041 " and "KT-2041" are one product. */
export const normalizeSku = (sku: unknown): string => (typeof sku === "string" ? sku.trim().toUpperCase() : "");

const CONTROL = /[\u0000-\u001f\u007f]/;

/** A normalized SKU: 1 to SKU_MAX printable characters, already trimmed and upper-case. */
export const isNormalizedSku = (value: unknown): value is string =>
  typeof value === "string" && value.length > 0 && value.length <= SKU_MAX && !CONTROL.test(value) && normalizeSku(value) === value;
