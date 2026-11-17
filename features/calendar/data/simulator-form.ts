// The Outlook invitation simulator's form on "זימונים שלא נקלטו" (D24, D60 (11); SIM-02 to SIM-05,
// X-05). Pure: no I/O and no clock (the caller passes "today" and the random parts), so every rule
// is unit-tested. The form builds a request for the existing server action
// (lib/actions/calendar-simulator.ts runInvitationSimulator), which validates it again with the
// shared Zod schemas, checks the environment switch and the caller, and runs the single ingestion
// service under the caller's session; the database decides (Migration 6). Nothing here decides who
// may use the simulator: the page renders the form only where the server says the simulator is on
// and the role may use it (D24, SIM-10, SIM-11).
// Every record the simulator creates is test data (D47): the database marks it from the source.
import type { SimulatorRequest } from "@/features/calendar/adapters/simulator/commands";
import { DEFAULT_INVITATION_TEMPLATE } from "@/features/calendar/ingestion/template";
import type { IngestionOutcome, IngestionResult, InvitationEvent } from "@/features/calendar/ingestion/types";
import { atJerusalem } from "@/features/dashboards/data/time";
import { isHourMinute, isIsoDate, type HourMinute, type IsoDate } from "@/features/data-access/common";
import type { TemplateFieldKey } from "@/features/settings/data/types";
import { unparsedProblemsOf } from "./unparsed-reasons";
import type { UnparsedProblem } from "./types";

/** The actions a person picks (SIM-02 to SIM-05), in the order the form lists them. */
export const SIMULATOR_FORM_ACTIONS = ["create", "update", "reschedule", "reassign", "cancel", "duplicate", "invalid"] as const;
export type SimulatorFormAction = (typeof SIMULATOR_FORM_ACTIONS)[number];

export const SIMULATOR_ACTION_LABELS = {
  create: "זימון חדש",
  update: "עדכון זימון",
  reschedule: "שינוי מועד",
  reassign: "החלפת טכנאי",
  cancel: "ביטול זימון",
  duplicate: "שליחה כפולה",
  invalid: "זימון שגוי",
} as const satisfies Record<SimulatorFormAction, string>;

/** One line under each action: what it sends. */
export const SIMULATOR_ACTION_HINTS = {
  create: "זימון חדש ב-Outlook: נוצרים קריאה וביקור, או ביקור נוסף לפנייה קיימת.",
  update: "גרסה חדשה של זימון ששלחתם: אותו זימון, הביקור מתעדכן ולא משוכפל.",
  reschedule: "אותו זימון במועד אחר.",
  reassign: "אותו זימון לטכנאי אחר.",
  cancel: "הזימון נמחק ב-Outlook. ביקור פתוח לא מבוטל אוטומטית: הוא עובר לבדיקה.",
  duplicate: "אותו עדכון נשלח שוב, בלי שינוי: לא נוצר שום דבר חדש.",
  invalid: "זימון עם ערכים חסרים או שגויים: הוא מופיע ברשימה עם הסיבות.",
} as const satisfies Record<SimulatorFormAction, string>;

/** Actions on an invitation sent before (they need its event id; "invalid" may also be a new one). */
export const needsExisting = (action: SimulatorFormAction): boolean => action !== "create" && action !== "invalid";

/** Actions that send the invitation's fields (cancel and duplicate send none). */
export const sendsFields = (action: SimulatorFormAction): boolean => action !== "cancel" && action !== "duplicate";

/** What the person typed. `attendee` is an address (a technician's Outlook address, or any other). */
export type SimulatorFormValues = {
  action: SimulatorFormAction;
  /** The event id of an invitation sent before ("" for none). */
  existing: string;
  attendee: string;
  subject: string;
  date: string;
  start: string;
  end: string;
  body: string;
};

/** An invitation sent from this page (kept in the screen's memory only, never in browser storage). */
export type SentInvitation = {
  eventId: string;
  /** The last event delivered for it (a "duplicate" sends it again unchanged). */
  lastEvent: InvitationEvent;
  /** The fields of its last version, to fill the form for an update; null after a cancellation only. */
  fields: Omit<SimulatorFormValues, "action" | "existing"> | null;
  /** The request number of its last version, when one was read. */
  requestNumber: string | null;
  cancelled: boolean;
};

