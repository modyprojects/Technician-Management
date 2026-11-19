// Supabase errors -> short Hebrew messages for the user (Step 2 plan §3.7 "Errors", §4 "Hebrew
// messages"; docs/security.md §8: no stack trace, raw database or Auth text, or session material
// reaches the client). Pure: no I/O and no logging. Callers log an event name and a code only.
//
// Database errors are read by `error.code` (SQLSTATE or PostgREST `PGRST…`), never by HTTP status:
// a `55000` business refusal arrives as HTTP 500. Auth errors are read by the Supabase Auth error
// code. The codes and the `55000` texts are those Migrations 1 and 5 raise (applied); an unknown
// code or text gets the generic message (R14: unit tests pin the known texts).

/** Messages shared by every action. Wording is shown to the owner for feedback (plan §4). */
export const ACTION_MESSAGES = {
  forbidden: "אין לך הרשאה לפעולה הזו.",
  invalid: "חלק מהפרטים חסרים או שגויים.",
  duplicate: "הערך כבר בשימוש.",
  stale: "הנתונים השתנו בינתיים. רעננו את הדף ונסו שוב.",
  unavailable: "הפעולה עדיין אינה זמינה.",
  unknown: "הפעולה לא הושלמה. נסו שוב מאוחר יותר.",
} as const;

/**
 * Account-request refusals that the shared validators also return (features/accounts/data/validate.ts),
 * so the simulated commands and the real adapter show the same text.
 */
export const REQUEST_MESSAGES = {
  cannotCancel: "לא ניתן לבטל את הבקשה.",
  notPending: "הבקשה כבר טופלה.",
  needsCreator: "הפעולה דורשת אישור של היוצר.",
  /** An open creation that can no longer be completed (not approved, or an account is bound; 55000). */
  noLongerApplies: "הבקשה כבר אינה רלוונטית.",
} as const;

/**
 * Technician field-profile refusals ("השלמה" of "פרופיל טכנאי חסר", Migration 1
 * `admin_create_technician`, 55000) that the shared validators also return.
 */
export const TECHNICIAN_MESSAGES = {
  notTechnician: "החשבון אינו חשבון טכנאי.",
  hasProfile: "לטכנאי כבר יש פרופיל טכנאי.",
} as const;

/**
 * Sign-in messages (plan §3.4): one message for every credential failure (wrong password, unknown
 * email, inactive account, no profile), one for every service failure (not configured,
 * unreachable, rate-limited, database objects missing). Neither reveals anything about an account.
 */
export const SIGN_IN_MESSAGES = {
  credentials: "האימייל או הסיסמה שגויים, או שאין לחשבון גישה.",
  service: "הכניסה אינה זמינה כרגע. נסו שוב מאוחר יותר.",
  noAccess: "אין לחשבון הזה גישה למסך הזה.",
} as const;

/**
 * Account-administration outcomes of the real server actions (D60 (7); Migration 5): the
 * deletion's permanence, the retired request path, and the multi-step creation and deletion
 * (Step 2 plan §3.8) whose later step failed after an earlier one took effect. No message names a
 * value the user typed.
 */
