// The fail-closed hardening checks of Migration 2 (section 11; owner, 2026-11-11), Migration 3
// (section 12; owner, 2026-11-12), Migration 4 (section 12, a byte-identical copy of Migration 3
// section 12; PR 1.6) and Migration 5 (section 14, a byte-identical copy of Migration 4 section 12;
// PR 1.8) and Migration 6 (section 11, a byte-identical copy of Migration 5 section 14; Step 6).
// tests/db/140_hardening_assertion.test.sql runs a copy of the section 11 DO body against injected
// leaks; this test keeps that copy byte-identical, shows that section 11 keeps the PR 1.3
// section 15 privilege checks unchanged (it only adds checks), and that the check is the last
// statement of the migration (it runs after every write it checks).
import { test } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lexSql } from "../../scripts/check-migrations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const read = (path) => readFileSync(join(root, path), "utf8");

function doBody(text, header, file) {
  const at = text.indexOf(header);
  assert.notEqual(at, -1, `${file}: missing "${header}"`);
  const open = "\ndo $$\n";
  const start = text.indexOf(open, at);
  assert.notEqual(start, -1, `${file}: no DO block after "${header}"`);
  const stop = text.indexOf("\n$$;\n", start + open.length);
  assert.notEqual(stop, -1, `${file}: unterminated DO block`);
  return { body: text.slice(start + open.length, stop), end: stop + "\n$$;\n".length };
}

const m1File = "supabase/migrations/20261104120000_access_and_permissions.sql";
const m2File = "supabase/migrations/20261105120000_reference_customers_products.sql";
const testFile = "tests/db/140_hardening_assertion.test.sql";
const m3File = "supabase/migrations/20261106120000_service_calls_visits.sql";
const test3File = "tests/db/210_hardening_assertion_m3.test.sql";
const m1 = read(m1File);
const m2 = read(m2File);

test("tests/db/140 runs a byte-identical copy of the Migration 2 section 11 check", () => {
  const { body } = doBody(m2, "-- 11. Fail closed", m2File);
  const text = read(testFile);
  const open = "language plpgsql as $assert$\n";
  const start = text.indexOf(open);
  assert.notEqual(start, -1, `${testFile}: missing the copy`);
  const stop = text.indexOf("\n$assert$;\n", start + open.length);
  assert.notEqual(stop, -1, `${testFile}: unterminated copy`);
  assert.equal(text.slice(start + open.length, stop), body);
});

test("section 11 keeps the PR 1.3 section 15 privilege checks unchanged and only adds checks", () => {
  const { body: m1Body } = doBody(m1, "-- 15. Fail closed", m1File);
  const { body: m2Body } = doBody(m2, "-- 11. Fail closed", m2File);
  const split = "\n  ) x;\n";
  const [m1Head, m1Tail, ...m1Rest] = m1Body.split(split);
  const [m2Head, m2Tail, ...m2Rest] = m2Body.split(split);
  assert.deepEqual([m1Rest.length, m2Rest.length], [0, 0]);
  assert.ok(m2Head.startsWith(m1Head), "the section 15 union is a prefix of the section 11 union");
  assert.ok(m2Head.slice(m1Head.length).startsWith("\n    union all\n"), "section 11 adds branches with UNION ALL only");
  assert.equal(m2Tail, m1Tail, "the raise is unchanged");
});

test("the section 11 check is the last statement of Migration 2", () => {
  const { end } = doBody(m2, "-- 11. Fail closed", m2File);
  assert.equal(m2.slice(end), "");
});

const m3 = read(m3File);

test("tests/db/210 runs a byte-identical copy of the Migration 3 section 12 check", () => {
  const { body } = doBody(m3, "-- 12. Fail closed", m3File);
  const text = read(test3File);
  const open = "language plpgsql as $assert$\n";
  const start = text.indexOf(open);
  assert.notEqual(start, -1, `${test3File}: missing the copy`);
  const stop = text.indexOf("\n$assert$;\n", start + open.length);
  assert.notEqual(stop, -1, `${test3File}: unterminated copy`);
  assert.equal(text.slice(start + open.length, stop), body);
});

