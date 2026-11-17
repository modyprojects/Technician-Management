import { expect, test } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSimulatorEvent, type SimulatorDeps } from "@/features/calendar/adapters/simulator";
import {
  ingestInvitation,
  parseIngestionOutcome,
  toDatabaseCommand,
  type IngestionOutcome,
  type IngestionResult,
  type IngestionStore,
  type InvitationEvent,
} from "@/features/calendar/ingestion";
import { seeded } from "./helpers";

// Step 6, independent review S2: concurrent deliveries against the LOCAL Supabase stack
// (tests/auth/run-local.mjs; never the remote project). Two signed-in office users send their RPC
// calls at the same moment (Promise.all), so PostgREST runs them on two database connections in
// two transactions side by side; the writer's advisory locks and ON CONFLICT DO NOTHING
// (Migration 6 section 5) must make the result the same as one after the other:
//   - the same event delivered twice at once: one is processed, the other is a replay of it;
//   - two events with the same new request number: one call with visits 1 and 2;
//   - two new calls with the same new customer number and SKU: one customer and one product.
// Each case runs three rounds with fresh fictional identifiers (example.test, test-marked; D47) to
// give the two transactions several chances to overlap. The same RPC store as
// calendar-ingestion.spec.ts (lib/calendar imports "server-only").

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";
const ROUNDS = 3;

async function signedIn(email: string, password: string): Promise<SupabaseClient> {
  const client = createClient(url, publishableKey, { auth: { persistSession: false, autoRefreshToken: false, detectSessionInUrl: false } });
  const { error } = await client.auth.signInWithPassword({ email, password });
  expect(error).toBeNull();
  return client;
}

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

function outcomeOf(result: IngestionResult): IngestionOutcome {
  if (result.kind !== "ingested") throw new Error(`expected an ingested result, got ${result.kind}`);
  return result.outcome;
}

const run = Math.random().toString(16).slice(2, 10);
let n = 0;
const deps: SimulatorDeps = { now: () => new Date(Date.now() - 120_000 + ++n * 1000), newId: () => crypto.randomUUID() };

function body(request: string, customer: string, sku: string): string {
  return [
    `מספר פנייה: ${request}`,
    "מספר משימה: 1",
    "נציגה מטפלת: נציגת בדיקה",
    `מספר לקוח: ${customer}`,
    "שם לקוח: לקוח בדיקה",
    "טלפון: 050-000-7002",
    "עיר: עיר בדיקה",
    "רחוב ומספר: רחוב בדיקה 2",
    "סוג קריאה: תיקון",
    "מוצר: מוצר בדיקה",
    `מק"ט: ${sku}`,
    "תיאור התקלה: תקלת בדיקה",
  ].join("\n");
}

test.describe("calendar ingestion: concurrent deliveries against the local stack (Step 6, review S2)", () => {
  test("simultaneous calls give one event outcome, one call per request number, one customer and one product", async () => {
    const users = seeded();
    const manager = await signedIn(users.mgr.email, users.mgr.password);
    const service = await signedIn(users.cs.email, users.cs.password);
    const { data: tech, error: techError } = await manager
      .from("technicians")
      .select("outlook_email")
      .eq("id", process.env.AUTH_E2E_TECH_ROW ?? "")
      .single();
    expect(techError).toBeNull();
    const attendee = (tech as { outlook_email: string }).outlook_email;
    const invitation = (request: string, customer: string, sku: string, day: number) => ({
      subject: "[קריאת שירות] לקוח בדיקה",
      organizerEmail: "rep-sim@example.test",
      attendeeEmails: [attendee],
      start: `2026-12-${String(day).padStart(2, "0")}T09:00:00+02:00`,
      end: `2026-12-${String(day).padStart(2, "0")}T11:00:00+02:00`,
      body: body(request, customer, sku),
    });

    for (let round = 1; round <= ROUNDS; round += 1) {
      const tag = `${run}-${round}`;

      // 1. The same event (same id and change key) delivered twice at once.
      const event: InvitationEvent = buildSimulatorEvent({ action: "create", invitation: invitation(`CC1-${tag}`, `CCC1-${tag}`, `cc1-${tag}`, 3) }, deps);
      const twice = await Promise.all([ingestInvitation(event, store(manager)), ingestInvitation(event, store(service))]);
      const [a, b] = twice.map(outcomeOf);
      expect([a?.replay, b?.replay].sort()).toEqual([false, true]);
      expect(a?.changeId).toBe(b?.changeId);
      expect(a?.visitId).toBe(b?.visitId);
      expect([a?.outcome, b?.outcome]).toEqual(["applied", "applied"]);
      const { count: visitsOfEvent } = await manager
        .from("visits")
        .select("id", { count: "exact", head: true })
        .eq("service_call_id", a?.serviceCallId ?? "");
      expect(visitsOfEvent).toBe(1);

      // 2. Two events with the same new request number at once: one call, visits 1 and 2.
      const sameRequest = invitation(`CC2-${tag}`, `CCC2-${tag}`, `cc2-${tag}`, 4);
      const first = buildSimulatorEvent({ action: "create", invitation: sameRequest }, deps);
      const second = buildSimulatorEvent({ action: "create", invitation: { ...sameRequest, start: "2026-12-05T09:00:00+02:00", end: "2026-12-05T11:00:00+02:00" } }, deps);
      const [p1, p2] = (await Promise.all([ingestInvitation(first, store(manager)), ingestInvitation(second, store(service))])).map(outcomeOf);
      expect([p1?.outcome, p2?.outcome]).toEqual(["applied", "applied"]);
      expect(p1?.serviceCallId).toBe(p2?.serviceCallId);
      expect([p1?.visitNumber, p2?.visitNumber].sort()).toEqual([1, 2]);
      const { data: calls } = await manager.from("service_calls").select("id, next_visit_number").eq("request_number", `CC2-${tag}`);
      expect(calls).toEqual([{ id: p1?.serviceCallId, next_visit_number: 3 }]);

      // 3. Two new calls with the same new customer number and SKU at once: one customer, one product.
      const third = buildSimulatorEvent({ action: "create", invitation: invitation(`CC3-${tag}`, `CCC3-${tag}`, `cc3-${tag}`, 6) }, deps);
      const fourth = buildSimulatorEvent({ action: "create", invitation: invitation(`CC4-${tag}`, `CCC3-${tag}`, `CC3-${tag}`, 7) }, deps);
      const [c3, c4] = (await Promise.all([ingestInvitation(third, store(manager)), ingestInvitation(fourth, store(service))])).map(outcomeOf);
      expect([c3?.outcome, c4?.outcome]).toEqual(["applied", "applied"]);
      expect(c3?.serviceCallId).not.toBe(c4?.serviceCallId);
      const { data: customers } = await manager.from("customers").select("id").eq("customer_number", `CCC3-${tag}`);
      expect(customers).toHaveLength(1);
      const { data: products } = await manager.from("products").select("id, sku_display").eq("sku_normalized", `CC3-${tag}`.toUpperCase());
      expect(products).toHaveLength(1);
      const { data: linked } = await manager
        .from("service_calls")
        .select("customer_id, product_id")
        .in("request_number", [`CC3-${tag}`, `CC4-${tag}`]);
      expect(linked).toHaveLength(2);
      expect(new Set((linked ?? []).map((c) => `${c.customer_id}/${c.product_id}`)).size).toBe(1);
      expect((linked ?? [])[0]).toEqual({ customer_id: customers?.[0]?.id, product_id: products?.[0]?.id });
    }
  });
});