export const ACCOUNT_MESSAGES = {
  /** Migration 5: a deleted account never changes again (no reactivation, edit, role or credential change). */
  deleted: "החשבון נמחק ולא ניתן לשנות אותו.",
  /** Migration 5 (C-02): the Manager's requests and the Creator's decisions are retired. */
  requestsRetired: "בקשות לאישור אינן בשימוש עוד.",
  /** An open creation intent exists for that address (Migration 1 `authorize_account_creation`, 55000). */
  openCreationExists: "קיימת כבר יצירה פתוחה לכתובת המייל הזו.",
  /** Phase 2 failed in a way that may have taken effect: the intent stays open for "השלמת יצירה". */
  creationIncomplete: "יצירת המשתמש לא הושלמה. היא מופיעה ב„יצירה שלא הושלמה” ואפשר להשלים אותה משם.",
  /** Phase 3 refused the binding for good (42501): the intent is cancelled (Step 2 plan §3.8, Q16). */
  creationCancelled: "לא ניתן היה להשלים את יצירת המשתמש, והיא בוטלה.",
  /** Phase 4 failed: the account exists without its field profile ("פרופיל טכנאי חסר", plan §3.8). */
  technicianProfileMissing: "המשתמש נוצר, אבל פרופיל הטכנאי לא נשמר. השלימו אותו ברשימה („פרופיל טכנאי חסר”).",
  /**
   * The deletion committed in the database, but the Auth step failed: a repeated deletion completes
   * it (the screen keeps the account and offers "נסו שוב", review S1, since the row is gone).
   */
  revokeIncomplete: "המשתמש נמחק במערכת, אבל חסימת ההתחברות לא הושלמה. נסו שוב כדי להשלים אותה.",
  created: "המשתמש נוצר.",
  saved: "השינוי נשמר.",
  passwordSet: "הסיסמה נשמרה.",
  emailChanged: "כתובת המייל עודכנה.",
  deletedOk: "המשתמש נמחק. ההיסטוריה שלו נשמרת.",
  cancelled: "היצירה בוטלה.",
} as const;

/** Auth Admin messages (account creation and the Creator's credential changes, PRs 2.6–2.7). */
export const AUTH_ADMIN_MESSAGES = {
  /** An address Auth already holds. A Manager is also told to ask the Creator (askCreator); the Creator is not (review N2). */
  emailExists: "כתובת המייל כבר רשומה במערכת ההתחברות",
  askCreator: "פנו ליוצר",
  weakPassword: "הסיסמה אינה עומדת בדרישות.",
  userNotFound: "חשבון ההתחברות לא נמצא.",
  rateLimited: "בוצעו יותר מדי פעולות. נסו שוב מאוחר יותר.",
} as const;

/** What kind of database failure it was; the caller decides (for example "no access" when objects are missing). */
export type DatabaseErrorKind = "forbidden" | "invalid" | "duplicate" | "stale" | "state" | "missing-object" | "unknown";

/** The `code` of an error-shaped value: a short non-empty string, else null. */
function codeOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const code = (error as { code?: unknown }).code;
  return typeof code === "string" && code.length > 0 && code.length <= 64 ? code : null;
}

/** The `message` of an error-shaped value, else null (compared only, never shown). */
function messageOf(error: unknown): string | null {
  if (typeof error !== "object" || error === null) return null;
  const message = (error as { message?: unknown }).message;
  return typeof message === "string" ? message : null;
}

/** The HTTP `status` of an Auth error, else null. */
function statusOf(error: unknown): number | null {
  if (typeof error !== "object" || error === null) return null;
  const status = (error as { status?: unknown }).status;
  return typeof status === "number" && Number.isInteger(status) ? status : null;
}

// Maps (not object literals), so a code such as "constructor" or "__proto__" is never found.

const DATABASE_KINDS: ReadonlyMap<string, DatabaseErrorKind> = new Map([
  ["42501", "forbidden"],
  ["22023", "invalid"],
  ["23514", "invalid"],
  ["23502", "invalid"],
  ["23503", "invalid"],
  ["23505", "duplicate"],
  ["PT409", "stale"],
  ["55000", "state"],
  // The database objects are not there (Migration 1 not applied, or the API schema cache is stale):
  // PostgREST's "table, function, column or schema not found" and the matching SQLSTATEs.
  ["PGRST106", "missing-object"],
  ["PGRST202", "missing-object"],
  ["PGRST204", "missing-object"],
  ["PGRST205", "missing-object"],
  ["42P01", "missing-object"],
  ["42703", "missing-object"],
  ["42883", "missing-object"],
  ["3F000", "missing-object"],
]);

/**
 * `55000` ("wrong state") texts that Migrations 1 and 5 raise from the account and matrix functions
 * and triggers, matched exactly. Trigger texts that the functions never let through (immutable fields,
 * append-only tables) and the one-time bootstrap's texts get the generic message.
 */