/** Form fields that have an error, with the Hebrew message. */
export type SimulatorFormErrors = Partial<Record<"existing" | "attendee" | "subject" | "date" | "start" | "end", string>>;

const ADDRESS = /^[^@\s]+@[^@\s]+\.[^@\s]+$/;

/**
 * The form's own checks (before anything is sent). They only make the request buildable: a known
 * invitation for an action on one, a real date and times, a subject and an attendee for a valid
 * invitation. A "זימון שגוי" may leave the subject or the attendee empty or malformed on purpose:
 * the ingestion service lists those problems itself (S-05). Body values are never checked here.
 */
export function simulatorFormErrors(values: SimulatorFormValues, sent: readonly SentInvitation[]): SimulatorFormErrors {
  const errors: SimulatorFormErrors = {};
  if (needsExisting(values.action) || values.existing !== "") {
    const known = sent.find((s) => s.eventId === values.existing);
    if (!known) errors.existing = "בחרו זימון ששלחתם מהסימולטור";
    else if (known.cancelled && values.action !== "duplicate") errors.existing = "הזימון הזה בוטל: אפשר רק לשלוח שוב את הביטול";
  }
  if (!sendsFields(values.action)) return errors;
  const strict = values.action !== "invalid";
  if (strict && values.subject.trim() === "") errors.subject = "צריך נושא לזימון";
  if (strict && !ADDRESS.test(values.attendee.trim())) errors.attendee = "בחרו טכנאי, או הקלידו כתובת מייל תקינה";
  if (!isIsoDate(values.date)) errors.date = "בחרו תאריך";
  if (!isHourMinute(values.start)) errors.start = "שעה בפורמט 09:00";
  if (!isHourMinute(values.end)) errors.end = "שעה בפורמט 11:00";
  return errors;
}

export const hasErrors = (errors: SimulatorFormErrors): boolean => Object.keys(errors).length > 0;

/**
 * The server action's request for the form (call only when simulatorFormErrors is empty). Times are
 * the invitation's own, in Asia/Jerusalem (the offset of that date, never a fixed "+03:00").
 */
export function simulatorRequestOf(values: SimulatorFormValues, sent: readonly SentInvitation[]): SimulatorRequest | null {
  const known = sent.find((s) => s.eventId === values.existing) ?? null;
  if (values.action === "duplicate") return known ? { action: "duplicate", event: known.lastEvent as Extract<SimulatorRequest, { action: "duplicate" }>["event"] } : null;
  if (values.action === "cancel") return known ? { action: "cancel", eventId: known.eventId } : null;
  if (!isIsoDate(values.date) || !isHourMinute(values.start) || !isHourMinute(values.end)) return null;
  const attendee = values.attendee.trim();
  const invitation = {
    subject: values.subject,
    organizerEmail: null,
    attendeeEmails: attendee === "" ? [] : [attendee],
    start: atJerusalem(values.date, values.start),
    end: atJerusalem(values.date, values.end),
    body: values.body,
  };
  switch (values.action) {
    case "create":
      return { action: "create", invitation };
    case "invalid":
      return known ? { action: "invalid", eventId: known.eventId, invitation } : { action: "invalid", invitation };
    default:
      return known ? { action: values.action, eventId: known.eventId, invitation } : null;
  }
}

/** The request number of a body, as the template reads it ("מספר פנייה: …"); null when none. */
export function requestNumberOfBody(body: string): string | null {
  const label = DEFAULT_INVITATION_TEMPLATE.fields.find((f) => f.key === "req")?.label ?? "מספר פנייה";
  for (const line of body.split(/\r\n|\r|\n/)) {
    const t = line.trim();
    if (!t.startsWith(label)) continue;
    const m = /^[ \t]*:[ \t]*(.*)$/.exec(t.slice(label.length));
    const v = m?.[1]?.trim() ?? "";
    if (/^[A-Za-z0-9-]{1,32}$/.test(v)) return v;
  }
  return null;
}

/** The fictional values of a sample invitation (D47: fictional, test-marked by the database). */
export type SampleValues = Partial<Record<TemplateFieldKey, string>>;

/** A body in the template's label order ("label: value" lines; empty values left empty). */
export function invitationBodyOf(values: SampleValues): string {
  return DEFAULT_INVITATION_TEMPLATE.fields.map((f) => `${f.label}: ${values[f.key] ?? ""}`).join("\n");
}

