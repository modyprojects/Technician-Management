// Visit DTOs: what the technician screens (home, visit card, work, close) and the office visit
// timeline read. Pure types and enums (no data). See features/data-access/common.ts.
import type { Bounded, HourMinute, IsoDate, IsoTimestamp, TestMarker } from "@/features/data-access/common";
import type { Customer } from "@/features/customers/data/types";
import type { Product, TechnicianRef } from "@/features/reference/data/types";

/** Visit statuses (docs/demo.html ST): שובצה, בדרך, בטיפול, טופל, המשך טיפול, בוטלה. */
export const VISIT_STATUS_VALUES = ["new", "go", "work", "done", "cont", "cancel"] as const;
export type VisitStatus = (typeof VISIT_STATUS_VALUES)[number];

/** Open visits: scheduled, en route, in progress. */
export const OPEN_VISIT_STATUSES: readonly VisitStatus[] = ["new", "go", "work"];

export const isOpenVisitStatus = (status: VisitStatus): boolean => OPEN_VISIT_STATUSES.includes(status);

/** Closed by the technician: "טופל" or "המשך טיפול". */
export const isClosedVisitStatus = (status: VisitStatus): boolean => status === "done" || status === "cont";

/**
 * Where a visit came from (TE-12, SIM-14): a Microsoft 365 invitation or the invitation
 * simulator (D24). A database adapter maps `data_source` `microsoft_graph` → "outlook" and
 * `simulator` / `automated_test` → "simulator".
 */
export type VisitSource = "outlook" | "simulator";

/** A visit's identity: request number and visit number within the call. */
export type VisitRef = { req: string; n: number };

/** A visit's key in maps of visits ("48213/1"). Safe on malformed input (never throws). */
export const visitRefKey = (ref: VisitRef | undefined): string => `${ref?.req}/${ref?.n}`;

export type MediaKind = "img" | "vid";
export type MediaPhase = "before" | "after";

/** A photo or video. Production shows it through a short-lived signed URL only (OF-06). */
export type MediaItem = TestMarker & {
  id: string;
  kind: MediaKind;
  when: MediaPhase;
  /**
   * A short-lived signed link (OF-06) or a local object URL of the file just taken, for the
   * thumbnail; absent in the demo (the tile draws a placeholder).
   */
  previewUrl?: string;
};

/** Item to pick up before the visit (TE-03). */
export type Pickup = {
  item: string;
  /** Pickup place name (Settings › מקומות איסוף). */
  place: string;
  /** The place's address for navigation; null when the place is unknown. */
  placeAddress: string | null;
};

/** A visit with everything the office timeline and the technician's own visit show. */
export type VisitRecord = TestMarker &
  VisitRef & {
    /**
     * Task number ("מספר משימה") from the invitation: a number in the demo, the stored text in the
     * database (`visits.task_number`, printable ASCII, D41). Display only.
     */
    task: number | string;
    technician: TechnicianRef;
    date: IsoDate;
    start: HourMinute;
    end: HourMinute;
    status: VisitStatus;
    source: VisitSource;
    /** Field times (office only, TE-25). */
    departAt: HourMinute | null;
    arriveAt: HourMinute | null;
    endAt: HourMinute | null;
    /** Follow-up reason (status "cont"). */
    followupReason: string | null;
    summary: string;
    /** Approved transcription of the recording (TE-15); "" when none. */
    transcript: string;
    /** Recording length in seconds; 0 = no recording. Never the audio itself (D36, D37). */
    recordingSeconds: number;
    media: MediaItem[];
    /** Parts replaced (TE-17). */
    parts: string[];
    /** "מה צריך בביקור הבא" (TE-21, follow-up only). */
    nextNote: string;
    /** Signer name (status "done"). */
    signerName: string | null;
    /** Approval text preserved at signing (D43); null when not signed. */
    signedText: string | null;
    pickup: Pickup | null;
  };

/** The technician visit screen (visit card, work, close). */
export type VisitDetail = VisitRecord & {
  call: TestMarker & {
    req: string;
    /** "תיקון" / "התקנה". */
    type: string;
    /** Warranty text as received ("כן", "לא", "כן · עד 03/2028"; "" when not given, TE-08). */
    warranty: string;
    /** Fault description. */
    problem: string;
    /** "הערות לטכנאי" (TE-10); "" when none. */
    techNote: string;
    /** Handling representative; `phone` null when unknown (TE-07). */
    representative: { name: string; phone: string | null };
  };
  customer: Customer;
  product: Product;
  /** False for closed visits: they are read-only to technicians (D14). */
  editable: boolean;
};

