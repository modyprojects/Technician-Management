import { expect, test } from "@playwright/test";
import {
  buildSimulatorEvent,
  parseSimulatorRequest,
  simulatorEnabled,
  type SimulatorRequest,
} from "@/features/calendar/adapters/simulator";
import { GRAPH_ADAPTER_AVAILABLE } from "@/features/calendar/adapters/graph";
import {
  decideDelivery,
  DEFAULT_INVITATION_TEMPLATE,
  effectiveTemplate,
  ingestInvitation,
  invitationEventSchema,
  normalizeSku,
  parseIngestionOutcome,
  parseInvitationBody,
  parseWarranty,
  planIngestion,
  toDatabaseCommand,
  type IngestionCommand,
  type IngestionOutcome,
  type IngestionStore,
  type InvitationEvent,
} from "@/features/calendar/ingestion";
import { isSafeText, sanitizeForReport } from "@/features/calendar/ingestion/text";
import { onlyInProject } from "./helpers";

// Step 6: the pure core of the single calendar ingestion service (parser, plan, idempotency rule)
// and the simulator adapter. Fictional data only (D47). The database side is tested in
// tests/db/340_calendar_ingestion_writer.test.sql.

const RLM = String.fromCodePoint(0x200f);
const NBSP = String.fromCodePoint(0x00a0);
const GERSHAYIM = String.fromCodePoint(0x05f4);

/** docs/outlook-template.md "Sample (fictional)". */
const SAMPLE_LINES = [
  "מספר פנייה: 48213",
  "מספר משימה: 2",
  "נציגה מטפלת: שיראל",
  "מספר לקוח: 10001",
  "שם לקוח: משפחת לוי",
  "טלפון: 050-000-1122",
  "עיר: רחובות",
  "רחוב ומספר: הרצל 14",
  "בניין: א",
  "קומה: 3",
  "דירה: 9",
  "סוג קריאה: תיקון",
  "מוצר: ברז מטבח נשלף",
  'מק"ט: KT-2041',
  "תיאור התקלה: טפטוף מתחת לכיור",
  "באחריות: כן",
  "לאסוף לפני הביקור: ברז חלופי",
  "לאסוף מ: מרלוג",
  "הערות לטכנאי: להתקשר לפני הגעה",
];
const SAMPLE = SAMPLE_LINES.join("\n");
const withLine = (label: string, value: string | null): string =>
  SAMPLE_LINES.filter((line) => !line.startsWith(`${label}:`))
    .concat(value === null ? [] : [`${label}: ${value}`])
    .join("\n");

function upsertEvent(overrides: Partial<InvitationEvent> = {}, change: Partial<Extract<InvitationEvent["change"], { type: "upsert" }>> = {}): InvitationEvent {
  return {
    source: "simulator",
    calendarId: "simulator",
    eventId: "sim-00000000-0000-4000-8000-000000000001",
    changeKey: "sim-00000000-0000-4000-8000-0000000000a1",
    changedAt: "2026-11-17T08:00:00.000Z",
    change: {
      type: "upsert",
      subject: "[קריאת שירות] משפחת לוי · רחובות",
      organizerEmail: "rep.one@example.test",
      attendeeEmails: ["Tech.A@Example.Test "],
      start: "2026-11-18T09:00:00+02:00",
      end: "2026-11-18T11:00:00+02:00",
      body: SAMPLE,
      ...change,
    },
    ...overrides,
  };
}

