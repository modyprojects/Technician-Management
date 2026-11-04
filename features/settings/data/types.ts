// Settings DTOs (docs/demo.html offSettings() L935-976, as amended by demo-deviations SE-02 to
// SE-16): the permission matrix, technicians, pickup places, follow-up reasons, call types, mail
// and notification settings and the invitation template. Pure types, enums and product copy (no
// data). See features/data-access/common.ts.
// Operational settings (reasons, places, call types, the "טופל" text, template labels) are
// governed by the matrix key `settings` (D35); the matrix itself is Creator-only (D33). What a
// screen offers is display only: enforcement is on the server and in the database (G-04).
import type { Bounded, TestMarker } from "@/features/data-access/common";
import type {
  MatrixRole,
  MatrixValueStatus,
  PermissionKey,
  Place,
  Reason,
  Technician,
} from "@/features/reference/data/types";

export type { Bounded };

/** Settings sections: the demo's SETS (L936) plus "types" (call types, SE-16). */
export const SETTINGS_SECTION_VALUES = ["users", "techs", "places", "reasons", "types", "mail", "template"] as const;
export type SettingsSection = (typeof SETTINGS_SECTION_VALUES)[number];

export const isSettingsSection = (value: unknown): value is SettingsSection =>
  typeof value === "string" && (SETTINGS_SECTION_VALUES as readonly string[]).includes(value);

/** Tab titles (demo SETS; "סוגי קריאה" is new, SE-16). */
export const SETTINGS_SECTION_LABELS: Readonly<Record<SettingsSection, string>> = {
  users: "משתמשים והרשאות",
  techs: "טכנאים",
  places: "מקומות איסוף",
  reasons: "סיבות המשך טיפול",
  types: "סוגי קריאה",
  mail: "מיילים והתראות",
  template: "תבנית זימון",
};

/**
 * Open owner decisions that some settings and screens wait for (docs/decisions.md, open decisions;
 * the board reference): d08 cancellation, d09 unparsed-invitation mail, d10 completion-mail
 * recipients, d11 media in the completion email, d13 usage screen, d23 the spec v2 screens and the
 * matrix key of "זימונים שלא נקלטו" and "חזרו מהשטח" (open #15).
 */
export type OpenDecisionId = "d08" | "d09" | "d10" | "d11" | "d13" | "d23";

/**
 * A setting whose behaviour waits for an open owner decision. Screens show it as a disabled
 * control with a short visible "ממתין להחלטה" hint; they never resolve the decision.
 */
export type PendingSetting = { status: "pending"; decision: OpenDecisionId };

// ---------------------------------------------------------------------------------------------
// Permission matrix (SE-02, D33, D51)

/**
 * Row labels: the demo's PERMS (L306-310), the `card` label without recordings (original
 * recordings are their own key, D37), and new labels for `products`, `conflicts` and
 * `recordings` (docs/database-schema.md §8.2). New labels are new visual elements, shown to the
 * owner for approval (SE-02). `hint` is an optional second line.
 */
export const PERMISSION_LABELS: Readonly<Record<PermissionKey, { label: string; hint: string | null }>> = {
  cal: { label: "יומן טכנאים", hint: null },
  calls: { label: "קריאות – צפייה וחיפוש", hint: null },
  card: { label: "כרטיס קריאה – תמונות, חתימה", hint: "סיכום, תמלול מאושר, תמונות, סרטונים וחתימה · בלי הקלטות מקוריות" },
  cancel: { label: "ביטול קריאה", hint: null },
  dashGen: { label: "דשבורד · כללי", hint: null },
  dashTech: { label: "דשבורד · טכנאים", hint: null },
  dashProd: { label: "דשבורד · מוצרים וספקים", hint: null },
  export: { label: "ייצוא ל-Excel", hint: null },
  settings: { label: "הגדרות", hint: "סיבות המשך טיפול, מקומות איסוף, סוגי קריאה, נוסח \"טופל\" ותוויות הזימון" },
  usage: { label: "מדדי שימוש", hint: null },
  products: { label: "עריכת מוצרים", hint: "שם המוצר, מותג וספק" },
  conflicts: { label: "טיפול בפריטים לבדיקה", hint: "שינוי מק\"ט או לקוח, התנגשות עריכה" },
  recordings: { label: "הקלטות מקוריות", hint: "כל האזנה נרשמת ביומן הביקורת" },
};

/**
 * Matrix cells that wait for an open decision (shown disabled, never editable): Customer Service
 * `cancel` until d08 (SE-04); `usage` for both roles until d13 (OF-15: the screen is not built).
 */