/** Field times: office only (TE-25 PENDING, d05). */
export type FieldTimeKey = "departAt" | "arriveAt" | "endAt";

/**
 * The technician's own closed visit, read-only ("הושלמו", TE-26, D14: closed synced visits are
 * read-only to technicians). The screen shows the approval text preserved at signing
 * (`signedText`, D43), never the current Settings text. The type carries no field times (TE-25
 * PENDING: a technician does not get them until d05 is decided), so no adapter can return them.
 */
export type ClosedVisitDetail = Omit<VisitDetail, FieldTimeKey> & { editable: false };

/** How a previous visit relates to the visit being viewed. */
export type VisitHistoryRelation = "call" | "customer" | "product";

/**
 * A previous closed visit as a technician may see it (TE-06, D36): summary, approved transcript,
 * parts, follow-up reason and next-visit note, photos and videos, and the recording length.
 * Never signer names, signatures, field times or the audio.
 */
export type VisitHistoryItem = TestMarker &
  VisitRef & {
    relation: VisitHistoryRelation;
    date: IsoDate;
    start: HourMinute;
    technician: Pick<TechnicianRef, "id" | "name" | "color">;
    status: VisitStatus;
    summary: string;
    transcript: string;
    followupReason: string | null;
    nextNote: string;
    parts: string[];
    /** The visit's photos and videos (TE-06, D36); production shows them through short-lived signed URLs only (OF-06). */
    media: MediaItem[];
    mediaCount: number;
    recordingSeconds: number;
    customerName: string;
    product: Pick<Product, "sku" | "name">;
  };

/** One visit in the technician's day. */
export type TechDayVisit = TestMarker &
  VisitRef & {
    /** Task number as in VisitRecord. */
    task: number | string;
    start: HourMinute;
    end: HourMinute;
    status: VisitStatus;
    source: VisitSource;
    customerName: string;
    /** "הרצל 14, רחובות". */
    address: string;
    city: string;
    productName: string;
    /** Visit 2 or later ("↻ ביקור המשך"). */
    isFollowUp: boolean;
    pickup: Pickup | null;
  };

/** "מה לאסוף לפני יציאה" grouped by pickup place (TE-03). */
export type PickupGroup = {
  place: string;
  placeAddress: string | null;
  /** `collected`: the technician ticked "נאסף" (TE-03: kept per technician per day). */
  items: { ref: VisitRef; item: string; customerName: string; start: HourMinute; collected: boolean }[];
};

/**
 * A day visit of the real technician screens (Step 3): the visit's database id (`visits.id`, a
 * uuid) for its links. The real routes address a visit by id (the technician reads his own visits
 * rows under RLS, never the calls table, Migration 3 OQ-12); the demo addresses it by `VisitRef`.
 */
export type TechDayVisitWithId = TechDayVisit & {
  id: string;
  /** `visits.field_version` as read: a field action sends it, so a changed visit is refused (PT409). */
  fieldVersion: number;
};

/** A technician's schedule for one date plus the home-header counters (TE-01). */
export type TechDay<V extends TechDayVisit = TechDayVisit> = {
  technician: TechnicianRef;
  date: IsoDate;
  /** Open visits (scheduled, en route, in progress), by start time. */
  open: V[];
  /** Visits closed that day ("טופל" / "המשך טיפול"), by start time. */
  closed: V[];
  /** The featured visit: in progress, else en route, else the first scheduled; null when none. */
  next: V | null;
  /** Pickups of the open visits, by place. */
  pickups: PickupGroup[];
  stats: {
    /** "ביקורים היום": open visits. */
    open: number;
    /** "הושלמו". */
    completed: number;
  };
};

/** Close-visit form (TE-18 to TE-22). */
export type CloseVisitInput = {
  outcome: "done" | "cont";
  /** Follow-up reason; required for "cont". */
  reason?: string;
  /** Signer name; required for "done". */
  signerName?: string;
  /** PNG data URL of the signature; required for "done". */
  signatureDataUrl?: string;
  /**
   * Version id of the approval text shown at signing ("done"; reference.approvalText(), D43).
   * The server verifies it (with the text hash a production adapter adds) and keeps that exact text.
   */
  approvalTextVersionId?: string;
  /** "מה צריך בביקור הבא"; required for "cont" (TE-21). */
  nextNote?: string;
  /**
   * The written treatment summary, sent with the closure (the real writer stores it at closure,
   * Migration 3 c40; the demo saves it before, through saveSummary).
   */
  summary?: string;
};

