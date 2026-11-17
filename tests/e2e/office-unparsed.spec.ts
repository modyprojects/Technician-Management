import { readFileSync } from "node:fs";
import path from "node:path";
import { expect, test } from "@playwright/test";
import {
  hasErrors,
  initialFormValues,
  invitationBodyOf,
  needsExisting,
  requestNumberOfBody,
  sampleInvitation,
  sendsFields,
  sentAfter,
  sentInvitationLabel,
  SIMULATOR_FORM_ACTIONS,
  simulatorFormErrors,
  simulatorRequestOf,
  simulatorResultView,
  type SentInvitation,
  type SimulatorFormValues,
} from "@/features/calendar/data/simulator-form";
import { invitationText, problemFieldLabel, reasonListsNeeded, unparsedProblemOf } from "@/features/calendar/data/unparsed-reasons";
import { simulatorRequestSchema } from "@/features/calendar/adapters/simulator/commands";
import type { IngestionOutcome, IngestionProblem, InvitationEvent } from "@/features/calendar/ingestion/types";
import { eventTimesOf, instantOf, matchedTechnician, readsIntake, unparsedInvitationOf, type ErrorRow } from "@/features/calendar/supabase/intake-queries";
import { OFFICE_UNPARSED_PATH, realOfficeNav } from "@/features/auth/landing";
import { onlyInProject, openPage } from "./helpers";

// "זימונים שלא נקלטו" and the Outlook invitation simulator (QA S-05; D24, D47, D60 (4), (11)): the
// pure rules (reasons, the read model's mapping, the simulator form) and source checks of the page's
// server-side switch. The screen itself on real data is tested against the local stack
// (tests/auth/office-unparsed.spec.ts); here, without Supabase values, the route fails closed.

const EVENT_ID = "sim-00000000-0000-4000-8000-000000000001";
const CHANGE = "sim-00000000-0000-4000-8000-000000000002";
const upsertEvent = (body = "x"): InvitationEvent => ({
  source: "simulator",
  calendarId: "simulator",
  eventId: EVENT_ID,
  changeKey: CHANGE,
  changedAt: "2026-11-17T10:00:00.000Z",
  change: { type: "upsert", subject: "[קריאת שירות] 1", organizerEmail: null, attendeeEmails: ["t@example.test"], start: "2026-12-01T09:00:00+02:00", end: "2026-12-01T11:00:00+02:00", body },
});
const outcome = (o: Partial<IngestionOutcome>): IngestionOutcome => ({
  outcome: "applied",
  replay: false,
  changeId: "00000000-0000-4000-8000-000000000003",
  requestNumber: "48213",
  visitNumber: 1,
  serviceCallId: null,
  visitId: null,
  reviewItems: 0,
  appliedFields: [],
  problems: [],
  ...o,
});