const STATE_MESSAGES: ReadonlyMap<string, string> = new Map([
  // D60 (7): only a creation intent raises it now (the request path is retired).
  ["an open request exists", ACCOUNT_MESSAGES.openCreationExists],
  ["a pending request exists", "קיימת כבר בקשה פתוחה."],
  ["the request is not pending", REQUEST_MESSAGES.notPending],
  ["the request does not apply", "הבקשה אינה מתאימה לחשבון הזה."],
  ["the request no longer applies", REQUEST_MESSAGES.noLongerApplies],
  ["the request cannot be cancelled", REQUEST_MESSAGES.cannotCancel],
  ["requires the Creator's approval", REQUEST_MESSAGES.needsCreator],
  ["the profile is not a Technician", TECHNICIAN_MESSAGES.notTechnician],
  ["the Technician already has a field profile", TECHNICIAN_MESSAGES.hasProfile],
  ["profiles: a profile with a technician record keeps its role", "לא ניתן לשנות את התפקיד של חשבון טכנאי."],
  ["profiles: the last active Creator cannot be demoted or deactivated", "לא ניתן להשבית את היוצר הפעיל האחרון או לשנות את תפקידו."],
  ["value locked until an open owner decision", "הערך נעול עד להחלטת הבעלים."],
  ["value already approved", "הערך כבר אושר."],
  // Migration 5 (D60 (7)): the deletion and the retired request path.
  ["the account is deleted", ACCOUNT_MESSAGES.deleted],
  ["profiles: a deleted account never changes (D60 (7))", ACCOUNT_MESSAGES.deleted],
  ["technicians: the account is deleted (D60 (7))", ACCOUNT_MESSAGES.deleted],
  ["account_requests: account requests are retired (D60 (7))", ACCOUNT_MESSAGES.requestsRetired],
  ["profiles: no user is promoted to Creator (D49)", "לא ניתן להפוך משתמש ליוצר."],
]);

/** The kind of a database (PostgREST) error; anything unrecognised, including a network failure, is "unknown". */
export function databaseErrorKind(error: unknown): DatabaseErrorKind {
  const code = codeOf(error);
  return (code !== null && DATABASE_KINDS.get(code)) || "unknown";
}

/** The Hebrew message for a database (PostgREST) error. Never the database's own text. */
export function databaseErrorMessage(error: unknown): string {
  switch (databaseErrorKind(error)) {
    case "forbidden":
      return ACTION_MESSAGES.forbidden;
    case "invalid":
      return ACTION_MESSAGES.invalid;
    case "duplicate":
      return ACTION_MESSAGES.duplicate;
    case "stale":
      return ACTION_MESSAGES.stale;
    case "state": {
      const message = messageOf(error);
      return (message !== null && STATE_MESSAGES.get(message)) || ACTION_MESSAGES.unknown;
    }
    case "missing-object":
    case "unknown":
      return ACTION_MESSAGES.unknown;
  }
}

/** A request reference may appear in a message only as an id: letters, digits and hyphens. */
const REQUEST_REF_PATTERN = /^[A-Za-z0-9-]{1,64}$/;

const AUTH_ADMIN_TEXTS: ReadonlyMap<string, string> = new Map([
  ["weak_password", AUTH_ADMIN_MESSAGES.weakPassword],
  ["user_not_found", AUTH_ADMIN_MESSAGES.userNotFound],
  ["over_request_rate_limit", AUTH_ADMIN_MESSAGES.rateLimited],
  ["validation_failed", ACTION_MESSAGES.invalid],
  ["email_address_invalid", ACTION_MESSAGES.invalid],
  ["bad_json", ACTION_MESSAGES.invalid],
  ["not_admin", ACTION_MESSAGES.forbidden],
  ["no_authorization", ACTION_MESSAGES.forbidden],
  ["bad_jwt", ACTION_MESSAGES.forbidden],
]);

/**
 * The Hebrew message for a Supabase Auth Admin error (account creation, password and email
 * changes). An address that Auth already holds names the request reference when one is given,
 * so the Creator can find the case (Step 2 plan §3.8, Q16); anyone but the Creator (`forCreator`)
 * is also told to ask the Creator (review N2: the Creator is never told to ask himself). A network
 * failure or an unknown code gets the generic message; whether the call took effect is the
 * caller's question (plan §3.8).
 */
