// Tests for scripts/check-migrations.mjs (D47: no test or fictitious data in migrations; D49).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_EXTENSIONS, ALLOWED_REFERENCE_TRIGGERS, ALLOWED_WRITERS, checkFiles, checkRepository, checkSql, lexSql } from "../../scripts/check-migrations.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const rejects = (sql, pattern, options) => {
  const problems = checkSql(sql, "m.sql", options);
  assert.ok(problems.some((p) => pattern.test(p)), `${sql}\n  expected ${pattern}, got ${JSON.stringify(problems)}`);
};
const passes = (sql, options) => assert.deepEqual(checkSql(sql, "m.sql", options), [], sql);

test("schema-only migration passes, even when a CHECK lists test values", () => {
  const sql = `
    create table public.customers (
      id uuid primary key,
      data_source text not null check (data_source in ('simulator', 'automated_test'))
    );`;
  assert.deepEqual(checkSql(sql), []);
});

test("approved reference data passes", () => {
  const sql = `insert into public.call_types (label_he) values ('תיקון'), ('התקנה');`;
  assert.deepEqual(checkSql(sql), []);
});

test("insert into a business table fails", () => {
  const problems = checkSql(`insert into public.customers (customer_number, name) values ('10001', 'x');`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /not allowed/);
});

test("quoted and schema-less table names are recognised", () => {
  assert.equal(checkSql(`INSERT INTO "visits" (id) values ('a');`).length, 1);
  assert.equal(checkSql(`insert into service_calls (id) values ('a');`).length, 1);
});