test.describe("calendar ingestion: the template parser (IN-01, S-05, D17, D19, D42)", () => {
  onlyInProject("desktop");

  test("the sample invitation parses into every field", () => {
    const parsed = parseInvitationBody(SAMPLE);
    expect(parsed.ok).toBe(true);
    if (!parsed.ok) return;
    expect(parsed.fields).toEqual({
      requestNumber: "48213",
      taskNumber: "2",
      handlingRepName: "שיראל",
      customerNumber: "10001",
      customerName: "משפחת לוי",
      phone: "050-000-1122",
      phoneAlt: null,
      city: "רחובות",
      street: "הרצל 14",
      building: "א",
      floor: "3",
      apartment: "9",
      arrivalNotes: null,
      callType: "תיקון",
      productName: "ברז מטבח נשלף",
      sku: "KT-2041",
      skuNormalized: "KT-2041",
      faultDescription: "טפטוף מתחת לכיור",
      warranty: { status: "yes", until: null, raw: "כן" },
      pickupItem: "ברז חלופי",
      pickupLocation: "מרלוג",
      techNotes: "להתקשר לפני הגעה",
    });
  });

  test("labels, not line order: shuffled lines, free text, indentation and CRLF give the same fields", () => {
    const shuffled = ["שלום, זימון לביקור", ...[...SAMPLE_LINES].reverse().map((line) => `  ${line}`), "תודה"].join("\r\n");
    const a = parseInvitationBody(SAMPLE);
    const b = parseInvitationBody(shuffled);
    expect(b).toEqual(a);
  });

  test("'טלפון נוסף' is never read as 'טלפון', and both are kept", () => {
    const body = withLine("טלפון נוסף", "03-555-0000");
    const parsed = parseInvitationBody(body);
    expect(parsed.ok && parsed.fields.phone).toBe("050-000-1122");
    expect(parsed.ok && parsed.fields.phoneAlt).toBe("03-555-0000");
  });

  test("a gershayim in the SKU label reads as the template's quotation mark", () => {
    const body = SAMPLE.replace('מק"ט:', `מק${GERSHAYIM}ט:`);
    const parsed = parseInvitationBody(body);
    expect(parsed.ok && parsed.fields.sku).toBe("KT-2041");
  });

  test("missing required fields are listed in template order, with the values that were read", () => {
    const body = SAMPLE_LINES.filter((line) => !/^(מספר לקוח|תיאור התקלה|מספר משימה):/.test(line)).join("\n");
    const parsed = parseInvitationBody(body);
    expect(parsed.ok).toBe(false);
    if (parsed.ok) return;
    expect(parsed.problems).toEqual([
      { kind: "missing", field: "task" },
      { kind: "missing", field: "customerNo" },
      { kind: "missing", field: "desc" },
    ]);
    expect(parsed.recognised).toEqual({ requestNumber: "48213", customerName: "משפחת לוי" });
  });

  test("an empty or dash value is no value: missing when required, null when optional", () => {
    const missingRequired = parseInvitationBody(withLine("מספר לקוח", "—"));
    expect(!missingRequired.ok && missingRequired.problems).toEqual([{ kind: "missing", field: "customerNo" }]);
    const emptyOptional = parseInvitationBody(withLine("קומה", "-"));
    expect(emptyOptional.ok && emptyOptional.fields.floor).toBeNull();
    const noLabel = parseInvitationBody(withLine("קומה", null));
    expect(noLabel.ok && noLabel.fields.floor).toBeNull();
  });

  test("invalid values are refused with a machine-readable rule and a sanitized value", () => {
    const body = [
      withLine("טלפון", "phone me"),
      "", // a blank line changes nothing
    ].join("\n");
    const phone = parseInvitationBody(body);
    expect(!phone.ok && phone.problems).toEqual([{ kind: "invalid", field: "phone", rule: "format", value: "phone me" }]);

    const req = parseInvitationBody(withLine("מספר פנייה", "48 213"));
    expect(!req.ok && req.problems).toEqual([{ kind: "invalid", field: "req", rule: "format", value: "48 213" }]);
    expect(!req.ok && req.recognised.requestNumber).toBeNull();

    const hidden = parseInvitationBody(withLine("שם לקוח", `משפחת${RLM} לוי`));
    expect(!hidden.ok && hidden.problems).toEqual([{ kind: "invalid", field: "customer", rule: "format", value: "משפחת? לוי" }]);
    expect(!hidden.ok && hidden.recognised.customerName).toBeNull();

    const long = parseInvitationBody(withLine("עיר", "א".repeat(61)));
    expect(!long.ok && long.problems).toEqual([{ kind: "invalid", field: "city", rule: "length", value: "א".repeat(61) }]);
  });

  test("a label repeated with another value is a duplicate; the same value twice is fine", () => {
    const twice = parseInvitationBody(`${SAMPLE}\nמספר לקוח: 10001`);
    expect(twice.ok).toBe(true);
    const conflicting = parseInvitationBody(`${SAMPLE}\nמספר לקוח: 20002`);
    expect(!conflicting.ok && conflicting.problems).toEqual([
      { kind: "invalid", field: "customerNo", rule: "duplicate_label", value: "10001" },
    ]);
  });

  test("an unknown SKU is never a problem, and the SKU is trimmed and upper-cased (D19, PR-07)", () => {
    const parsed = parseInvitationBody(withLine('מק"ט', "kt-9999 "));
    expect(parsed.ok && [parsed.fields.sku, parsed.fields.skuNormalized]).toEqual(["kt-9999", "KT-9999"]);
    expect(normalizeSku("  ab-1 ")).toBe("AB-1");
  });

  test("warranty: yes, no, yes until MM/YYYY (first day of the month); anything else is invalid (D17, D42)", () => {
    expect(parseWarranty("כן")).toEqual({ status: "yes", until: null, raw: "כן" });
    expect(parseWarranty("לא")).toEqual({ status: "no", until: null, raw: "לא" });
    expect(parseWarranty("כן · עד 03/2027")).toEqual({ status: "yes", until: "2027-03-01", raw: "כן · עד 03/2027" });
    expect(parseWarranty("כן·עד 12/2030")?.until).toBe("2030-12-01");
    for (const bad of ["כן עד 03/2027", "כן · עד 13/2027", "כן · עד 3/2027", "אולי", "yes"]) expect(parseWarranty(bad)).toBeNull();
    const invalid = parseInvitationBody(withLine("באחריות", "אולי"));
    expect(!invalid.ok && invalid.problems).toEqual([{ kind: "invalid", field: "warranty", rule: "warranty_format", value: "אולי" }]);
    const none = parseInvitationBody(withLine("באחריות", null));
    expect(none.ok && none.fields.warranty).toBeNull();
  });

  test("an oversized body is refused as a whole", () => {
    const parsed = parseInvitationBody(`${SAMPLE}\n${"x".repeat(20_001)}`);
    expect(!parsed.ok && parsed.problems).toEqual([{ kind: "invalid", field: "body", rule: "length", value: null }]);
  });
});