test("Migration 3 section 12 is Migration 2 section 11 with only the view rule changed", () => {
  const { body: m2Body } = doBody(m2, "-- 11. Fail closed", m2File);
  const { body: m3Body } = doBody(m3, "-- 12. Fail closed", m3File);
  const viewBranch = "    union all\n    select 'view ' || c.oid::regclass::text\n";
  const m2At = m2Body.indexOf(viewBranch);
  assert.notEqual(m2At, -1, "Migration 2: the view branch");
  const m2Tail = m2Body.slice(m2Body.indexOf("  ) x;\n", m2At));
  assert.ok(m3Body.startsWith(m2Body.slice(0, m2At)), "everything before the view branch is unchanged");
  assert.ok(m3Body.endsWith(m2Tail), "the raise is unchanged");
  const changed = m3Body.slice(m2At, m3Body.length - m2Tail.length);
  assert.match(changed, /relkind = 'v'/);
  assert.match(changed, /security_invoker/);
  assert.match(changed, /relkind = 'm'/);
});

test("the section 12 check is the last statement of Migration 3", () => {
  const { end } = doBody(m3, "-- 12. Fail closed", m3File);
  assert.equal(m3.slice(end), "");
});

const m4File = "supabase/migrations/20261107120000_integrity_offline.sql";
const test4File = "tests/db/220_hardening_assertion_m4.test.sql";
const m4 = read(m4File);

test("tests/db/220 runs a byte-identical copy of the Migration 4 section 12 check", () => {
  const { body } = doBody(m4, "-- 12. Fail closed", m4File);
  const text = read(test4File);
  const open = "language plpgsql as $assert$\n";
  const start = text.indexOf(open);
  assert.notEqual(start, -1, `${test4File}: missing the copy`);
  const stop = text.indexOf("\n$assert$;\n", start + open.length);
  assert.notEqual(stop, -1, `${test4File}: unterminated copy`);
  assert.equal(text.slice(start + open.length, stop), body);
});

test("Migration 4 section 12 is Migration 3 section 12, byte for byte", () => {
  const { body: m3Body } = doBody(m3, "-- 12. Fail closed", m3File);
  const { body: m4Body } = doBody(m4, "-- 12. Fail closed", m4File);
  assert.equal(m4Body, m3Body);
});

test("the section 12 check is the last statement of Migration 4", () => {
  const { end } = doBody(m4, "-- 12. Fail closed", m4File);
  assert.equal(m4.slice(end), "");
});

const m5File = "supabase/migrations/20261108120000_accounts_permissions.sql";
const test5File = "tests/db/270_hardening_assertion_m5.test.sql";
const m5 = read(m5File);

test("tests/db/270 runs a byte-identical copy of the Migration 5 section 14 check", () => {
  const { body } = doBody(m5, "-- 14. Fail closed", m5File);
  const text = read(test5File);
  const open = "language plpgsql as $assert$\n";
  const start = text.indexOf(open);
  assert.notEqual(start, -1, `${test5File}: missing the copy`);
  const stop = text.indexOf("\n$assert$;\n", start + open.length);
  assert.notEqual(stop, -1, `${test5File}: unterminated copy`);
  assert.equal(text.slice(start + open.length, stop), body);
});

test("Migration 5 section 14 is Migration 4 section 12, byte for byte", () => {
  const { body: m4Body } = doBody(m4, "-- 12. Fail closed", m4File);
  const { body: m5Body } = doBody(m5, "-- 14. Fail closed", m5File);
  assert.equal(m5Body, m4Body);
});

test("the section 14 check is the last statement of Migration 5", () => {
  const { end } = doBody(m5, "-- 14. Fail closed", m5File);
  assert.equal(m5.slice(end), "");
});

// PR 1.8, independent review N-4: the read-only pre-apply check (section 0b) runs before Migration 5
// changes anything, and tests/db/310 runs a byte-identical copy of it.
const test5PrecheckFile = "tests/db/310_precheck_m5.test.sql";