test.describe("the reasons of an unparsed invitation (S-05)", () => {
  onlyInProject("desktop");

  test("every stored problem kind becomes a readable Hebrew reason with its field label", () => {
    expect(unparsedProblemOf({ kind: "missing", field: "customerNo" })).toEqual({ kind: "missing", field: "customerNo", label: "מספר לקוח" });
    expect(unparsedProblemOf({ kind: "missing", field: "attendee" })).toMatchObject({ label: "משתתפים (הטכנאי)", explanation: expect.stringContaining('שדה "אל"') });
    expect(unparsedProblemOf({ kind: "invalid", field: "warranty", rule: "warranty_format", value: "אולי" })).toEqual({
      kind: "invalid",
      field: "warranty",
      label: "באחריות",
      value: "אולי",
      expected: "כן / לא / כן · עד MM/YYYY",
    });
    expect(unparsedProblemOf({ kind: "invalid", field: "req", rule: "format", value: "48 213" })).toMatchObject({ label: "מספר פנייה", expected: expect.stringContaining("עד 32 תווים") });
    expect(unparsedProblemOf({ kind: "invalid", field: "phone", rule: "format", value: "אין" })).toMatchObject({ expected: expect.stringContaining("מספר טלפון") });
    expect(unparsedProblemOf({ kind: "invalid", field: "city", rule: "length", value: "x" })).toMatchObject({ expected: "עד 60 תווים" });
    expect(unparsedProblemOf({ kind: "invalid", field: "schedule", rule: "end_before_start", value: null })).toMatchObject({ label: "מועד הזימון", value: "", expected: "שעת סיום אחרי שעת ההתחלה" });
    expect(unparsedProblemOf({ kind: "invalid", field: "type", rule: "unknown_call_type", value: "החלפה" }, { callTypes: ["תיקון", "התקנה"] })).toMatchObject({
      expected: "אחד מסוגי הקריאה בהגדרות: תיקון, התקנה",
    });
    expect(unparsedProblemOf({ kind: "unknown_place", field: "collectFrom", value: "מחסן" }, { pickupPlaces: [] })).toMatchObject({
      kind: "unknown-place",
      label: "לאסוף מ",
      explanation: expect.stringContaining("אין עדיין מקומות איסוף"),
    });
    for (const [kind, reason] of [
      ["unknown_technician", "unknown"],
      ["inactive_technician", "inactive"],
      ["ambiguous_technician", "ambiguous"],
    ] as const) {
      expect(unparsedProblemOf({ kind, field: "attendee", value: "a@example.test" })).toMatchObject({ kind: "technician", reason, value: "a@example.test" });
    }
    for (const rule of ["request_number_changed", "real_service_call", "real_customer", "real_product"] as const) {
      const p = unparsedProblemOf({ kind: "conflict", field: "req", rule, value: "1" });
      expect(p.kind).toBe("conflict");
      expect(p.kind === "conflict" && p.explanation.length > 20).toBe(true);
    }
  });

  test("explanations are app text: invitation text stays a value, cut to 120 characters", () => {
    const long = "א".repeat(300);
    const p = unparsedProblemOf({ kind: "invalid", field: "customer", rule: "length", value: long });
    expect(p.kind === "invalid" && [...p.value].length).toBe(121);
    expect(p.kind === "invalid" && p.expected).toBe("עד 120 תווים");
    expect(invitationText(null)).toBe("");
    expect(problemFieldLabel("sku")).toBe('מק"ט');
    expect(reasonListsNeeded([{ kind: "unknown_place", field: "collectFrom", value: null }])).toEqual({ callTypes: false, pickupPlaces: true });
  });
});

test.describe("the read model of the unparsed list", () => {
  onlyInProject("desktop");

  const row: ErrorRow = {
    id: "00000000-0000-4000-8000-000000000010",
    created_at: "2026-11-17T10:12:33.123456+00:00",
    subject: "[קריאת שירות] 48213",
    organizer_email: null,
    attendee_emails: ["T@Example.test", "other@example.test"],
    event_start: "2026-12-01 07:00:00+00",
    event_end: "2026-12-01T09:30:00+00:00",
    request_number: "48213",
    customer_name: "לקוח בדיקה",
    problems: [{ kind: "missing", field: "customerNo" }] as IngestionProblem[],
    is_test: true,
  };
  const tech = { id: "00000000-0000-4000-8000-000000000020", display_name: "טכנאי בדיקה", color: "t-y", outlook_email: "t@example.test" };

  test("PostgreSQL instants become Asia/Jerusalem dates and times; unreadable ones none", () => {
    expect(instantOf("2026-11-17T10:12:33.123456+00:00")).toBe("2026-11-17T10:12:33.123+00:00");
    expect(instantOf("2026-12-01 07:00:00+00")).toBe("2026-12-01T07:00:00+00:00");
    expect(instantOf("yesterday")).toBeNull();
    expect(eventTimesOf("2026-12-01T07:00:00+00:00", "2026-12-01T09:30:00+00:00")).toEqual({ date: "2026-12-01", start: "09:00", end: "11:30" });
    expect(eventTimesOf(null, null)).toBeNull();
  });

  test("a row: test source, the one matched technician, reasons, the rep mail pending (d09)", () => {
    const byAddress = new Map([[tech.outlook_email, tech]]);
    const item = unparsedInvitationOf(row, byAddress, {});
    expect(item).toMatchObject({
      source: "simulator",
      isTest: true,
      organizer: { email: null, name: null },
      attendees: { emails: ["T@Example.test", "other@example.test"], technician: { id: tech.id, name: tech.display_name, color: "var(--t-y)" } },
      event: { date: "2026-12-01", start: "09:00", end: "11:30" },
      requestNumber: "48213",
      repMail: { status: "pending", decision: "d09" },
    });
    expect(item.problems).toEqual([{ kind: "missing", field: "customerNo", label: "מספר לקוח" }]);
    // Two technicians in one invitation: none is chosen.
    const t2 = { ...tech, id: "00000000-0000-4000-8000-000000000021", outlook_email: "other@example.test" };
    expect(matchedTechnician(["t@example.test", "other@example.test"], new Map([[tech.outlook_email, tech], [t2.outlook_email, t2]]))).toBeNull();
    expect(matchedTechnician([], byAddress)).toBeNull();
  });

  test("only office roles read the list (a Technician or nobody gets nothing)", () => {
    for (const role of ["creator", "mgr", "cs"] as const) expect(readsIntake({ role })).toBe(true);
    expect(readsIntake({ role: "tech" })).toBe(false);
    expect(readsIntake(null)).toBe(false);
  });
});