test.describe("calendar ingestion: the template configuration", () => {
  onlyInProject("desktop");

  test("the D17 labels and the database's NOT NULL fields stay required whatever a configuration says (D35)", () => {
    const relaxed = {
      ...DEFAULT_INVITATION_TEMPLATE,
      fields: DEFAULT_INVITATION_TEMPLATE.fields.map((field) => ({ ...field, required: false })),
    };
    const effective = effectiveTemplate(relaxed);
    const required = effective.fields.filter((field) => field.required).map((field) => field.key);
    expect(required).toEqual(["req", "task", "rep", "customerNo", "customer", "phone", "city", "street", "type", "product", "sku", "desc"]);
  });

  test("a configured label replaces the default without code changes", () => {
    const custom = {
      ...DEFAULT_INVITATION_TEMPLATE,
      fields: DEFAULT_INVITATION_TEMPLATE.fields.map((field) => (field.key === "req" ? { ...field, label: "מס׳ פנייה" } : field)),
    };
    const parsed = parseInvitationBody(SAMPLE.replace("מספר פנייה:", "מס׳ פנייה:"), custom);
    expect(parsed.ok && parsed.fields.requestNumber).toBe("48213");
    const optionalMadeRequired = {
      ...DEFAULT_INVITATION_TEMPLATE,
      fields: DEFAULT_INVITATION_TEMPLATE.fields.map((field) => (field.key === "arrival" ? { ...field, required: true } : field)),
    };
    const missing = parseInvitationBody(SAMPLE, optionalMadeRequired);
    expect(!missing.ok && missing.problems).toEqual([{ kind: "missing", field: "arrival" }]);
  });

  test("a malformed configuration throws (duplicate label, colon, missing key)", () => {
    const fields = DEFAULT_INVITATION_TEMPLATE.fields;
    expect(() => effectiveTemplate({ ...DEFAULT_INVITATION_TEMPLATE, fields: fields.map((f) => (f.key === "phone2" ? { ...f, label: "טלפון" } : f)) })).toThrow();
    expect(() => effectiveTemplate({ ...DEFAULT_INVITATION_TEMPLATE, fields: fields.map((f) => (f.key === "city" ? { ...f, label: "עיר:" } : f)) })).toThrow();
    expect(() => effectiveTemplate({ ...DEFAULT_INVITATION_TEMPLATE, fields: fields.slice(1) })).toThrow();
    expect(() => effectiveTemplate({ ...DEFAULT_INVITATION_TEMPLATE, subjectPrefix: " " })).toThrow();
  });
});

