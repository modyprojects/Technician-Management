// FICTITIOUS DATA ONLY: the review items of "פריטים לבדיקה" (D39, D44; schema `review_items`).
// Allowed only under app/dev (G-05). Server-side, and only for the fixture adapter: screens read
// them through demoDataAccess.review (eslint.config.mjs blocks direct imports).
// Each item keeps both versions per field as stored when it was created (D44). The calls and
// visits are the seeded ones; the values match the seed (current = what the server held).
// Every person is fictional; every record is test data (D47). Times are ISO, +03:00.
import "server-only";
import type { ReviewAuthority, ReviewDecision, ReviewFieldChoice, ReviewKind, ReviewValue } from "@/features/review/data/types";
import type { VisitSource } from "@/features/visits/data/types";
import { FIXED_TEXT } from "./reference";
import type { TechId } from "./types";

export type DemoReviewField = {
  key: string;
  label: string;
  base: ReviewValue;
  current: ReviewValue;
  incoming: ReviewValue;
  /** Per-field choice offered (D44 field conflicts only). */
  choosable?: boolean;
};

export type DemoReviewItem = {
  id: string;
  kind: ReviewKind;
  req: string;
  /** Null for a call-level item (customer, SKU). */
  n: number | null;
  source:
    | { kind: "invitation"; source: VisitSource; subject: string }
    | { kind: "device"; tech: TechId; operationId: string; deviceSentAt: string };
  receivedAt: string;
  fields: readonly DemoReviewField[];
  /** Non-critical changes of the same invitation applied with a notification (D39). */
  applied?: readonly { label: string; value: string }[];
  /** Decisions offered while open. */
  decisions: readonly ReviewDecision[];
  authority: ReviewAuthority;
  version: number;
  resolution: {
    by: { id: string; name: string };
    at: string;
    decision: ReviewDecision;
    fieldChoices: Readonly<Record<string, ReviewFieldChoice>> | null;
    note: string | null;
  } | null;
  /** D44: the completion email sent exactly once if the closure is accepted. */
  completionEmailKey?: string;
};

const BOTH: readonly ReviewDecision[] = ["apply-incoming", "keep-current"];

const subject = (req: string, customer: string, city: string): string => `[קריאת שירות] ${req} · ${customer} · ${city}`;

/**
 * Six open items and two resolved ones:
 * - D39, invitations for a visit already en route or in progress: a re-assignment (48226/1, en
 *   route) and an address change (48219/1, in progress); a deletion while in progress (47950/1 on
 *   19.10), resolved by keeping the visit;
 * - D39, call-level identity changes: a different SKU (48213, with the arrival notes applied with
 *   a notification), a different customer number (48252), and a different name for the same
 *   customer number (47690, resolved by applying it);
 * - D44: a late device submission for a server-closed visit with a field conflict and per-field
 *   choice (48190/1), and an offline closure of a visit the office cancelled (48230/1). Both change
 *   a server-closed or cancelled visit: Manager and Creator only, with a required note (D14).
 */
