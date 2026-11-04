// Input checks for the products list and the product edit (PR-06, PR-07), shared by every
// implementation (simulated now, the server later; the server always re-validates, checks the
// caller's `products` capability in the database and the row version, D44). Each error is a short
// Hebrew message, or null when valid.
import { clampLimit, clampPage, isUuid, normalizeQuery } from "@/features/data-access/common";
import { isNormalizedSku, type BrandId, type ProductListQuery, type ProductUpdateInput, type SupplierId } from "./types";

export const PRODUCT_NAME_MAX = 120;

const KEY = /^[A-Za-z0-9-]{1,64}$/;

/** Brand and supplier ids: fixture keys now, database UUIDs later. */
export const isProductOptionId = (value: unknown): value is BrandId | SupplierId =>
  isUuid(value) || (typeof value === "string" && KEY.test(value));

/** The list query with every field validated: search cut to 100 characters, page and limit clamped. */
export function normalizeProductListQuery(query: ProductListQuery | undefined): Required<Pick<ProductListQuery, "q" | "page" | "limit">> {
  const f = query ?? {};
  return { q: normalizeQuery(f.q), page: clampPage(f.page), limit: clampLimit(f.limit) };
}

export const skuError = (sku: unknown): string | null => (isNormalizedSku(sku) ? null : 'מק"ט לא תקין');

export function productNameError(name: unknown): string | null {
  if (typeof name !== "string") return "שם מוצר לא תקין";
  const t = name.trim();
  if (!t) return "חסר שם מוצר";
  return t.length > PRODUCT_NAME_MAX ? `השם ארוך מ-${PRODUCT_NAME_MAX} תווים` : null;
}

/**
 * The edit (PR-06): a valid SKU and version, at least one field, a non-empty name when given, and
 * brand and supplier as an id or null (null clears it: "לא הוזן"). Whether the ids exist and are
 * active is checked against stored data (productOptionError).
 */
export function productUpdateError(input: ProductUpdateInput): string | null {
  if (!input || typeof input !== "object") return "קלט לא תקין";
  const sku = skuError(input.sku);
  if (sku) return sku;
  if (!Number.isInteger(input.expectedVersion) || input.expectedVersion < 1) return "גרסה לא תקינה";
  const { name, brandId, supplierId } = input;
  if (name === undefined && brandId === undefined && supplierId === undefined) return "אין שינוי לשמור";
  if (name !== undefined) {
    const e = productNameError(name);
    if (e) return e;
  }
  if (brandId !== undefined && brandId !== null && !isProductOptionId(brandId)) return "מותג לא תקין";
  if (supplierId !== undefined && supplierId !== null && !isProductOptionId(supplierId)) return "ספק לא תקין";
  return null;
}

/**
 * A brand or supplier chosen in an edit must exist and be active (`stored` is what the server has
 * for the id; undefined when it does not exist). Null or undefined input (clear, or unchanged) is valid.
 */
export function productOptionError(
  id: string | null | undefined,
  stored: { active: boolean } | undefined,
  what: "מותג" | "ספק",
): string | null {
  if (id === undefined || id === null) return null;
  if (!stored) return `ה${what} לא נמצא`;
  return stored.active ? null : `ה${what} לא פעיל`;
}

/**
 * The product must exist, and the edit must start from its current version (D44; production
 * merges an edit whose fields did not change in between, and stores a conflict for review).
 */
export function productVersionError(expectedVersion: number, stored: { version: number } | undefined): string | null {
  if (!stored) return "המוצר לא נמצא";
  return stored.version === expectedVersion ? null : "המוצר עודכן בינתיים · יש לרענן את הדף";
}
