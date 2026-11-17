// Test data for the technician screens (Step 3), against the LOCAL stack only (tests/auth/run-local.mjs):
// service calls and visits are created through the real flow, the invitation simulator's events
// through the single ingestion service and the RPC `ingest_calendar_event` under an office user's own
// session (the same store as lib/calendar/supabase-ingestion-store.ts, which is server-only). Every
// record is fictional and test-marked by the database (D47, data_source 'simulator'). The one pickup
// place is a test-marked Settings row inserted as postgres (its writer needs the Creator's `settings`
// key; Migration 2 keeps collection_locations test-only until go-live).
import { randomUUID } from "node:crypto";
import { expect } from "@playwright/test";
import { createClient, type SupabaseClient } from "@supabase/supabase-js";
import { buildSimulatorEvent, type SimulatorDeps } from "@/features/calendar/adapters/simulator";
import { ingestInvitation, parseIngestionOutcome, toDatabaseCommand, type IngestionStore } from "@/features/calendar/ingestion";
import { atJerusalem } from "@/features/dashboards/data/time";
import { localSql, localSqlValue } from "./helpers";

const url = process.env.NEXT_PUBLIC_SUPABASE_URL ?? "";
const publishableKey = process.env.NEXT_PUBLIC_SUPABASE_PUBLISHABLE_KEY ?? "";

/** A Supabase client signed in as `email` with the publishable key (that user's own session). */
export async function signedInClient(email: string, password: string): Promise<SupabaseClient> {
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

let tick = 0;
const deps: SimulatorDeps = { now: () => new Date(Date.now() - 120_000 + ++tick * 50), newId: () => randomUUID() };

/** The technician's invitation email (read under an office session: technicians_select_office). */
export async function attendeeOf(office: SupabaseClient, technicianRow: string): Promise<string> {
  const { data, error } = await office.from("technicians").select("outlook_email").eq("id", technicianRow).single();
  expect(error).toBeNull();
  return (data as { outlook_email: string }).outlook_email;
}

/** An active, test-marked pickup place of this name (created once, reused). */
export function ensurePickupPlace(name: string, address: string): void {
  if (localSqlValue(`select count(*) from public.collection_locations where name = '${name}'`) !== "0") return;
  localSql(`insert into public.collection_locations (name, place_type, sort_order, address, is_test)
    values ('${name}', 'logistics_center', (select coalesce(max(sort_order), 0) + 1 from public.collection_locations), '${address}', true);`);
}

export type FictionalVisit = {
  req: string;
  task?: string;
  rep?: string;
  customerNo: string;
  customer: string;
  phone: string;
  city: string;
  street: string;
  building?: string;
  floor?: string;
  apt?: string;
  arrival?: string;
  type?: string;
  product: string;
  sku: string;
  desc: string;
  warranty?: string;
  collect?: string;
  collectFrom?: string;
  techNote?: string;
};

function bodyOf(v: FictionalVisit): string {
  const lines: [string, string | undefined][] = [
    ["מספר פנייה", v.req],
    ["מספר משימה", v.task ?? "1"],
    ["נציגה מטפלת", v.rep ?? "שירה נציגה"],
    ["מספר לקוח", v.customerNo],
    ["שם לקוח", v.customer],
    ["טלפון", v.phone],
    ["עיר", v.city],
    ["רחוב ומספר", v.street],
    ["בניין", v.building],
    ["קומה", v.floor],
    ["דירה", v.apt],
    ["הערות הגעה", v.arrival],
    ["סוג קריאה", v.type ?? "תיקון"],
    ["מוצר", v.product],
    ['מק"ט', v.sku],
    ["תיאור התקלה", v.desc],
    ["באחריות", v.warranty],
    ["לאסוף לפני הביקור", v.collect],
    ["לאסוף מ", v.collectFrom],
    ["הערות לטכנאי", v.techNote],
  ];
  return lines.filter(([, value]) => value !== undefined && value !== "").map(([k, value]) => `${k}: ${value}`).join("\n");
}

/** Delivers one simulated invitation for `date` `from`–`to` (Asia/Jerusalem); returns the visit id. */
export async function ingestVisit(
  office: SupabaseClient,
  attendee: string,
  date: string,
  from: string,
  to: string,
  visit: FictionalVisit,
): Promise<string> {
  const event = buildSimulatorEvent(
    {
      action: "create",
      invitation: {
        subject: `[קריאת שירות] ${visit.customer}`,
        organizerEmail: "rep-sim@example.test",
        attendeeEmails: [attendee],
        start: atJerusalem(date, from),
        end: atJerusalem(date, to),
        body: bodyOf(visit),
      },
    },
    deps,
  );
  const result = await ingestInvitation(event, store(office));
  if (result.kind !== "ingested" || result.outcome.outcome !== "applied" || !result.outcome.visitId) {
    throw new Error(`the simulated invitation was not ingested: ${JSON.stringify(result.kind === "ingested" ? result.outcome.problems : result)}`);
  }
  return result.outcome.visitId;
}

/**
 * Cancels a visit as the future cancellation writer will (open decision 5: no writer exists yet):
 * status, its status event and the D38 call recalculation in one transaction, as postgres. Used
 * only to prove that a cancelled visit is never shown (D60 (1)).
 */
export function cancelVisitAsPostgres(visitId: string): void {
  if (!/^[0-9a-f-]{36}$/.test(visitId)) throw new Error("not a visit id");
  localSql(`begin;
update public.visits set status = 'cancelled' where id = '${visitId}';
insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, is_test)
  select v.id, v.version, 'status_changed', 'scheduled', 'cancelled', v.is_test from public.visits v where v.id = '${visitId}';
select private.recalc_call_status((select service_call_id from public.visits where id = '${visitId}'));
commit;`);
}