/** The samples a person can start from (the demo's three, X-05). */
export const SIMULATOR_SAMPLES = ["new", "follow", "missing"] as const;
export type SimulatorSample = (typeof SIMULATOR_SAMPLES)[number];

export const SIMULATOR_SAMPLE_LABELS = {
  new: "לקוח חדש",
  follow: "ביקור המשך",
  missing: "זימון עם שדות חסרים",
} as const satisfies Record<SimulatorSample, string>;

/**
 * A sample's subject and body. `requestNumber` and `customerNumber` are fresh fictional numbers from
 * the caller; "ביקור המשך" reuses the request number of an invitation sent before (X-03: the same
 * number makes the next visit of that call).
 */
export function sampleInvitation(
  sample: SimulatorSample,
  ids: { requestNumber: string; customerNumber: string },
  followRequestNumber: string | null,
): { subject: string; body: string } {
  const req = sample === "follow" && followRequestNumber ? followRequestNumber : ids.requestNumber;
  const values: SampleValues = {
    req,
    task: sample === "follow" ? "2" : "1",
    rep: "נציגת בדיקה",
    customerNo: ids.customerNumber,
    customer: "לקוח בדיקה",
    phone: "050-000-0000",
    city: "רחובות",
    street: "הרצל 14",
    building: "א",
    floor: "3",
    apt: "9",
    arrival: "כניסה מהחניה",
    type: "תיקון",
    product: "ברז מטבח נשלף",
    sku: "KT-2041",
    desc: "טפטוף מתחת לכיור",
    warranty: "כן",
    techNote: "להתקשר לפני הגעה",
  };
  if (sample === "missing") {
    values.customerNo = "";
    values.phone = "";
    values.warranty = "אולי";
  }
  return { subject: `${DEFAULT_INVITATION_TEMPLATE.subjectPrefix} ${req} · לקוח בדיקה · רחובות`, body: invitationBodyOf(values) };
}

/** The form's start: a new invitation today, 09:00–11:00, from the "לקוח חדש" sample. */
export function initialFormValues(
  today: IsoDate,
  ids: { requestNumber: string; customerNumber: string },
  attendee: string,
): SimulatorFormValues {
  const sample = sampleInvitation("new", ids, null);
  return { action: "create", existing: "", attendee, subject: sample.subject, date: today, start: "09:00" as HourMinute, end: "11:00" as HourMinute, body: sample.body };
}

/** The server action's error codes (lib/actions/calendar-simulator.ts SimulatorActionError). */
export const SIMULATOR_ERROR_CODES = ["not-found", "invalid-input", "not-authorized", "rate-limited", "conflict", "unavailable", "failed"] as const;
export type SimulatorErrorCode = (typeof SIMULATOR_ERROR_CODES)[number];

/** The server action's answer, as the screen receives it (structurally the action's own type). */
export type SimulatorRunResult = { ok: true; event: InvitationEvent; result: IngestionResult } | { ok: false; error: SimulatorErrorCode };

/** The server action, passed to the screen by the page (components never import lib/actions). */
export type SimulatorRun = (input: unknown) => Promise<SimulatorRunResult>;

const ERROR_TEXT = {
  "not-found": "הסימולטור כבוי בסביבה הזו. שום דבר לא נשלח.",
  "invalid-input": "הבקשה לא תקינה ולא נשלחה. בדקו את השדות ונסו שוב.",
  "not-authorized": "אין לכם הרשאה לשלוח זימונים מהסימולטור.",
  "rate-limited": "נשלחו יותר מדי זימונים בדקה האחרונה. נסו שוב בעוד דקה.",
  conflict: "אותו עדכון כבר נשלח עם תוכן אחר, ולכן הוא נדחה. שום דבר לא השתנה.",
  unavailable: "השירות לא זמין כרגע. שום דבר לא נשלח.",
  failed: "השליחה נכשלה. שום דבר לא השתנה. נסו שוב.",
} as const satisfies Record<SimulatorErrorCode, string>;

/** What the screen says about one result: a tone, a title, more lines and the reasons of an unparsed invitation. */
export type SimulatorResultView = {
  tone: "ok" | "warn" | "error";
  title: string;
  lines: string[];
  problems: UnparsedProblem[];
};

