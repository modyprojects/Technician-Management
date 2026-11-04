// Review-item DTOs: the office "פריטים לבדיקה" screen (matrix key `conflicts`; D39, D43, D44, D45;
// docs/database-schema.md `review_items`). Pure types, enums and labels (no data). See
// features/data-access/common.ts.
// Both versions of a change are preserved (D44): `current` is what the server holds (version B),
// `incoming` what was submitted (version A), `base` the value the submission started from. Nothing
// is silently overwritten; a rejected submission stays stored with the item.
import type { AccountRef } from "@/features/accounts/data/types";
import type { IsoTimestamp, Page, PageRequest, TestMarker } from "@/features/data-access/common";
import type { TechnicianRef } from "@/features/reference/data/types";
import type { VisitSource, VisitStatus } from "@/features/visits/data/types";

/** Review item id (`review_items.id`, a uuid in the database; a short key in the fixtures). */
export type ReviewItemId = string;

/**
 * Why an item is waiting for review. The database's exact `review_type` value set is fixed in PR
 * 1.6 (docs/database-schema.md); these are the cases the approved decisions name:
 * - D39 (an invitation for a visit already en route or in progress, or a call-level identity
 *   change): "reassignment", "cancellation" (cancelled or deleted invitation), "address-change",
 *   "customer-change" (a different customer number, or a different name for the same number) and
 *   "sku-change". A closed visit is never changed by an invitation.
 * - D44: "edit-conflict" (conflicting field changes; the rejected submission is stored) and
 *   "closure-of-cancelled-visit" (office cancellation vs an offline closure: the cancellation
 *   stands, the closure and its media are kept for review).
 * - D43: "approval-text-mismatch" (an unknown approval-text version or a hash mismatch).
 * - D45: "duplicate-time-report" (a second device report of the same field time).
 */
export const REVIEW_KIND_VALUES = [
  "reassignment",
  "cancellation",
  "address-change",
  "customer-change",
  "sku-change",
  "edit-conflict",
  "closure-of-cancelled-visit",
  "approval-text-mismatch",
  "duplicate-time-report",
] as const;
export type ReviewKind = (typeof REVIEW_KIND_VALUES)[number];

export const isReviewKind = (value: unknown): value is ReviewKind =>
  typeof value === "string" && (REVIEW_KIND_VALUES as readonly string[]).includes(value);

/** Hebrew kind labels (new visual elements, shown to the owner for approval). */
export const REVIEW_KIND_LABELS: Readonly<Record<ReviewKind, string>> = {
  reassignment: "החלפת טכנאי בביקור פעיל",
  cancellation: "ביטול או מחיקה של ביקור פעיל",
  "address-change": "שינוי כתובת בביקור פעיל",
  "customer-change": "שינוי פרטי זיהוי של לקוח",
  "sku-change": "שינוי מק״ט בקריאה קיימת",
  "edit-conflict": "התנגשות עריכה",
  "closure-of-cancelled-visit": "סגירה מהמכשיר של ביקור שבוטל",
  "approval-text-mismatch": "נוסח אישור שלא תואם",
  "duplicate-time-report": "דיווח זמן כפול",
};

export const REVIEW_STATUS_VALUES = ["open", "resolved"] as const;
export type ReviewStatus = (typeof REVIEW_STATUS_VALUES)[number];

export const isReviewStatus = (value: unknown): value is ReviewStatus => value === "open" || value === "resolved";

export const REVIEW_STATUS_LABELS: Readonly<Record<ReviewStatus, string>> = { open: "פתוח", resolved: "טופל" };

/**
 * How an item is resolved: apply the submitted change, keep the server's value, or choose per
 * field (only where the item offers it: a D44 field conflict with per-field base values).
 */
export const REVIEW_DECISION_VALUES = ["apply-incoming", "keep-current", "per-field"] as const;
export type ReviewDecision = (typeof REVIEW_DECISION_VALUES)[number];

export const isReviewDecision = (value: unknown): value is ReviewDecision =>
  typeof value === "string" && (REVIEW_DECISION_VALUES as readonly string[]).includes(value);

export const REVIEW_DECISION_LABELS: Readonly<Record<ReviewDecision, string>> = {
  "apply-incoming": "החלת השינוי",
  "keep-current": "השארת הקיים",
  "per-field": "בחירה לפי שדה",
};

/** A per-field choice: the server's value or the submitted one. */
export type ReviewFieldChoice = "current" | "incoming";

export const isReviewFieldChoice = (value: unknown): value is ReviewFieldChoice => value === "current" || value === "incoming";

