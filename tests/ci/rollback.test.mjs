// Rollback (down) scripts (docs/database-schema.md "Migration order and approval checklist" item 6).
// Every migration has a down script in supabase/rollback/, which the CLI never applies. The pgTAP
// suite runs each down script inside a rolled-back transaction from byte-identical copies in
// tests/db/ (the Database tests workflow runs tests/db only): one run on the empty tables and one
// that proves the fail-closed precondition refuses to run once data exists. This test keeps every
// copy in sync and requires the whole script to be one DO block whose first action is that
// precondition (re-review R-S3: separate statements ran on after a refusal under plain psql -f).
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lexSql, stripComments } from "../../scripts/check-migrations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const migrationsDir = join(root, "supabase", "migrations");
const rollbackDir = join(root, "supabase", "rollback");
const testsDir = join(root, "tests", "db");

const migrations = existsSync(migrationsDir)
  ? readdirSync(migrationsDir).filter((name) => name.endsWith(".sql")).sort()
  : [];
const downScripts = existsSync(rollbackDir)
  ? readdirSync(rollbackDir).filter((name) => name.endsWith(".down.sql")).sort()
  : [];
const testFiles = readdirSync(testsDir).filter((name) => name.endsWith(".sql"));

function embeddedCopies(published) {
  const begin = `-- >>> BEGIN ${published}\n`;
  const end = `-- <<< END ${published}\n`;
  const copies = [];
  for (const name of testFiles) {
    const text = readFileSync(join(testsDir, name), "utf8");
    for (let start = text.indexOf(begin); start !== -1; start = text.indexOf(begin, start + begin.length)) {
      const stop = text.indexOf(end, start + begin.length);
      assert.notEqual(stop, -1, `${name}: missing end marker for ${published}`);
      copies.push(text.slice(start + begin.length, stop));
    }
  }
  return copies;
}

test("every migration has a down script and every down script has a migration", () => {
  assert.deepEqual(
    downScripts,
    migrations.map((name) => name.replace(/\.sql$/, ".down.sql")),
  );
});

for (const name of downScripts) {
  const published = `supabase/rollback/${name}`;
  const down = readFileSync(join(rollbackDir, name), "utf8");

  test(`${name}: tests/db runs byte-identical copies (the run and the refused run)`, () => {
    const copies = embeddedCopies(published);
    assert.ok(copies.length >= 2, `tests/db must embed ${published} twice (run and refused run); found ${copies.length}`);
    for (const copy of copies) assert.equal(copy, down);
  });

  test(`${name}: one DO block that refuses first (fail closed whatever the client flags, re-review R-S3)`, () => {
    const { statements, errors } = lexSql(down);
    assert.deepEqual(errors, []);
    assert.equal(statements.length, 1, "the down script must be a single statement, so a refusal cancels every DROP");
    const [only] = statements;
    assert.match(only.code, /^do\b/i);
    assert.equal(only.bodies.length, 1);
    const body = stripComments(only.bodies[0]);
    const refusal = body.search(/raise exception[\s\S]*rollback refused/i);
    const firstDrop = body.search(/\bdrop\b/i);
    assert.ok(refusal !== -1 && firstDrop !== -1 && refusal < firstDrop, "the refusal comes before the first DROP");
  });

  test(`${name}: no CASCADE, no dynamic SQL and no transaction control`, () => {
    const body = lexSql(lexSql(down).statements[0].bodies[0]).tokens;
    assert.doesNotMatch(stripComments(down), /\bcascade\b/i);
    for (const word of ["execute", "commit", "rollback", "savepoint", "cascade"]) {
      assert.ok(!body.some((t) => t.type === "ident" && t.value === word), word);
    }
  });
}