test.describe("calendar ingestion: the plan (one event in, one command out)", () => {
  onlyInProject("desktop");

  test("a valid invitation becomes one upsert command with the event's own times and the matched attendee", () => {
    const plan = planIngestion(upsertEvent());
    expect(plan.kind).toBe("command");
    if (plan.kind !== "command" || plan.command.kind !== "upsert") throw new Error("expected an upsert");
    expect(plan.command.event).toEqual({
      subject: "[קריאת שירות] משפחת לוי · רחובות",
      organizerEmail: "rep.one@example.test",
      attendeeEmails: ["tech.a@example.test"],
      start: "2026-11-18T07:00:00.000Z",
      end: "2026-11-18T09:00:00.000Z",
    });
    expect(plan.command.fields.requestNumber).toBe("48213");
  });

  test("a meeting without the subject prefix is ignored (SE-13); a deletion needs nothing else", () => {
    expect(planIngestion(upsertEvent({}, { subject: "ישיבת צוות" }))).toEqual({ kind: "ignored", reason: "not-a-service-call" });
    const deletion = planIngestion({ ...upsertEvent(), change: { type: "delete" } });
    expect(deletion.kind === "command" && deletion.command.kind).toBe("delete");
  });

  test("problems of the event and of the body become one unparsed command", () => {
    const plan = planIngestion(
      upsertEvent({}, { attendeeEmails: [], start: "2026-11-18T11:00:00+02:00", end: "2026-11-18T09:00:00+02:00", body: withLine("מספר לקוח", null) }),
    );
    if (plan.kind !== "command" || plan.command.kind !== "unparsed") throw new Error("expected unparsed");
    expect(plan.command.problems).toEqual([
      { kind: "missing", field: "attendee" },
      { kind: "invalid", field: "schedule", rule: "end_before_start", value: null },
      { kind: "missing", field: "customerNo" },
    ]);
    expect(plan.command.recognised).toEqual({ requestNumber: "48213", customerName: "משפחת לוי" });
    const badAttendee = planIngestion(upsertEvent({}, { attendeeEmails: ["not an email"] }));
    expect(badAttendee.kind === "command" && badAttendee.command.kind === "unparsed" && badAttendee.command.problems).toEqual([
      { kind: "invalid", field: "attendee", rule: "format", value: "not an email" },
    ]);
    const badTime = planIngestion(upsertEvent({}, { start: "tomorrow" }));
    expect(badTime.kind === "command" && badTime.command.kind === "unparsed" && badTime.command.event.start).toBeNull();
  });

  test("a malformed envelope is rejected before anything is stored (ids, change time, source)", () => {
    expect(planIngestion(upsertEvent({ eventId: "" })).kind).toBe("rejected");
    expect(planIngestion(upsertEvent({ changeKey: "with space" })).kind).toBe("rejected");
    expect(planIngestion(upsertEvent({ changedAt: "2026-11-17" })).kind).toBe("rejected");
    expect(planIngestion(upsertEvent({ changedAt: "1999-01-01T00:00:00Z" })).kind).toBe("rejected");
    expect(planIngestion({ ...upsertEvent(), source: "microsoft_graph" }).kind).toBe("rejected");
    expect(planIngestion(null).kind).toBe("rejected");
    const rejected = planIngestion(upsertEvent({ eventId: "" }));
    expect(rejected.kind === "rejected" && rejected.issues.join()).not.toContain("sim-");
  });

  test("the same event always gives the same database command; equal instants in other offsets too", () => {
    const a = planIngestion(upsertEvent());
    const b = planIngestion(upsertEvent({ changedAt: "2026-11-17T10:00:00+02:00" }, { start: "2026-11-18T07:00:00Z", end: "2026-11-18T09:00:00.000Z" }));
    if (a.kind !== "command" || b.kind !== "command") throw new Error("expected commands");
    expect(JSON.stringify(toDatabaseCommand(b.command))).toBe(JSON.stringify(toDatabaseCommand(a.command)));
  });

  test("the database command has exactly the keys the SQL function reads", () => {
    const plan = planIngestion(upsertEvent());
    if (plan.kind !== "command") throw new Error("expected a command");
    const command = toDatabaseCommand(plan.command) as { fields: Record<string, unknown>; event: Record<string, unknown> };
    expect(Object.keys(command).sort()).toEqual(
      ["calendar_id", "change_key", "changed_at", "event", "event_id", "fields", "kind", "problems", "recognised", "source"].sort(),
    );
    expect(Object.keys(command.event).sort()).toEqual(["attendee_emails", "end", "organizer_email", "start", "subject"]);
    expect(Object.keys(command.fields).sort()).toEqual(
      [
        "apartment", "arrival_notes", "building", "call_type", "city", "customer_name", "customer_number", "fault_description",
        "floor", "handling_rep_name", "phone", "phone_alt", "pickup_item", "pickup_location", "product_name", "request_number",
        "sku", "street", "task_number", "tech_notes", "warranty_raw", "warranty_status", "warranty_until",
      ].sort(),
    );
  });
});

