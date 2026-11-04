// Tests for scripts/check-migrations.mjs (D47: no test or fictitious data in migrations; D49).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { ALLOWED_WRITERS, checkFiles, checkRepository, checkSql, lexSql } from "../../scripts/check-migrations.mjs";

const repositoryRoot = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");

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
  assert.equal(checkSql(`insert into followup_reasons (label_he, is_test) values ('x', true);`).length, 1);
  assert.equal(checkSql(`insert into role_permissions (role) values ('manager'); -- ok
    insert into permissions (key, label_he) values ('k', 'user@example.test');`).length, 1);
  assert.equal(checkSql(`insert into call_types (label_he, data_source) values ('x', 'simulator');`).length, 1);
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

test("the repository's migrations pass", () => {
  assert.deepEqual(checkRepository(repositoryRoot), []);
});

test("an INSERT inside the body of a reviewed writer function (ALLOWED_WRITERS) passes", () => {
  const sql = `
    create function private.write_audit(p_action text) returns void language plpgsql as $$
    begin
      insert into public.audit_logs (action) values (p_action); -- a ";" inside the body
    end
    $$;
    grant execute on function private.write_audit(text) to authenticated;`;
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
  assert.deepEqual(checkSql(`insert into public.call_types (label_he) values (E'it\\'s; fine');`), []);
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
  const options = { allowedWriters: new Set(["private.add_customer"]) };
  const writer = `create function private.add_customer() returns void language sql as $$ insert into public.customers (id) values (1) $$;`;
  const wrapper = `create function public.add_customer_api() returns void language sql as $$ select private.add_customer() $$;`;
  assert.equal(checkSql(`${writer} select private.add_customer();`, "m.sql", options).length, 1);
  assert.equal(checkSql(`${writer} ${wrapper} select public.add_customer_api();`, "m.sql", options).length, 1);
  assert.equal(checkSql(`${writer} do $x$ begin perform private.add_customer(); end $x$;`, "m.sql", options).length, 1);
  assert.equal(
    checkSql(`${writer} create trigger t after insert on public.call_types for each row execute function private.add_customer();`, "m.sql", options).length,
    1,
  );
  assert.deepEqual(checkSql(`${writer} ${wrapper} revoke all on function private.add_customer() from public;
    grant execute on function public.add_customer_api() to authenticated;
    comment on function private.add_customer() is 'x';`, "m.sql", options), []);
});

test("a writer defined in an earlier migration cannot be called in a later one", () => {
  const problems = checkFiles([
    { name: "1.sql", sql: `create function w() returns void language sql as $$ insert into public.visits (id) values (1) $$;` },
    { name: "2.sql", sql: `select w();` },
  ], { allowedWriters: new Set(["w"]) });
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
  ]) {
    assert.ok(checkSql(`${definition}\n${forbidden}`).some((p) => /bootstrap_first_creator/.test(p)), forbidden);
  }
});

test("an unterminated dollar quote is reported", () => {
  assert.deepEqual(lexSql(`do $$ begin insert into customers values (1);`).errors, ["unterminated dollar-quoted string $$"]);
  assert.equal(checkSql(`do $$ begin select 1;`).length, 1);
});

// Fix pass (independent review S1/D1, S14) ----------------------------------------------------------

test("ALLOWED_WRITERS lists exactly the reviewed PR 1.3 writer functions", () => {
  assert.deepEqual([...ALLOWED_WRITERS].sort(), [
    "private.admin_create_profile",
    "private.admin_create_technician",
    "private.authorize_account_creation",
    "private.bootstrap_first_creator",
    "private.request_account_change",
    "private.write_audit",
  ]);
});

test("an INSERT into a business table inside any other function body fails, as before PR 1.3", () => {
  const problems = checkSql(`create function private.add_customer() returns void language sql as $$ insert into public.customers (id) values (1) $$;`);
  assert.equal(problems.length, 1);
  assert.match(problems[0], /function private\.add_customer: INSERT into "customers" is not allowed/);
  // The allowlist is by schema-qualified name: the same name in another schema or unqualified fails.
  assert.equal(checkSql(`create function public.write_audit() returns void language sql as $$ insert into public.audit_logs (id) values (1) $$;`).length, 1);
  assert.equal(checkSql(`create function write_audit() returns void language sql as $$ insert into public.audit_logs (id) values (1) $$;`).length, 1);
  // A test marker in a reference insert inside a body fails too.
  assert.equal(checkSql(`create function private.f() returns void language sql as $$ insert into public.call_types (label_he, is_test) values ('x', true) $$;`).length, 1);
});

test("a function body that is not dollar-quoted fails, and so does a later call of it (review S1/D1)", () => {
  const forms = {
    "single-quoted": `create function public.seed_it() returns void language sql as 'insert into public.brands (name) values (''X'')';`,
    "E-string": `create function public.seed_it() returns void language sql as E'insert into public.brands (name) values (\\'X\\')';`,
    "BEGIN ATOMIC": `create function public.seed_it() returns void language sql begin atomic insert into public.brands (name) values ('X'); end;`,
    "RETURN": `create function public.seed_it() returns bigint language sql return private.write_audit('a', 'b', null, '{}');`,
    "procedure, single-quoted": `create procedure public.seed_it() language sql as 'insert into public.brands (name) values (1)';`,
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

test("dynamic SQL (EXECUTE) in statements that run fails; GRANT EXECUTE and EXECUTE FUNCTION pass", () => {
  for (const sql of [
    `do $$ begin execute format('select %I.%I()', 'private', 'write_audit'); end $$;`,
    `do $$ begin execute 'insert into public.customers values (1)'; end $$;`,
    `prepare p as select 1; execute p;`,
  ]) {
    assert.ok(checkSql(sql).some((p) => /dynamic SQL \(EXECUTE\) is not allowed/.test(p)), sql);
  }
  assert.deepEqual(checkSql(`grant execute on function public.f() to authenticated;
    revoke execute on all functions in schema public from anon;
    alter default privileges for role postgres revoke execute on functions from public;
    create trigger t before update on public.x for each row execute function private.tg();
    create trigger t2 before update on public.x for each row execute procedure private.tg();`), []);
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
    assert.ok(checkSql(sql).some((p) => /is not allowed in migrations/.test(p)), sql);
  }
});

test("schema statements that only name UPDATE, DELETE, TRUNCATE or AS still pass", () => {
  assert.deepEqual(checkSql(`
    create table public.a (
      id bigint generated always as identity primary key,
      b uuid references public.b (id) on delete restrict on update restrict,
      n numeric(10, 2)
    );
    create trigger t99 before truncate on public.a for each statement execute function private.tg();
    create trigger t95 before update or delete on public.a for each row execute function private.tg();
    grant select, update, delete on public.a to authenticated;
    revoke truncate on public.a from anon;
    comment on table public.a is 'UPDATE, DELETE and TRUNCATE are rejected; delete from x is not run';
    create function private.f() returns void language plpgsql as $$
    begin
      perform 1 from public.a for update;
      update public.a set n = 1;
    end
    $$;
    do $$ begin if current_user <> 'postgres' then raise exception 'x'; end if; end $$;`), []);
});
