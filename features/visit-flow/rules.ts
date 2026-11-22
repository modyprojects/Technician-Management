// The visit flow's rules (D95; Migration 7 OQ-2 to OQ-4), pure and shared by the screens and the
// server actions, so the device and the server refuse the same things:
// - photos: JPEG, PNG or WebP, 1 byte to 10 MiB (the visit-media bucket's ceiling), at most 8 per
//   phase; "after" required, "before" optional (D95 (a)); compressed on the device first (D95 (h)).
// - "טופל": the signer's name and the finger signature (PNG), under the fixed Version 1 approval
//   text whose sha256 the server checks (D43, M7 OQ-2; D95 (b)).
// - "המשך טיפול": an active continuation reason and the notes for the next visit (D95 (c)).
// - both: the written treatment summary (M7 OQ-3, accepted by the owner with D95).

export const MEDIA_MIME_TYPES = ["image/jpeg", "image/png", "image/webp"] as const;
export type MediaMime = (typeof MEDIA_MIME_TYPES)[number];

/** The bucket's ceiling (10 MiB, bytes compared with bytes). */
export const MEDIA_MAX_BYTES = 10 * 1024 * 1024;

/** D95 (a): at most 8 photos per phase (the server's own limit is 30 media per visit). */
export const PHOTOS_PER_PHASE_MAX = 8;

export type PhotoPhase = "before" | "after";
export const PHOTO_PHASES: readonly PhotoPhase[] = ["before", "after"];
export const PHASE_TITLE: Readonly<Record<PhotoPhase, string>> = { before: "לפני הטיפול", after: "אחרי הטיפול" };

/**
 * The fixed Version 1 approval text of "טופל" (Migration 7 OQ-2: the server keeps the same constant
 * and refuses any other hash). Shown to the customer above the signature.
 */
export const APPROVAL_TEXT_V1 = "קריאת השירות טופלה לשביעות רצון הלקוח";

export const SUMMARY_MAX = 2000;
export const SIGNER_MAX = 100;
export const NEXT_NOTES_MAX = 1000;

export const isMediaMime = (value: unknown): value is MediaMime =>
  typeof value === "string" && (MEDIA_MIME_TYPES as readonly string[]).includes(value);

export const isPhotoPhase = (value: unknown): value is PhotoPhase => value === "before" || value === "after";

/** Why a media file of this type and size is refused, or null when it is accepted. */
export function mediaRefusal(mime: string, size: number): string | null {
  if (!isMediaMime(mime)) return "אפשר לצרף רק תמונה (JPEG, PNG או WebP)";
  if (!Number.isInteger(size) || size < 1) return "הקובץ ריק";
  if (size > MEDIA_MAX_BYTES) return "התמונה גדולה מ-10MB גם אחרי הכיווץ. צלם שוב או בחר תמונה אחרת";
  return null;
}

/** How many more photos of a phase fit, given how many it has. */
export const photoRoom = (count: number): number => Math.max(0, PHOTOS_PER_PHASE_MAX - count);

/** What the work screen still needs before "סיום ביקור ›" (D95 (a); M7 OQ-3). */
export function workMissing(afterCount: number, summary: string): string[] {
  const missing: string[] = [];
  if (afterCount < 1) missing.push("תמונה אחרי הטיפול");
  if (!summary.trim()) missing.push("סיכום הטיפול");
  return missing;
}

export type CloseOutcome = "done" | "followup";

export type CloseDraft = {
  outcome: CloseOutcome | null;
  signer: string;
  hasSignature: boolean;
  reasonId: string | null;
  nextNotes: string;
};

/** What the close screen still needs before sending (D95 (b), (c)). */
export function closeMissing(d: CloseDraft): string[] {
  if (!d.outcome) return ["תוצאה"];
  if (d.outcome === "done") {
    return [!d.signer.trim() && "שם החותם", !d.hasSignature && "חתימת הלקוח"].filter((x): x is string => Boolean(x));
  }
  return [!d.reasonId && "סיבה", !d.nextNotes.trim() && "מה צריך בביקור הבא"].filter((x): x is string => Boolean(x));
}

/** The closure as the server action receives it (validated again there; the database decides last). */
export type CloseInput = {
  outcome: CloseOutcome;
  summary: string;
  signerName: string | null;
  ackTextSha256: string | null;
  signatureMediaId: string | null;
  followupReasonId: string | null;
  nextVisitNotes: string | null;
};

const SHA256_HEX = /^[0-9a-f]{64}$/;

/** Null when the closure is complete and well-formed, else the reason code. */
export function closeInputRefusal(c: CloseInput): "invalid" | "summary-required" | "signature-required" | "reason-required" | null {
  if (c.outcome !== "done" && c.outcome !== "followup") return "invalid";
  if (typeof c.summary !== "string" || !c.summary.trim() || c.summary.length > SUMMARY_MAX) return "summary-required";
  if (c.outcome === "done") {
    if (!c.signerName?.trim() || c.signerName.length > SIGNER_MAX) return "signature-required";
    if (!c.signatureMediaId || !c.ackTextSha256 || !SHA256_HEX.test(c.ackTextSha256)) return "signature-required";
    if (c.followupReasonId !== null || c.nextVisitNotes !== null) return "invalid";
    return null;
  }
  if (!c.followupReasonId || !c.nextVisitNotes?.trim() || c.nextVisitNotes.length > NEXT_NOTES_MAX) return "reason-required";
  if (c.signerName !== null || c.signatureMediaId !== null || c.ackTextSha256 !== null) return "invalid";
  return null;
}

/** The sha256 (hex) of a UTF-8 text, with Web Crypto (browser and Node). */
export async function sha256Hex(text: string): Promise<string> {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return Array.from(new Uint8Array(digest), (b) => b.toString(16).padStart(2, "0")).join("");
}
