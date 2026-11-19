import { localSql } from "./helpers";

// Test data for the technician calendar (D79, D89), LOCAL stack only. Changes a test visit's status
// as the future visit-flow writers will (no writer exists on this branch), as postgres, in one
// transaction with the status event and the D38 call recalculation. A closure also writes the
// treatment summary (and, for "done", the customer signature); closed_at is the server's now() (t12).
// Fictional, test-marked rows only.
const ID = /^[0-9a-f-]{36}$/;

function statusChange(visitId: string, to: string, extra: string): string {
  return `begin;
${extra}
insert into public.visit_events (visit_id, version_after, event_type, from_status, to_status, is_test)
  select v.id, v.version, 'status_changed', 'scheduled', '${to}', v.is_test from public.visits v where v.id = '${visitId}';
select private.recalc_call_status((select service_call_id from public.visits where id = '${visitId}'));
commit;`;
}

/** "בדרך" or "בטיפול" for a scheduled test visit. */
export function startVisitAsPostgres(visitId: string, to: "en_route" | "in_progress"): void {
  if (!ID.test(visitId)) throw new Error("not a visit id");
  localSql(statusChange(visitId, to, `update public.visits set status = '${to}' where id = '${visitId}';`));
}

/**
 * Closes a scheduled test visit as "טופל" (done) or "המשך טיפול" (followup) with its summary.
 * closedOnItsOwnDay back-dates closed_at to the visit's scheduled end (a past day), so it is closed
 * BEFORE today as the reduced path (D79) needs; the server guard forbids this write, so triggers
 * are skipped for that one update only (postgres, LOCAL stack).
 */
export function closeVisitAsPostgres(visitId: string, summary: string, to: "done" | "followup" = "done", closedOnItsOwnDay = false): void {
  if (!ID.test(visitId)) throw new Error("not a visit id");
  if (!/^[֐-׿\w ,.-]{1,200}$/.test(summary)) throw new Error("not a plain summary");
  const ack = "אישור בדיקה";
  const followup =
    to === "followup"
      ? `, followup_reason_id = (select id from public.followup_reasons where is_active order by sort_order limit 1), next_visit_notes = 'להביא חלק חלופי'`
      : "";
  const signature =
    to === "done"
      ? `insert into public.visit_signatures (visit_id, signer_name, signed_ack_text, ack_text_sha256, operation_id, is_test)
  select v.id, 'חותם בדיקה', '${ack}', encode(sha256(convert_to('${ack}', 'UTF8')), 'hex'), gen_random_uuid(), v.is_test
  from public.visits v where v.id = '${visitId}';`
      : "";
  localSql(
    statusChange(
      visitId,
      to,
      `update public.visits set status = '${to}'${followup} where id = '${visitId}';
insert into public.visit_reports (visit_id, summary_text, summary_source, is_test)
  select v.id, '${summary}', 'written', v.is_test from public.visits v where v.id = '${visitId}';
${signature}`,
    ),
  );
  if (closedOnItsOwnDay) {
    localSql(`begin;
set local session_replication_role = replica;
update public.visits set closed_at = scheduled_end where id = '${visitId}' and status = '${to}';
commit;`);
  }
}
