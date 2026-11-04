// The self-contained audit anchor check (docs/review/step1-pr13/audit-anchor-check.sql; reviews S3
// and R-S4). tests/db/065_audit_anchor.test.sql runs a byte-identical copy; this test keeps it in
// sync and proves statically that the check trusts nothing in the audited database: it defines
// functions in pg_temp only, pins search_path to pg_catalog, reads only public.audit_logs and the
// catalog, and never names the private schema.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lexSql } from "../../scripts/check-migrations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const published = "docs/review/step1-pr13/audit-anchor-check.sql";
const check = readFileSync(join(root, published), "utf8");

test("tests/db runs a byte-identical copy of the audit anchor check", () => {
  const begin = `-- >>> BEGIN ${published}\n`;
  const end = `-- <<< END ${published}\n`;
  const copies = [];
  for (const name of readdirSync(join(root, "tests", "db")).filter((n) => n.endsWith(".sql"))) {
    const text = readFileSync(join(root, "tests", "db", name), "utf8");
    for (let start = text.indexOf(begin); start !== -1; start = text.indexOf(begin, start + begin.length)) {
      const stop = text.indexOf(end, start + begin.length);
      assert.notEqual(stop, -1, `${name}: missing end marker`);
      copies.push(text.slice(start + begin.length, stop));
    }
  }
  assert.ok(copies.length >= 1, "tests/db must run the audit anchor check");
  for (const copy of copies) assert.equal(copy, check);
});

test("the audit anchor check defines pg_temp functions only, with search_path pinned to pg_catalog", () => {
  const { statements, errors } = lexSql(check);
  assert.deepEqual(errors, []);
  assert.ok(statements.length >= 3);
  for (const { tokens } of statements) {
    const words = tokens.slice(0, 6).map((t) => t.value);
    assert.deepEqual(words, ["create", "or", "replace", "function", "pg_temp", "."], words.join(" "));
    const set = tokens.findIndex((t, k) => t.value === "set" && tokens[k + 1]?.value === "search_path");
    assert.notEqual(set, -1, "search_path is set");
    assert.deepEqual(tokens.slice(set + 2, set + 6).map((t) => t.value), ["=", "pg_catalog", ",", "pg_temp"]);
  }
});

test("the audit anchor check never names the private schema or another schema's functions", () => {
  const bodies = lexSql(check).statements.flatMap((s) => s.bodies);
  assert.equal(bodies.length, lexSql(check).statements.length);
  for (const body of bodies) {
    const { tokens, errors } = lexSql(body);
    assert.deepEqual(errors, []);
    tokens.forEach((t, k) => {
      if (tokens[k + 1]?.type !== "punct" || tokens[k + 1].value !== ".") return;
      if (t.type !== "ident") return;
      // Qualifiers: pg_catalog functions and catalogs, pg_temp helpers, public.audit_logs, and
      // column references through the table aliases used in the bodies.
      if (["pg_catalog", "pg_temp", "a", "b", "c", "p", "n", "t", "x", "tr", "r"].includes(t.value)) return;
      if (t.value === "public") {
        assert.equal(tokens[k + 2]?.value, "audit_logs", "public.audit_logs is the only public object it reads");
        return;
      }
      assert.fail(`unexpected qualifier ${t.value}.`);
    });
    // 'private' appears only as a string: the fingerprint reads those functions' definitions.
    assert.ok(!tokens.some((t) => (t.type === "ident" || t.type === "qident") && t.value === "private"), "the private schema is never named");
  }
  // The literal 'public.audit_logs'::regclass casts name the same table.
  assert.doesNotMatch(check.replace(/^--.*$/gm, ""), /\bprivate\./);
});
