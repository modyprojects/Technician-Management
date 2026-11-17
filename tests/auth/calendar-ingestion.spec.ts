import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSimulatorEvent, type SimulatorDeps } from "@/features/calendar/adapters/simulator";
import {
  ingestInvitation,
  parseIngestionOutcome,
  toDatabaseCommand,
  type IngestionOutcome,
  type IngestionStore,
} from "@/features/calendar/ingestion";
import { seeded } from "./helpers";

// Step 6, against the LOCAL Supabase stack (tests/auth/run-local.mjs; never the remote project): the
// TypeScript ingestion core and the database writer together. Each test signs in with a seeded
// fictional account (example.test, test-marked) through the publishable key, so the RPC runs under
// that user's own session (RLS, grants and the writer's caller check), exactly as the simulator's
// server action calls it. The store below is the same RPC call as lib/calendar/supabase-ingestion-store.ts
// (which imports "server-only" and so cannot be imported in a test process). Fictional data only.

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return client;
}

/** The RPC store, failing with the database code. */
function store(client: SupabaseClient): IngestionStore {
  return {
    async apply(command) {
      const { data, error } = await client.rpc("ingest_calendar_event", { p_command: toDatabaseCommand(command) });
      if (error) throw Object.assign(new Error("ingestion refused"), { code: error.code });
      const outcome = parseIngestionOutcome(data);
      if (!outcome) throw new Error("unexpected answer");
      return outcome;
    },
  };
}

const run = Math.random().toString(16).slice(2, 10);
let n = 0;
const deps: SimulatorDeps = { now: () => new Date(Date.now() - 60_000 + ++n * 1000), newId: () => crypto.randomUUID() };

const body = (technicianNote: string, phone = "050-000-7001") =>
  [
    `מספר פנייה: SIM-${run}`,
    "מספר משימה: 1",
    "נציגה מטפלת: נציגת בדיקה",
    `מספר לקוח: SIMC-${run}`,
    "שם לקוח: לקוח בדיקה",
    `טלפון: ${phone}`,
    "עיר: עיר בדיקה",
    "רחוב ומספר: רחוב בדיקה 1",
    "סוג קריאה: תיקון",
    "מוצר: מוצר בדיקה",
    `מק"ט: sim-${run}`,
    "תיאור התקלה: תקלת בדיקה",
    `הערות לטכנאי: ${technicianNote}`,
  ].join("\n");

async function technicianEmail(client: SupabaseClient): Promise<string> {
  const { data, error } = await client.from("technicians").select("outlook_email").eq("id", process.env.AUTH_E2E_TECH_ROW ?? "").single();
  expect(error).toBeNull();
  return (data as { outlook_email: string }).outlook_email;
}

test.describe("calendar ingestion against the local stack (Step 6)", () => {
  test("the simulator's events go through the single service: create, replay, reschedule, unparsed, deny", async () => {
    const users = seeded();
    const manager = await signedIn(users.mgr.email, users.mgr.password);
    const attendee = await technicianEmail(manager);
    const invitation = {
      subject: "[קריאת שירות] לקוח בדיקה",
      organizerEmail: "rep-sim@example.test",
      attendeeEmails: [attendee],
      start: "2026-12-01T09:00:00+02:00",
      end: "2026-12-01T11:00:00+02:00",
      body: body("להתקשר"),
    };

    // Create: one call, visit 1, test data from the simulator.
    const created = buildSimulatorEvent({ action: "create", invitation }, deps);
    const first = await ingestInvitation(created, store(manager));
    expect(first.kind).toBe("ingested");
    const outcome = (first as { outcome: IngestionOutcome }).outcome;
    expect([outcome.outcome, outcome.replay, outcome.requestNumber, outcome.visitNumber]).toEqual(["applied", false, `SIM-${run}`, 1]);
    const { data: call } = await manager
      .from("service_calls")
      .select("request_number, data_source, is_test, status")
      .eq("request_number", `SIM-${run}`)
      .single();
    expect(call).toEqual({ request_number: `SIM-${run}`, data_source: "simulator", is_test: true, status: "open" });

    // Duplicate delivery: a replay, nothing new.
    const again = await ingestInvitation(buildSimulatorEvent({ action: "duplicate", event: created }, deps), store(manager));
    expect(again.kind === "ingested" && [again.outcome.replay, again.outcome.changeId]).toEqual([true, outcome.changeId]);

    // Reschedule: same event, new change; the visit moves.
    const moved = buildSimulatorEvent(
      { action: "reschedule", eventId: created.eventId, invitation: { ...invitation, start: "2026-12-02T09:00:00+02:00", end: "2026-12-02T11:00:00+02:00" } },
      deps,
    );
    const third = await ingestInvitation(moved, store(manager));
    expect(third.kind === "ingested" && third.outcome.appliedFields).toEqual(["visits.scheduled_start", "visits.scheduled_end"]);
    const { data: visit } = await manager.from("visits").select("scheduled_start, visit_number, is_test").eq("id", outcome.visitId!).single();
    expect(visit).toEqual({ scheduled_start: "2026-12-02T07:00:00+00:00", visit_number: 1, is_test: true });

    // An invalid invitation: listed with its reasons, nothing ingested.
    const invalid = buildSimulatorEvent({ action: "invalid", invitation: { ...invitation, body: body("x").replace(/^מספר לקוח:.*$/m, "") } }, deps);
    const fourth = await ingestInvitation(invalid, store(manager));
    expect(fourth.kind === "ingested" && [fourth.outcome.outcome, fourth.outcome.problems]).toEqual(["unparsed", [{ kind: "missing", field: "customerNo" }]]);

    // A Technician may not use it (D24, SIM-10): refused in the database.
    const technician = await signedIn(users.tech.email, users.tech.password);
    const refused = await ingestInvitation(buildSimulatorEvent({ action: "create", invitation }, deps), store(technician)).catch((e: { code?: string }) => e.code);
    expect(refused).toBe("42501");

    // Not a service call: ignored before the database.
    const ignored = await ingestInvitation(buildSimulatorEvent({ action: "create", invitation: { ...invitation, subject: "ישיבת צוות" } }, deps), store(manager));
    expect(ignored).toEqual({ kind: "ignored", reason: "not-a-service-call" });
  });
});