test.describe("the simulator form (D24, SIM-02 to SIM-05)", () => {
  onlyInProject("desktop");

  const ids = { requestNumber: "912345", customerNumber: "SC-00001" };
  const start = (): SimulatorFormValues => initialFormValues("2026-12-01", ids, "t@example.test");

  test("samples are fictional template bodies; a follow-up reuses a request number", () => {
    const v = start();
    expect(v.action).toBe("create");
    expect(v.subject.startsWith("[קריאת שירות]")).toBe(true);
    expect(requestNumberOfBody(v.body)).toBe("912345");
    expect(v.body).toContain('מק"ט: KT-2041');
    expect(sampleInvitation("follow", ids, "48190").body).toContain("מספר פנייה: 48190");
    const missing = sampleInvitation("missing", ids, null).body;
    expect(missing).toContain("מספר לקוח: \n");
    expect(missing).toContain("באחריות: אולי");
    expect(invitationBodyOf({ req: "1" }).split("\n")).toHaveLength(21);
  });

  test("the form's own errors; a valid create builds a request the server's schema accepts", () => {
    expect(simulatorFormErrors(start(), [])).toEqual({});
    expect(simulatorFormErrors({ ...start(), action: "update" }, [])).toEqual({ existing: "בחרו זימון ששלחתם מהסימולטור" });
    expect(simulatorFormErrors({ ...start(), subject: " ", attendee: "x", start: "9" }, [])).toEqual({
      subject: "צריך נושא לזימון",
      attendee: "בחרו טכנאי, או הקלידו כתובת מייל תקינה",
      start: "שעה בפורמט 09:00",
    });
    // An invalid invitation may be empty or malformed on purpose: only the date and times are needed.
    expect(simulatorFormErrors({ ...start(), action: "invalid", subject: "", attendee: "" }, [])).toEqual({});
    expect(hasErrors({})).toBe(false);
    const request = simulatorRequestOf(start(), []);
    expect(request).toMatchObject({ action: "create", invitation: { start: "2026-12-01T09:00:00+02:00", end: "2026-12-01T11:00:00+02:00", attendeeEmails: ["t@example.test"], organizerEmail: null } });
    expect(simulatorRequestSchema.safeParse(request).success).toBe(true);
    // Summer time in Asia/Jerusalem: the offset of that date.
    expect(simulatorRequestOf({ ...start(), date: "2026-07-01" }, [])).toMatchObject({ invitation: { start: "2026-07-01T09:00:00+03:00" } });
  });

  test("actions on a sent invitation: update, reschedule, reassign, cancel, duplicate", () => {
    const sentOne = sentAfter({ ok: true, event: upsertEvent(start().body), result: { kind: "ingested", command: "upsert", outcome: outcome({}) } }, start(), null);
    expect(sentOne).toMatchObject({ eventId: EVENT_ID, requestNumber: "912345", cancelled: false });
    const sent = [sentOne!];
    for (const action of ["update", "reschedule", "reassign"] as const) {
      const r = simulatorRequestOf({ ...start(), action, existing: EVENT_ID }, sent);
      expect(r).toMatchObject({ action, eventId: EVENT_ID });
      expect(simulatorRequestSchema.safeParse(r).success, action).toBe(true);
    }
    expect(simulatorRequestOf({ ...start(), action: "cancel", existing: EVENT_ID }, sent)).toEqual({ action: "cancel", eventId: EVENT_ID });
    const dup = simulatorRequestOf({ ...start(), action: "duplicate", existing: EVENT_ID }, sent);
    expect(dup).toEqual({ action: "duplicate", event: sentOne!.lastEvent });
    expect(simulatorRequestSchema.safeParse(dup).success).toBe(true);
    expect(sendsFields("cancel")).toBe(false);
    expect(needsExisting("invalid")).toBe(false);
    expect(SIMULATOR_FORM_ACTIONS).toEqual(["create", "update", "reschedule", "reassign", "cancel", "duplicate", "invalid"]);
    // After a cancellation only a duplicate of the cancellation is offered.
    const cancelled: SentInvitation = { ...sentOne!, cancelled: true };
    expect(simulatorFormErrors({ ...start(), action: "update", existing: EVENT_ID }, [cancelled]).existing).toContain("בוטל");
    expect(simulatorFormErrors({ ...start(), action: "duplicate", existing: EVENT_ID }, [cancelled])).toEqual({});
    expect(sentInvitationLabel(cancelled)).toBe("מס׳ פנייה 912345 · 01.12 09:00 · בוטל");
  });

  test("results in Hebrew: ingested, replay, review, unparsed with reasons, ignored, errors", () => {
    const ok = (o: Partial<IngestionOutcome>, command: "upsert" | "unparsed" | "delete" = "upsert") =>
      simulatorResultView({ ok: true, event: upsertEvent(), result: { kind: "ingested", command, outcome: outcome(o) } });
    expect(ok({}).title).toBe("הזימון נקלט · מס׳ פנייה 48213 · ביקור 1");
    expect(ok({}).lines).toContain("נשמר כנתוני בדיקה (🧪 זימון בדיקה). לא נשלח מייל.");
    expect(ok({ replay: true }).lines[0]).toContain("זו שליחה כפולה");
    expect(ok({ outcome: "review" }, "delete").title).toContain("הביקור לא בוטל אוטומטית");
    const unparsed = ok({ outcome: "unparsed", problems: [{ kind: "missing", field: "phone" }] }, "unparsed");
    expect(unparsed.tone).toBe("warn");
    expect(unparsed.problems).toEqual([{ kind: "missing", field: "phone", label: "טלפון" }]);
    expect(ok({ outcome: "stale" }).title).toContain("ישן");
    expect(simulatorResultView({ ok: true, event: upsertEvent(), result: { kind: "ignored", reason: "not-a-service-call" } }).title).toContain("מתעלמת");
    expect(simulatorResultView({ ok: false, error: "not-found" }).title).toBe("הסימולטור כבוי בסביבה הזו. שום דבר לא נשלח.");
    expect(simulatorResultView({ ok: false, error: "rate-limited" }).tone).toBe("error");
    expect(sentAfter({ ok: false, error: "failed" }, start(), null)).toBeNull();
  });
});