export function authAdminErrorMessage(error: unknown, context: { requestRef?: string; forCreator?: boolean } = {}): string {
  const code = codeOf(error);
  if (code === "email_exists" || code === "user_already_exists") {
    const ref = context.requestRef;
    const ask = context.forCreator === true ? "" : `. ${AUTH_ADMIN_MESSAGES.askCreator}`;
    return ref !== undefined && REQUEST_REF_PATTERN.test(ref)
      ? `${AUTH_ADMIN_MESSAGES.emailExists}${ask} (מספר בקשה ${ref}).`
      : `${AUTH_ADMIN_MESSAGES.emailExists}${ask}.`;
  }
  return (code !== null && AUTH_ADMIN_TEXTS.get(code)) || ACTION_MESSAGES.unknown;
}

/** Auth error codes of a refused sign-in that say something about the account: one generic message. */
const SIGN_IN_CREDENTIAL_CODES: ReadonlySet<string> = new Set([
  "invalid_credentials",
  "email_not_confirmed",
  "phone_not_confirmed",
  "user_banned",
  "user_not_found",
]);

/**
 * Whether a failed `signInWithPassword` is a credential failure or a service failure (plan §3.4).
 * Credential failures are the account-related codes above, and an HTTP 400 without a code (older
 * Auth servers). Everything else (rate limits, network failures, server errors, unknown values) is
 * a service failure, whose message reveals nothing about any account either.
 */
export function signInFailureKind(error: unknown): "credentials" | "service" {
  const code = codeOf(error);
  if (code !== null) return SIGN_IN_CREDENTIAL_CODES.has(code) ? "credentials" : "service";
  return statusOf(error) === 400 ? "credentials" : "service";
}

/** The sign-in screen's message for a failed `signInWithPassword`. */
export const signInFailureMessage = (error: unknown): string => SIGN_IN_MESSAGES[signInFailureKind(error)];

/**
 * Self-service password reset (D65; docs/security.md §4): every text of "שכחתי סיסמה", the request
 * screen, the new-password screen and the notice on the sign-in screen, in the sign-in messages'
 * style. The request screen answers the same for every address ("sent"), so nothing reveals whether
 * an account exists; "deliveryOff" depends on the environment only.
 */
export const PASSWORD_RESET_MESSAGES = {
  forgotLink: "שכחתי סיסמה",
  updated: "הסיסמה עודכנה. אפשר להיכנס עם הסיסמה החדשה.",
  forgotTitle: "איפוס סיסמה",
  forgotIntro: "הזינו את כתובת המייל של החשבון, ונשלח אליה קישור לבחירת סיסמה חדשה.",
  send: "שליחת קישור",
  sending: "שולח…",
  backToLogin: "חזרה לכניסה",
  sentTitle: "בדקו את תיבת המייל",
  sent: "אם קיים חשבון עם הכתובת הזו, נשלח אליה קישור לבחירת סיסמה חדשה. הקישור תקף לשעה ולשימוש אחד.",
  deliveryOff: "שליחת מיילים עדיין אינה פעילה בסביבה הזו. לאיפוס סיסמה פנו ליוצר המערכת.",
  resetTitle: "בחירת סיסמה חדשה",
  newPassword: "סיסמה חדשה",
  confirmPassword: "אימות סיסמה",
  save: "שמירת הסיסמה",
  saving: "שומר…",
  invalidLink: "הקישור אינו תקף או שפג תוקפו.",
  requestNew: "בקשת קישור חדש",
  mismatch: "הסיסמאות אינן תואמות.",
  weak: "הסיסמה אינה עומדת בדרישות. בחרו סיסמה ארוכה וחזקה יותר.",
  same: "הסיסמה החדשה זהה לסיסמה הנוכחית. בחרו סיסמה אחרת.",
  service: "איפוס הסיסמה אינו זמין כרגע. נסו שוב מאוחר יותר.",
} as const;