export const PENDING_MATRIX_CELLS: Readonly<Record<MatrixRole, Partial<Record<PermissionKey, OpenDecisionId>>>> = {
  mgr: { usage: "d13" },
  cs: { cancel: "d08", usage: "d13" },
};

export const pendingMatrixDecision = (role: MatrixRole, key: PermissionKey): OpenDecisionId | null =>
  PENDING_MATRIX_CELLS[role]?.[key] ?? null;

/**
 * Creator capabilities that wait for an open decision: `usage` until d13 (OF-15). The Creator's
 * capabilities are fixed (D33), but a pending one is not shown as granted and stays off (deny by
 * default) until the owner decides.
 */
export const PENDING_CREATOR_CAPABILITIES: Readonly<Partial<Record<PermissionKey, OpenDecisionId>>> = { usage: "d13" };

export const pendingCreatorDecision = (key: PermissionKey): OpenDecisionId | null => PENDING_CREATOR_CAPABILITIES[key] ?? null;

/** One matrix value: display only (G-04); `status` is "temporary" until the owner approves it (D51). */
export type PermissionCell = {
  value: boolean;
  status: MatrixValueStatus;
  /** The open decision the cell waits for (not editable), or null. */
  pending: OpenDecisionId | null;
};

/** One matrix row (a key). The Creator column is fixed (✓ 🔒, D33) and is not a matrix cell. */
export type PermissionMatrixRow = {
  key: PermissionKey;
  label: string;
  hint: string | null;
  cells: Readonly<Record<MatrixRole, PermissionCell>>;
  /** The Creator's fixed capability; `pending` names the open decision it waits for (never editable). */
  creator: { pending: OpenDecisionId | null };
};

/** The editable matrix (Creator only, D33), in PERMISSION_KEYS order. */
export type PermissionMatrix = { rows: readonly PermissionMatrixRow[] };

// ---------------------------------------------------------------------------------------------
// Technicians, pickup places, follow-up reasons, call types

/**
 * A technician as Settings › טכנאים lists it (SE-05). `active` is eligibility for new
 * invitations: an inactive technician gets no new invitations and keeps his history; it does not
 * control sign-in, which follows the user account (D34, D36). `email` is the Outlook attendee
 * address that matches an invitation to the technician; every change to it notifies the Creator
 * in the app (D34 f).
 */
export type TechnicianSetting = Technician & {
  /** "סמארטפון" (the demo's only value). */
  device: string;
};

export type SettingId = string;

/** What an add command returns: the new record's id and its test marker, as stored (D47). */
export type CreatedSetting = TestMarker & { id: SettingId };

/** Place types (the demo's PLACES values; "+ הוספת מקום"). */
export const PLACE_TYPES = ["מרכז לוגיסטי", "סניף"] as const;

/** Pickup place (SE-06). A place that is referenced (`inUse`) can only be deactivated, never deleted. */
export type PlaceSetting = Place & { id: SettingId; inUse: boolean };

/**
 * Follow-up reason (SE-07). An inactive reason disappears from the close screen at once. Only a
 * user-added reason that was never used can be deleted (docs/demo.html `r.added && !used`,
 * docs/database-schema.md `is_user_added`); an initial (D48) or used reason can only be
 * deactivated.
 */
export type ReasonSetting = Reason & {
  id: SettingId;
  /** 1-based position (the close screen's order). */
  order: number;
  inUse: boolean;
  /** Added in Settings (not one of the initial values). */
  userAdded: boolean;
  /** "שימוש החודש": closed visits of the current month with this reason. */
  usedThisMonth: number;
};

/** Whether Settings offers "מחיקה" for a reason (SE-07). */
export const reasonDeletable = (reason: Pick<ReasonSetting, "inUse" | "userAdded">): boolean => reason.userAdded && !reason.inUse;

/** Call type (SE-16, new): initial values "תיקון" and "התקנה" (D48). Used types can only be deactivated. */
export type CallTypeSetting = TestMarker & { id: SettingId; name: string; active: boolean; inUse: boolean };

// ---------------------------------------------------------------------------------------------
// Mail and notifications (SE-08 to SE-12)

export type CompletionOutcome = "done" | "cont";

/** Card titles (demo setMail()). */
export const COMPLETION_OUTCOME_LABELS: Readonly<Record<CompletionOutcome, string>> = {
  done: "✓ ביקור שטופל",
  cont: "↻ ביקור שעבר להמשך טיפול",
};

/**
 * The completion email of one outcome. D09 (SE-08): always to the Manager AND the
 * customer-service mailbox, for both outcomes: fixed recipients, never toggles.
 */
