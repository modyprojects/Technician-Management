// The technician's field actions (Step 4, Version 1, Migration 7): shared rules of the browser
// adapter (field-actions.ts) and the server side (features/visits/supabase/field-commands.ts). Pure:
// no I/O, no secret, no server-only import.
import { z } from "zod";
import { isUuid } from "@/features/data-access/common";

/**
 * The fixed Version 1 approval text of "טופל" (Migration 7 OQ-2; the demo's text). The screen shows
 * it, the browser sends its sha256 and the database checks it against its own copy (D43); the
 * versioned texts are Version 2.
 */
export const FIXED_ACK_TEXT = "קריאת השירות טופלה לשביעות רצון הלקוח";
export const FIXED_ACK_VERSION_ID = "v1-fixed";

/** The device's clock values sent with every field action (D45: reported values, not proof). */
export type DeviceStamp = {
  reportedAt: string;
  deviceTz: string;
  deviceUtcOffsetMin: number;
  deviceSentAt: string;
};

/** The browser's clock values now. */
export function deviceStamp(now: Date = new Date()): DeviceStamp {
  let tz = "UTC";
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || "UTC";
  } catch {
    // keep UTC
  }
  const iso = now.toISOString();
  return { reportedAt: iso, deviceTz: tz, deviceUtcOffsetMin: -now.getTimezoneOffset(), deviceSentAt: iso };
}

/** Hebrew messages of the field actions (no database text ever reaches the screen, docs/security.md §8). */
export const FIELD_MESSAGES = {
  forbidden: "אין לך הרשאה לפעולה הזו.",
  invalid: "חלק מהפרטים חסרים או שגויים.",
  state: "מצב הביקור השתנה בינתיים. רעננו את הדף.",
  stale: "פרטי הביקור השתנו בינתיים. רעננו את הדף ונסו שוב.",
  reused: "הפעולה כבר נשלחה עם פרטים אחרים. רעננו את הדף.",
  notStored: "התמונה לא נשמרה. נסו שוב.",
  limit: "הגעתם למספר התמונות המרבי לביקור.",
  tooLarge: "הקובץ גדול מדי.",
  badImage: "הקובץ אינו תמונה מסוג JPEG, PNG או WebP.",
  unavailable: "הפעולה אינה זמינה כרגע. נסו שוב מאוחר יותר.",
  unknown: "הפעולה לא הושלמה. נסו שוב.",
  notSupported: "הפעולה אינה זמינה בגרסה הזו.",
  noRemove: "תמונה שנשמרה בשרת לא נמחקת.",
  closed: "הביקור נסגר ונשמר בשרת.",
} as const;

/** The Hebrew message of a database or Storage refusal, by its code only. */
export function fieldErrorMessage(code: unknown, message?: unknown): string {
  switch (code) {
    case "42501":
      return FIELD_MESSAGES.forbidden;
    case "22023":
      return FIELD_MESSAGES.invalid;
    case "55000":
      return typeof message === "string" && message === "media limit reached"
        ? FIELD_MESSAGES.limit
        : typeof message === "string" && message === "the object is not stored"
          ? FIELD_MESSAGES.notStored
          : FIELD_MESSAGES.state;
    case "PT409":
      return FIELD_MESSAGES.stale;
    case "23505":
      return FIELD_MESSAGES.reused;
    default:
      return FIELD_MESSAGES.unknown;
  }
}

/** Text as the database's text rules expect it: NFC, LF line breaks, trimmed. */
export function cleanFieldText(value: unknown): string {
  return typeof value === "string" ? value.normalize("NFC").replace(/\r\n?/g, "\n").trim() : "";
}

/** Photos travel compressed (D13): the browser sends at most this many bytes per photo. */
export const PHOTO_MAX_BYTES = 950 * 1024;
/** The signature image (a PNG of the pad). */
export const SIGNATURE_MAX_BYTES = 400 * 1024;

export type ImageType = "image/jpeg" | "image/png" | "image/webp";

/** The image type by its first bytes (never by a name or a declared type); null for anything else. */
export function imageTypeOf(bytes: Uint8Array): ImageType | null {
  if (bytes.length >= 3 && bytes[0] === 0xff && bytes[1] === 0xd8 && bytes[2] === 0xff) return "image/jpeg";
  if (bytes.length >= 8 && [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a].every((b, i) => bytes[i] === b)) return "image/png";
  if (
    bytes.length >= 12 &&
    String.fromCharCode(...bytes.subarray(0, 4)) === "RIFF" &&
    String.fromCharCode(...bytes.subarray(8, 12)) === "WEBP"
  ) {
    return "image/webp";
  }
  return null;
}

const uuid = z.string().refine(isUuid);
const instant = z.string().max(40).refine((v) => !Number.isNaN(Date.parse(v)));
const device = {
  reportedAt: instant,
  deviceTz: z.string().max(64).regex(/^[A-Za-z_]+(\/[A-Za-z0-9_+-]+){0,2}$/),
  deviceUtcOffsetMin: z.number().int().min(-840).max(840),
  deviceSentAt: instant,
};

/** "יוצא" / "הגעתי": the visit, the device's operation id, the field version read, the clock values. */
export const fieldStepSchema = z.object({ visitId: uuid, operationId: uuid, fieldVersion: z.number().int().min(1), ...device }).strict();
export type FieldStepInput = z.infer<typeof fieldStepSchema>;

/** A photo's metadata (the file travels beside it in the same form). */
export const photoMetaSchema = z
  .object({ visitId: uuid, operationId: uuid, phase: z.enum(["before", "after"]), ...device })
  .strict();
export type PhotoMeta = z.infer<typeof photoMetaSchema>;

/** The closure. */
export const closeSchema = z
  .object({
    visitId: uuid,
    operationId: uuid,
    signatureOperationId: uuid,
    fieldVersion: z.number().int().min(1),
    outcome: z.enum(["done", "followup"]),
    summary: z.string().max(4000),
    signerName: z.string().max(100).nullable(),
    ackTextSha256: z.string().regex(/^[0-9a-f]{64}$/).nullable(),
    signatureDataUrl: z.string().max(Math.ceil((SIGNATURE_MAX_BYTES * 4) / 3) + 64).nullable(),
    reasonId: uuid.nullable(),
    nextNote: z.string().max(1000).nullable(),
    ...device,
  })
  .strict();
export type CloseInput = z.infer<typeof closeSchema>;