test.describe("the page: navigation, server-side switch, no browser storage", () => {
  onlyInProject("desktop");

  test("every office role has the item; the page guards itself and renders the simulator only when the server says so", () => {
    expect(OFFICE_UNPARSED_PATH).toBe("/office/unparsed");
    for (const role of ["creator", "mgr", "cs"]) expect(realOfficeNav(role).map((i) => i.key)).toContain("unparsed");
    expect(realOfficeNav("tech")).toEqual([]);
    const page = readFileSync(path.resolve("app/(office)/office/unparsed/page.tsx"), "utf8");
    expect(page).toContain('await requireArea("office")');
    expect(page).toContain("calendarSimulatorEnabled()");
    expect(page).toMatch(/\{simulatorOn && <InvitationSimulator /);
    expect(page).not.toMatch(/app\/dev|_fixtures|demoDataAccess/);
    const component = readFileSync(path.resolve("components/office/InvitationSimulator.tsx"), "utf8");
    expect(component).not.toMatch(/localStorage|sessionStorage|indexedDB|dangerouslySetInnerHTML/);
    expect(component).not.toMatch(/from "@\/lib\//);
    const list = readFileSync(path.resolve("components/office/UnparsedInvitationsList.tsx"), "utf8");
    expect(list).not.toContain("dangerouslySetInnerHTML");
  });

  test("without the Supabase values the route fails closed to /login", async ({ page }) => {
    await openPage(page, "/office/unparsed");
    await expect(page).toHaveURL(/\/login$/);
    await expect(page.getByRole("button", { name: "סימולטור זימונים" })).toHaveCount(0);
  });
});
