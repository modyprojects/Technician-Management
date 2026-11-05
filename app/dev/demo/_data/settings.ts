// FICTITIOUS DATA ONLY: the demo's Settings fixtures (docs/demo.html freshState() L330-340 and
// the settings functions L935-976, as amended by demo-deviations SE-05 to SE-16). Allowed only
// under app/dev (G-05). Server-side, and only for the fixture adapter: screens read Settings
// through demoDataAccess.settings (eslint.config.mjs blocks direct imports).
// Technicians, places and reasons are the reference fixtures (reference.ts) with Settings ids;
// "in use" is computed from the seeded calls, as a database would from references.
import "server-only";
import type { TechNotificationKey, TemplateFieldKey } from "@/features/settings/data/types";
import { TODAY } from "./dates";
import { CALLS } from "./queries";
import { CALL_TYPES, PLACES, REASONS, SERVICE_MAILBOX } from "./reference";
import type { TechId } from "./types";

/** Settings ids of the pickup places, in PLACES order. */
export const PLACE_IDS: readonly string[] = PLACES.map((_, i) => `place-${i + 1}`);

/** Settings ids of the follow-up reasons, in REASONS order. */
export const REASON_IDS: readonly string[] = REASONS.map((_, i) => `reason-${i + 1}`);

/** Call types (SE-16): the initial values "תיקון" and "התקנה" (D48, to validate in owner task O3). */
export const CALL_TYPE_SETTINGS: readonly { id: string; name: string; active: boolean }[] = CALL_TYPES.map((name, i) => ({
  id: `type-${i + 1}`,
  name,
  active: true,
}));

/** The demo's device column (setTechs(): every technician "סמארטפון"). */
export const TECH_DEVICE = "סמארטפון";

/** Technician "פעיל" (eligibility for new invitations, SE-05): every demo technician is active. */
export const TECH_ACTIVE = true;

/**
 * The stored version of each technician record (technicians.version). אדי's is 2: his Outlook email
 * was changed on 18.10 (the Creator's notice ACCOUNT_EVENTS aev-3). Not all 1, so nothing can
 * hard-code it.
 */
export const TECH_VERSIONS: Readonly<Record<TechId, number>> = { y: 1, e: 2, s: 1 };

/** The completion email's customer-service mailbox (D09). */
export const COMPLETION_MAILBOX = SERVICE_MAILBOX;

/** Technician in-app notifications (freshState().mailCfg techNew / techCancel; no techCollect, SE-11). */
export const TECH_NOTIFICATIONS: Readonly<Record<TechNotificationKey, boolean>> = { newOrChange: true, cancel: true };

/** "נושא הזימון מתחיל ב-" (SE-13). */
export const SUBJECT_PREFIX = "[קריאת שירות]";

/**
 * Template labels: the demo's TEMPLATE (L311-316) plus "מספר לקוח" (required, SE-15, D17).
 * "באחריות" is optional (D17); "מספר פנייה" and "מספר לקוח" are locked required (D35).
 */
export const TEMPLATE_LABELS: readonly { key: TemplateFieldKey; label: string; required: boolean }[] = [
  { key: "req", label: "מספר פנייה", required: true },
  { key: "task", label: "מספר משימה", required: true },
  { key: "rep", label: "נציגה מטפלת", required: true },
  { key: "customerNo", label: "מספר לקוח", required: true },
  { key: "customer", label: "שם לקוח", required: true },
  { key: "phone", label: "טלפון", required: true },
  { key: "phone2", label: "טלפון נוסף", required: false },
  { key: "city", label: "עיר", required: true },
  { key: "street", label: "רחוב ומספר", required: true },
  { key: "building", label: "בניין", required: false },
  { key: "floor", label: "קומה", required: false },
  { key: "apt", label: "דירה", required: false },
  { key: "arrival", label: "הערות הגעה", required: false },
  { key: "type", label: "סוג קריאה", required: true },
  { key: "product", label: "מוצר", required: true },
  { key: "sku", label: "מק\"ט", required: true },
  { key: "desc", label: "תיאור התקלה", required: true },
  { key: "warranty", label: "באחריות", required: false },
  { key: "collect", label: "לאסוף לפני הביקור", required: false },
  { key: "collectFrom", label: "לאסוף מ", required: false },
  { key: "techNote", label: "הערות לטכנאי", required: false },
];

const ALL_VISITS = CALLS.flatMap((c) => c.visits);

/** Place names referenced by a visit ("לאסוף מ"). */
export const placeInUse = (name: string): boolean => ALL_VISITS.some((v) => v.collectFrom === name);

/** Reason names used by a closed visit. */
export const reasonInUse = (name: string): boolean => ALL_VISITS.some((v) => v.reason === name);

/** "שימוש החודש": follow-up closures of the demo's current month with this reason. */
export const reasonUsesThisMonth = (name: string): number =>
  ALL_VISITS.filter((v) => v.status === "cont" && v.reason === name && v.date.slice(0, 7) === TODAY.slice(0, 7)).length;

/** Call type names used by a call. */
export const callTypeInUse = (name: string): boolean => CALLS.some((c) => c.type === name);