function outcomeView(outcome: IngestionOutcome, command: "upsert" | "unparsed" | "delete"): SimulatorResultView {
  const where = [
    outcome.requestNumber ? `מס׳ פנייה ${outcome.requestNumber}` : null,
    outcome.visitNumber !== null ? `ביקור ${outcome.visitNumber}` : null,
  ]
    .filter(Boolean)
    .join(" · ");
  const lines: string[] = [];
  if (outcome.replay) lines.push("אותו עדכון כבר התקבל קודם: זו שליחה כפולה, ולא נוצר ולא השתנה דבר.");
  if (outcome.reviewItems > 0) lines.push(`נפתחו ${outcome.reviewItems} פריטים לבדיקה (שינויים שלא מוחלים אוטומטית).`);
  lines.push("נשמר כנתוני בדיקה (🧪 זימון בדיקה). לא נשלח מייל.");
  switch (outcome.outcome) {
    case "applied":
      return { tone: "ok", title: command === "delete" ? "הביטול נקלט" : `הזימון נקלט${where ? ` · ${where}` : ""}`, lines, problems: [] };
    case "review":
      return {
        tone: "warn",
        title: command === "delete" ? "הביטול התקבל ועבר לבדיקה: הביקור לא בוטל אוטומטית" : `הזימון נקלט חלקית ועבר לבדיקה${where ? ` · ${where}` : ""}`,
        lines,
        problems: [],
      };
    case "unparsed":
      return {
        tone: "warn",
        title: "הזימון לא נקלט. הוא מופיע ברשימה עם מה שצריך לתקן",
        lines,
        problems: unparsedProblemsOf(outcome.problems),
      };
    case "stale":
      return { tone: "warn", title: "העדכון ישן מהעדכון האחרון שנקלט, ולכן לא הוחל", lines, problems: [] };
    case "no_effect":
      return { tone: "warn", title: "לא היה מה לעדכן: הזימון בוטל קודם, או שהביקור כבר הסתיים", lines, problems: [] };
  }
}

/** The Hebrew view of the server action's answer. */
export function simulatorResultView(run: SimulatorRunResult): SimulatorResultView {
  if (!run.ok) return { tone: "error", title: ERROR_TEXT[run.error], lines: [], problems: [] };
  const result = run.result;
  switch (result.kind) {
    case "ignored":
      return {
        tone: "warn",
        title: `הנושא לא מתחיל ב-${DEFAULT_INVITATION_TEMPLATE.subjectPrefix}, ולכן האפליקציה מתעלמת מהזימון (כמו מכל פגישה רגילה)`,
        lines: ["שום דבר לא נשמר."],
        problems: [],
      };
    case "rejected":
      return { tone: "error", title: "הזימון לא תקין ולא נקלט (למשל מועד שלא ניתן לקרוא)", lines: ["שום דבר לא נשמר."], problems: [] };
    case "ingested":
      return outcomeView(result.outcome, result.command);
  }
}

/**
 * The history entry after a successful delivery (null when nothing was delivered). An upsert keeps
 * the form's fields for the next update; a cancellation marks the invitation cancelled.
 */
export function sentAfter(run: SimulatorRunResult, values: SimulatorFormValues, previous: SentInvitation | null): SentInvitation | null {
  if (!run.ok) return null;
  const event = run.event;
  if (event.change.type === "delete") {
    return { eventId: event.eventId, lastEvent: event, fields: previous?.fields ?? null, requestNumber: previous?.requestNumber ?? null, cancelled: true };
  }
  if (values.action === "duplicate") {
    return previous ? { ...previous, lastEvent: event } : null;
  }
  const fields = { attendee: values.attendee, subject: values.subject, date: values.date, start: values.start, end: values.end, body: values.body };
  return { eventId: event.eventId, lastEvent: event, fields, requestNumber: requestNumberOfBody(values.body), cancelled: false };
}

/** How a sent invitation is named in the form's list. */
export function sentInvitationLabel(sent: SentInvitation): string {
  const f = sent.fields;
  const when = f && isIsoDate(f.date) ? ` · ${f.date.slice(8, 10)}.${f.date.slice(5, 7)} ${f.start}` : "";
  const req = sent.requestNumber ? `מס׳ פנייה ${sent.requestNumber}` : (f?.subject.trim() || "זימון ללא נושא");
  return `${req}${when}${sent.cancelled ? " · בוטל" : ""}`;
}
