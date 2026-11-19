// The readable Hebrew reasons of "זימונים שלא נקלטו" (QA S-05: "an unparsed invitation shows the
// reason and the information needed to fix it"; IN-03, IN-04; Step 6 problem kinds). Pure: no I/O.
// The ingestion service stores machine-readable problems (features/calendar/ingestion/types.ts
// IngestionProblem, `calendar_ingestion_errors.problems`); this module turns each into the screen's
// UnparsedProblem: the field's label from the invitation template (Settings › תבנית זימון, the
// configuration the parser used), the value read (already sanitized by the service, cut again
// here), and app-written text that says what the field accepts or what to change. Invitation text is
// untrusted data and stays a plain value: it is never part of an explanation, never HTML.
// An unknown SKU is never a problem (D19, IN-02), so no reason here mentions one.
import { DEFAULT_INVITATION_TEMPLATE, effectiveTemplate, type InvitationTemplate } from "@/features/calendar/ingestion/template";
import { MAX_ATTENDEES } from "@/features/calendar/ingestion/event";
import { MAX_BODY_LENGTH } from "@/features/calendar/ingestion/parse";
import { MAX_SUBJECT_LENGTH } from "@/features/calendar/ingestion/plan";
import type { ConflictRule, IngestionProblem, InvalidRule, ProblemField } from "@/features/calendar/ingestion/types";
import { isTemplateFieldKey, type TemplateFieldKey } from "@/features/settings/data/types";
import { UNPARSED_VALUE_MAX, type UnparsedProblem, type UnparsedTechnicianReason } from "./types";

/** The parts of the invitation that are not template labels, as the screen names them. */
export const EVENT_PART_LABELS = {
  subject: "נושא הזימון",
  attendee: "משתתפים (הטכנאי)",
  organizer: "מארגן הזימון",
  schedule: "מועד הזימון",
  body: "גוף הזימון",
} as const satisfies Record<Exclude<ProblemField, TemplateFieldKey>, string>;

/** Longest text of each template field (the database columns the ingestion fills; Migrations 2 and 3). */
const FIELD_MAX: Readonly<Record<TemplateFieldKey, number>> = {
  req: 32,
  task: 40,
  rep: 60,
  customerNo: 40,
  customer: 120,
  phone: 20,
  phone2: 20,
  city: 60,
  street: 120,
  building: 20,
  floor: 20,
  apt: 20,
  arrival: 1000,
  type: 60,
  product: 120,
  sku: 40,
  desc: 1000,
  warranty: 60,
  collect: 120,
  collectFrom: 60,
  techNote: 1000,
};

/** ASCII-ID fields (task number, customer number, SKU): printable ASCII with single spaces. */
const ASCII_ID_FIELDS: ReadonlySet<TemplateFieldKey> = new Set(["task", "customerNo", "sku"]);

/** What a field's format accepts, in Hebrew (rule "format"). */
function formatExpected(field: ProblemField): string {
  switch (field) {
    case "req":
      return "אותיות באנגלית, ספרות ומקף בלבד, עד 32 תווים";
    case "phone":
    case "phone2":
      return "מספר טלפון בספרות, למשל 050-0000000";
    case "attendee":
    case "organizer":
      return "כתובת מייל תקינה";
    case "schedule":
      return "תאריך ושעות תקינים בזימון";
    case "subject":
    case "body":
      return "טקסט רגיל, בלי תווים נסתרים";
    default:
      return ASCII_ID_FIELDS.has(field) ? "אותיות באנגלית, ספרות וסימנים בלבד (בלי עברית), רווח אחד בין מילים" : "טקסט רגיל בשורה אחת, בלי תווים נסתרים";
  }
}

/** The longest value of a field, in Hebrew (rule "length"). */
function lengthExpected(field: ProblemField): string {
  if (field === "body") return `גוף זימון קצר מ-${MAX_BODY_LENGTH.toLocaleString("en-US")} תווים`;
  if (field === "subject") return `עד ${MAX_SUBJECT_LENGTH} תווים`;
  if (isTemplateFieldKey(field)) return `עד ${FIELD_MAX[field]} תווים`;
  return "טקסט קצר יותר";
}

/** The active call types of Settings, when the caller knows them ("סוג קריאה" with an unknown value). */
function callTypeExpected(callTypes: readonly string[] | undefined): string {
  if (!callTypes || callTypes.length === 0) return "אחד מסוגי הקריאה הפעילים בהגדרות";
  return `אחד מסוגי הקריאה בהגדרות: ${callTypes.join(", ")}`;
}

/** What an invalid value should be, per rule. */
function invalidExpected(field: ProblemField, rule: InvalidRule, lists: ReasonLists): string {
  switch (rule) {
    case "format":
      return formatExpected(field);
    case "length":
      return lengthExpected(field);
    case "duplicate_label":
      return "שורה אחת בלבד עם השדה הזה (השדה מופיע בזימון כמה פעמים עם ערכים שונים)";
    case "warranty_format":
      return "כן / לא / כן · עד MM/YYYY";
    case "unknown_call_type":
      return callTypeExpected(lists.callTypes);
    case "end_before_start":
      return "שעת סיום אחרי שעת ההתחלה";
    case "too_many_attendees":
      return `עד ${MAX_ATTENDEES} משתתפים`;
  }
}

/** Why a technician was not identified, and what to change. */
const TECHNICIAN_EXPLANATIONS = {
  unknown: "אף כתובת בזימון לא תואמת למייל ה-Outlook של טכנאי במערכת. צריך להזמין את הטכנאי בכתובת ה-Outlook שלו.",
  inactive: "הטכנאי שהוזמן לא פעיל או לא מקבל זימונים. צריך לשבץ טכנאי פעיל.",
  ambiguous: "בזימון יותר מטכנאי אחד. צריך להזמין טכנאי אחד בלבד לכל ביקור.",
} as const satisfies Record<UnparsedTechnicianReason, string>;

