// FICTITIOUS DATA ONLY: the demo's reference data. Allowed only under app/dev (G-05).
// Ported from docs/demo.html "reference data" (L265-305). Email addresses use the reserved
// example.test domain instead of the demo's example.co.il. Order and weights must stay as in
// the demo: the seeded calls (seed.ts) depend on them.
import "server-only";
import type { OfficeRole, Place, Product, Reason, Tech, TechId, User } from "./types";

export const TECHS: readonly Tech[] = [
  { id: "y", name: "יורם", color: "var(--t-y)", phone: "050-000-0001", email: "yoram@example.test" },
  { id: "e", name: "אדי", color: "var(--t-e)", phone: "050-000-0002", email: "edi@example.test" },
  { id: "s", name: "שמואל", color: "var(--t-s)", phone: "050-000-0003", email: "shmuel@example.test" },
];

export const TECH_IDS: readonly TechId[] = ["y", "e", "s"];

/** The technician the demo signs in as (G-03: production takes identity from the session). */
export const ME: TechId = "y";

/** Technician by id. */
export function tech(id: TechId): Tech {
  const t = TECHS.find((x) => x.id === id);
  if (!t) throw new Error(`Unknown technician ${id}`);
  return t;
}

/** Pickup places (Settings › מקומות איסוף). */
export const PLACES: readonly Place[] = [
  { name: "מרלוג", type: "מרכז לוגיסטי", addr: "הרכבת 12, אזור תעשייה", phone: "03-000-1000", hours: "א׳–ה׳ 07:00–16:00", on: true },
  { name: "סניף בני ברק", type: "סניף", addr: "ז׳בוטינסקי 100, בני ברק", phone: "03-000-2000", hours: "א׳–ה׳ 08:00–19:00", on: true },
  { name: "סניף ראשון לציון", type: "סניף", addr: "רוטשילד 50, ראשון לציון", phone: "03-000-3000", hours: "א׳–ה׳ 08:00–19:00", on: true },
];

export const PRODUCTS: readonly Product[] = [
  { sku: "BT-1120", name: "ברז אמבטיה רב-דרך", brand: "אקווה-ליין", sup: "מ.ס. יבוא", w: 5, issues: ["המפצל לא מעביר", "טפטוף מהפיה"] },
  { sku: "KT-2041", name: "ברז מטבח נשלף", brand: "אקווה-ליין", sup: "מ.ס. יבוא", w: 4, issues: ["טפטוף", "הנשלף לא חוזר למקום"] },
  { sku: "WC-300", name: "מיכל הדחה סמוי", brand: "נובה", sup: "גל-טק סחר", w: 3, issues: ["ההדחה לא נעצרת", "נזילה לאסלה"] },
  { sku: "SH-510", name: "מערכת מקלחת תרמוסטטית", brand: "טרה-סאן", sup: "א.ר. אינסטלציה", w: 2, issues: ["המים לא מתחממים"] },
  { sku: "KT-1800", name: "ברז מטבח פרח", brand: "נובה", sup: "גל-טק סחר", w: 2, issues: ["ידית רופפת"] },
  { sku: "BS-220", name: "כיור אמבטיה + סיפון", brand: "פלורה", sup: "מ.ס. יבוא", w: 1, issues: ["נזילה מהסיפון"] },
];

/**
 * ADD (PR-01 to PR-04, D19): products the ingestion created from an invitation's SKU and name,
 * brand and supplier empty at creation ("לא הוזן", PR-04, OF-07). TB-75 shows a brand added later
 * through "מוצרים" (PR-06) and deactivated since (kept on the product, no longer offered in an
 * edit), with the supplier still empty. Kept out of PRODUCTS, whose order and
 * weights drive the seeded calls (seed.ts); only the repeat-customer calls use them.
 */
export const AUTO_PRODUCTS: readonly Product[] = [
  { sku: "MX-410", name: "ברז נשלף שחור מט", brand: "", sup: "", w: 0, issues: ["הנשלף לא ננעל"] },
  { sku: "TB-75", name: "סוללת אמבטיה לקיר", brand: "הידרו-פלוס", sup: "", w: 0, issues: ["טפטוף מהסוללה"] },
];

/** Every product: the demo's list and the products created from invitations. */
export const CATALOGUE: readonly Product[] = [...PRODUCTS, ...AUTO_PRODUCTS];

/** Product by SKU. */
export function prod(sku: string): Product {
  const p = CATALOGUE.find((x) => x.sku === sku);
  if (!p) throw new Error(`Unknown SKU ${sku}`);
  return p;
}

/** A brand or supplier (ADD, PR-06: product reference data with ids; deactivated, never deleted). */
export type ProductOptionRecord = { id: string; name: string; on: boolean };

/** Brands: the demo's brand names, plus one inactive brand (still on TB-75). */
export const BRANDS: readonly ProductOptionRecord[] = [
  { id: "br-aqua", name: "אקווה-ליין", on: true },
  { id: "br-nova", name: "נובה", on: true },
  { id: "br-terra", name: "טרה-סאן", on: true },
  { id: "br-flora", name: "פלורה", on: true },
  { id: "br-hydro", name: "הידרו-פלוס", on: false },
];

/** Suppliers: the demo's supplier names. */
export const SUPPLIERS: readonly ProductOptionRecord[] = [
  { id: "su-ms", name: "מ.ס. יבוא", on: true },
  { id: "su-galtech", name: "גל-טק סחר", on: true },
  { id: "su-ar", name: "א.ר. אינסטלציה", on: true },
];

/** Follow-up reasons ("סיבות המשך טיפול"), in Settings order. */
export const REASONS: readonly Reason[] = [
  { name: "ממתין לחלקי חילוף", on: true, w: 8 },
  { name: "נדרש ביקור נוסף", on: true, w: 4 },
  { name: "נדרשת בדיקת מתקין", on: true, w: 3 },
  { name: "הזמנת מוצר חדש", on: true, w: 2 },
  { name: "לקוח לא נמצא", on: true, w: 1 },
];

/** Office users. Phones are an ADD for TE-07 ("נציגה" calls the rep's own phone). */
export const USERS: readonly User[] = [
  { name: "משתמש יוצר", email: "admin@example.test", role: "creator", phone: "050-000-0100" },
  { name: "דורון", email: "doron@example.test", role: "mgr", phone: "050-000-0101" },
  { name: "שיראל", email: "shirel@example.test", role: "cs", phone: "050-000-0102" },
  { name: "הדס", email: "rep2@example.test", role: "cs", phone: "050-000-0103" },
];

/** Office user by name (the call's `rep`). */
export const userByName = (name: string): User | undefined => USERS.find((u) => u.name === name);

/** The office user each office viewpoint signs in as. */
export const OFFICE_USER_NAME: Record<OfficeRole, string> = { mgr: "דורון", cs: "שיראל", creator: "משתמש יוצר" };

/** The demo's office phone number (profile "חיוג למשרד"). */
export const OFFICE_PHONE = "03-000-9000";

/** Customer-service mailbox (completion email recipient, D09). */
export const SERVICE_MAILBOX = "service@example.test";

/** The "טופל" approval text the customer signs (Settings; D43 keeps it per signature). */
export const FIXED_TEXT = "קריאת השירות טופלה לשביעות רצון הלקוח";

/** Call types (SE-16 initial values). */
export const CALL_TYPES = ["תיקון", "התקנה"] as const;