test.describe("calendar ingestion: idempotency and ordering (database-schema.md §10)", () => {
  onlyInProject("desktop");

  const state = { lastChangedAt: "2026-11-17T08:00:00.000Z", received: new Map([["k1", "h1"]]) };

  test("the same change key with the same payload is a replay; with another payload a conflict", () => {
    expect(decideDelivery(state, { changeKey: "k1", changedAt: "2026-11-17T08:00:00.000Z", payloadSha256: "h1" })).toBe("replay");
    expect(decideDelivery(state, { changeKey: "k1", changedAt: "2026-11-17T08:00:00.000Z", payloadSha256: "h2" })).toBe("conflict");
  });

  test("a new key that is not newer is stale (out of order, or the same time with another key); a newer one is new", () => {
    expect(decideDelivery(state, { changeKey: "k0", changedAt: "2026-11-17T07:59:59.999Z", payloadSha256: "h0" })).toBe("stale");
    expect(decideDelivery(state, { changeKey: "k2", changedAt: "2026-11-17T08:00:00.000Z", payloadSha256: "h2" })).toBe("stale");
    expect(decideDelivery(state, { changeKey: "k3", changedAt: "2026-11-17T08:00:00.001Z", payloadSha256: "h3" })).toBe("new");
    expect(decideDelivery({ lastChangedAt: null, received: new Map() }, { changeKey: "k", changedAt: "2000-01-01T00:00:00Z", payloadSha256: "h" })).toBe("new");
  });

  test("the single entry point: ignored and rejected events never reach the store; a command reaches it once", async () => {
    const seen: IngestionCommand[] = [];
    const outcome: IngestionOutcome = {
      outcome: "applied", replay: false, changeId: "00000000-0000-4000-8000-000000000001", requestNumber: "48213",
      visitNumber: 1, serviceCallId: null, visitId: null, reviewItems: 0, appliedFields: [], problems: [],
    };
    const store: IngestionStore = { apply: async (command) => (seen.push(command), outcome) };
    expect(await ingestInvitation(upsertEvent({}, { subject: "ישיבה" }), store)).toEqual({ kind: "ignored", reason: "not-a-service-call" });
    expect((await ingestInvitation({}, store)).kind).toBe("rejected");
    expect(seen).toHaveLength(0);
    expect(await ingestInvitation(upsertEvent(), store)).toEqual({ kind: "ingested", command: "upsert", outcome });
    expect(seen).toHaveLength(1);
  });

  test("the database's answer is validated before anyone uses it", () => {
    const answer = {
      outcome: "unparsed", replay: true, change_id: "00000000-0000-4000-8000-000000000002", request_number: null,
      visit_number: null, service_call_id: null, visit_id: null, review_items: 0, applied_fields: [],
      problems: [{ kind: "unknown_place", field: "collectFrom", value: "מחסן" }],
    };
    expect(parseIngestionOutcome(answer)?.problems).toEqual([{ kind: "unknown_place", field: "collectFrom", value: "מחסן" }]);
    expect(parseIngestionOutcome({ ...answer, outcome: "done" })).toBeNull();
    expect(parseIngestionOutcome({ ...answer, problems: [{ kind: "missing", field: "secret" }] })).toBeNull();
    expect(parseIngestionOutcome(null)).toBeNull();
  });
});

