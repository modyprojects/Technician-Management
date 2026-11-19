import { localSql } from "./helpers";

// Test data for the technician calendar (D79, D89), LOCAL stack only. Closes a test visit as the
// future visit-flow writer will (no closure writer exists on this branch): status "done", its
// treatment summary, the customer signature, the status event and the D38 call recalculation in one
// transaction, as postgres. closed_at is the server's now() (t12). Fictional, test-marked rows only.
export function closeVisitAsPostgres(visitId: string, summary: string): void {
  if (!/^[0-9a-f-]{36}$/.test(visitId)) throw new Error("not a visit id");
  if (!/^[֐-׿\w ,.-]{1,200}$/.test(summary)) throw new Error("not a plain summary");
  const ack = "אישור בדיקה";
  localSql(`begin;
update public.visits set status = 'done' where id = '${visitId}';
insert into public.visit_reports (visit_id, summary_text, summary_source, is_test)
  select v.id, '${summary}', 'written', v.is_test from public.visits v where v.id = '${visitId}';
insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, is_test)
  select v.id, 'חותם בדיקה', '${ack}', encode(sha256(convert_to('${ack}', 'UTF8')), 'hex'), gen_random_uuid(), v.is_test
  from public.visits v where v.id = '${visitId}';
insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, is_test)
  select v.id, v.version, 'status_changed', 'scheduled', 'done', v.is_test from public.visits v where v.id = '${visitId}';
select private.recalc_call_status((select service_call_id from public.visits where id = '${visitId}'));
commit;`);
}
