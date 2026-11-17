// Text rules of the calendar ingestion service (Step 6). Pure: no I/O, safe on the server and in
// tests. They mirror the database CHECKs the ingestion writer fills (Migration 2 section 1 and
// Migration 3 section 1: TEXT-SAFE, TEXT-SAFE-ML, ASCII-ID, the request-number, phone and email
// formats), so an invitation the parser accepts is never refused by a CHECK later, and an
// invitation it refuses is reported with its field (S-05). The database stays authoritative: a
// value that still fails a CHECK makes the whole ingestion fail (no partial write).
// Calendar text is untrusted data (docs/security.md §7): it is validated and stored as text,
// never rendered as HTML and never treated as instructions.

/**
 * Code points the database's TEXT-SAFE CHECK refuses anywhere (C0/C1 controls, format characters,
 * other default-ignorables, private use, noncharacters, U+FFFC/U+FFFD and the rest of Migration 2's
 * list), plus U+0000, which PostgreSQL text cannot hold. Written as escapes: no invisible character
 * appears in this file.
 */
const FORBIDDEN_SINGLE_LINE =
  /[\u0000-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\u{110bd}\u{110cd}\u{13430}-\u{1343f}\u{1bca0}-\u{1bca3}\u{1d159}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}\u{f0000}-\u{10ffff}]/u;

/** TEXT-SAFE-ML: the same list, with U+000A (line feed) allowed inside the text. */
const FORBIDDEN_MULTI_LINE =
  /[\u0000-\u0009\u000b-\u001f\u007f-\u009f\u00ad\u034f\u0600-\u0605\u061c\u06dd\u070f\u0890\u0891\u08e2\u115f\u1160\u17b4\u17b5\u180b-\u180f\u200b-\u200f\u2028-\u202e\u2060-\u206f\u3164\ue000-\uf8ff\ufdd0-\ufdef\ufe00-\ufe0f\ufeff\uffa0\ufff0-\uffff\u{110bd}\u{110cd}\u{13430}-\u{1343f}\u{1bca0}-\u{1bca3}\u{1d159}\u{1d173}-\u{1d17a}\u{e0000}-\u{e0fff}\u{f0000}-\u{10ffff}]/u;

/** A space variant other than U+0020 at either end (the database refuses it; ML adds U+000A). */
const EDGE_SPACE_SINGLE_LINE = /^[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$/u;
const EDGE_SPACE_MULTI_LINE = /^[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]|[\u000a\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]$/u;

/** Number of Unicode code points (PostgreSQL's char_length), not UTF-16 units. */
export function codePointLength(value: string): number {
  return Array.from(value).length;
}

/**
 * TEXT-SAFE (single line) or TEXT-SAFE-ML (multi-line): no surrounding U+0020, a length range in
 * code points, NFC, no forbidden code point and no other space variant at either end.
 */
export function isSafeText(value: string, maxLength: number, multiLine = false): boolean {
  const length = codePointLength(value);
  if (length < 1 || length > maxLength) return false;
  if (value !== value.replace(/^ +| +$/g, "")) return false;
  if (value !== value.normalize("NFC")) return false;
  if ((multiLine ? FORBIDDEN_MULTI_LINE : FORBIDDEN_SINGLE_LINE).test(value)) return false;
  return !(multiLine ? EDGE_SPACE_MULTI_LINE : EDGE_SPACE_SINGLE_LINE).test(value);
}

/** ASCII-ID (task number, customer number, SKU): printable ASCII with single internal spaces. */
export function isAsciiId(value: string, maxLength: number): boolean {
  return value.length >= 1 && value.length <= maxLength && /^[!-~]+( [!-~]+)*$/.test(value);
}

/** `service_calls.request_number` (Migration 3, TEMPORARY format OQ-6). */
export function isRequestNumber(value: string): boolean {
  return /^[A-Za-z0-9-]{1,32}$/.test(value);
}

/** `customers.phone` and `phone_alt` (Migration 2, OQ-8): at least 3 digits, "+" only first, single separators. */
export function isPhone(value: string): boolean {
  return value.length <= 20 && /^\+?[0-9]([ -]?[0-9]){2,}$/.test(value);
}

/** A space variant other than U+0020 anywhere (an address holds none). */
const SPACE_VARIANT = /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]/u;

/**
 * An email address as the ingestion writer stores it (`private.ingest_email`, Migration 6; the form
 * of `technicians.outlook_email`): lower case, trimmed, NFC, at most 254 characters, no code point
 * TEXT-SAFE refuses and no space variant.
 */
export function isNormalizedEmail(value: string): boolean {
  return (
    value.length <= 254 &&
    value === value.trim().toLowerCase() &&
    value === value.normalize("NFC") &&
    /^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(value) &&
    !FORBIDDEN_SINGLE_LINE.test(value) &&
    !SPACE_VARIANT.test(value)
  );
}

/** NFC, trimmed and lower case (the matching form of an attendee or organizer address). */
export function normalizeEmail(value: string): string {
  return value.normalize("NFC").trim().toLowerCase();
}

/** An opaque identifier from a calendar source (event id, change key, calendar id): printable ASCII. */
export function isOpaqueId(value: string, maxLength: number): boolean {
  return value.length >= 1 && value.length <= maxLength && /^[!-~]+$/.test(value);
}

/** Longest invitation text a report carries (features/calendar/data/types.ts UNPARSED_VALUE_MAX). */
export const REPORT_VALUE_MAX = 120;

/**
 * A value as the unparsed-invitations list may show it (S-05): NFC, every code point TEXT-SAFE
 * refuses replaced by "?", trimmed, cut to `max` code points. Never empty: an empty result is null.
 */
export function sanitizeForReport(value: string, max = REPORT_VALUE_MAX): string | null {
  let out = "";
  let n = 0;
  for (const ch of value.normalize("NFC")) {
    if (n >= max) break;
    out += FORBIDDEN_SINGLE_LINE.test(ch) || /[\u00a0\u1680\u2000-\u200a\u202f\u205f\u2800\u3000]/u.test(ch) ? "?" : ch;
    n += 1;
  }
  const trimmed = out.replace(/^ +| +$/g, "");
  return trimmed === "" ? null : trimmed;
}