export type CompletionMailRule = {
  outcome: CompletionOutcome;
  fixedRecipients: {
    /** The Manager always receives it (D09). */
    manager: true;
    /** The customer-service mailbox address (example.test in the demo). */
    serviceMailbox: string;
  };
  /** One Manager account or every active Manager: open decision d10. */
  managerScope: PendingSetting;
  /** "הנציגה המטפלת (מהזימון)" as a recipient (SE-09): open decision d10. */
  handlingRep: PendingSetting;
  /** "לצרף תמונות וסרטונים" (SE-10): open decision d11 (recommendation: a link to the call card only). */
  attachMedia: PendingSetting;
};

/** Technician in-app notifications (SE-11, D10). No morning pickup reminder (TE-28, D25). */
export const TECH_NOTIFICATION_KEYS = ["newOrChange", "cancel"] as const;
export type TechNotificationKey = (typeof TECH_NOTIFICATION_KEYS)[number];

export const isTechNotificationKey = (value: unknown): value is TechNotificationKey =>
  typeof value === "string" && (TECH_NOTIFICATION_KEYS as readonly string[]).includes(value);

export const TECH_NOTIFICATION_LABELS: Readonly<Record<TechNotificationKey, string>> = {
  newOrChange: "זימון חדש או שינוי ביומן",
  cancel: "ביטול ביקור",
};

export type TechNotificationSetting = { key: TechNotificationKey; on: boolean };

export type MailSettings = {
  /** "done" then "cont". */
  completion: readonly CompletionMailRule[];
  /** In-app only (D10), in TECH_NOTIFICATION_KEYS order. */
  technicianNotifications: readonly TechNotificationSetting[];
  /** "זימון שלא נקלט · מייל לנציגה" (SE-12): open decision d09. */
  unparsedInvitationMail: PendingSetting;
};

// ---------------------------------------------------------------------------------------------
// Invitation template (SE-13 to SE-15)

/** How invitations arrive (SE-14, D08): event-driven change notifications, never polling. */
export type InvitationSyncMode = "event-driven";

export const SYNC_MODE_LABELS: Readonly<Record<InvitationSyncMode, string>> = {
  "event-driven": "מתעדכן אוטומטית כשזימון נוצר או משתנה",
};

/** What an invitation with an existing request number does. */
export type ExistingRequestRule = "add-visit";

export const EXISTING_REQUEST_LABELS: Readonly<Record<ExistingRequestRule, string>> = {
  "add-visit": "מצטרף לקריאה כביקור נוסף",
};

/** Invitation fields: the demo's TEMPLATE (L311-316) plus "מספר לקוח" (SE-15, D17). */
export const TEMPLATE_FIELD_KEYS = [
  "req",
  "task",
  "rep",
  "customerNo",
  "customer",
  "phone",
  "phone2",
  "city",
  "street",
  "building",
  "floor",
  "apt",
  "arrival",
  "type",
  "product",
  "sku",
  "desc",
  "warranty",
  "collect",
  "collectFrom",
  "techNote",
] as const;
export type TemplateFieldKey = (typeof TEMPLATE_FIELD_KEYS)[number];

export const isTemplateFieldKey = (value: unknown): value is TemplateFieldKey =>
  typeof value === "string" && (TEMPLATE_FIELD_KEYS as readonly string[]).includes(value);

/** D17 (SE-15, D35): always required, whatever `settings` allows. */
export const LOCKED_TEMPLATE_FIELDS: readonly TemplateFieldKey[] = ["req", "customerNo"];

export const isLockedTemplateField = (key: TemplateFieldKey): boolean => LOCKED_TEMPLATE_FIELDS.includes(key);

/** One label row: the label as written in the invitation, and whether it is required. */
export type TemplateLabel = {
  key: TemplateFieldKey;
  label: string;
  required: boolean;
  /** Always required (D17); the toggle is disabled. */
  locked: boolean;
};

export type TemplateSettings = {
  /** "[קריאת שירות]" (SE-13; to confirm with customer service in owner task O2). */
  subjectPrefix: string;
  syncMode: InvitationSyncMode;
  existingRequest: ExistingRequestRule;
  /** In TEMPLATE_FIELD_KEYS order. The final list comes from owner task O2 (SE-15). */
  labels: Bounded<TemplateLabel>;
};

// ---------------------------------------------------------------------------------------------
// Command inputs

/** "+ הוספת מקום" (SE-06). */
export type NewPlaceInput = {
  name: string;
  /** "מרכז לוגיסטי" / "סניף". */
  type: string;
  /** Address for navigation (Waze). */
  address: string;
  phone: string;
  hours: string;
};