/** What a conflict with stored data means, and what to change (D39, D47; Step 6 OQ-7). */
const CONFLICT_EXPLANATIONS = {
  request_number_changed:
    "מס׳ הפנייה שונה ממס׳ הפנייה של הביקור שכבר נקלט מהזימון הזה. ביקור לא עובר לקריאה אחרת: צריך להחזיר את המספר הקודם, או לבטל את הזימון ולשלוח זימון חדש.",
  real_service_call: "מס׳ הפנייה שייך לקריאה אמיתית. זימון בדיקה לא מצטרף לנתונים אמיתיים: צריך מס׳ פנייה של נתוני בדיקה.",
  real_customer: "מספר הלקוח שייך ללקוח אמיתי. זימון בדיקה לא מצטרף לנתונים אמיתיים: צריך מספר לקוח של נתוני בדיקה.",
  real_product: "המק״ט שייך למוצר אמיתי. זימון בדיקה לא מצטרף לנתונים אמיתיים: צריך מק״ט של נתוני בדיקה.",
} as const satisfies Record<ConflictRule, string>;

/** Explanations of a missing part of the invitation that is not a template label. */
const MISSING_EVENT_PART = {
  subject: "צריך נושא שמתחיל ב-[קריאת שירות].",
  attendee: 'צריך להזמין את הטכנאי לפגישה (שדה "אל" ב-Outlook).',
  organizer: undefined,
  schedule: "צריך תאריך, שעת התחלה ושעת סיום בזימון.",
  body: "צריך גוף זימון לפי התבנית.",
} as const satisfies Record<Exclude<ProblemField, TemplateFieldKey>, string | undefined>;

/** Lists from Settings that make a reason concrete (each optional; bounded by the caller). */
export type ReasonLists = {
  /** Active call types, in Settings order. */
  callTypes?: readonly string[];
  /** Active pickup places, in Settings order. */
  pickupPlaces?: readonly string[];
};

/** Invitation text cut to UNPARSED_VALUE_MAX characters ("…" added); "" for none. */
export function invitationText(value: string | null | undefined): string {
  if (typeof value !== "string") return "";
  const chars = [...value];
  return chars.length > UNPARSED_VALUE_MAX ? `${chars.slice(0, UNPARSED_VALUE_MAX).join("")}…` : value;
}

/** The label of a problem's field: the template's label, or the name of the invitation's part. */
export function problemFieldLabel(field: ProblemField, template: InvitationTemplate = DEFAULT_INVITATION_TEMPLATE): string {
  if (isTemplateFieldKey(field)) return effectiveTemplate(template).fields.find((f) => f.key === field)?.label ?? field;
  return EVENT_PART_LABELS[field];
}

function placeExplanation(places: readonly string[] | undefined): string {
  if (!places) return "לא ברשימת מקומות האיסוף בהגדרות";
  if (places.length === 0) return "לא ברשימת מקומות האיסוף בהגדרות (אין עדיין מקומות איסוף בהגדרות)";
  return `לא ברשימת מקומות האיסוף בהגדרות: ${places.join(", ")}`;
}

/** One stored problem as the screen shows it. */
export function unparsedProblemOf(
  problem: IngestionProblem,
  lists: ReasonLists = {},
  template: InvitationTemplate = DEFAULT_INVITATION_TEMPLATE,
): UnparsedProblem {
  const label = problemFieldLabel(problem.field, template);
  switch (problem.kind) {
    case "missing": {
      const explanation = isTemplateFieldKey(problem.field) ? undefined : MISSING_EVENT_PART[problem.field];
      return explanation ? { kind: "missing", field: problem.field, label, explanation } : { kind: "missing", field: problem.field, label };
    }
    case "invalid":
      return { kind: "invalid", field: problem.field, label, value: invitationText(problem.value), expected: invalidExpected(problem.field, problem.rule, lists) };
    case "unknown_place":
      return { kind: "unknown-place", field: "collectFrom", label, value: invitationText(problem.value), explanation: placeExplanation(lists.pickupPlaces) };
    case "unknown_technician":
    case "inactive_technician":
    case "ambiguous_technician": {
      const reason: UnparsedTechnicianReason =
        problem.kind === "unknown_technician" ? "unknown" : problem.kind === "inactive_technician" ? "inactive" : "ambiguous";
      return { kind: "technician", field: "attendee", reason, label, value: invitationText(problem.value), explanation: TECHNICIAN_EXPLANATIONS[reason] };
    }
    case "conflict":
      return { kind: "conflict", field: problem.field, label, value: invitationText(problem.value), explanation: CONFLICT_EXPLANATIONS[problem.rule] };
  }
}

/** Every stored problem of an invitation, in the order the service found them. */
export function unparsedProblemsOf(
  problems: readonly IngestionProblem[],
  lists: ReasonLists = {},
  template: InvitationTemplate = DEFAULT_INVITATION_TEMPLATE,
): UnparsedProblem[] {
  return problems.map((p) => unparsedProblemOf(p, lists, template));
}

/** Whether any problem needs the call-type or pickup-place list (so a reader asks Settings only then). */
export function reasonListsNeeded(problems: readonly IngestionProblem[]): { callTypes: boolean; pickupPlaces: boolean } {
  return {
    callTypes: problems.some((p) => p.kind === "invalid" && p.rule === "unknown_call_type"),
    pickupPlaces: problems.some((p) => p.kind === "unknown_place"),
  };
}
