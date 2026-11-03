// Tests for scripts/check-migrations.mjs (D47: no test or fictitious data in migrations).
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { checkRepository, checkSql } from "../../scripts/check-migrations.mjs";

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
