// Visit DTOs: what the technician screens (home, visit card, work, close) and the office visit
// timeline read. Pure types and enums (no data). See features/data-access/common.ts.
import type { HourMinute, IsoDate, TestMarker } from "@/features/data-access/common";
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

export type MediaKind = "img" | "vid";
export type MediaPhase = "before" | "after";

/** A photo or video. Production shows it through a short-lived signed URL only (OF-06). */
export type MediaItem = TestMarker & { id: string; kind: MediaKind; when: MediaPhase };

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
    /** Task number ("מספר משימה") from the invitation. */
    task: number;
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

/**
 * The technician's own closed visit, read-only ("הושלמו", TE-26, D14: closed synced visits are
 * read-only to technicians). The screen shows the approval text preserved at signing
 * (`signedText`, D43), never the current Settings text, and never the field times (TE-25 PENDING:
 * a production adapter returns them as null to a technician until d05 is decided).
 */
export type ClosedVisitDetail = VisitDetail & { editable: false };

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
    task: number;
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

/** A technician's schedule for one date plus the home-header counters (TE-01). */
export type TechDay = {
  technician: TechnicianRef;
  date: IsoDate;
  /** Open visits (scheduled, en route, in progress), by start time. */
  open: TechDayVisit[];
  /** Visits closed that day ("טופל" / "המשך טיפול"), by start time. */
  closed: TechDayVisit[];
  /** The featured visit: in progress, else en route, else the first scheduled; null when none. */
  next: TechDayVisit | null;
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
};

/** A new photo or video (the file itself goes through the upload path, never in the DTO). */
export type AddMediaInput = {
  kind: MediaKind;
  when: MediaPhase;
  fileName?: string;
  mimeType?: string;
  sizeBytes?: number;
};