/** A new photo or video (the file itself goes through the upload path, never in the DTO). */
export type AddMediaInput = {
  kind: MediaKind;
  when: MediaPhase;
  /** The photo itself, in the browser only (the real commands upload it; never in a DTO). */
  file?: Blob;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
};

// ---------------------------------------------------------------------------------------------
// Audited corrections of a server-closed visit (OF-10, D14, D45, D43; docs/database-schema.md
// `visit_corrections`, `visit_time_reports`). Manager and Creator only, a fixed capability (D33:
// never a matrix key); Customer Service and technicians never correct a closed visit.

/**
 * Fields of a server-closed visit that a correction may change. The report fields (summary, parts,
 * follow-up reason, next-visit note) are corrected in `visit_corrections` with the change set and
 * the versions before and after; field times are corrected by a new time report (`source`
 * "correction", D45). Originals are never overwritten. Follow-up reason and next-visit note apply
 * only to a visit closed as "המשך טיפול".
 */
export const CORRECTABLE_VISIT_FIELDS = ["summary", "parts", "followupReason", "nextNote", "departAt", "arriveAt", "endAt"] as const;
export type CorrectableVisitField = (typeof CORRECTABLE_VISIT_FIELDS)[number];

export const isCorrectableVisitField = (value: unknown): value is CorrectableVisitField =>
  typeof value === "string" && (CORRECTABLE_VISIT_FIELDS as readonly string[]).includes(value);

/** Field times among the correctable fields (a correction adds a time report, D45). */
export const TIME_CORRECTION_FIELDS: readonly CorrectableVisitField[] = ["departAt", "arriveAt", "endAt"];

/** Fields that only a visit closed as "המשך טיפול" has. */
export const FOLLOWUP_CORRECTION_FIELDS: readonly CorrectableVisitField[] = ["followupReason", "nextNote"];

/** Hebrew labels of the correctable fields. */
export const CORRECTABLE_FIELD_LABELS: Readonly<Record<CorrectableVisitField, string>> = {
  summary: "סיכום הטיפול",
  parts: "חלפים שהוחלפו",
  followupReason: "סיבת המשך טיפול",
  nextNote: "מה צריך בביקור הבא",
  departAt: "שעת יציאה",
  arriveAt: "שעת הגעה",
  endAt: "שעת סיום",
};

/**
 * Never correctable: the approval text preserved at signing (D43), the signer name and the
 * signature (`visit_signatures` rows are immutable). A correction naming one of them is rejected.
 */
export const UNCORRECTABLE_VISIT_FIELDS = ["signedText", "signerName", "signature"] as const;

/** A corrected value: text (summary, reason, note), a list (parts), "HH:MM" (field times), or null (not set). */
export type CorrectionValue = string | readonly string[] | null;

/** Correctable values of a visit, every field present (null where the visit has none). */
export type CorrectableValues = Readonly<Record<CorrectableVisitField, CorrectionValue>>;

/** One audited correction (append-only). */
export type VisitCorrection = TestMarker & {
  id: string;
  ref: VisitRef;
  field: CorrectableVisitField;
  /** "report": `visit_corrections`; "time-report": a new `visit_time_reports` row (D45). */
  target: "report" | "time-report";
  /** The value before this correction (the original for the first one). */
  before: CorrectionValue;
  after: CorrectionValue;
  /** Manager or Creator (D14). */
  by: { id: string; name: string };
  /** Server time of the correction. */
  at: IsoTimestamp;
  /** Mandatory reason (OF-10). */
  reason: string;
  versionBefore: number;
  versionAfter: number;
};

/** Cap of the corrections listed per visit (newest first); `total` gives the rest. */
export const VISIT_CORRECTIONS_LIMIT = 50;

/**
 * A server-closed visit's correctable values and its corrections ("תיקונים"): the values as the
 * technician closed it (`original`, never overwritten), the current values (the latest
 * correction, else the original) and the history, newest first.
 */
export type VisitCorrectionHistory = TestMarker &
  VisitRef & {
    /** Row version (a correction sends the version it started from, D44). */
    version: number;
    status: "done" | "cont";
    original: CorrectableValues;
    current: CorrectableValues;
    /** Fields this visit allows correcting (follow-up fields only for "המשך טיפול"). */
    correctable: readonly CorrectableVisitField[];
    corrections: Bounded<VisitCorrection>;
  };

/** "תיקון ביקור סגור" (OF-10). */
export type VisitCorrectionInput = {
  visitRef: VisitRef;
  field: CorrectableVisitField;
  newValue: CorrectionValue;
  /** Mandatory reason (OF-10, D14). */
  reason: string;
  /** The version the correction started from. */
  expectedVersion: number;
};