export const REVIEW_ITEMS: readonly DemoReviewItem[] = [
  {
    id: "rv-1",
    kind: "reassignment",
    req: "48226",
    n: 1,
    source: { kind: "invitation", source: "simulator", subject: subject("48226", "יעל שושן", "בת ים") },
    receivedAt: "2026-10-21T09:52:00+03:00",
    fields: [{ key: "technician", label: "טכנאי", base: "אדי", current: "אדי", incoming: "שמואל" }],
    decisions: BOTH,
    authority: "conflicts",
    version: 1,
    resolution: null,
  },
  {
    id: "rv-2",
    kind: "address-change",
    req: "48219",
    n: 1,
    source: { kind: "invitation", source: "simulator", subject: subject("48219", "אורן גל", "שוהם") },
    receivedAt: "2026-10-21T10:05:00+03:00",
    fields: [{ key: "street", label: "רחוב ומספר", base: "התאנה 3", current: "התאנה 3", incoming: "התאנה 5" }],
    decisions: BOTH,
    authority: "conflicts",
    version: 1,
    resolution: null,
  },
  {
    id: "rv-3",
    kind: "cancellation",
    req: "47950",
    n: 1,
    source: { kind: "invitation", source: "simulator", subject: subject("47950", "יוסי מלכה", "לוד") },
    receivedAt: "2026-10-19T14:20:00+03:00",
    fields: [{ key: "visitStatus", label: "סטטוס הביקור", base: "בטיפול", current: "בטיפול", incoming: "בוטלה" }],
    decisions: BOTH,
    authority: "conflicts",
    version: 2,
    resolution: {
      by: { id: "acc-doron", name: "דורון" },
      at: "2026-10-19T14:31:00+03:00",
      decision: "keep-current",
      fieldChoices: null,
      note: "הלקוח אישר בטלפון שהטכנאי באתר; הזימון נמחק בטעות",
    },
  },
  {
    id: "rv-4",
    kind: "sku-change",
    req: "48213",
    n: null,
    source: { kind: "invitation", source: "simulator", subject: subject("48213", "משפחת לוי", "רחובות") },
    receivedAt: "2026-10-21T07:45:00+03:00",
    fields: [{ key: "sku", label: "מק\"ט", base: "KT-2041", current: "KT-2041", incoming: "KT-2014" }],
    applied: [{ label: "הערות הגעה", value: "חניה בכחול-לבן, אינטרקום 9" }],
    decisions: BOTH,
    authority: "conflicts",
    version: 1,
    resolution: null,
  },
  {
    id: "rv-5",
    kind: "customer-change",
    req: "47690",
    n: null,
    source: { kind: "invitation", source: "simulator", subject: subject("47690", "משפחת לוי", "רחובות") },
    receivedAt: "2026-09-23T08:12:00+03:00",
    fields: [{ key: "customerName", label: "שם לקוח", base: "לוי משה ורחל", current: "לוי משה ורחל", incoming: "משפחת לוי" }],
    decisions: BOTH,
    authority: "conflicts",
    version: 2,
    resolution: {
      by: { id: "acc-doron", name: "דורון" },
      at: "2026-09-23T08:40:00+03:00",
      decision: "apply-incoming",
      fieldChoices: null,
      note: null,
    },
  },
  {
    id: "rv-6",
    kind: "edit-conflict",
    req: "48190",
    n: 1,
    source: { kind: "device", tech: "s", operationId: "op-48190-1-tablet", deviceSentAt: "2026-10-21T09:05:00+03:00" },
    receivedAt: "2026-10-21T09:06:00+03:00",
    fields: [
      {
        key: "summary",
        label: "סיכום הטיפול",
        base: "",
        current: "",
        incoming: "מנגנון המילוי לא נסגר עד הסוף; הוזמן מנגנון חדש מהספק.",
        choosable: true,
      },
      {
        key: "nextNote",
        label: "מה צריך בביקור הבא",
        base: "",
        current: "להביא מנגנון מילוי WC-300 ולהחליף",
        incoming: "להביא מנגנון מילוי WC-300 ולבדוק גם את ברז הניל",
        choosable: true,
      },
    ],
    decisions: ["apply-incoming", "keep-current", "per-field"],
    authority: "closed-visit",
    version: 1,
    resolution: null,
  },
  {
    id: "rv-7",
    kind: "closure-of-cancelled-visit",
    req: "48230",
    n: 1,
    source: { kind: "device", tech: "e", operationId: "op-48230-1-close", deviceSentAt: "2026-10-21T12:41:00+03:00" },
    receivedAt: "2026-10-21T12:43:00+03:00",
    fields: [
      { key: "visitStatus", label: "סטטוס הביקור", base: "שובצה", current: "בוטלה", incoming: "טופל" },
      { key: "summary", label: "סיכום הטיפול", base: "", current: "", incoming: "הידית חוזקה והוחלף בורג קיבוע, נבדק ותקין." },
      { key: "media", label: "תמונות וסרטונים", base: [], current: [], incoming: ["תמונה לפני הטיפול", "תמונה אחרי הטיפול"] },
      { key: "signerName", label: "שם החותם", base: null, current: null, incoming: "חיים אוחיון" },
      { key: "signedText", label: "נוסח האישור שנחתם", base: null, current: null, incoming: FIXED_TEXT },
    ],
    decisions: BOTH,
    authority: "closed-visit",
    version: 1,
    resolution: null,
    completionEmailKey: "visit-completion:48230-1",
  },
  {
    id: "rv-8",
    kind: "customer-change",
    req: "48252",
    n: null,
    source: { kind: "invitation", source: "simulator", subject: subject("48252", "דניאל רז", "נס ציונה") },
    receivedAt: "2026-10-21T08:20:00+03:00",
    fields: [{ key: "customerNumber", label: "מספר לקוח", base: "607588", current: "607588", incoming: "607858" }],
    decisions: BOTH,
    authority: "conflicts",
    version: 1,
    resolution: null,
  },
];
