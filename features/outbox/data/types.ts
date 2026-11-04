// Completion-email outbox DTOs: the developer tool "דואר מדומה" (/dev only, X-06) that shows what the
// transactional outbox holds (EM-01 to EM-05, D09, D43, D12; docs/database-schema.md `email_outbox`,
// Step 7). Pure types and labels (no data). See features/data-access/common.ts.
// Nothing here is ever sent: every record is test data, and test data is never delivered (SIM-09,
// D24). No mail provider exists yet (open decision #9, d12).
import type { IsoTimestamp, Page, PageRequest, TestMarker } from "@/features/data-access/common";
import type { OpenDecisionId, PendingSetting } from "@/features/settings/data/types";

/** Outbox row id (`email_outbox.id`, a uuid in the database; a short key in the fixtures). */
export type OutboxId = string;

/** Outbox events. The completion email is one logical notification per closed visit (D09). */
export type OutboxEvent = "visit-completion";

/** The two outcomes of a closure ("טופל", "המשך טיפול"). */
export type CompletionOutcome = "done" | "cont";

/**
 * Delivery state. The demo has one: every record is test data, which is never delivered (SIM-09,
 * D24). Step 7 adds the provider states with the approved provider (open decision #9, d12); a
 * screen never shows a test record as sent.
 */
export type OutboxDeliveryState = "blocked-test-data";

export const OUTBOX_DELIVERY_LABELS: Readonly<Record<OutboxDeliveryState, string>> = {
  "blocked-test-data": "לא יישלח · נתוני בדיקה",
};

/**
 * Why the row may go out (EM-05): only after server acceptance and an approved summary.
 * "held": the visit has no written summary and no approved transcript (a voice-only closure); whether
 * such a visit waits for the technician's transcript approval before the server close and the email
 * is open decision #3 (d06, D12), so the row is held and labelled pending.
 */
export type OutboxRelease = { state: "ready" } | { state: "held"; reason: "awaiting-approved-summary"; pending: PendingSetting };

/** Who receives the email. */
export type OutboxRecipientRole = "manager" | "service-mailbox" | "handling-rep";

export const OUTBOX_RECIPIENT_LABELS: Readonly<Record<OutboxRecipientRole, string>> = {
  manager: "מנהל",
  "service-mailbox": "תיבת שירות הלקוחות",
  "handling-rep": "הנציגה המטפלת",
};

/**
 * A recipient (D09: the Manager and the customer-service mailbox, both outcomes). `fixed`: a D09
 * recipient. `pending`: the open decision about it: d10 decides whether "Manager" means one account
 * or every active Manager, and whether the handling rep is also a recipient (not fixed until then).
 * Addresses are resolved on the server; test addresses are example.test.
 */
export type OutboxRecipient = {
  role: OutboxRecipientRole;
  name: string;
  email: string;
  fixed: boolean;
  pending: OpenDecisionId | null;
};

/** One row of the outbox list. */
export type OutboxSummary = TestMarker & {
  id: OutboxId;
  /** One logical notification per closure: unique (visit, event) (D09; no duplicates). */
  idempotencyKey: string;
  event: OutboxEvent;
  outcome: CompletionOutcome;
  subject: string;
  req: string;
  /** Visit number. */
  n: number;
  /** When the outbox row was written: in the same transaction as the server's acceptance of the closure. */
  createdAt: IsoTimestamp;
  release: OutboxRelease["state"];
  delivery: OutboxDeliveryState;
};

/**
 * The completion email as the outbox row holds it (EM-01 structure, EM-04 identifiers), a snapshot
 * at closure: a later audited correction of the visit does not change it. Media are not attached
 * (EM-03 pending d11: the email links to the call card only).
 */
export type OutboxEmail = OutboxSummary & {
  recipients: readonly OutboxRecipient[];
  /** EM-04 business identifiers. No reference to, mapping for or format of any external system. */
  identifiers: { req: string; task: number; customerNumber: string; visitNumber: number };
  /** EM-01 status banner: "הקריאה טופלה ונסגרה" or "המשך טיפול · <reason>". */
  banner: { outcome: CompletionOutcome; text: string };
  /** "המשך טיפול": the next visit is a new Outlook invitation with the same request number, as visit `nextVisitNumber`. */
  followUp: { nextVisitNumber: number; reason: string; nextNote: string } | null;
  customer: { name: string; phone: string; address: string };
  product: { name: string; sku: string };
  technician: { name: string };
  /** The written summary or the approved transcript (D12); "" while held. */
  summary: string;
  /** Recording length in seconds; 0 = none ("ההאזנה בכרטיס הקריאה"; never the audio). */
  recordingSeconds: number;
  parts: readonly string[];
  /** "טופל": the signer and the approval text preserved at signing (D43), never the current Settings text. */
  signature: { signerName: string; signedText: string } | null;
  /** Photos and videos of the visit: counted, never attached (EM-03 pending d11). */
  media: { count: number; attachment: PendingSetting };
  /** "לכרטיס הקריאה ›": the call card of `req` (production: an absolute app link). */
  cardLink: { req: string };
  /** Why the row may (or may not yet) go out (EM-05); `release` is its state. */
  releaseDetail: OutboxRelease;
  /** The provider is not chosen (open decision #9, d12). */
  provider: PendingSetting;
};

export type OutboxPage = Page<OutboxSummary>;

/** Outbox list query: paged only (newest first). */
export type OutboxListQuery = PageRequest;