/**
 * Who may resolve the item (D44, D14; docs/database-schema.md §8.3):
 * - "closed-visit": the resolution changes a server-closed or cancelled visit: Manager and Creator
 *   only, a fixed capability (D33: never a matrix key), with a required note (D14 audited change);
 * - "conflicts": every other item, by the matrix key `conflicts` (the Creator always).
 * Display only here; the server checks the caller's role and the matrix in the database.
 */
export type ReviewAuthority = "closed-visit" | "conflicts";

/** A field value: text, a list (parts), or null (not set). Screens format it. */
export type ReviewValue = string | readonly string[] | null;

/** Longest field key accepted in a per-field choice. */
export const REVIEW_FIELD_KEY_MAX = 40;

/** One field of the item, both versions side by side (D44: per-field base values). */
export type ReviewField = {
  /** Stable key within the item (for example "technician", "street", "summary"). */
  key: string;
  /** Hebrew field label (the invitation template's or the visit screen's label). */
  label: string;
  /** The value the submission started from (an invitation: the previous invitation's value); null when not set. */
  base: ReviewValue;
  /** The server's value when the item was stored (version B; both versions are kept as stored, D44). */
  current: ReviewValue;
  /** The submitted value (version A). */
  incoming: ReviewValue;
  /** Both sides changed the field since `base`, to different values (D44). */
  conflict: boolean;
  /** The item offers a per-field choice for this field. */
  choosable: boolean;
};

/** A non-critical change of the same invitation that was applied with a notification (D39). */
export type ReviewAppliedChange = { label: string; value: string };

/**
 * Where the item came from: an invitation (its source, SIM-14: "🧪 זימון בדיקה" or Outlook) or a
 * technician's device (a submission of the offline work queue, D44, D46).
 */
export type ReviewSource =
  | { kind: "invitation"; source: VisitSource; subject: string }
  | {
      kind: "device";
      technician: Pick<TechnicianRef, "id" | "name" | "color">;
      /** The device's idempotent operation id (`offline_operations.operation_id`). */
      operationId: string;
      /** Device-reported send time (D45: a reported value, not proof). */
      deviceSentAt: IsoTimestamp;
    };

/** How a resolved item was decided (audited). */
export type ReviewResolution = {
  by: AccountRef;
  at: IsoTimestamp;
  decision: ReviewDecision;
  /** Per-field choices when `decision` is "per-field"; otherwise null. */
  fieldChoices: Readonly<Record<string, ReviewFieldChoice>> | null;
  note: string | null;
};

/** One row of the review list. */
export type ReviewItemSummary = TestMarker & {
  id: ReviewItemId;
  kind: ReviewKind;
  status: ReviewStatus;
  source: ReviewSource;
  /** The service call (screens link to the call card). */
  call: TestMarker & { req: string; customerName: string };
  /** The visit (screens link to it on the call card); null for a call-level item (customer, SKU). */
  visit: { n: number; status: VisitStatus } | null;
  /** Server receipt time. */
  receivedAt: IsoTimestamp;
  fieldCount: number;
  conflictCount: number;
  authority: ReviewAuthority;
  /** Null while open. */
  resolution: ReviewResolution | null;
};

/** The item with both versions per field and what its resolution offers. */
export type ReviewItemDetail = ReviewItemSummary & {
  /** Row version (D44: a resolution sends the version it started from). */
  version: number;
  fields: readonly ReviewField[];
  /** Non-critical changes of the same invitation already applied with a notification (D39). */
  appliedWithNotification: readonly ReviewAppliedChange[];
  /** Decisions this item offers (empty once resolved). */
  decisions: readonly ReviewDecision[];
  /** A resolution note is required (D14: a change to a server-closed or cancelled visit is audited with its reason). */
  noteRequired: boolean;
  /**
   * D44: accepting an offline closure of a cancelled visit sends the D09 completion email exactly
   * once; this is its idempotency key. Null for every other item.
   */
  completionEmailKey: string | null;
};

/** Review-list query. Every field is optional; adapters validate and clamp it. */
export type ReviewListQuery = PageRequest & {
  /** One status; omitted means every item. */
  status?: ReviewStatus;
};

/** One page of items (newest first) and the count per status (independent of the filter). */
export type ReviewPage = Page<ReviewItemSummary> & { counts: Readonly<Record<ReviewStatus, number>> };

/** Longest resolution note accepted. */
export const REVIEW_NOTE_MAX = 500;

/** "פריטים לבדיקה" resolution (D44). */
export type ReviewResolveInput = {
  id: ReviewItemId;
  /** The version the decision started from (D44). */
  expectedVersion: number;
  decision: ReviewDecision;
  /** Per-field choices; only with "per-field", and then for every conflicting field. */
  fields?: Readonly<Record<string, ReviewFieldChoice>>;
  /** Required where the item says so (`noteRequired`). */
  note?: string;
};
