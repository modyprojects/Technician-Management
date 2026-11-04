// Tests for scripts/check-migrations.mjs (D47: no test or fictitious data in migrations; D49).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_EXTENSIONS, ALLOWED_WRITERS, checkFiles, checkRepository, checkSql, lexSql } from "../../scripts/check-migrations.mjs";

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

test("a semicolon inside a string or a quoted identifier does not split a statement", () => {
  // Split on every ";", the text after it would look like a COPY ... FROM statement.
  assert.deepEqual(checkSql(`insert into public.call_types (label_he) values ('a; copy b from c');`), []);
  assert.deepEqual(checkSql(`insert into public.call_types ("label;he") values ('x');`), []);
  assert.deepEqual(checkSql(`insert into public.call_types (label_he) values ('it''s; fine');`), []);
  // An E'' string is read correctly (its \\' does not end it) but is not a plain constant.
  rejects(`insert into public.call_types (label_he) values (E'it\\'s; fine');`, /plain constant VALUES/);
});

test("nested block comments and comments inside bodies are ignored", () => {
  assert.deepEqual(checkSql(`/* outer /* inner */ insert into customers values (1); */ select 1;`), []);
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

test("ALLOWED_WRITERS lists exactly the reviewed PR 1.3 writer functions, pinned to signature and tables", () => {
  assert.deepEqual(
    [...ALLOWED_WRITERS].map(([signature, { tables }]) => `${signature} -> ${tables.join(",")}`).sort(),
    [
      "private.admin_create_profile(uuid,text,text,text,text,uuid) -> public.profiles",
      "private.admin_create_technician(uuid,text,text,text,text,boolean) -> public.technicians",
      "private.authorize_account_creation(text,text,text) -> public.account_requests",
      "private.bootstrap_first_creator(uuid,text) -> public.profiles",
      "private.request_account_change(text,uuid,text,text,text) -> public.account_requests",
      "private.write_audit(text,text,uuid,jsonb) -> public.audit_logs",
    ],
  );
  assert.deepEqual([...ALLOWED_EXTENSIONS], []);
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
    alter table public.a rename column n to m;
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
  rejects(`${UPDATER("probe_w")} alter function private.probe_w() rename to probe_r; select private.probe_r();`, /RENAME TO is not allowed/);
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
  rejects(`${definition} alter function private.w(int, int) rename to harmless; select private.harmless(1, 2);`, /RENAME TO is not allowed/, options);
  rejects(`${definition} alter function private.w(int, int) set schema public;`, /SET SCHEMA is not allowed/, options);
  rejects(`${definition} alter routine private.w(int, int) rename to harmless;`, /RENAME TO is not allowed/, options);
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
  passes(trigger("if new.label_he = 'x' then raise exception 'x'; end if;"));
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

test("R-G4: the tokenizer reads dollar quotes, identifiers and strings exactly as PostgreSQL does", () => {
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
    [`alter table s.call_types rename to customers;`, /RENAME TO is not allowed/],
    [`alter table s.customers set schema public;`, /SET SCHEMA is not allowed/],
    [`alter schema s rename to t;`, /RENAME TO is not allowed/],
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