test.describe("calendar ingestion: the Outlook invitation simulator (D24, SIM-02 to SIM-12)", () => {
  onlyInProject("desktop");

  const invitation = {
    subject: "[קריאת שירות] משפחת לוי",
    organizerEmail: "rep.one@example.test",
    attendeeEmails: ["tech.a@example.test"],
    start: "2026-11-18T09:00:00+02:00",
    end: "2026-11-18T11:00:00+02:00",
    body: SAMPLE,
  };
  let n = 0;
  const deps = { now: () => new Date("2026-11-17T08:00:00.000Z"), newId: () => `00000000-0000-4000-8000-${String(++n).padStart(12, "0")}` };

  test("switched only by the environment: CALENDAR_SIMULATOR=1, never on Vercel Production", () => {
    const cases: [string | undefined, string | undefined, boolean][] = [
      ["1", undefined, true],
      ["1", "preview", true],
      ["1", "development", true],
      ["1", "production", false],
      [undefined, "preview", false],
      ["true", "preview", false],
      ["", undefined, false],
      ["0", undefined, false],
    ];
    for (const [flag, vercelEnv, expected] of cases) expect(simulatorEnabled({ flag, vercelEnv }), `${flag}/${vercelEnv}`).toBe(expected);
  });

  test("create draws a new event id; update, reschedule and reassign keep it with a new change key", () => {
    const created = buildSimulatorEvent({ action: "create", invitation }, deps);
    expect(created.eventId).toMatch(/^sim-/);
    expect(invitationEventSchema.safeParse(created).success).toBe(true);
    for (const action of ["update", "reschedule", "reassign"] as const) {
      const next = buildSimulatorEvent({ action, eventId: created.eventId, invitation }, deps);
      expect(next.eventId).toBe(created.eventId);
      expect(next.changeKey).not.toBe(created.changeKey);
      expect(next.change.type).toBe("upsert");
    }
    const cancelled = buildSimulatorEvent({ action: "cancel", eventId: created.eventId }, deps);
    expect(cancelled.change).toEqual({ type: "delete" });
    const invalidNew = buildSimulatorEvent({ action: "invalid", invitation: { ...invitation, body: "" } }, deps);
    expect(invalidNew.eventId).not.toBe(created.eventId);
  });

  test("duplicate delivers the same event unchanged, so the database sees a replay", () => {
    const created = buildSimulatorEvent({ action: "create", invitation }, deps);
    const again = buildSimulatorEvent({ action: "duplicate", event: created }, deps);
    expect(again).toEqual(created);
    const a = planIngestion(created);
    const b = planIngestion(again);
    if (a.kind !== "command" || b.kind !== "command") throw new Error("expected commands");
    expect(toDatabaseCommand(b.command)).toEqual(toDatabaseCommand(a.command));
  });

  test("requests are validated: only simulated ids, known actions and bounded values", () => {
    const valid: SimulatorRequest = { action: "create", invitation };
    expect(parseSimulatorRequest(valid)).not.toBeNull();
    expect(parseSimulatorRequest({ action: "update", eventId: "AAMkAGI2", invitation })).toBeNull();
    expect(parseSimulatorRequest({ action: "cancel" })).toBeNull();
    expect(parseSimulatorRequest({ action: "approve", invitation })).toBeNull();
    expect(parseSimulatorRequest({ action: "create", invitation: { ...invitation, attendeeEmails: Array(21).fill("a@example.test") } })).toBeNull();
    const graphLike = { ...buildSimulatorEvent({ action: "create", invitation }, deps), source: "simulator", calendarId: "mailbox-1" };
    expect(parseSimulatorRequest({ action: "duplicate", event: graphLike })).toBeNull();
  });

  test("the Graph adapter is a typed boundary only (no network code until Step 11)", () => {
    expect(GRAPH_ADAPTER_AVAILABLE).toBe(false);
  });
});

test.describe("calendar ingestion: text rules mirror the database CHECKs", () => {
  onlyInProject("desktop");

  test("TEXT-SAFE refuses invisible and edge-space characters, accepts Hebrew text", () => {
    expect(isSafeText("משפחת לוי", 120)).toBe(true);
    expect(isSafeText(`לוי${RLM}`, 120)).toBe(false);
    expect(isSafeText(`${NBSP}לוי`, 120)).toBe(false);
    expect(isSafeText(" לוי", 120)).toBe(false);
    expect(isSafeText("שורה\nשנייה", 120)).toBe(false);
    expect(isSafeText("שורה\nשנייה", 120, true)).toBe(true);
    expect(isSafeText(String.fromCodePoint(0x65, 0x301), 120)).toBe(false);
  });

  test("report values are sanitized and cut", () => {
    expect(sanitizeForReport(`a${RLM}b`)).toBe("a?b");
    expect(sanitizeForReport("   ")).toBeNull();
    expect(sanitizeForReport("א".repeat(200))?.length).toBe(120);
  });
});