test("reference insert with a test marker fails", () => {
  rejects(`insert into public.followup_reasons (label_he, is_test) values ('x', true);`, /test marker \(sets is_test/);
  rejects(`insert into public.permissions (key, label_he) values ('k', 'user@example.test');`, /test marker \(example\.test/);
  rejects(`insert into public.call_types (label_he, data_source) values ('x', 'simulator');`, /test marker/);
  rejects(`insert into public.call_types (label_he) values ('Seed');`, /test marker \(data_source 'seed'\)/);
  // Schema-less reference names fail too (re-review R-G5).
  rejects(`insert into followup_reasons (label_he) values ('x');`, /must name the table as public\.followup_reasons/);
});

test("commented-out statements are ignored", () => {
  assert.deepEqual(checkSql(`-- insert into customers values (1);\n/* insert into visits values (2); */ select 1;`), []);
});

test("COPY FROM fails", () => {
  assert.equal(checkSql(`copy public.customers from '/tmp/x.csv';`).length, 1);
});

test("repository scan: no migrations folder passes; a bad file fails", () => {
  const root = mkdtempSync(join(tmpdir(), "migrations-guard-"));
  try {
    assert.deepEqual(checkRepository(root), []);
    mkdirSync(join(root, "supabase", "migrations"), { recursive: true });
    writeFileSync(join(root, "supabase", "migrations", "20261103000000_ok.sql"), "create table public.t (id int);");
    assert.deepEqual(checkRepository(root), []);
    writeFileSync(join(root, "supabase", "migrations", "20261103000001_bad.sql"), "insert into public.visits (id) values (1);");
    const problems = checkRepository(root);
    assert.equal(problems.length, 1);
    assert.match(problems[0], /20261103000001_bad\.sql/);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

// PR 1.3: function bodies, DO blocks, writer functions and the first-Creator function -------------

const writer = (signature, tables) => ({ allowedWriters: new Map([[signature, { tables }]]) });

test("the repository's migrations pass", () => {
  assert.deepEqual(checkRepository(repositoryRoot), []);
});

test("an INSERT inside the body of a reviewed writer function (ALLOWED_WRITERS) passes", () => {
  const sql = `
    create function private.write_audit(p_action text, p_target_table text, p_target_id uuid, p_details jsonb)
    returns bigint language plpgsql as $$
    begin
      insert into public.audit_logs (action) values (p_action); -- a ";" inside the body
      return 1;
    end
    $$;
    grant execute on function private.write_audit(text, text, uuid, jsonb) to authenticated;`;
  assert.deepEqual(checkSql(sql), []);
});

test("an INSERT inside a DO block runs during the migration and fails", () => {
  const problems = checkSql(`do $$ begin insert into public.customers (id) values (1); end $$;`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /INSERT into "customers"/);
});

const MAIN_RULE = /\(the guard on main rejects this text; this guard is never weaker, rule 9\)$/;

test("a semicolon inside a string or a quoted identifier does not split a statement", () => {
  // Split on every ";", the text after it would look like a COPY ... FROM statement. The tokenizer
  // reads one statement; only rule 9 (the guard on main, which split there) rejects the text.
  const copyText = checkSql(`insert into public.call_types (label_he) values ('a; copy b from c');`);
  assert.equal(copyText.length, 1, JSON.stringify(copyText));
  assert.match(copyText[0], /^migration\.sql: COPY \.\.\. FROM is not allowed in migrations \(the guard on main rejects this text/);
  assert.equal(lexSql(`insert into public.call_types (label_he) values ('a; copy b from c');`).statements.length, 1);
  assert.deepEqual(checkSql(`insert into public.call_types ("label;he") values ('x');`), []);
  assert.deepEqual(checkSql(`insert into public.call_types (label_he) values ('it''s; fine');`), []);
  // An E'' string is read correctly (its \\' does not end it) but is not a plain constant.
  rejects(`insert into public.call_types (label_he) values (E'it\\'s; fine');`, /plain constant VALUES/);
});

test("nested block comments and comments inside bodies are ignored", () => {
  // PostgreSQL nests block comments: the INSERT is inside the comment. The guard on main did not
  // nest them and rejected the text, so rule 9 rejects it too; no other rule fires.
  const nested = `/* outer /* inner */ insert into customers values (1); */ select 1;`;
  assert.deepEqual(lexSql(nested).tokens.map((t) => t.value), ["select", "1", ";"]);
  const problems = checkSql(nested);
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], MAIN_RULE);
  assert.deepEqual(
    checkSql(`create function f() returns void language sql as $$ -- private.bootstrap_first_creator(x)
      select 1 $$;`),
    [],
  );
});

test("calling a data-writing function from a migration fails, directly or through a wrapper", () => {
  const options = writer("private.add_customer()", ["public.customers"]);
  const definition = `create function private.add_customer() returns void language sql as $$ insert into public.customers (id) values (1) $$;`;
  const wrapper = `create function public.add_customer_api() returns void language sql as $$ select private.add_customer() $$;`;
  assert.equal(checkSql(`${definition} select private.add_customer();`, "m.sql", options).length, 1);
  assert.equal(checkSql(`${definition} ${wrapper} select public.add_customer_api();`, "m.sql", options).length, 1);
  assert.equal(checkSql(`${definition} do $x$ begin perform private.add_customer(); end $x$;`, "m.sql", options).length, 1);
  assert.equal(
    checkSql(`${definition} create trigger t after insert on public.call_types for each row execute function private.add_customer();`, "m.sql", options).length,
    1,
  );
  assert.deepEqual(checkSql(`${definition} ${wrapper} revoke all on function private.add_customer() from public;
    grant execute on function public.add_customer_api() to authenticated;
    comment on function private.add_customer() is 'x';`, "m.sql", options), []);
});

test("a writer defined in an earlier migration cannot be called in a later one", () => {
  const problems = checkFiles([
    { name: "1.sql", sql: `create function w() returns void language sql as $$ insert into public.visits (id) values (1) $$;` },
    { name: "2.sql", sql: `select w();` },
  ], writer("w()", ["public.visits"]));
  assert.equal(problems.length, 1);
  assert.match(problems[0], /^2\.sql: the migration calls w\(\)/);
});

test("bootstrap_first_creator may only be defined, revoked or commented (D49)", () => {
  const definition = `create function private.bootstrap_first_creator(p_user_id uuid, p_full_name text) returns uuid
    language plpgsql as $$ begin insert into public.profiles (id) values (p_user_id); return p_user_id; end $$;
    revoke all on function private.bootstrap_first_creator(uuid, text) from public, anon, authenticated, service_role;
    comment on function private.bootstrap_first_creator(uuid, text) is 'D49: never run by a migration';`;
  assert.deepEqual(checkSql(definition), []);
  for (const forbidden of [
    `select private.bootstrap_first_creator('00000000-0000-0000-0000-000000000000', 'x');`,
    `do $$ begin perform private.bootstrap_first_creator(null, null); end $$;`,
    `grant execute on function private.bootstrap_first_creator(uuid, text) to authenticated;`,
    `alter function private.bootstrap_first_creator(uuid, text) security definer;`,
    `create function private.helper() returns void language sql as $$ select private.bootstrap_first_creator(null, null) $$;`,
    // Re-review R-G8: a name without "(", a U& spelling, a string run as SQL.
    `create operator public.@@@ (function = private.bootstrap_first_creator, leftarg = uuid, rightarg = text);`,
    `select private.U&"bootstrap_first_cre\\0061tor"('00000000-0000-0000-0000-000000000000', 'x');`,
    `grant execute on function private.U&"bootstrap_first_cre\\0061tor"(uuid, text) to authenticated;`,
    `do $$ declare function text := 'select private.bootstrap_' || 'first_creator(null, null)'; begin execute function; end $$;`,
  ]) {
    assert.ok(checkSql(`${definition}\n${forbidden}`).some((p) => /bootstrap_first_creator|U& Unicode|dynamic SQL/.test(p)), forbidden);
  }
});

test("an unterminated dollar quote is reported", () => {
  assert.deepEqual(lexSql(`do $$ begin insert into customers values (1);`).errors, ["unterminated dollar-quoted string $$"]);
  assert.equal(checkSql(`do $$ begin select 1;`).length, 1);
});

// Fix pass (independent review S1/D1, S14) ----------------------------------------------------------

// PR 1.8 (Migration 5) adds no entry: it replaces three listed writers with the same signatures
// (authorize_account_creation, admin_create_profile, add_call_type, add_followup_reason) and its new
// writer admin_delete_user only updates (see the PR 1.8 tests at the end of this file).
test("ALLOWED_WRITERS lists exactly the reviewed PR 1.3, PR 1.4, PR 1.5, PR 1.6, Step 6 and Step 4 writer functions, pinned to signature, tables and marker exceptions (unchanged by PR 1.8)", () => {
  assert.deepEqual(
    [...ALLOWED_WRITERS]
      .map(([signature, { tables, markers }]) => `${signature} -> ${tables.join(",")}${markers ? ` markers=${markers.join(",")}` : ""}`)
      .sort(),
    [
      "private.add_call_type(text) -> public.call_types",
      "private.add_collection_location(text,text,text,text,text) -> public.collection_locations",
      "private.add_followup_reason(text) -> public.followup_reasons",
      "private.add_visit_media(uuid,uuid,text,text,text,integer,timestamptz,text,integer,timestamptz) -> public.visit_media",
      "private.admin_create_profile(uuid,text,text,text,text,uuid) -> public.profiles",
      "private.admin_create_technician(uuid,text,text,text,text,boolean) -> public.technicians",
      "private.arrive_visit(uuid,uuid,integer,timestamptz,text,integer,timestamptz) -> public.visit_events,public.visit_time_reports",
      "private.authorize_account_creation(text,text,text) -> public.account_requests",
      "private.bootstrap_first_creator(uuid,text) -> public.profiles",
      "private.close_visit(uuid,uuid,integer,text,text,text,text,uuid,uuid,text,timestamptz,text,integer,timestamptz) -> public.visit_reports,public.visit_signatures,public.visit_events,public.visit_time_reports",
      "private.correct_visit(uuid,text,text,text,integer) -> public.visit_corrections,public.visit_time_reports",
      "private.create_review_item(text,text,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb) -> public.review_items",
      "private.depart_visit(uuid,uuid,integer,timestamptz,text,integer,timestamptz) -> public.visit_events,public.visit_time_reports",
      "private.ingest_calendar_event(jsonb) -> public.external_calendar_events,public.calendar_event_changes,public.calendar_ingestion_errors,public.customers,public.products,public.service_calls,public.visits,public.visit_events markers=simulator",
      "private.record_offline_operation(uuid,uuid,text,text,integer,timestamptz,text,integer,text,integer,uuid) -> public.offline_operations",
      "private.request_account_change(text,uuid,text,text,text) -> public.account_requests",
      "private.resolve_review_item(uuid,integer,text,jsonb,text) -> public.visit_time_reports",
      "private.write_audit(text,text,uuid,jsonb) -> public.audit_logs",
      "private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text) -> public.entity_changes",
    ],
  );
  assert.deepEqual([...ALLOWED_EXTENSIONS], []);
});

// PR 1.4 (Migration 2): three Settings writers (owner acceptance needed, PR 1.4 approval item 1).
const pr13Writers = new Map([...ALLOWED_WRITERS].filter(([signature]) => !/^private\.add_/.test(signature)));
const migration13 = readFileSync(join(repositoryRoot, "supabase", "migrations", "20261104120000_access_and_permissions.sql"), "utf8");
const migration14 = readFileSync(join(repositoryRoot, "supabase", "migrations", "20261105120000_reference_customers_products.sql"), "utf8");

test("PR 1.4: a Settings writer inserts only with its exact signature and only into its own table", () => {
  const body = (table) => `language plpgsql security definer as $$ begin insert into public.${table} (label_he, sort_order) values ('x', 1); end $$;`;
  passes(`create function private.add_call_type(p_label text) returns void ${body("call_types")}`);
  passes(`create function private.add_followup_reason(p_label text) returns void ${body("followup_reasons")}`);
  for (const definition of [
    // Another table than the one listed for it.
    `create function private.add_call_type(p_label text) returns void ${body("followup_reasons")}`,
    `create function private.add_followup_reason(p_label text) returns void ${body("call_types")}`,
    // Another signature, schema or name.
    `create function private.add_call_type(p_label text, p_sort integer) returns void ${body("call_types")}`,
    `create function public.add_call_type(p_label text) returns void ${body("call_types")}`,
    `create function private.add_call_types(p_label text) returns void ${body("call_types")}`,
    // A writer outside the allowlist inserting into a reference table.
    `create function private.set_call_type_active(p_id uuid, p_active boolean, p_version integer) returns void ${body("call_types")}`,
  ]) {
    rejects(definition, /INSERT into "(call_types|followup_reasons)" is not allowed/);
  }
  // Without the three PR 1.4 entries the PR 1.4 migration fails exactly at its three writers.
  assert.deepEqual(
    checkFiles([{ name: "a.sql", sql: migration13 }, { name: "b.sql", sql: migration14 }], { allowedWriters: pr13Writers }).sort(),
    [
      'b.sql: function private.add_call_type: INSERT into "call_types" is not allowed (only the reviewed writer functions in ALLOWED_WRITERS, pinned to their signature and tables, may insert)',
      'b.sql: function private.add_collection_location: INSERT into "collection_locations" is not allowed (only the reviewed writer functions in ALLOWED_WRITERS, pinned to their signature and tables, may insert)',
      'b.sql: function private.add_followup_reason: INSERT into "followup_reasons" is not allowed (only the reviewed writer functions in ALLOWED_WRITERS, pinned to their signature and tables, may insert)',
    ],
  );
});

test("PR 1.4: the migration passes after PR 1.3; calling a Settings writer or marking a D48 row fails", () => {
  assert.deepEqual(checkFiles([{ name: "a.sql", sql: migration13 }, { name: "b.sql", sql: migration14 }]), []);
  for (const call of [
    `select private.add_call_type('x');`,
    `select * from public.add_followup_reason('x');`,
    `select public.add_collection_location('x', 'branch', 'y', null, null);`,
    `select private.delete_followup_reason(null, 1);`,
  ]) {
    const problems = checkFiles([{ name: "a.sql", sql: migration13 }, { name: "b.sql", sql: `${migration14}\n${call}` }]);
    assert.ok(problems.some((p) => /the migration calls/.test(p)), `${call}: ${JSON.stringify(problems)}`);
  }
  rejects(`insert into public.call_types (label_he, sort_order, is_test) values ('x', 3, false);`, /test-marker column|test marker/);
  rejects(`insert into public.followup_reasons (label_he, sort_order, created_by) values ('x', 6, (select id from public.profiles limit 1));`,
    /plain constants|constant/);
});

// PR 1.5 (Migration 3): one field-history writer (owner acceptance needed, PR 1.5 approval item A1).
// recalc_call_status only UPDATEs, so it needs no entry, but it is a writer: no statement that runs
// and no non-writer body may name it (plan section 6.5, V8, V21).
const ENTITY_CHANGE_WRITER = "private.write_entity_change(text,uuid,text,jsonb,jsonb,text,text)";
const pr14Writers = new Map([...ALLOWED_WRITERS].filter(([signature]) => signature !== ENTITY_CHANGE_WRITER));
const migration15 = readFileSync(join(repositoryRoot, "supabase", "migrations", "20261106120000_service_calls_visits.sql"), "utf8");
const migrations15 = (sql15 = migration15) => [
  { name: "a.sql", sql: migration13 },
  { name: "b.sql", sql: migration14 },
  { name: "c.sql", sql: sql15 },
];
// Replaces exactly one occurrence of an anchor of the PR 1.5 migration (fails when it is missing or
// not unique, so the hazard cases cannot pass by not applying).
const mutate15 = (anchor, replacement) => {
  assert.equal(migration15.split(anchor).length, 2, `anchor must occur exactly once: ${anchor}`);
  return migration15.replace(anchor, replacement);
};

test("PR 1.5 (V8): the migration passes after PR 1.3 and PR 1.4; without the write_entity_change entry it fails exactly at that writer", () => {
  assert.deepEqual(checkFiles(migrations15()), []);
  assert.deepEqual(checkFiles(migrations15(), { allowedWriters: pr14Writers }), [
    'c.sql: function private.write_entity_change: INSERT into "entity_changes" is not allowed (only the reviewed writer functions in ALLOWED_WRITERS, pinned to their signature and tables, may insert)',
  ]);
  // The entry is pinned to the exact signature and to entity_changes.
  const header = "p_entity_table text, p_entity_id uuid, p_field text, p_old_value jsonb, p_new_value jsonb, p_source text, p_source_ref text";
  const body = (table) => `returns bigint language plpgsql as $$ begin insert into public.${table} (field) values ('status'); return 1; end $$;`;
  passes(`create function private.write_entity_change(${header}) ${body("entity_changes")}`);
  for (const definition of [
    // Another table than the one listed for it.
    `create function private.write_entity_change(${header}) ${body("visit_events")}`,
    `create function private.write_entity_change(${header}) ${body("audit_logs")}`,
    // An actor parameter (dropped by the plan, M47) is another signature.
    `create function private.write_entity_change(${header}, p_actor uuid) ${body("entity_changes")}`,
    // Another schema or name.
    `create function public.write_entity_change(${header}) ${body("entity_changes")}`,
    `create function private.recalc_call_status(p_call_id uuid) ${body("entity_changes")}`,
  ]) {
    rejects(definition, /INSERT into "(entity_changes|visit_events|audit_logs)" is not allowed/);
  }
});

test("PR 1.5 (V8): no statement that runs names a writer of the migration (recalc_call_status, write_entity_change)", () => {
  for (const statement of [
    `create trigger t50_recalc after update on public.visits for each row execute function private.recalc_call_status();`,
    `create constraint trigger c50_history after insert or update of status, closed_at on public.visits deferrable initially deferred for each row execute function private.write_entity_change();`,
    `create policy visits_recalc on public.visits for select to authenticated using (private.recalc_call_status(visits.service_call_id) = 'open');`,
    `create view public.call_status_now with (security_invoker = true) as select private.recalc_call_status(c.id) as status from public.service_calls c;`,
    `select private.recalc_call_status('c0000000-0000-4000-8000-00000000a001');`,
    `select private.write_entity_change('visits', null, 'status', null, '"done"', 'system', null);`,
  ]) {
    const problems = checkFiles(migrations15(`${migration15}\n${statement}\n`));
    assert.ok(problems.some((p) => /c\.sql: the migration calls (recalc_call_status|write_entity_change)\(\)/.test(p)),
      `${statement}: ${JSON.stringify(problems)}`);
  }
  // GRANT, REVOKE, COMMENT ON and DROP FUNCTION may name them (the migration revokes and comments).
  assert.deepEqual(checkFiles(migrations15(`${migration15}
    revoke all on function private.recalc_call_status(uuid) from public;
    comment on function private.write_entity_change(text, uuid, text, jsonb, jsonb, text, text) is 'x';
  `)), []);
});

test("PR 1.5 (V8): a check-only function of the migration that names a writer becomes a writer, and its trigger then fails", () => {
  // compute_call_status, the tg_* and ct_* functions are attached or called by statements that run
  // (triggers), so naming recalc_call_status or write_entity_change in their bodies would make the
  // migration attach a writer.
  for (const [anchor, replacement, attached] of [
    [
      "  select v.* into v_visit from public.visits v where v.id = new.id;\n",
      "  select v.* into v_visit from public.visits v where v.id = new.id;\n  perform private.recalc_call_status(v_call.id);\n",
      "ct_visit_rules",
    ],
    [
      "  select count(*), max(v.visit_number) into v_count, v_max from public.visits v where v.service_call_id = v_call.id;\n",
      "  select count(*), max(v.visit_number) into v_count, v_max from public.visits v where v.service_call_id = v_call.id;\n" +
        "  perform private.write_entity_change('service_calls', v_call.id, 'status', null, null, 'system', null);\n",
      "ct_service_call_rules",
    ],
    [
      "    new.opened_at := now();\n",
      "    new.opened_at := now();\n    perform private.write_entity_change('service_calls', new.id, 'opened_at', null, null, 'system', null);\n",
      "tg_service_call_guard",
    ],
  ]) {
    const problems = checkFiles(migrations15(mutate15(anchor, replacement)));
    assert.ok(problems.some((p) => new RegExp(`c\\.sql: the migration calls ${attached}\\(\\)`).test(p)), `${attached}: ${JSON.stringify(problems)}`);
  }
  // The migration's own text: no body other than the two writers names a writer, comments included
  // (the guard reads tokens; this reads the text, so a later edit cannot add the name in a comment).
  const bodies = [...migration15.matchAll(/create (?:or replace )?function (\w+\.\w+)\(([\s\S]*?)\nas \$\$([\s\S]*?)\$\$;/g)];
  // 10 trigger functions, 4 constraint-trigger functions, compute, recalc, the writer, can_read_visit,
  // 3 narrow bodies, 3 wrappers and the census.
  assert.equal(bodies.length, 25, `function definitions found: ${bodies.length}`);
  for (const [, name, , text] of bodies) {
    if (name === "private.recalc_call_status" || name === "private.write_entity_change") continue;
    assert.doesNotMatch(text, /recalc_call_status|write_entity_change/, name);
  }
});

test("PR 1.5 (V21): the four constraint-trigger forms are read, and locking clauses in their functions are not writes", () => {
  const forms = [
    "after insert or update of status, closed_at on public.visits",
    "after insert or update on public.service_calls",
    "after insert on public.visit_signatures",
    "after insert on public.visit_reports",
  ];
  const checker = (lock) => `create function private.ct_x() returns trigger language plpgsql security definer
    set search_path = pg_catalog, pg_temp as $$
    declare v_call public.service_calls;
    begin
      select c.* into v_call from public.service_calls c where c.id = new.id ${lock};
      perform 1 from public.service_calls c where c.id = new.id ${lock};
      return null;
    end $$;`;
  const writes = `create function private.ct_x() returns trigger language plpgsql security definer as $$
    begin update public.service_calls c set version = c.version where c.id = new.id; return null; end $$;`;
  for (const form of forms) {
    const trigger = `create constraint trigger c_x ${form}\n  deferrable initially deferred\n  for each row execute function private.ct_x();`;
    for (const lock of ["for no key update", "for update", "for share", "for key share", "for no key update nowait", "for update skip locked"]) {
      passes(`${checker(lock)}\n${trigger}`);
    }
    rejects(`${writes}\n${trigger}`, /the migration calls ct_x\(\)/);
  }
  // The migration's own constraint triggers: dropping the lock or the deferral keeps the guard
  // passing (the review and tests/db cover them), but turning a ct_* lock into an UPDATE fails.
  const unlocked = mutate15(
    "  select c.* into v_call from public.service_calls c where c.id = new.service_call_id for no key update;\n",
    "  update public.service_calls c set version = c.version where c.id = new.service_call_id;\n" +
      "  select c.* into v_call from public.service_calls c where c.id = new.service_call_id;\n",
  );
  const problems = checkFiles(migrations15(unlocked));
  assert.ok(problems.some((p) => /c\.sql: the migration calls ct_visit_rules\(\)/.test(p)), JSON.stringify(problems));
});

test("PR 1.5 (V8, rules 2 and 9): no text of the migration reads as an INSERT into a business table outside the reviewed writer", () => {
  // The writer's own INSERT is left out only while its entry exists (rule 9 reads every other body).
  assert.deepEqual(checkFiles(migrations15()), []);
  for (const [extra, pattern] of [
    // A string (a COMMENT ON text, or a string in a body) that reads as an INSERT: rule 2.
    [`comment on table public.entity_changes is 'insert into entity_changes only through the writer';`, /a string reads as an INSERT into "entity_changes"/],
    [`create function private.f() returns text language sql stable set search_path = pg_catalog, pg_temp as $$ select 'insert into visits (id) values (1)' $$;`,
      /function private\.f: a string reads as an INSERT into "visits"/],
    // Text that only the guard on main read as code: rule 9.
    [`comment on function private.recalc_call_status(uuid) is 'x; copy public.visits from stdin';`, MAIN_RULE],
    [`/* a /* b */ insert into public.visit_events (id) values (1); */ select 1;`, MAIN_RULE],
  ]) {
    const problems = checkFiles(migrations15(`${migration15}\n${extra}\n`));
    assert.ok(problems.some((p) => pattern.test(p)), `${extra}: ${JSON.stringify(problems)}`);
  }
});

test("an INSERT into a business table inside any other function body fails, as before PR 1.3", () => {
  const problems = checkSql(`create function private.add_customer() returns void language sql as $$ insert into public.customers (id) values (1) $$;`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /function private\.add_customer: INSERT into "customers" is not allowed/);
  // The allowlist is by exact signature: the same name in another schema, unqualified or with
  // other arguments fails (re-review R-G1).
  assert.equal(checkSql(`create function public.write_audit() returns void language sql as $$ insert into public.audit_logs (id) values (1) $$;`).length, 1);
  assert.equal(checkSql(`create function write_audit() returns void language sql as $$ insert into public.audit_logs (id) values (1) $$;`).length, 1);
  assert.equal(checkSql(`create function private.write_audit(a int, b int) returns int language sql as $$ insert into public.audit_logs (id) values (1) returning 1 $$;`).length, 1);
  // An insert into a reference table in an unlisted body fails too.
  assert.equal(checkSql(`create function private.f() returns void language sql as $$ insert into public.call_types (label_he, is_test) values ('x', true) $$;`).length, 1);
});

test("a function body that is not dollar-quoted fails, and so does a later call of it (review S1/D1)", () => {
  const forms = {
    "single-quoted": `create function public.seed_it() returns void language sql as 'insert into public.brands (name) values (''X'')';`,
    "E-string": `create function public.seed_it() returns void language sql as E'insert into public.brands (name) values (\\'X\\')';`,
    "BEGIN ATOMIC": `create function public.seed_it() returns void language sql begin atomic insert into public.brands (name) values ('X'); end;`,
    "RETURN": `create function public.seed_it() returns bigint language sql return private.write_audit('a', 'b', null, '{}');`,
    "procedure, single-quoted": `create procedure public.seed_it() language sql as 'insert into public.brands (name) values (1)';`,
    "another language": `create function public.seed_it() returns void language plv8 as $$ plv8.execute('select 1') $$;`,
  };
  for (const [form, definition] of Object.entries(forms)) {
    const alone = checkSql(definition);
    assert.ok(alone.some((p) => /must be dollar-quoted/.test(p)), `${form}: ${JSON.stringify(alone)}`);
    const called = checkSql(`${definition}\nselect public.seed_it();\ncall public.seed_it();`);
    assert.ok(called.some((p) => /the migration calls seed_it\(\)/.test(p)), `${form} (called): ${JSON.stringify(called)}`);
  }
});

test("a function that updates, deletes, merges or truncates is a writer: defining it passes, calling it fails", () => {
  for (const body of [
    "update public.role_permissions set allowed = true",
    "delete from public.customers",
    "merge into public.customers c using public.x s on c.id = s.id when matched then delete",
    "truncate public.customers",
  ]) {
    const definition = `create function private.change_it() returns void language sql as $$ ${body} $$;`;
    assert.deepEqual(checkSql(definition), [], body);
    assert.equal(checkSql(`${definition} select private.change_it();`).length, 1, body);
  }
});

test("dynamic SQL (EXECUTE) fails anywhere; GRANT EXECUTE and EXECUTE FUNCTION in triggers pass", () => {
  for (const sql of [
    `do $$ begin execute format('select %I.%I()', 'private', 'write_audit'); end $$;`,
    `do $$ begin execute 'insert into public.customers values (1)'; end $$;`,
    `prepare p as select 1; execute p;`,
    // Re-review R-G3: a variable named function or procedure, and EXECUTE in a function body.
    `do $$ declare function text := 'ins' || 'ert into public.customers (name) values (''Fake'')'; begin execute function; end $$;`,
    `do $$ declare procedure text := 'del' || 'ete from public.audit_logs'; begin execute procedure; end $$;`,
    `create function private.f() returns void language plpgsql as $$ begin execute 'ins' || 'ert into public.customers (name) values (''Fake'')'; end $$;`,
  ]) {
    rejects(sql, /dynamic SQL \(EXECUTE\) is not allowed/);
  }
  assert.deepEqual(checkSql(`grant execute on function public.f() to authenticated;
    revoke execute on all functions in schema public from anon;
    alter default privileges for role postgres revoke execute on functions from public;
    create trigger t before update on public.x for each row execute function private.tg();
    create trigger t2 before update on public.x for each row execute procedure private.tg();
    create constraint trigger t3 after insert on public.x for each row execute function private.tg();
    create event trigger e on ddl_command_end execute function private.tg();`), []);
});

test("other data changes in statements that run fail (review S14)", () => {
  for (const sql of [
    `update public.role_permissions set allowed = true where role = 'customer_service';`,
    `update only public.profiles p set is_test = false;`,
    `delete from public.profiles;`,
    `merge into public.customers c using (select 1 as id) s on c.id = s.id when not matched then insert (id) values (s.id);`,
    `truncate public.customers;`,
    `truncate table only public.customers, public.visits;`,
    `do $$ begin update public.role_permissions set allowed = true; end $$;`,
    `do $$ begin delete from public.audit_logs; end $$;`,
    `create table public.brands_copy as select 'Fake' as name;`,
    `create unlogged table if not exists public.t (a, b) as values (1, 'x');`,
    `select 'Fake' as name into public.brands_copy;`,
    `create materialized view public.mv as select 1;`,
  ]) {
    rejects(sql, /is not allowed in migrations/);
  }
});

test("schema statements that only name UPDATE, DELETE, TRUNCATE or AS still pass", () => {
  assert.deepEqual(checkSql(`
    create table public.a (
      id bigint generated always as identity primary key,
      b uuid references public.b (id) on delete restrict on update restrict,
      c uuid references public.c (id) on update set null on delete set default,
      n numeric(10, 2) check (n > 0) no inherit
    );
    create trigger t99 before truncate on public.a for each statement execute function private.tg();
    create trigger t95 before update or delete on public.a for each row execute function private.tg();
    create trigger t96 after insert or update of n on public.a for each row execute function private.tg();
    create policy p1 on public.a for update to authenticated using (true);
    create policy p2 on public.a for delete to authenticated using (true);
    grant select, insert, update, delete, truncate on public.a to authenticated;
    revoke truncate on public.a from anon;
    alter table public.a add column is_test boolean not null default false;
    comment on table public.a is 'UPDATE, DELETE and TRUNCATE are rejected; delete from x is not run';
    create function private.f() returns void language plpgsql as $$
    begin
      perform 1 from public.a for update;
      perform 1 from public.a for no key update;
      update public.a set n = 1;
    end
    $$;
    create view public.v as select 1 as one;
    select 'example.test';
    do $$ begin if current_user <> 'postgres' then raise exception 'x'; end if; end $$;`), []);
});

// Re-review (R-S2, R-G1 ... R-G11) ---------------------------------------------------------------------

const UPDATER = (name) => `create function private.${name}() returns int language plpgsql set search_path = '' as $$
  begin
    update public.role_permissions set allowed = true where role = 'customer_service' and permission_key = 'export';
    return 1;
  end
  $$;`;

test("R-S2 g1-g8: the security review's probes fail", () => {
  rejects(`update public.role_permissions * set allowed = true where role = 'customer_service';`, /UPDATE is not allowed/);
  rejects(`update only (public.role_permissions) set allowed = true where role = 'customer_service';`, /UPDATE is not allowed/);
  rejects(`create function private.probe_w(a int, b int) returns boolean language plpgsql set search_path = '' as $$
      begin update public.role_permissions set allowed = true; return true; end $$;
    create operator private.=== (function = private.probe_w, leftarg = int, rightarg = int);
    select 1 operator(private.===) 1;`, /the migration calls probe_w\(\)/);
  rejects(`${UPDATER("probe_w")}
    create function private.probe_harmless(x int default private.probe_w()) returns int language sql set search_path = '' as $$ select x $$;
    select private.probe_harmless();`, /the migration calls probe_harmless\(\)/);
  rejects(`${UPDATER("probe_w")} alter function private.probe_w() rename to probe_r; select private.probe_r();`, /RENAME is not allowed/);
  rejects(`create function private.probe_w() returns int language plpgsql as $$
      begin update public.role_permissions * set allowed = true; return 1; end $$;
    select private.probe_w();`, /the migration calls probe_w\(\)/);
  rejects(`create function pg_temp.probe_d() returns int language plpgsql as $$
      begin execute 'update public.role_permissions set allowed = true'; return 1; end $$;
    select pg_temp.probe_d();`, /functions in pg_temp are not allowed/);
  rejects(`create function pg_temp.probe_d() returns int language sql as $$ select 1 $$;`, /functions in pg_temp are not allowed/);
});

test("code nested anywhere in a statement is read as code; other dollar-quoted text fails", () => {
  // A DO block or a function definition after BEGIN/THEN inside a body or a DO block.
  rejects(`do $a$ begin do $b$ begin update public.role_permissions set allowed = true; end $b$; end $a$;`, /UPDATE is not allowed/);
  rejects(`do $a$ begin if true then do $b$ begin delete from public.audit_logs; end $b$; end if; end $a$;`, /DELETE is not allowed/);
  rejects(`create function private.f() returns void language plpgsql as $f$
      begin do $b$ begin update public.role_permissions set allowed = true; end $b$; end $f$;
    select private.f();`, /the migration calls f\(\)/);
  rejects(`create function private.f() returns void language plpgsql as $f$
      begin create function private.g() returns void language plpgsql as $g$ begin update public.role_permissions set allowed = true; end $g$;
      perform private.g(); end $f$;
    select private.f();`, /the migration calls f\(\)/);
  rejects(`do $a$ begin create function private.g() returns void language plpgsql as $g$ begin update public.role_permissions set allowed = true; end $g$; perform private.g(); end $a$;`,
    /the migration calls g\(\)/);
  rejects(`do 'begin update public.role_permissions set allowed = true; end';`, /a DO block must have one dollar-quoted PL\/pgSQL body/);
  rejects(`do language plpython3u $$ plpy.execute('select 1') $$;`, /a DO block must have one dollar-quoted PL\/pgSQL body/);
  // Dollar-quoted text that is not a function or DO body.
  for (const sql of [
    `select $$example.test$$;`,
    `comment on table public.t is $$ update public.role_permissions set allowed = true $$;`,
    `create function public.f(p text default $$x$$) returns text language sql as $b$ select p $b$;`,
  ]) {
    rejects(sql, /dollar-quoted text is allowed only as a function or DO body/);
  }
});

test("R-G1: a writer is called when a statement that runs names it in any way", () => {
  const options = writer("private.w(int,int)", ["public.customers"]);
  const definition = `create function private.w(a int, b int) returns int language sql as $$ insert into public.customers (name) values ('x') returning 1 $$;\n`;
  assert.deepEqual(checkSql(definition, "m.sql", options), []);
  for (const use of [
    `select private.w(1, 2);`,
    `select private."w"(1, 2);`,
    `select PRIVATE.W (1, 2);`,
    `call private.w(1, 2);`,
    `create operator public.### (function = private.w, leftarg = int, rightarg = int);`,
    `create aggregate public.agg(int) (sfunc = private.w, stype = int, initcond = '0');`,
    `create cast (int as text) with function private.w(int, int);`,
    `create table public.t (id int, x int default private.w(1, 2));`,
    `alter table public.call_types add column z int default private.w(1, 2);`,
    `create trigger t after insert on public.call_types for each row execute function private.w();`,
    `create policy p on public.t for select using (private.w(1, 2) = 1);`,
    `create view public.v as select private.w(1, 2);`,
    `create index i on public.t ((private.w(1, 2)));`,
  ]) {
    rejects(definition + use, /the migration calls w\(\)/, options);
  }
  // A function that names a writer anywhere (body, parameter default) is a writer.
  rejects(`${definition} create function public.h(x int default private.w(1, 2)) returns int language sql as $$ select x $$; select public.h();`,
    /the migration calls h\(\)/, options);
  // Escapes and renames.
  rejects(`${definition} select private.U&"\\0077"(1, 2);`, /U& Unicode escapes/, options);
  rejects(`${definition} select U&'x';`, /U& Unicode escapes/, options);
  rejects(`${definition} alter function private.w(int, int) rename to harmless; select private.harmless(1, 2);`, /RENAME is not allowed/, options);
  rejects(`${definition} alter function private.w(int, int) set schema public;`, /SET SCHEMA is not allowed/, options);
  rejects(`${definition} alter routine private.w(int, int) rename to harmless;`, /RENAME is not allowed/, options);
  // PostgreSQL truncates identifiers to 63 bytes: a longer spelling is the same function.
  const long = "w".repeat(63);
  const longOptions = writer(`private.${long}()`, ["public.customers"]);
  const longDefinition = `create function private.${long}() returns int language sql as $$ insert into public.customers (name) values ('x') returning 1 $$;`;
  rejects(`${longDefinition} select private.${long}_and_more();`, new RegExp(`the migration calls ${long}\\(\\)`), longOptions);
  // Every ALLOWED_WRITERS name is a writer even when its definition is in no migration file.
  rejects(`alter table public.call_types add column z int default private.write_audit(1);`, /the migration calls write_audit\(\)/);
});

test("R-G1: ALLOWED_WRITERS entries are pinned to their signature and tables; their bodies keep the marker checks", () => {
  const signature = "p_action text, p_target_table text, p_target_id uuid, p_details jsonb";
  passes(`create function private.write_audit(${signature}) returns bigint language sql as $$ insert into public.audit_logs (action) values (p_action) returning 1 $$;`);
  passes(`create function "private"."write_audit"(${signature}) returns bigint language sql as $$ insert into public.audit_logs (action) values (p_action) returning 1 $$;`);
  rejects(`create function private.write_audit(${signature}) returns bigint language sql as $$ insert into public.customers (name) values ('Fake') returning 1 $$;`,
    /INSERT into "customers" is not allowed \(only the reviewed writer functions/);
  rejects(`create function private.write_audit(${signature}) returns bigint language sql as $$ insert into audit_logs (action) values (p_action) returning 1 $$;`,
    /INSERT into "audit_logs" is not allowed/);
  rejects(`create function private.write_audit(${signature}) returns bigint language sql as $$ insert into public.audit_logs (action) values ('seed') returning 1 $$;`,
    /contains a test marker \(data_source 'seed'\)/);
  rejects(`create function private.write_audit(${signature}) returns bigint language sql as $$ insert into public.audit_logs (action) values ($m$x@example.test$m$) returning 1 $$;`,
    /contains a test marker \(example\.test address\)/);
  rejects(`create function private.write_audit(a int, b int) returns int language sql as $$ insert into public.customers (name, is_test, data_source) values ('Fake Customer', true, 'seed') returning 1 $$;`,
    /INSERT into "customers" is not allowed/);
});

test("R-G2/R-G6: a reference INSERT lists its columns, sets no marker and uses plain constants", () => {
  for (const sql of [
    `insert into public.call_types (label_he) values ($$o9@example.test$$);`,
    `insert into public.call_types select * from json_populate_record(null::public.call_types, $j$` + `{"label_he":"x","is_test":true}$j$);`,
    `insert into public.call_types select * from json_populate_record(null::public.call_types, '{"label_he":"x","is_test":true}');`,
    `insert into public.call_types values (default, 'Fake', true);`,
    `insert into public.call_types (label_he, data_source) values ('x', 'simu' || 'lator');`,
    `insert into public.call_types (label_he) values (default);`,
    `insert into public.call_types (label_he) values (E'simu\\x6cator');`,
    `insert into public.call_types (label_he) values ('x') on conflict do nothing;`,
    `insert into public.role_permissions (role, permission_key, allowed) values ('manager', 'cal', true) on conflict (role, permission_key) do update set allowed = true;`,
    `insert into public.call_types (label_he) values ('x') returning *;`,
    `insert into public.call_types default values;`,
    `do $$ begin insert into public.call_types (label_he) values ($m$u@example.test$m$); end $$;`,
  ]) {
    rejects(sql, /INSERT into "call_types"|INSERT into "role_permissions"/);
  }
  rejects(`insert into public.call_types (label_he, "data_source") values ('x', 'real');`, /test marker \(sets data_source/);
  rejects(`alter table public.call_types alter column is_test set default true; insert into public.call_types (label_he) values ('x');`,
    /a default on is_test other than false is not allowed/);
  rejects(`alter table public.call_types alter column data_source set default 'si' || 'mulator';`, /a default on data_source/);
  rejects(`alter table public.customers add column is_test boolean not null default true;`, /a default on is_test/);
  rejects(`create table public.call_types (id int, is_test boolean not null default true);`, /a default on is_test/);
  passes(`create table public.call_types (id int, label_he text, is_test boolean not null default false);`);
  // Self-review additions: an expression that is not exactly false, a generated marker, a domain
  // default, and a BEFORE INSERT trigger on a reference table that changes the new row.
  rejects(`alter table public.call_types alter column is_test set default false or true;`, /a default on is_test other than false/);
  rejects(`alter table public.call_types add column is_test boolean generated always as (true) stored;`, /may not be a generated column/);
  rejects(`create domain public.marker as boolean default true;`, /a domain default is not allowed/);
  const trigger = (body) => `create function private.tg_x() returns trigger language plpgsql as $$ begin ${body} return new; end $$;
    create trigger t before insert on public.call_types for each row execute function private.tg_x();`;
  rejects(trigger("new.is_test := true;"), /BEFORE INSERT trigger on reference table call_types/);
  rejects(trigger("new.data_source = 'seed';"), /BEFORE INSERT trigger on reference table call_types/);
  rejects(trigger("select true into new.is_test;"), /BEFORE INSERT trigger on reference table call_types/);
  rejects(trigger("new := jsonb_populate_record(new, '{}');"), /BEFORE INSERT trigger on reference table call_types/);
  rejects(`create trigger t before insert on public.call_types for each row execute function private.not_defined_here();`,
    /BEFORE INSERT trigger on reference table call_types/);
  passes(trigger("if new.label_he = 'x' then raise exception 'x'; end if;"), { allowedReferenceTriggers: new Set(["private.tg_x()"]) });
  passes(`insert into public.permissions (key, label_he, enforcement, sort_order) values ('k', 'תווית', 'screen', 14), ('k2', 'x', 'data', -1);`);
});

test("R-G3/R-G9/R-G10/R-G11: dynamic SQL, COPY, writing built-ins, extensions and string settings fail everywhere", () => {
  for (const [sql, pattern] of [
    [`do $$ begin copy public.customers from '/tmp/x.csv'; end $$;`, /COPY is not allowed/],
    [`create function public.f() returns void language plpgsql as $$ begin copy public.customers from '/tmp/x.csv'; end $$;`, /COPY is not allowed/],
    [`copy (select 1) to stdout;`, /COPY is not allowed/],
    [`create extension if not exists pg_cron;`, /CREATE EXTENSION pg_cron is not allowed/],
    [`select cron.schedule('j', '* * * * *', 'select 1');`, /the cron schema is not allowed/],
    [`select vault.create_secret('fake');`, /the vault schema is not allowed/],
    [`select net.http_post('https://example.test');`, /the net schema is not allowed/],
    [`select dblink_exec('dbname=x', 'select 1');`, /dblink_exec\(\) is not allowed/],
    [`select query_to_xml('select private.w()', true, true, '');`, /query_to_xml\(\) is not allowed/],
    [`create function private.f() returns xml language sql as $$ select query_to_xml('select 1', true, true, '') $$;`, /query_to_xml\(\) is not allowed/],
    [`select set_config('session_replication_role', 'replica', false);`, /set_config\(\) is not allowed/],
    [`set session_replication_role = replica;`, /session_replication_role may not be named/],
    [`set standard_conforming_strings = off;`, /standard_conforming_strings may not be named/],
    [`alter extension pgcrypto update;`, /ALTER EXTENSION is not allowed/],
    [`create foreign table public.x (id int) server s;`, /CREATE FOREIGN is not allowed/],
    [`create subscription s connection 'dbname=x' publication p;`, /CREATE SUBSCRIPTION is not allowed/],
    [`load 'plpgsql';`, /LOAD is not allowed/],
    [`explain analyze create table public.t as select 'Fake' as name;`, /EXPLAIN is not allowed/],
  ]) {
    rejects(sql, pattern);
  }
});

test("R-G4: the tokenizer reads dollar quotes, identifiers and strings as PostgreSQL does (UTF8 client encoding)", () => {
  // A dollar tag longer than 62 characters, and one inside a function body.
  const tag = `$${"a".repeat(70)}$`;
  rejects(`select ${tag} /* ${tag};\ninsert into public.customers (name) values ('Fake');\nselect ${tag} */ ${tag};`, /INSERT into "customers" is not allowed/);
  const bodyTag = `$tag_${"a".repeat(70)}$`;
  rejects(`create function private.f() returns void language plpgsql as $$ begin perform ${bodyTag} /* ${bodyTag}; insert into public.customers (name) values ('Fake'); perform ${bodyTag} */ ${bodyTag}; end $$; select private.f();`,
    /INSERT into "customers" is not allowed/);
  // Non-ASCII outside strings and comments fails (tags, identifiers, before "$" or "e'").
  rejects("select $תג$ /* $תג$;\ninsert into public.customers (name) values ('Fake');\nselect $תג$ */ $תג$;", /non-ASCII character in a dollar-quote tag/);
  rejects("update public.role_permissions ר set allowed = true;", /non-ASCII character in an identifier/);
  rejects("select א$a$ x $a$;", /non-ASCII character in an identifier/);
  rejects("select אe'x';", /non-ASCII character in an identifier/);
  rejects("insert into public.call_typesא (name) values ('Fake');", /non-ASCII character in an identifier/);
  passes("comment on table public.t is 'תווית בעברית'; -- הערה");
  // An identifier ending in "$" or "e" never starts a quote.
  assert.deepEqual(lexSql("select a$b$ from t").tokens.map((t) => t.value), ["select", "a$b$", "from", "t"]);
  assert.deepEqual(lexSql("select abce'x'").tokens.map((t) => [t.type, t.value]), [["ident", "select"], ["ident", "abce"], ["string", "x"]]);
  // An E'' string's backslash escape does not end it (review C11: it hid an UPDATE in a CTE).
  rejects(`with a as (select E'\\''), b as (update public.role_permissions set allowed = true returning 'x') select 1;`, /UPDATE is not allowed/);
  // Whitespace, comments and strings end where PostgreSQL ends them.
  rejects("select x $a$ ; insert into public.customers (name) values ('Fake'); select $a$;", /non-ASCII character in an identifier/);
  // A no-break space at the start of a token is part of an identifier for PostgreSQL, not a space.
  rejects("select  $a$ ; insert into public.customers (name) values ('Fake'); select $a$;", /INSERT into "customers" is not allowed/);
  // b'' and x'' strings end at the next quote (no '' escape).
  assert.deepEqual(lexSql("select b'01''10'").tokens.map((t) => [t.type, t.value]), [["ident", "select"], ["string", "01"], ["string", "10"]]);
  rejects("select 1; -- comment\rinsert into public.customers (name) values ('Fake');", /INSERT into "customers" is not allowed/);
  rejects("select x'' ; insert into public.customers (name) values ('Fake'); select '';", /INSERT into "customers" is not allowed/);
  rejects("select b'1' ; insert into public.customers (name) values ('Fake'); select '';", /INSERT into "customers" is not allowed/);
  rejects("select E'x'\n'\\' ' ; insert into public.customers (name) values ('Fake'); select '';", /string literal continued on the next line/);
  rejects("select 'a' -- comment\n'b';", /string literal continued on the next line/);
  // Lexer errors inside bodies fail closed.
  rejects(`create function private.f() returns void language plpgsql as $$ begin perform 'unterminated; end $$;`, /function private\.f: unterminated string literal/);
  rejects(`do $$ begin perform "x; end $$;`, /unterminated quoted identifier/);
  rejects(`select \\x;`, /unexpected character/);
});

test("R-G5: a reference table is only public.<name>; no inheritance, partitions, renames or schema moves", () => {
  for (const [sql, pattern] of [
    [`insert into s.call_types (label_he) values ('x');`, /INSERT into "s\.call_types" is not allowed/],
    [`insert into public.call_types$x (name) values ('Fake');`, /INSERT into "call_types\$x" is not allowed/],
    [`create table s.call_types (like public.customers);`, /reference table name; it may exist only as the table public\.call_types/],
    [`create view public.call_types as select * from public.customers;`, /reference table name/],
    [`alter table s.call_types inherit public.customers;`, /INHERIT\/INHERITS is not allowed/],
    [`create table public.x (id int) inherits (public.customers);`, /INHERIT\/INHERITS is not allowed/],
    [`alter table public.customers attach partition s.x for values in (1);`, /ATTACH PARTITION is not allowed/],
    [`create table s.x partition of public.customers for values in (1);`, /PARTITION OF is not allowed/],
    [`alter table s.call_types rename to customers;`, /RENAME is not allowed/],
    [`alter table s.customers set schema public;`, /SET SCHEMA is not allowed/],
    [`alter schema s rename to t;`, /RENAME is not allowed/],
  ]) {
    rejects(sql, pattern);
  }
});

test("R-G7: every form of UPDATE, CREATE TABLE ... AS, SELECT INTO and EXPLAIN fails", () => {
  for (const sql of [
    `update public.role_permissions * set allowed = true;`,
    `update only (public.role_permissions) set allowed = true;`,
    `update public.role_permissions as rp set allowed = true;`,
    `with x as (update public.role_permissions set allowed = true returning 1) select 1;`,
    `create table public.t using heap as select 'Fake' as name;`,
    `create table public.t tablespace pg_default as select 'Fake' as name;`,
    `create table public.t (id int) as select 1;`,
    `with x as (select 'Fake' as name) select * into public.t from x;`,
    `(select 'Fake' as name into public.t);`,
    `explain (analyze) create materialized view public.mv as select 'Fake' as name;`,
    `refresh materialized view public.mv;`,
    `alter table public.profiles alter column full_name type text using 'Fake';`,
    `do $$ begin if true then update public.role_permissions set allowed = true; end if; end $$;`,
    `do $$ begin if true then truncate public.customers; end if; end $$;`,
  ]) {
    assert.ok(checkSql(sql).some((p) => /is not allowed|not allowed in migrations/.test(p)), `${sql}: ${JSON.stringify(checkSql(sql))}`);
  }
});

test("R-G1/R-G8: the independent guard review's call paths fail", () => {
  const W = `create function private.write_audit(a int, b int) returns int language sql as $$ insert into public.customers (name, is_test, data_source) values ('Fake Customer', true, 'seed') returning 1 $$;`;
  for (const sql of [
    `${W} select private.U&"write_\\0061udit"(1, 2);`,
    `${W} alter function private.write_audit(int, int) rename to harmless; select private.harmless(1, 2);`,
    `${W} create operator public.### (function = private.write_audit, leftarg = int, rightarg = int); select 1 ### 2;`,
    `${W} create aggregate public.agg(int) (sfunc = private.write_audit, stype = int, initcond = '0'); select public.agg(x) from generate_series(1,1) x;`,
    `create function private.write_audit() returns trigger language plpgsql as $$ begin insert into public.customers (name) values ('Fake'); return new; end $$; create trigger t after insert on public.call_types for each row execute function private.U&"write_\\0061udit"(); insert into public.call_types (label_he) values ('ok');`,
    `create procedure private.write_audit() language sql as $$ insert into public.customers (name) values ('Fake') $$; call private.U&"write_\\0061udit"();`,
  ]) {
    assert.ok(checkSql(sql).length > 0, sql);
  }
});

// Fix round 1 (final-verify items N1-N3) -----------------------------------------------------------------

const EXISTING_REWRITE = /on the existing table .* is not allowed in migrations \(it rewrites existing rows\)/;

test("N1: schema changes that rewrite an existing table's rows fail (drop and re-add, type changes, casts)", () => {
  // Drop and re-add with a default: every existing profile would become a manager.
  const dropAdd = checkSql(`alter table public.profiles drop column role;
    alter table public.profiles add column role text not null default 'manager';`);
  assert.ok(dropAdd.some((p) => /DROP COLUMN on the existing table public\.profiles/.test(p)), JSON.stringify(dropAdd));
  assert.ok(dropAdd.some((p) => /ADD COLUMN with a DEFAULT on the existing table public\.profiles/.test(p)), JSON.stringify(dropAdd));
  // A type change through an assignment cast and back rewrites every value.
  const cast = checkSql(`create function private.to_r(text) returns public.r language sql immutable as $$ select 'manager'::public.r $$;
    create cast (text as public.r) with function private.to_r(text) as assignment;
    alter table public.profiles alter column role type public.r;
    alter table public.profiles alter column role type text;`);
  assert.ok(cast.some((p) => /CREATE CAST is not allowed/.test(p)), JSON.stringify(cast));
  assert.ok(cast.some((p) => /ALTER COLUMN \.\.\. TYPE \/ SET DATA TYPE on the existing table public\.profiles/.test(p)), JSON.stringify(cast));
  rejects(`create cast (text as public.r) without function as assignment;`, /CREATE CAST is not allowed/);
  for (const [sql, pattern] of [
    [`alter table public.profiles alter column role set data type varchar(20);`, /ALTER COLUMN \.\.\. TYPE/],
    [`alter table only public.profiles alter role type text;`, /ALTER COLUMN \.\.\. TYPE/],
    [`alter table public.profiles * alter column role type text;`, /ALTER COLUMN \.\.\. TYPE/],
    [`alter table if exists public.role_permissions add column allowed2 boolean not null default true;`, /ADD COLUMN with a DEFAULT/],
    [`alter table public.profiles add n uuid default gen_random_uuid();`, /ADD COLUMN with a DEFAULT/],
    [`alter table public.profiles add column n int default null::int;`, /ADD COLUMN with a DEFAULT/],
    [`alter table public.profiles add column n bigserial;`, /ADD COLUMN with a serial type/],
    [`alter table public.profiles add column n int generated always as identity;`, /ADD COLUMN \.\.\. GENERATED/],
    [`alter table public.profiles add column n int generated always as (1) stored;`, /ADD COLUMN \.\.\. GENERATED/],
    [`alter table public.t alter column g set expression as (1);`, /ALTER COLUMN \.\.\. SET EXPRESSION/],
    [`alter table public.profiles drop role;`, /DROP COLUMN/],
    [`alter table public.profiles drop column if exists role cascade;`, /DROP COLUMN/],
    [`alter table public.profiles enable row level security, drop column role;`, /DROP COLUMN/],
    // ALTER TABLE wherever it starts: after BEGIN or THEN in a DO block, and in a function body.
    [`do $$ begin if true then alter table public.profiles drop column role; end if; end $$;`, /DROP COLUMN/],
    [`create function private.f() returns void language plpgsql as $$ begin alter table public.profiles drop column role; end $$;`, /function private\.f: DROP COLUMN/],
  ]) {
    rejects(sql, pattern);
    rejects(sql, EXISTING_REWRITE);
  }
  // Marker defaults and TYPE ... USING were checked only when ALTER TABLE started the statement.
  rejects(`do $$ begin alter table public.call_types alter column is_test set default true; end $$;`, /a default on is_test other than false/);
  rejects(`create function private.f() returns void language plpgsql as $$ begin alter table public.call_types alter column is_test set default true; end $$;`,
    /a default on is_test other than false/);
  rejects(`do $$ begin alter table public.profiles alter column full_name type text using 'Fake'; end $$;`, /TYPE \.\.\. USING rewrites existing rows/);
  // A typed table's columns change with its type.
  rejects(`alter type public.c alter attribute a type int cascade;`, /ALTER\/DROP ATTRIBUTE is not allowed/);
  rejects(`alter type public.c drop attribute a cascade;`, /ALTER\/DROP ATTRIBUTE is not allowed/);
});

test("N1: only a table created earlier in the same file by a plain top-level CREATE TABLE <schema>.<name> is new", () => {
  passes(`create table public.a (id int);
    alter table public.a add column x int not null default 1, drop column id, alter column x type bigint, add column s bigserial;
    create unlogged table private.b (id int);
    alter table private.b add column g int generated always as identity;`);
  // Changes that do not rewrite existing rows pass on any table.
  passes(`alter table public.profiles add column x text default null, add column y int references public.t (id) on delete set default,
    add constraint c check (y > 0), alter column x set default 'a', alter column x set not null, drop constraint c,
    add z int, enable row level security;`);
  for (const sql of [
    // IF NOT EXISTS may leave an existing table with rows in place.
    `create table if not exists public.a (id int); alter table public.a add column x int default 1;`,
    // Unqualified names may resolve elsewhere.
    `create table a (id int); alter table a add column x int default 1;`,
    `create table public.a (id int); alter table a drop column id;`,
    `set search_path = private; create table a (id int); alter table public.a drop column id;`,
    // A CREATE in a DO block may not have run.
    `do $$ begin if false then create table public.profiles (id int); end if; end $$; alter table public.profiles drop column role;`,
    // The ALTER comes before the CREATE.
    `alter table public.a drop column id; create table public.a (id int);`,
    // A table that received an INSERT has rows.
    `create table public.call_types (id int, label_he text);
     insert into public.call_types (label_he) values ('x');
     alter table public.call_types add column note text default 'Fake';`,
  ]) {
    rejects(sql, EXISTING_REWRITE);
  }
  // A table created in an earlier file is an existing table in a later one.
  const problems = checkFiles([
    { name: "1.sql", sql: "create table public.a (id int);" },
    { name: "2.sql", sql: "alter table public.a drop column id;" },
  ]);
  assert.ok(problems.some((p) => /^2\.sql: DROP COLUMN on the existing table public\.a/.test(p)), JSON.stringify(problems));
});

test("N2: every RENAME fails (a marker column renamed away would let a reference INSERT set it)", () => {
  // The bypass: rename the marker away, insert it as true, rename it back.
  rejects(`alter table public.call_types rename column is_test to flag;
    insert into public.call_types (label_he, flag) values ('x', true);
    alter table public.call_types rename column flag to is_test;`, /RENAME is not allowed/);
  for (const sql of [
    `alter table public.call_types rename is_test to flag;`,
    `alter table only public.call_types rename column data_source to src;`,
    `alter table public.account_requests rename target_is_test to t;`,
    `alter table public.call_types rename constraint c to d;`,
    `alter type public.r rename value 'manager' to 'technician';`,
    `alter type public.c rename attribute a to b;`,
    `alter index public.i rename to j;`,
    `alter trigger t on public.a rename to u;`,
    `alter policy p on public.a rename to q;`,
    `do $$ begin alter table public.call_types rename column is_test to flag; end $$;`,
    `create function private.f() returns void language plpgsql as $$ begin alter table public.call_types rename column is_test to flag; end $$;`,
  ]) {
    rejects(sql, /RENAME is not allowed/);
  }
});

test("N3: an UPDATE in a rule action is found after DO, with ONLY, '*' or an alias", () => {
  for (const sql of [
    `create rule r as on insert to public.call_types do update public.role_permissions * set allowed = true;`,
    `create rule r as on insert to public.call_types do update public.role_permissions * rp set allowed = true;`,
    `create rule r as on insert to public.call_types do update public.role_permissions * as rp set allowed = true;`,
    `create rule r as on insert to public.call_types do update only public.role_permissions set allowed = true;`,
    `create rule r as on insert to public.call_types do update public.role_permissions set allowed = true;`,
    `create rule r as on insert to public.call_types do instead update public.role_permissions * set allowed = true;`,
  ]) {
    rejects(sql, /UPDATE is not allowed in migrations/);
  }
});

// Fix round 2 (verification round 1 items V1-1 ... V1-8) ---------------------------------------------------

const CALL_TYPES = `create table public.call_types (id uuid primary key default gen_random_uuid(), label_he text not null,
  is_test boolean not null default false, data_source text);\n`;
const THREE_PARTS = /a name with three parts \(database\.schema\.object, record\.field\.field\) is not allowed/;

test("V1-1: a three-part name (postgres.public.x) fails, and every rule that reads a name fails closed on one", () => {
  // The verification's inputs: each rewrote or inserted rows on the local database.
  const rule = `${CALL_TYPES} create rule ct_r as on insert to public.call_types do update postgres.public.permissions set label_he = 'Fake label';`;
  rejects(rule, THREE_PARTS);
  rejects(rule, /UPDATE is not allowed in migrations/);
  const cursor = `do $$ declare c refcursor; n int; begin
      open c for update postgres.public.permissions set label_he = 'Fake label' returning 1; fetch c into n; close c; end $$;`;
  rejects(cursor, THREE_PARTS);
  // OPEN ... FOR UPDATE <name>: after FOR, only a word of a locking clause or a policy may follow
  // UPDATE; the guard does not need to read the target.
  rejects(cursor, /UPDATE is not allowed in migrations/);
  const dropAdd = `alter table postgres.public.role_permissions drop column allowed;
    alter table postgres.public.role_permissions add column allowed boolean not null default true;`;
  rejects(dropAdd, THREE_PARTS);
  rejects(dropAdd, /an ALTER TABLE target the guard cannot read is not allowed/);
  const trigger = `${CALL_TYPES} create function private.tg_ct() returns trigger language plpgsql set search_path = '' as $$
      begin new.is_test := true; new.data_source := 'simulator'; return new; end $$;
    create trigger ct_bi before insert on postgres.public.call_types for each row execute function private.tg_ct();`;
  rejects(trigger, THREE_PARTS);
  rejects(trigger, /BEFORE INSERT trigger on reference table \(unreadable name\)/);
  const view = `create view postgres.public.call_types as select id, name as label_he from public.customers;`;
  rejects(view, THREE_PARTS);
  rejects(view, /a view name the guard cannot read is not allowed/);
  const table = `create table postgres.public.call_types (id uuid, label_he text not null, is_test boolean not null default true);`;
  rejects(table, THREE_PARTS);
  rejects(table, /a table name the guard cannot read is not allowed/);
  // Inside a function body, and a record field of a field.
  rejects(`create function private.f() returns void language plpgsql as $$ begin perform postgres.private.write_audit('a', 'b', null, '{}'); end $$;`, THREE_PARTS);
  rejects(`create function private.f() returns void language plpgsql as $$ declare r record; begin perform r.a.b; end $$;`, THREE_PARTS);
  // The cursor form inside a function body makes the function a writer.
  rejects(`create function private.f() returns void language plpgsql as $$ declare c refcursor; begin
      open c for update public.permissions set label_he = 'Fake label' returning 1; end $$;
    select private.f();`, /the migration calls f\(\)/);
  // ON CONFLICT DO UPDATE is an UPDATE too (after DO the guard never reads the target).
  rejects(`insert into public.role_permissions (role, permission_key, allowed) values ('manager', 'cal', true)
    on conflict (role, permission_key) do update set allowed = true;`, /UPDATE is not allowed in migrations/);
  // Locking clauses, policies and foreign key actions still pass.
  passes(`create function private.f() returns void language plpgsql as $$ begin
      perform 1 from public.a for update of a nowait;
      perform 1 from public.a for update skip locked limit 1;
      perform 1 from public.a where exists (select 1 from public.b for update);
    end $$;
    create policy p on public.a for update to authenticated using (true) with check (true);
    create table public.t (id int, b int references public.b (id) on update set null on delete set default);`);
});

const triggerOn = (table, fn) => `create trigger ct_bi before insert on ${table} for each row execute function ${fn}();`;
const tgDefinition = (body, declare = "") => `create function private.tg_ct() returns trigger language plpgsql set search_path = '' as $$
  declare r record; v public.call_types; c refcursor; ${declare}
  begin
    ${body}
  end $$;\n`;
const REVIEWED_TRIGGER = /may run only a reviewed function of ALLOWED_REFERENCE_TRIGGERS/;

test("V1-2: a BEFORE INSERT trigger on a reference table may run only a reviewed, pinned trigger function", () => {
  assert.deepEqual([...ALLOWED_REFERENCE_TRIGGERS], ["private.tg_one_way_people()"]);
  // jsonb_populate_record(new, ...) changes the stored row without assigning to NEW.
  rejects(`${CALL_TYPES}${tgDefinition(`return jsonb_populate_record(new, '{"is_test": true, "data_source": "simulator"}');`)}
    ${triggerOn("public.call_types", "private.tg_ct")} insert into public.call_types (label_he) values ('x');`, REVIEWED_TRIGGER);
  // A function that never touches NEW is not enough: only the reviewed list may run.
  rejects(`${tgDefinition("return new;")} ${triggerOn("public.call_types", "private.tg_ct")}`, REVIEWED_TRIGGER);
  // The reviewed function, named schema-qualified and defined in the files.
  const owp = `create function private.tg_one_way_people() returns trigger language plpgsql set search_path = '' as $$ begin return new; end $$;\n`;
  passes(`${owp} create trigger t before insert or update on public.role_permissions for each row execute function private.tg_one_way_people('updated_by', 'approved_by');`);
  rejects(`${owp} create trigger t before insert on public.role_permissions for each row execute function tg_one_way_people('a');`, REVIEWED_TRIGGER);
  rejects(`create trigger t before insert on public.role_permissions for each row execute function private.tg_one_way_people('a');`,
    /must use a function defined in the migrations \(private\.tg_one_way_people\(\)\)/);
  // Wherever the trigger is created: after BEGIN in a DO block, and in a function body.
  rejects(`do $$ begin perform 1; ${triggerOn("public.call_types", "private.tg_bad")} end $$;`, REVIEWED_TRIGGER);
  rejects(`do $$ begin if true then ${triggerOn("public.call_types", "private.tg_bad")} end if; end $$;`, REVIEWED_TRIGGER);
  rejects(`create function private.mk() returns void language plpgsql as $$ begin perform 1; ${triggerOn("public.call_types", "private.tg_bad")} end $$;`,
    /function private\.mk: a BEFORE INSERT trigger on reference table call_types may run only a reviewed function/);
  // INSTEAD OF INSERT counts as BEFORE (it decides the stored row of a view of that name).
  rejects(`create trigger t instead of insert on public.call_types for each row execute function private.tg_bad();`, REVIEWED_TRIGGER);
  // Other tables and other timings are not limited by this rule.
  passes(`${triggerOn("public.customers", "private.tg_bad")} create trigger t after insert on public.call_types for each row execute function private.tg_bad();`);
});

test("V1-2: every definition of a reviewed trigger function leaves NEW as it is and returns only NEW or NULL", () => {
  const options = { allowedReferenceTriggers: new Set(["private.tg_ct()"]) };
  const withTrigger = (definition) => `${definition} ${triggerOn("public.call_types", "private.tg_ct")}`;
  passes(withTrigger(tgDefinition("if new.label_he = 'x' then raise exception 'x'; end if; return new;")), options);
  passes(withTrigger(tgDefinition("perform 1 from public.profiles p where p.id = new.id for update; return null;")), options);
  const CHANGES = /a reviewed reference-table trigger function may not change the new row \(NEW\)/;
  const RETURNS = /a reviewed reference-table trigger function may return only NEW or NULL/;
  for (const [body, pattern, declare] of [
    // The four forms the verification ran, plus assignment forms.
    ["select true, 'simulator' into strict new.is_test, new.data_source; return new;", CHANGES],
    ["select 1, true into r, new.is_test; return new;", CHANGES],
    ["open c for select true; fetch c into new.is_test; return new;", CHANGES],
    ["perform 1; get diagnostics new.is_test = row_count; return new;", CHANGES],
    ["foreach new.data_source in array array['simulator'] loop end loop; return new;", CHANGES],
    ["for new in select new.id, true loop end loop; return new;", CHANGES],
    ["for r, new in select 1, 2 loop end loop; return new;", CHANGES],
    ["new.is_test := true; return new;", CHANGES],
    ["new.is_test = true; return new;", CHANGES],
    ["if true then new.data_source = 'simulator'; end if; return new;", CHANGES],
    ["tg_ct.new := jsonb_populate_record(new, '{}'); return new;", CHANGES],
    ["tg_ct.new = jsonb_populate_record(new, '{}'); return new;", CHANGES],
    [`"new".is_test := true; return new;`, CHANGES],
    ["new.tags[1] := 'x'; return new;", CHANGES],
    ["call private.p(new.is_test); return new;", CHANGES],
    ["a.is_test := true; return new;", CHANGES, "a alias for new;"],
    // A changed copy, or a new row built from NEW, returned instead of NEW.
    ["v := new; v.is_test := true; return v;", RETURNS],
    [`return jsonb_populate_record(new, '{"is_test": true}');`, RETURNS],
    ["return private.f(new);", RETURNS],
  ]) {
    rejects(withTrigger(tgDefinition(body, declare)), pattern, options);
  }
  rejects(withTrigger(`create function private.tg_ct() returns trigger language plpgsql as $$ begin
      create function private.g() returns int language sql as $g$ select 1 $g$; return new; end $$;`),
    /may not define other functions/, options);
  rejects(withTrigger(`create function private.tg_ct() returns trigger language sql as $$ select 1 $$;`), /must have a dollar-quoted PL\/pgSQL body/, options);
  // A later file may not replace the reviewed function with one that changes the row.
  const problems = checkFiles([
    { name: "1.sql", sql: `create function private.tg_one_way_people() returns trigger language plpgsql as $$ begin return new; end $$;
      create trigger t before insert on public.role_permissions for each row execute function private.tg_one_way_people('a');` },
    { name: "2.sql", sql: `create or replace function private.tg_one_way_people() returns trigger language plpgsql as $$
      begin return jsonb_populate_record(new, '{"is_test": true}'); end $$;` },
  ]);
  assert.ok(problems.some((p) => /^2\.sql: function private\.tg_one_way_people: a reviewed reference-table trigger function may return only NEW or NULL/.test(p)), JSON.stringify(problems));
});

test("V1-3/V1-4: pg_graphql, pgmq and denied names fail quoted, unqualified and in a search_path", () => {
  for (const [sql, pattern] of [
    [`select graphql.resolve('mutation { updatepermissionsCollection(set: {label_he: "Fake label"}, atMost: 100) { affectedCount } }');`, /the graphql schema is not allowed/],
    [`select graphql_public.graphql('{ x }');`, /the graphql_public schema is not allowed/],
    [`select pgmq.send('q', '{}');`, /the pgmq schema is not allowed/],
    [`select pgmq_public.send('q', '{}');`, /the pgmq_public schema is not allowed/],
    // Quoted names (V1-4).
    [`select "vault".create_secret('fake-value', 'fake_name');`, /the vault schema is not allowed/],
    [`select "graphql".resolve('{ x }');`, /the graphql schema is not allowed/],
    [`select pg_catalog."set_config"('search_path', 'x', false);`, /set_config\(\) is not allowed/],
    // A denied name that is not followed by "." or "(": a search_path list, an operator's function.
    [`set local search_path = vault, public;`, /the vault schema is not allowed/],
    [`create function private.f() returns void language sql set search_path = graphql as $$ select 1 $$;`, /the graphql schema is not allowed/],
    [`create operator public.### (function = query_to_xml, leftarg = text, rightarg = boolean);`, /query_to_xml\(\) is not allowed/],
    // A search_path string.
    [`set local search_path = 'vault', public;`, /the vault schema is not allowed in migrations, also not in a search_path string/],
    [`create function private.f() returns void language sql set search_path to '$user', 'graphql_public, public' as $$ select 1 $$;`,
      /the graphql_public schema is not allowed in migrations, also not in a search_path string/],
    // Unqualified writers of those schemas (a default search_path set outside the migrations).
    [`select create_secret('fake-value', 'fake_name');`, /create_secret\(\) is not allowed/],
    [`select update_secret('00000000-0000-0000-0000-000000000000', 'x');`, /update_secret\(\) is not allowed/],
    [`select resolve('{ x }');`, /resolve\(\) is not allowed/],
    // A GraphQL mutation in a string.
    [`select 'mutation { insertIntocall_typesCollection(objects: [{label_he: "Fake"}]) { affectedCount } }';`, /a string reads as a pg_graphql mutation/],
    [`comment on table public.a is 'deleteFromcustomersCollection';`, /a string reads as a pg_graphql mutation/],
  ]) {
    rejects(sql, pattern);
  }
  passes(`comment on table public.a is 'update the collection later'; select 'vault';`);
});

test("V1-5: a column constraint named set or drop does not hide a DEFAULT", () => {
  const setDefault = `alter table public.permissions add column note text not null constraint set default 'Fake note';`;
  rejects(setDefault, /ADD COLUMN with a DEFAULT on the existing table public\.permissions/);
  rejects(setDefault, /CONSTRAINT <name> DEFAULT is not allowed/);
  const dropDefault = `create table public.call_types (id uuid, label_he text not null,
    is_test boolean not null constraint drop default true, data_source text not null constraint drop default 'simulator');`;
  rejects(dropDefault, /a default on is_test other than false is not allowed/);
  rejects(dropDefault, /a default on data_source other than false is not allowed/);
  rejects(dropDefault, /CONSTRAINT <name> DEFAULT is not allowed/);
  passes(`alter table public.call_types alter column is_test drop default, alter data_source drop default;
    alter table public.profiles add column y int references public.t (id) on delete set default on update set default;`);
});

test("V1-6: CREATE TABLE ... (LIKE ...) fails (it copies a marker default)", () => {
  rejects(`create table public.call_types (label_he text not null, like public.profiles including defaults);`, /CREATE TABLE \.\.\. \(LIKE \.\.\.\) is not allowed/);
  rejects(`create table public.x (like public.profiles);`, /CREATE TABLE \.\.\. \(LIKE \.\.\.\) is not allowed/);
  passes(`create table public.x (id int, email text check (email like '%@example.test'));`);
  // A typed table takes its columns (and an attribute domain's default) from a composite type.
  rejects(`create type public.ct as (label_he text, made information_schema.time_stamp); create table public.call_types of public.ct;`,
    /CREATE TABLE \.\.\. OF <type> \(a typed table\) is not allowed/);
  rejects(`create table public.x of public.ct (label_he with options not null);`, /CREATE TABLE \.\.\. OF <type>/);
});

test("V1-7: ADD COLUMN on an existing table only with a built-in type or a type the files create", () => {
  rejects(`alter table public.permissions add column created_at_2 information_schema.time_stamp;`, /ADD COLUMN of type information_schema\.time_stamp .* on the existing table public\.permissions/);
  rejects(`alter table public.permissions add column if not exists c time_stamp;`, /ADD COLUMN of type time_stamp/);
  rejects(`alter table public.permissions add column c "integer";`, /ADD COLUMN of type integer/);
  rejects(`alter table public.permissions add column c public.r;`, /ADD COLUMN of type public\.r/);
  rejects(`create type public.r as enum ('a'); alter table public.permissions add column c r;`, /ADD COLUMN of type r/);
  passes(`create type public.r as enum ('a');
    alter table public.permissions add column c int, add d double precision, add column e character varying(3),
      add column f timestamp with time zone, add column g text[], add column h pg_catalog.uuid, add column i public.r;
    create table public.n (id int); alter table public.n add column c information_schema.time_stamp;`);
  // A base type's DEFAULT is a hidden default too.
  rejects(`create type public.t (input = int4in, output = int4out, default = '1');`, /a domain default is not allowed/);
});

test("V1-8: a CREATE TABLE at the start of a statement in a DO block does not make the table new", () => {
  rejects(`do $$ begin perform 1; create table public.profiles (id int); end $$; alter table public.profiles drop column role;`, EXISTING_REWRITE);
});

test("V1-1 ... V1-6: every input of verification round 1 fails (E1-E17 and the four NEW forms)", () => {
  const calls = `create table public.call_types (id uuid primary key default gen_random_uuid(), label_he text not null,
    is_test boolean not null default false, data_source text);\n`;
  const tg = (body) => `${calls}create function private.tg_ct() returns trigger language plpgsql set search_path = '' as $$
    declare r record; begin ${body} return new; end $$;
    create trigger ct_bi before insert on public.call_types for each row execute function private.tg_ct();
    insert into public.call_types (label_he) values ('x');`;
  const mutation = "mutation { updatepermissionsCollection(set: {label_he: \"Fake label\"}, atMost: 100) { affectedCount } }";
  for (const [label, sql] of [
    ["E1", tg(`return jsonb_populate_record(new, '{"is_test": true, "data_source": "simulator"}');`)],
    ["E2", `${calls}create function private.tg_ct() returns trigger language plpgsql as $$ begin new.is_test := true; return new; end $$;
      create trigger ct_bi before insert on postgres.public.call_types for each row execute function private.tg_ct();`],
    ["E3", `${calls}create rule ct_r as on insert to public.call_types do update postgres.public.permissions set label_he = 'Fake label';`],
    ["E4", `alter table postgres.public.role_permissions drop column allowed;
      alter table postgres.public.role_permissions add column allowed boolean not null default true;`],
    ["E5", `select graphql.resolve('${mutation}');`],
    ["E5b", `${calls}select graphql.resolve('mutation { insertIntocall_typesCollection(objects: [{label_he: "Fake", is_test: true}]) { affectedCount } }');`],
    ["E6", `create view postgres.public.call_types as select id, name as label_he from public.customers;`],
    ["E7", `create table postgres.public.call_types (id uuid, label_he text not null, is_test boolean not null default true);`],
    ["E8", `do $$ declare c refcursor; n int; begin open c for update postgres.public.permissions set label_he = 'Fake label' returning 1; fetch c into n; end $$;`],
    ["E8b", `do $$ declare c refcursor; n int; begin open c for update public.permissions set label_he = 'Fake label' returning 1; fetch c into n; end $$;`],
    ["E9", `alter table public.permissions add column note text not null constraint set default 'Fake note';`],
    ["E10", `create table public.call_types (id uuid, label_he text not null, is_test boolean not null constraint drop default true);`],
    ["E11", `alter table public.permissions add column is_test boolean not null constraint drop default true;`],
    ["E12", `create table public.call_types (label_he text not null, like public.profiles including defaults);`],
    ["E13", `alter table public.permissions add column created_at_2 information_schema.time_stamp;`],
    ["E14", `select "vault".create_secret('fake-value', 'fake_name');`],
    ["E15", `set local search_path = vault, public; select create_secret('fake-value-2', 'fake_name_2');`],
    ["E16", `set local search_path = graphql, public; select resolve('${mutation}');`],
    ["E17", `select "graphql".resolve('${mutation}');`],
    ["NEW strict", tg("select true, 'simulator' into strict new.is_test, new.data_source;")],
    ["NEW get diagnostics", tg("perform 1; get diagnostics new.is_test = row_count;")],
    ["NEW foreach", tg("foreach new.data_source in array array['simulator'] loop end loop;")],
    ["NEW for in", tg("for new in select new.id, new.label_he, true, 'simulator' loop end loop;")],
  ]) {
    assert.ok(checkSql(sql).length > 0, `${label}: ${sql}`);
  }
});

test("V1-2: a reviewed trigger function may not declare a variable named NEW (it would shadow the row)", () => {
  const options = { allowedReferenceTriggers: new Set(["private.tg_ct()"]) };
  const definition = (declare) => `create function private.tg_ct() returns trigger language plpgsql set search_path = '' as $$
    declare ${declare} begin return new; end $$;
    create trigger ct_bi before insert on public.call_types for each row execute function private.tg_ct();`;
  const CHANGES = /a reviewed reference-table trigger function may not change the new row \(NEW\)/;
  rejects(definition(`new public.call_types := jsonb_populate_record(null::public.call_types, '{"label_he": "Fake", "is_test": true}');`), CHANGES, options);
  rejects(definition(`a int; new record;`), CHANGES, options);
  rejects(definition(`a int; "new" constant public.call_types := null;`), CHANGES, options);
  // In an inner block.
  rejects(`create function private.tg_ct() returns trigger language plpgsql as $$ begin
      declare new public.call_types; begin return new; end; return null; end $$;
    create trigger ct_bi before insert on public.call_types for each row execute function private.tg_ct();`, CHANGES, options);
  passes(definition(`v_row jsonb; v_new_label text;`), options);
});

test("V1-7: a domain counts as a type the files create only over a built-in type, wherever a domain of that name is created", () => {
  const ADDED = /ADD COLUMN of type public\.\w+ .* on the existing table public\.permissions/;
  // A domain over a domain inherits its default: every existing row would get now().
  rejects(`create domain public.d as information_schema.time_stamp; alter table public.permissions add column c public.d;`, ADDED);
  rejects(`create domain public.d information_schema.time_stamp; alter table public.permissions add column c public.d;`, ADDED);
  // The same name created safely and then again as such a domain (also unqualified, also in a DO block).
  rejects(`create type public.r as enum ('a'); drop type public.r;
    do $$ begin create domain r as information_schema.time_stamp; end $$;
    alter table public.permissions add column c public.r;`, ADDED);
  passes(`create domain public.d as text; create domain public.e as pg_catalog.int4 check (value > 0);
    alter table public.permissions add column c public.d, add column e public.e;`);
});

test("V1-7: every column of a reference table has a built-in type or a type the files create", () => {
  rejects(`create table public.call_types (id uuid, label_he text not null, created information_schema.time_stamp);`,
    /a column of reference table call_types has type information_schema\.time_stamp/);
  rejects(`create domain public.d as information_schema.time_stamp; create table public.call_types (id uuid, label_he public.d);`,
    /a column of reference table call_types has type public\.d/);
  passes(`create type public.k as enum ('screen', 'data');
    create table public.call_types (id uuid primary key, label_he text not null, kind public.k, sort_order int not null,
      is_test boolean not null default false, created_at timestamp with time zone not null default now(),
      constraint u unique (label_he), check (sort_order >= 0));`);
});

test("V1-1 (verification round 2): each name reader fails closed on its own, and FOR UPDATE <name> SET is an UPDATE whatever the name", () => {
  // The INSERT reader reports a target it cannot read, independently of the three-part rule.
  rejects(`insert into postgres.public.call_types (label_he) values ('x');`, /an INSERT target the guard cannot read is not allowed/);
  // A view named like a locking-clause word: OPEN ... FOR UPDATE nowait SET rewrote all 13 labels
  // through public.nowait on the local database (rolled back).
  const UPDATE = /UPDATE is not allowed in migrations/;
  const cursor = (target) => `do $$ declare c refcursor; n int; begin open c for update ${target} label_he = 'Fake label' returning 1; fetch c into n; end $$;`;
  rejects(`create view public.nowait as select * from public.permissions; ${cursor("nowait set")}`, UPDATE);
  for (const target of ["skip s set", "cascade as x set", "restrict * set", "set set", "of.permissions set", "no n set"]) rejects(cursor(target), UPDATE);
});

test("V1-4 (verification round 2): an E'' string in a search_path fails (its escapes spell a denied schema)", () => {
  // e'\x76ault' is vault: on the local database (rolled back) it made create_secret reachable
  // unqualified; for cron.schedule or pgmq.send no denied function name would appear at all.
  const ESTRING = /an E'' string in a search_path is not allowed in migrations/;
  for (const sql of [
    String.raw`set local search_path = e'\x63ron', public; select schedule('j', '* * * * *', 'update public.permissions set label_he = ''Fake''');`,
    String.raw`set local search_path = public, e'pg\x6dq'; select send('q', '{}'::jsonb);`,
    String.raw`set search_path to e'\x76ault';`,
    String.raw`create function private.f() returns void language sql set search_path = e'\x63ron' as $$ select 1 $$;`,
    String.raw`alter role postgres set search_path = E'gr\141phql';`,
  ]) {
    rejects(sql, ESTRING);
  }
  passes(`set local search_path = '', public; create function private.f() returns void language sql set search_path = '' as $$ select 1 $$;`);
});

test("V1-7 (verification round 2): no type or domain named like a built-in type, and the type rules stand on their own", () => {
  // With search_path = public, pg_catalog an unqualified `date` is public.date: on the local
  // database (rolled back) every one of the 13 existing rows got now().
  const SHADOW = /a type or domain named like the built-in type (\w+) is not allowed/;
  rejects(`create domain public.date as information_schema.time_stamp; set local search_path = public, pg_catalog;
    alter table public.permissions add column c date;`, SHADOW);
  rejects(`create type public."text" as enum ('a');`, SHADOW);
  rejects(`do $$ begin create domain uuid as information_schema.time_stamp; end $$;`, SHADOW);
  rejects(`create function private.f() returns void language plpgsql as $$ begin create domain private.jsonb as pg_catalog.jsonb; end $$;`, SHADOW);
  passes(`create domain public.label as text; create type public.kind as enum ('a'); create table public.date_ranges (id int);`);
  // Only an unqualified or pg_catalog built-in counts as built-in.
  rejects(`alter table public.permissions add column c public.text;`, /ADD COLUMN of type public\.text/);
  // A type created by a statement inside a DO block may not have been created (IF false): it does
  // not count, so the type of that name that exists outside the files is the column's type.
  rejects(`do $$ begin if false then perform 1; create domain information_schema.time_stamp as text; end if; end $$;
    alter table public.permissions add column c information_schema.time_stamp;`, /ADD COLUMN of type information_schema\.time_stamp/);
  // A type counts only after the statement that creates it: a later statement or file may fail
  // because the type already exists outside the files, after the column took its default.
  const LATER = /ADD COLUMN of type public\.r /;
  rejects(`alter table public.permissions add column c public.r; create type public.r as enum ('a');`, LATER);
  const files = checkFiles([
    { name: "1.sql", sql: "alter table public.permissions add column c public.r;" },
    { name: "2.sql", sql: "create type public.r as enum ('a');" },
  ]);
  assert.ok(files.some((p) => p.startsWith("1.sql: ") && LATER.test(p)), JSON.stringify(files));
  const body = `create function private.f() returns void language plpgsql as $$ begin alter table public.permissions add column c public.r; end $$;`;
  rejects(`${body} create type public.r as enum ('a');`, LATER);
  passes(`create type public.r as enum ('a'); ${body}`);
  assert.deepEqual(checkFiles([{ name: "1.sql", sql: "create type public.r as enum ('a');" }, { name: "2.sql", sql: body }]), []);
});

test("V1-9 / rule 9: what the guard on main rejected is still rejected, text PostgreSQL never runs included", () => {
  for (const sql of [
    // The two text-only differences verification round 1 found.
    `insert into public.call_types (label_he) values ('is_test');`,
    `select 'insert into call_types (x) values (''seed'')';`,
    // Further text main read as code: a quoted identifier, a nested comment, COPY after ";" in a string.
    `create table public."insert into customers" (id int);`,
    `/* a /* b */ insert into public.visits (id) values (1); */ select 1;`,
    `comment on table public.a is 'x; copy public.a from stdin';`,
    // A string in a body that is not a reviewed writer's (its text is read as main read it).
    `create function private.f() returns text language sql as $$ select 'insert into call_types (x) values (''seed'')' $$;`,
    // A writer defined inside a DO block is not a top-level reviewed definition: main's reading applies.
    `do $d$ begin create function private.write_audit(a text, b text, c uuid, d jsonb) returns bigint language sql as $w$
      insert into public.audit_logs (action) values (a) returning 1 $w$; end $d$;`,
  ]) {
    rejects(sql, MAIN_RULE);
  }
  // The inputs of main's own tests keep main's result (pass or fail).
  passes(`create table public.customers (id uuid primary key, data_source text not null check (data_source in ('simulator', 'automated_test')));`);
  passes(`insert into public.call_types (label_he) values ('תיקון'), ('התקנה');`);
  passes(`-- insert into customers values (1);\n/* insert into visits values (2); */ select 1;`);
  for (const sql of [
    `insert into public.customers (customer_number, name) values ('10001', 'x');`,
    `INSERT INTO "visits" (id) values ('a');`,
    `insert into service_calls (id) values ('a');`,
    `insert into followup_reasons (label_he, is_test) values ('x', true);`,
    `insert into role_permissions (role) values ('manager'); -- ok\n insert into permissions (key, label_he) values ('k', 'user@example.test');`,
    `insert into call_types (label_he, data_source) values ('x', 'simulator');`,
    `copy public.customers from '/tmp/x.csv';`,
  ]) {
    assert.ok(checkSql(sql).length > 0, sql);
  }
  // Only the reviewed writer bodies are left out of main's reading: the repository passes (its
  // writers insert into business tables), and the same INSERT in another body fails.
  assert.deepEqual(checkRepository(repositoryRoot), []);
  const body = `returns bigint language sql as $$ insert into public.audit_logs (action) values (p_action) returning 1 $$;`;
  passes(`create function private.write_audit(p_action text, p_target_table text, p_target_id uuid, p_details jsonb) ${body}`);
  rejects(`create function private.write_audit(p_action text, p_target_table text, p_target_id uuid) ${body}`, /INSERT into "audit_logs" is not allowed/);
});

// ------------------------------------------------------------------------------------------------
// Fix round 3: the inputs of verification round 2 (V2-1 ... V2-9). Each test fails when its fix is
// removed from the guard.
// ------------------------------------------------------------------------------------------------
const WRITER_W = `create function private.w() returns integer language plpgsql set search_path = '' as $$
  begin update public.permissions set label_he = 'Fake label'; return 1; end $$;`;

test("V2-1 (fix round 3): client_encoding may not be named, in any form", () => {
  // J2: with client_encoding SJIS, PostgreSQL ends e'Á\' at the second quote (0x81 0x5C is one
  // character) and calls private.w(); the guard read one string.
  const j2 = String.raw`${WRITER_W}
    set client_encoding = 'SJIS';
    select e'Á\', private.w() --'
    ;
    reset client_encoding;`;
  rejects(j2, /client_encoding may not be named in migrations/);
  const NAMED = /client_encoding may not be named in migrations/i;
  for (const sql of [
    `set client_encoding = 'SJIS';`,
    `set local client_encoding to 'SJIS';`,
    `set "client_encoding" = 'SJIS';`,
    `SET "CLIENT_ENCODING" TO 'BIG5';`,
    `reset client_encoding;`,
    `alter role postgres set client_encoding = 'SJIS';`,
    `alter database postgres set client_encoding to 'GBK';`,
    `create function private.f() returns int language sql set client_encoding = 'SJIS' as $$ select 1 $$;`,
    `create function private.f() returns int language plpgsql as $$ begin set local client_encoding = 'SJIS'; return 1; end $$;`,
  ]) {
    rejects(sql, NAMED);
  }
  // In a string too (as the other denied settings).
  rejects(`select current_setting('client_encoding');`, /standard_conforming_strings, backslash_quote, session_replication_role and client_encoding may not be named/);
});

test("V2-1 (fix round 3): SET [LOCAL | SESSION] NAMES fails, also in a function's or a role's SET clause", () => {
  const NAMES = /SET NAMES is not allowed in migrations/;
  // J5: SET NAMES 'SJIS' made PostgreSQL run the UPDATE in the CTE that the guard read as a string.
  rejects(String.raw`set names 'SJIS';
    with a as (select e'Á\' as x), b as (update public.permissions set label_he = chr(70)||chr(97)||chr(107)||chr(101) returning 1) select count(*) from b --')
    ;`, NAMES);
  for (const sql of [
    `set names 'SJIS';`,
    `SET NAMES 'SJIS';`,
    `set local names 'BIG5';`,
    `set session names 'GBK';`,
    `set names default;`,
    `set "names" 'SJIS';`,
    `create function private.f() returns int language sql set names 'SJIS' as $$ select 1 $$;`,
    `alter function private.f() set names 'SJIS';`,
    `alter role postgres set names 'SJIS';`,
    `do $$ begin set local names 'SJIS'; end $$;`,
  ]) {
    rejects(sql, NAMES);
  }
  passes(`alter table public.permissions alter column label_he set not null;`);
});

test("V2-1 (fix round 3): a non-ASCII character in an E'' string fails; plain strings keep Hebrew", () => {
  const ESTRING = /a non-ASCII character in an E'' string is not allowed in migrations/;
  rejects(String.raw`select e'Á\' as x;`, ESTRING);
  rejects(`comment on table public.permissions is e'שירות';`, ESTRING);
  rejects(`comment on table public.permissions is E'a\\nb ×';`, ESTRING);
  rejects(`create function private.f() returns text language sql as $$ select e'é' $$;`, ESTRING);
  passes(`comment on table public.permissions is 'שירות'; comment on table public.role_permissions is e'a\\nb';`);
  passes(`insert into public.call_types (label_he) values ('תיקון');`);
});

test("V2-2 (fix round 3): a writer with a quoted mixed-case name is a writer (select, call, perform, default, trigger)", () => {
  const CALLS = /the migration calls (\w+)\(\), a function that writes data/;
  const wf = `create function private."Wf"() returns int language plpgsql set search_path = '' as $$
    begin update public.permissions set label_he = 'Fake label'; return 1; end $$;`;
  // A1c, A1f, A1b
  rejects(`${wf} select private."Wf"();`, CALLS);
  rejects(`${wf} do $$ begin perform private."Wf"(); end $$;`, CALLS);
  rejects(`${wf} create table public.call_types (id integer primary key, label_he text not null, n int default private."Wf"(),
    is_test boolean not null default false); insert into public.call_types (id, label_he) values (1, 'Service');`, CALLS);
  // A1g: a procedure
  rejects(`create procedure private."P"() language plpgsql set search_path = '' as $$ begin update public.permissions set label_he = 'Fake label'; end $$;
    call private."P"();`, CALLS);
  // A1: an AFTER INSERT trigger runs the writer for each reference row
  rejects(`create table public.call_types (id integer primary key, label_he text not null, is_test boolean not null default false);
    create function private."Fake"() returns trigger language plpgsql set search_path = '' as $$
      begin update public.permissions set label_he = 'Fake label'; return null; end $$;
    create trigger t50_fake after insert on public.call_types for each row execute function private."Fake"();
    insert into public.call_types (id, label_he) values (1, 'Service');`, CALLS);
  // Through a wrapper (the writer closure compares lower-cased too), and the other way round.
  rejects(`${wf} create function private.g() returns int language sql as $$ select private."Wf"() $$; select private.g();`, /the migration calls g\(\)/);
  rejects(`create function private."WG"() returns int language sql as $$ select private."Wf"() $$; ${wf} select private."WG"();`, /the migration calls wg\(\)/);
  rejects(`${WRITER_W} select private."W"();`, /the migration calls w\(\)/);
  // A writer listed in ALLOWED_WRITERS, called with a quoted upper-case name; and an entry whose
  // own name is mixed case is compared lower-cased too.
  rejects(`select private."WRITE_AUDIT"('a', 'b', null, null);`, /the migration calls write_audit\(\)/);
  rejects(`select private."Writer"('a');`, /the migration calls writer\(\)/, writer("private.Writer(text)", ["public.audit_logs"]));
});

test("V2-3 (fix round 3): a function named in a string option of CREATE/ALTER AGGREGATE, OPERATOR, TYPE or TEXT SEARCH fails", () => {
  const OPTION = /a string value for the option (\w+) of CREATE\/ALTER AGGREGATE, OPERATOR, TYPE or TEXT SEARCH is not allowed/;
  const w2 = `create function public.w(s integer, v integer) returns integer language plpgsql set search_path = '' as $$
    begin update public.permissions set label_he = 'Fake label'; return coalesce(s, 0) + v; end $$;`;
  // H1, H2: sfunc = 'w' and function = 'w' ran w (the guard saw no name).
  rejects(`${w2} create aggregate public.agg(integer) (sfunc = 'w', stype = integer); select public.agg(1);`, OPTION);
  rejects(`${w2} create operator public.#%# (function = 'w', leftarg = integer, rightarg = integer); select 1 operator(public.#%#) 2;`, OPTION);
  for (const sql of [
    `create aggregate public.a(int) (sfunc = int4pl, stype = int, finalfunc = 'w');`,
    `create aggregate public.a(int) (sfunc = int4pl, stype = int, combinefunc = 'public.w');`,
    `create aggregate public.a (basetype = int, sfunc = 'w', stype = int);`,
    `CREATE AGGREGATE public.a(int) (SFUNC = 'W', STYPE = int);`,
    `create aggregate public.a(int) ("sfunc" = 'w', stype = int);`,
    `create aggregate public.a(int) (sfunc = int4pl, stype = int, msfunc = int4pl, minvfunc = 'w', mstype = int);`,
    `create operator public.### (procedure = 'w', leftarg = int, rightarg = int);`,
    `create operator public.### (function = int4pl, leftarg = int, rightarg = int, restrict = 'w');`,
    `alter operator public.###(int, int) set (restrict = 'w');`,
    `create type public.t (input = 'w', output = int4out);`,
    `alter type public.t set (receive = 'w');`,
    `create type public.r as range (subtype = int4, subtype_diff = 'w');`,
    `create text search parser public.p (start = 'w', gettoken = prsd_nexttoken, end = prsd_end, lextypes = prsd_lextype);`,
    `create text search template public.t (lexize = 'w');`,
    `do $$ begin create aggregate public.a(int) (sfunc = 'w', stype = int); end $$;`,
    // A key that may take a string takes only a plain '...' string.
    `create aggregate public.a(int) (sfunc = int4pl, stype = int, initcond = e'0');`,
  ]) {
    rejects(sql, OPTION);
  }
  passes(`create aggregate public.a(int) (sfunc = int4pl, stype = int, initcond = '0');
    create type public.k as enum ('screen', 'data');`);
});

test("V2-4 (fix round 3): ADD exclude <type> adds a column named exclude, not a constraint", () => {
  // A2, K2, A2b-e: each filled every existing row through a column named exclude.
  for (const sql of [
    `alter table public.permissions add exclude text not null default 'Fake note';`,
    `ALTER TABLE public.permissions ADD EXCLUDE TEXT NOT NULL DEFAULT 'Fake note';`,
    `alter table public.permissions add exclude information_schema.time_stamp;`,
    `alter table public.permissions add exclude int generated always as identity;`,
    `alter table public.permissions add exclude bigserial;`,
    `alter table public.permissions add exclude text generated always as ('Fake ' || label_he) stored;`,
    `alter table public.permissions add column if not exists x int, add exclude int default 1;`,
  ]) {
    rejects(sql, EXISTING_REWRITE);
  }
  // A3: a reference table's column named exclude must have a built-in type too.
  rejects(`create table public.call_types (id integer primary key, label_he text not null, exclude information_schema.time_stamp,
    is_test boolean not null default false); insert into public.call_types (id, label_he) values (1, 'x');`,
  /a column of reference table call_types has type information_schema\.time_stamp/);
  // EXCLUDE USING / EXCLUDE ( is still a constraint.
  passes(`alter table public.permissions add exclude using btree (key with =);
    alter table public.permissions add exclude (key with =);
    create table public.call_types (id integer primary key, label_he text not null, exclude using btree (label_he with =));`);
});

test("V2-5 (fix round 3): MERGE ... THEN INSERT in a function body is an INSERT into the MERGE target", () => {
  const MERGE_INSERT = /INSERT \(a MERGE \.\.\. THEN INSERT action\) into "(\w+)" is not allowed/;
  // H4: a reviewed writer pinned to audit_logs inserted into technicians through MERGE.
  rejects(`create or replace function private.write_audit(p_action text, p_target text, p_target_id uuid, p_details jsonb)
    returns void language plpgsql set search_path = '' as $$
    begin
      merge into public.technicians t using (select p_target_id as id) src on t.profile_id = src.id
        when not matched then insert (profile_id) values (p_target_id);
    end $$;`, MERGE_INSERT);
  // H3: any other function (here run through an aggregate) may not insert through MERGE either.
  rejects(`create function public.w(s integer, v integer) returns integer language plpgsql set search_path = '' as $$
    begin
      merge into public.customers c using (select 1 as id) src on c.id = src.id
        when not matched then insert (id, name, is_test) values (1, 'Fake Customer Ltd', true);
      return coalesce(s, 0) + v;
    end $$;`, MERGE_INSERT);
  for (const action of ["insert default values", "insert values (p_target_id)", "INSERT (profile_id) OVERRIDING SYSTEM VALUE VALUES (p_target_id)"]) {
    rejects(`create function private.write_audit(p_action text, p_target text, p_target_id uuid, p_details jsonb)
      returns void language plpgsql set search_path = '' as $$ begin
      MERGE INTO ONLY public.technicians t USING (select 1) s ON false WHEN NOT MATCHED BY TARGET THEN ${action}; end $$;`, MERGE_INSERT);
  }
  // Into its pinned table it is allowed, as a plain INSERT is (also MERGE INTO ONLY).
  passes(`create function private.write_audit(p_action text, p_target text, p_target_id uuid, p_details jsonb)
    returns void language plpgsql set search_path = '' as $$ begin
      merge into public.audit_logs a using (select 1) s on false when not matched then insert (action) values (p_action);
      merge into only public.audit_logs a using (select 1) s on false when not matched then insert default values; end $$;`);
  // In a statement that runs, MERGE fails as before, and its INSERT action too.
  rejects(`merge into public.call_types c using (select 1) s on false when not matched then insert (label_he) values ('x');`,
    /MERGE \.\.\. THEN INSERT is not allowed in migrations/);
});

test("V2-6 (fix round 3): pgTAP and extension functions that run SQL text fail as any name", () => {
  const RUNS = /\(\) is not allowed in migrations \(pgTAP or extension function that runs SQL text given as an argument\)/;
  // B1: lives_ok ran the UPDATE in its text. ts_stat('select private.w()') ran a writer on the local
  // database (rolled back).
  rejects(`select no_plan(); select lives_ok('update public.permissions set label_he = ''Fake label''');`, RUNS);
  for (const name of ["lives_ok", "throws_ok", "throws_like", "throws_ilike", "throws_matching", "throws_imatching", "dies_ok",
    "results_eq", "results_ne", "set_eq", "set_ne", "set_has", "set_hasnt", "bag_eq", "bag_ne", "bag_has", "bag_hasnt", "is_empty",
    "isnt_empty", "row_eq", "performs_ok", "performs_within", "runtests", "do_tap", "cmp_ok", "_def_is", "_time_trials", "_runner",
    "_runem", "_query", "_temptable",
    "xpath_table", "crosstab", "crosstab2", "connectby", "ts_stat", "ts_rewrite"]) {
    rejects(`select ${name}('update public.permissions set label_he = ''x''');`, RUNS);
  }
  rejects(`select extensions."results_eq"('select 1', 'select 1');`, RUNS);
  rejects(`create function private.f() returns setof text language sql as $$ select * from extensions.runtests() $$;`, RUNS);
  rejects(`create operator public.### (function = lives_ok, leftarg = text, rightarg = text);`, RUNS);
});

test("V2-8 (fix round 3): ALTER TABLE ... OF and ALTER TYPE ... ADD ATTRIBUTE fail (they fill a typed table's rows)", () => {
  // G1: the typed table's existing rows got now() from the attribute's domain.
  const g1 = `create type public.permissions_shape as (key text, label_he text, enforcement text, sort_order smallint);
    alter table public.permissions of public.permissions_shape;
    alter type public.permissions_shape add attribute changed_at information_schema.time_stamp cascade;`;
  rejects(g1, /ALTER TABLE \.\.\. OF <type> \(a typed table\) is not allowed/);
  rejects(g1, /ALTER TYPE \.\.\. ADD ATTRIBUTE is not allowed/);
  rejects(`alter table public.permissions of public.s;`, /ALTER TABLE \.\.\. OF <type>/);
  rejects(`alter table if exists only public.permissions owner to postgres, of public.s;`, /ALTER TABLE \.\.\. OF <type>/);
  rejects(`alter type public.s add attribute c text;`, /ALTER TYPE \.\.\. ADD ATTRIBUTE is not allowed/);
  passes(`alter table public.permissions not of;`);
});

test("V2-9 (fix round 3): a reference INSERT is allowed only as a top-level statement, never in a DO block", () => {
  const TOP = /INSERT into "role_permissions" is allowed only as a top-level statement of the file, not inside a DO block/;
  // I1: an IF decided whether the reference row was inserted.
  rejects(`do $$
    begin
      if exists (select 1 from public.profiles) then
        perform 1;
        insert into public.role_permissions (role, permission_key, allowed, value_status) values ('manager', 'usage', false, 'temporary');
      end if;
    end
    $$;`, TOP);
  rejects(`do $$ begin perform 1; insert into public.role_permissions (role, permission_key, allowed, value_status) values ('manager', 'usage', false, 'temporary'); end $$;`, TOP);
  passes(`insert into public.role_permissions (role, permission_key, allowed, value_status) values ('manager', 'usage', false, 'temporary');`);
});

// PR 1.6 (Migration 4): four writers (owner acceptance needed, PR 1.6 approval item A1): the two
// helpers of the Step 4 and Step 6 writers and the two SECURITY DEFINER writers. offline_operation_replay
// only reads and locks, so it is no writer and needs no entry.
const PR16_WRITERS = [
  "private.create_review_item(text,text,uuid,uuid,text,text,uuid,jsonb,jsonb,jsonb)",
  "private.record_offline_operation(uuid,uuid,text,text,integer,timestamptz,text,integer,text,integer,uuid)",
  "private.correct_visit(uuid,text,text,text,integer)",
  "private.resolve_review_item(uuid,integer,text,jsonb,text)",
];
const pr15Writers = new Map([...ALLOWED_WRITERS].filter(([signature]) => !PR16_WRITERS.includes(signature)));
const migration16 = readFileSync(join(repositoryRoot, "supabase", "migrations", "20261107120000_integrity_offline.sql"), "utf8");
const migrations16 = (sql16 = migration16) => [...migrations15(), { name: "d.sql", sql: sql16 }];

test("PR 1.6: the migration passes after PR 1.3 to PR 1.5; without the four PR 1.6 entries it fails exactly at those writers", () => {
  assert.deepEqual(checkFiles(migrations16()), []);
  const NOT_ALLOWED = "is not allowed (only the reviewed writer functions in ALLOWED_WRITERS, pinned to their signature and tables, may insert)";
  assert.deepEqual(checkFiles(migrations16(), { allowedWriters: pr15Writers }).sort(), [
    `d.sql: function private.correct_visit: INSERT into "visit_corrections" ${NOT_ALLOWED}`,
    `d.sql: function private.correct_visit: INSERT into "visit_time_reports" ${NOT_ALLOWED}`,
    `d.sql: function private.create_review_item: INSERT into "review_items" ${NOT_ALLOWED}`,
    `d.sql: function private.record_offline_operation: INSERT into "offline_operations" ${NOT_ALLOWED}`,
    `d.sql: function private.resolve_review_item: INSERT into "visit_time_reports" ${NOT_ALLOWED}`,
  ]);
});

test("PR 1.6: each new entry inserts only with its exact signature and only into its own tables", () => {
  const body = (table) => `language plpgsql security definer as $$ begin insert into public.${table} (id) values (null); end $$;`;
  const correct = "p_visit_id uuid, p_field text, p_new_value text, p_reason text, p_expected_version integer";
  const resolve = "p_review_item_id uuid, p_expected_version integer, p_decision text, p_field_choices jsonb, p_note text";
  const create = "p_review_type text, p_dedupe_key text, p_service_call_id uuid, p_visit_id uuid, p_source text, p_source_ref text, " +
    "p_operation_id uuid, p_submitted_version jsonb, p_current_version jsonb, p_base_version jsonb";
  const record = "p_operation_id uuid, p_visit_id uuid, p_op_type text, p_payload_sha256 text, p_expected_field_version integer, " +
    "p_device_sent_at timestamptz, p_device_tz text, p_device_utc_offset_min integer, p_result text, p_resulting_field_version integer, " +
    "p_review_item_id uuid";
  passes(`create function private.correct_visit(${correct}) returns void ${body("visit_corrections")}`);
  passes(`create function private.correct_visit(${correct}) returns void ${body("visit_time_reports")}`);
  passes(`create function private.resolve_review_item(${resolve}) returns integer ${body("visit_time_reports")}`);
  passes(`create function private.create_review_item(${create}) returns uuid ${body("review_items")}`);
  passes(`create function private.record_offline_operation(${record}) returns void ${body("offline_operations")}`);
  for (const definition of [
    // Another table than the ones listed for it.
    `create function private.correct_visit(${correct}) returns void ${body("visit_reports")}`,
    `create function private.correct_visit(${correct}) returns void ${body("entity_changes")}`,
    `create function private.resolve_review_item(${resolve}) returns integer ${body("visit_corrections")}`,
    `create function private.resolve_review_item(${resolve}) returns integer ${body("visit_signatures")}`,
    `create function private.create_review_item(${create}) returns uuid ${body("offline_operations")}`,
    `create function private.record_offline_operation(${record}) returns void ${body("review_items")}`,
    // Another signature, schema or name.
    `create function private.correct_visit(${correct}, p_actor uuid) returns void ${body("visit_corrections")}`,
    `create function private.create_review_item(${create}, p_submitted_by uuid) returns uuid ${body("review_items")}`,
    `create function private.record_offline_operation(${record}, p_actor uuid) returns void ${body("offline_operations")}`,
    `create function public.resolve_review_item(${resolve}) returns integer ${body("visit_time_reports")}`,
    `create function private.offline_operation_replay(p_operation_id uuid, p_visit_id uuid, p_op_type text, p_payload_sha256 text) returns void ${body("offline_operations")}`,
  ]) {
    rejects(definition, /INSERT into "(visit_corrections|visit_time_reports|visit_reports|entity_changes|visit_signatures|offline_operations|review_items)" is not allowed/);
  }
});

test("PR 1.6: no statement that runs names a PR 1.6 writer, and no trigger function of the migration names one", () => {
  for (const statement of [
    `select private.create_review_item('sku_change', 'k', null, null, 'invitation', 'e', null, '{}', '{}', null);`,
    `select private.record_offline_operation(null, null, 'close', null, 1, now(), 'UTC', 0, 'applied', 1, null);`,
    `create trigger t50_review after insert on public.visit_time_reports for each row execute function private.create_review_item();`,
    `create policy review_items_x on public.review_items for select to authenticated using (private.resolve_review_item(review_items.id, 1, 'keep_current', null, null) > 0);`,
    `do $$ begin perform public.correct_visit(null, 'summary', 'x', 'y', 1); end $$;`,
  ]) {
    const problems = checkFiles(migrations16(`${migration16}\n${statement}\n`));
    assert.ok(problems.some((p) => /d\.sql: the migration calls (create_review_item|record_offline_operation|resolve_review_item|correct_visit)\(\)/.test(p)),
      `${statement}: ${JSON.stringify(problems)}`);
  }
  // GRANT, REVOKE and COMMENT may name them.
  assert.deepEqual(checkFiles(migrations16(`${migration16}
    revoke all on function private.create_review_item(text, text, uuid, uuid, text, text, uuid, jsonb, jsonb, jsonb) from public;
    comment on function private.correct_visit(uuid, text, text, text, integer) is 'x';
  `)), []);
  // The migration's own text: the trigger functions and the read-and-lock helper name no writer
  // (comments included), so attaching them never attaches a writer.
  const bodies = [...migration16.matchAll(/create (?:or replace )?function (\w+\.\w+)\(([\s\S]*?)\nas \$\$([\s\S]*?)\$\$;/g)];
  const names = bodies.map(([, name]) => name).sort();
  for (const expected of ["private.tg_call_child_marker", "private.tg_review_item_state", "private.tg_visit_correction_guard",
    "private.tg_offline_operation_derive", "private.tg_visit_field_version", "private.tg_time_report_derive",
    "private.tg_audit_target", "private.offline_operation_replay"]) {
    assert.ok(names.includes(expected), `${expected} is defined in the migration`);
  }
  for (const [, name, , text] of bodies) {
    if (!/^private\.(tg_|offline_operation_replay)/.test(name)) continue;
    assert.doesNotMatch(text, /create_review_item|record_offline_operation|correct_visit|resolve_review_item|write_audit|write_entity_change|recalc_call_status/, name);
  }
});

// PR 1.8 (Migration 5): no ALLOWED_WRITERS change. The migration replaces four listed writers with
// the same signatures (authorize_account_creation and admin_create_profile, D60 (7); add_call_type
// and add_followup_reason, D60 (8)); its new writer admin_delete_user and the replaced
// admin_set_user_active, assert_can_change_credentials and set/delete bodies only update or call
// write_audit, which needs no entry.
const migration18 = readFileSync(join(repositoryRoot, "supabase", "migrations", "20261108120000_accounts_permissions.sql"), "utf8");
const migrations18 = (sql18 = migration18) => [...migrations16(), { name: "e.sql", sql: sql18 }];
const PR18_REPLACED_WRITERS = [
  "private.authorize_account_creation(text,text,text)",
  "private.admin_create_profile(uuid,text,text,text,text,uuid)",
  "private.add_call_type(text)",
  "private.add_followup_reason(text)",
];

test("PR 1.8: the migration passes after PR 1.3 to PR 1.6 with ALLOWED_WRITERS unchanged; without an entry each replaced writer fails", () => {
  assert.deepEqual(checkFiles(migrations18()), []);
  const NOT_ALLOWED = "is not allowed (only the reviewed writer functions in ALLOWED_WRITERS, pinned to their signature and tables, may insert)";
  for (const signature of PR18_REPLACED_WRITERS) {
    const without = new Map([...ALLOWED_WRITERS].filter(([entry]) => entry !== signature));
    const problems = checkFiles([{ name: "e.sql", sql: migration18 }], { allowedWriters: without });
    const name = signature.slice(0, signature.indexOf("("));
    assert.ok(problems.some((p) => p.startsWith(`e.sql: function ${name}: INSERT into `) && p.endsWith(NOT_ALLOWED)),
      `${signature}: ${JSON.stringify(problems)}`);
  }
  // The migration inserts reference rows only into permissions and role_permissions, at top level.
  const inserts = [...migration18.matchAll(/^insert into (public\.\w+)/gm)].map(([, table]) => table);
  assert.deepEqual(inserts, ["public.permissions", "public.role_permissions"]);
});

test("PR 1.8: no statement that runs names a PR 1.8 writer, and the new trigger functions name none", () => {
  for (const statement of [
    `select private.admin_delete_user('00000000-0000-4000-8000-000000000001', 1, null);`,
    `do $$ begin perform public.admin_delete_user(null, 1, null); end $$;`,
    `create trigger t50_delete after update on public.profiles for each row execute function private.admin_delete_user();`,
    `select private.authorize_account_creation('technician', 'x@example.test', 'x');`,
  ]) {
    const problems = checkFiles(migrations18(`${migration18}\n${statement}\n`));
    assert.ok(problems.some((p) => /e\.sql: the migration calls (admin_delete_user|authorize_account_creation)\(\)/.test(p)),
      `${statement}: ${JSON.stringify(problems)}`);
  }
  assert.deepEqual(checkFiles(migrations18(`${migration18}
    revoke all on function private.admin_delete_user(uuid, integer, text) from public;
    comment on function public.admin_delete_user(uuid, integer, text) is 'x';
  `)), []);
  const bodies = [...migration18.matchAll(/create (?:or replace )?function (\w+\.\w+)\(([\s\S]*?)\nas \$\$([\s\S]*?)\$\$;/g)];
  const names = bodies.map(([, name]) => name).sort();
  for (const expected of ["private.tg_profile_deleted_guard", "private.tg_technician_deleted_guard", "private.tg_account_requests_retired",
    "private.has_permission"]) {
    assert.ok(names.includes(expected), `${expected} is defined in the migration`);
  }
  for (const [, name, , text] of bodies) {
    if (!/^private\.(tg_|has_permission$)/.test(name)) continue;
    assert.doesNotMatch(text, /admin_delete_user|write_audit|authorize_account_creation|admin_create_profile|request_account_change|decide_account_request|\binsert\b|\bupdate\s+public\b|\bdelete\b/, name);
  }
});

test("PR 1.8: the five Settings bodies differ from Migration 2 only in the key they check", () => {
  const migration14Text = migration14;
  for (const [name, key] of [["add_call_type", "callTypes"], ["set_call_type_active", "callTypes"], ["add_followup_reason", "reasons"],
    ["set_followup_reason_active", "reasons"], ["delete_followup_reason", "reasons"]]) {
    const original = migration14Text.match(new RegExp(`\\ncreate function private\\.${name}\\([\\s\\S]*?\\n\\$\\$;\\n`))[0];
    const replaced = migration18.match(new RegExp(`\\ncreate or replace function private\\.${name}\\([\\s\\S]*?\\n\\$\\$;\\n`))[0];
    assert.equal(
      replaced,
      original.replace("\ncreate function ", "\ncreate or replace function ")
        .replace("private.has_permission('settings')", `private.has_permission('${key}')`),
      name);
  }
});

// Step 6 (Migration 6, proposed): the ingestion writer is the one reviewed writer that may hold the
// data_source value 'simulator' as an exact string (ALLOWED_WRITERS markers); any other marker text
// in its body, and the same string in any other writer, still fails.
test("Step 6: only the exact 'simulator' string is exempt, only in the ingestion writer", () => {
  const writer = (name, value) =>
    `create function private.${name}(p_command jsonb) returns jsonb language plpgsql set search_path = pg_catalog, pg_temp as $$ declare v constant text := ${value}; begin insert into public.customers (data_source) values (v); return null; end $$;`;
  assert.deepEqual(checkSql(writer("ingest_calendar_event", "'simulator'")), []);
  for (const value of ["'simulator data'", "'automated_test'", "'x@example.test'"]) {
    assert.ok(checkSql(writer("ingest_calendar_event", value)).some((p) => /test marker/.test(p)), value);
  }
  // Another allowed writer, with its exact pinned signature and its own table: the same string is a
  // test marker there (and only the marker fails: without it the same body passes).
  const audit = (value) =>
    `create function private.write_audit(p_action text, p_target_table text, p_target_id uuid, p_details jsonb) returns bigint language plpgsql set search_path = pg_catalog, pg_temp as $$ declare v constant text := ${value}; begin insert into public.audit_logs (action) values (v); return null; end $$;`;
  assert.deepEqual(checkSql(audit("'x'")), []);
  const problems = checkSql(audit("'simulator'"));
  assert.equal(problems.length, 1, JSON.stringify(problems));
  assert.match(problems[0], /test marker/);
});

// Step 4 (Migration 7, proposed): the four field writers may insert only into their pinned tables;
// the same body under another signature, or inserting into another table, still fails; the
// update-only confirm_visit_media needs no entry.
test("Step 4: the field writers are pinned to their signature and tables", () => {
  const body = (name, args, table) =>
    `create function private.${name}(${args}) returns void language plpgsql set search_path = pg_catalog, pg_temp as $$ begin insert into ${table} (visit_id) values (null); end $$;`;
  const depart = "p_visit_id uuid, p_operation_id uuid, p_expected_field_version integer, p_reported_at timestamptz, p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz";
  assert.deepEqual(checkSql(body("depart_visit", depart, "public.visit_events")), []);
  assert.deepEqual(checkSql(body("depart_visit", depart, "public.visit_time_reports")), []);
  assert.ok(checkSql(body("depart_visit", depart, "public.visit_reports")).some((p) => /INSERT into "visit_reports" is not allowed/.test(p)));
  assert.ok(checkSql(body("depart_visit", `${depart}, p_extra text`, "public.visit_events")).some((p) => /is not allowed/.test(p)));
  const media = "p_visit_id uuid, p_operation_id uuid, p_kind text, p_phase text, p_mime_type text, p_size_bytes integer, p_captured_at timestamptz, p_device_tz text, p_device_utc_offset_min integer, p_device_sent_at timestamptz";
  assert.deepEqual(checkSql(body("add_visit_media", media, "public.visit_media")), []);
  assert.ok(checkSql(body("add_visit_media", media, "public.visit_signatures")).some((p) => /is not allowed/.test(p)));
  // A test marker in a field writer still fails (no marker exception for them).
  const marked = `create function private.add_visit_media(${media}) returns void language plpgsql set search_path = pg_catalog, pg_temp as $$ begin insert into public.visit_media (storage_path) values ('simulator'); end $$;`;
  assert.ok(checkSql(marked).some((p) => /test marker/.test(p)));
});