test("tests/db/310 runs a byte-identical copy of the Migration 5 section 0b pre-apply check", () => {
  const { body } = doBody(m5, "-- 0b. Fail closed", m5File);
  const text = read(test5PrecheckFile);
  const open = "language plpgsql as $precheck$\n";
  const start = text.indexOf(open);
  assert.notEqual(start, -1, `${test5PrecheckFile}: missing the copy`);
  const stop = text.indexOf("\n$precheck$;\n", start + open.length);
  assert.notEqual(stop, -1, `${test5PrecheckFile}: unterminated copy`);
  assert.equal(text.slice(start + open.length, stop), body);
});

test("the section 0b check is the second statement of Migration 5, right after the postgres check, and only reads", () => {
  const { body } = doBody(m5, "-- 0b. Fail closed", m5File);
  const { statements, errors } = lexSql(m5);
  assert.deepEqual(errors, []);
  assert.match(statements[0].code, /^do\b/i);
  assert.match(statements[0].bodies[0], /current_user <> 'postgres'/);
  assert.match(statements[1].code, /^do\b/i);
  assert.equal(statements[1].bodies[0], `\n${body}\n`);
  assert.doesNotMatch(body, /\b(insert|update|delete|merge|truncate|alter|create|drop|grant|revoke|perform)\b/i);
});

// Step 6 (Migration 6): the fail-closed hardening check (section 11) is Migration 5 section 14,
// byte for byte, and tests/db/320 runs a byte-identical copy of it.
const m6File = "supabase/migrations/20261109120000_calendar_ingestion.sql";
const test6File = "tests/db/320_hardening_assertion_m6.test.sql";
const m6 = read(m6File);

test("tests/db/320 runs a byte-identical copy of the Migration 6 section 11 check", () => {
  const { body } = doBody(m6, "-- 11. Fail closed", m6File);
  const text = read(test6File);
  const open = "language plpgsql as $assert$\n";
  const start = text.indexOf(open);
  assert.notEqual(start, -1, `${test6File}: missing the copy`);
  const stop = text.indexOf("\n$assert$;\n", start + open.length);
  assert.notEqual(stop, -1, `${test6File}: unterminated copy`);
  assert.equal(text.slice(start + open.length, stop), body);
});

test("Migration 6 section 11 is Migration 5 section 14, byte for byte", () => {
  const { body: m5Body } = doBody(m5, "-- 14. Fail closed", m5File);
  const { body: m6Body } = doBody(m6, "-- 11. Fail closed", m6File);
  assert.equal(m6Body, m5Body);
});

test("the section 11 check is the last statement of Migration 6", () => {
  const { end } = doBody(m6, "-- 11. Fail closed", m6File);
  assert.equal(m6.slice(end), "");
});

// Step 4 (Migration 7): the fail-closed hardening check (section 11) is Migration 6 section 11, byte
// for byte; tests/db/350 runs a byte-identical copy of it, and it is the last statement.
const m7File = "supabase/migrations/20261110120000_field_visit_writers.sql";
const test7File = "tests/db/350_hardening_assertion_m7.test.sql";
const m7 = read(m7File);

test("tests/db/350 runs a byte-identical copy of the Migration 7 section 11 check", () => {
  const { body } = doBody(m7, "-- 11. Fail closed", m7File);
  const text = read(test7File);
  const open = "language plpgsql as $assert$\n";
  const start = text.indexOf(open);
  assert.notEqual(start, -1, `${test7File}: missing the copy`);
  const stop = text.indexOf("\n$assert$;\n", start + open.length);
  assert.notEqual(stop, -1, `${test7File}: unterminated copy`);
  assert.equal(text.slice(start + open.length, stop), body);
});

test("Migration 7 section 11 is Migration 6 section 11, byte for byte", () => {
  const m6Text = read("supabase/migrations/20261109120000_calendar_ingestion.sql");
  const { body: m6Body } = doBody(m6Text, "-- 11. Fail closed", "Migration 6");
  const { body: m7Body } = doBody(m7, "-- 11. Fail closed", m7File);
  assert.equal(m7Body, m6Body);
});

test("the section 11 check is the last statement of Migration 7", () => {
  const { end } = doBody(m7, "-- 11. Fail closed", m7File);
  assert.equal(m7.slice(end), "");
});
