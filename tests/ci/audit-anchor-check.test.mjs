// The self-contained audit anchor (docs/review/step1-pr13/audit-anchor-record.sql and
// audit-anchor-check.sql; reviews S3, R-S4, DI-1, DI-2). tests/db/065_audit_anchor.test.sql runs
// byte-identical copies; this test keeps them in sync and proves statically that each file trusts
// nothing in the audited database: one SELECT (no DDL, so no event trigger fires, and no setting),
// every function call, type and operator qualified with pg_catalog (so neither search_path nor
// pg_temp nor another schema can stand in for a name), only the catalog and public.audit_logs read,
// the private schema never named, and the anchor taken from psql variables only.
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { lexSql } from "../../scripts/check-migrations.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const files = {
  "docs/review/step1-pr13/audit-anchor-record.sql": [],
  "docs/review/step1-pr13/audit-anchor-check.sql": ["anchor_id", "anchor_row_hash", "anchor_row_count", "functions_md5"],
};

// SQL keywords that may stand right before "(" without being a function call of the database.
const KEYWORDS_BEFORE_PAREN = new Set(["any", "as", "coalesce", "exists", "operator", "over"]);
// Words that would make the file more than one read-only query.
const NOT_A_QUERY = new Set([
  "create", "alter", "drop", "insert", "update", "delete", "merge", "truncate", "copy", "grant", "revoke",
  "set", "reset", "do", "call", "execute", "perform", "lock", "vacuum", "analyze", "comment", "begin", "commit",
  "rollback", "savepoint", "notify", "listen", "load", "discard", "prepare", "refresh", "cluster", "reindex",
  "security", "import", "into",
]);

function embeddedCopies(published) {
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
  return copies;
}

for (const [published, variables] of Object.entries(files)) {
  const text = readFileSync(join(root, published), "utf8");
  const { statements, errors } = lexSql(text);

  test(`${published}: tests/db runs a byte-identical copy`, () => {
    const copies = embeddedCopies(published);
    assert.ok(copies.length >= 1, `tests/db must run ${published}`);
    for (const copy of copies) assert.equal(copy, text);
  });

  test(`${published}: one read-only SELECT (no DDL, no setting, no other statement; DI-1)`, () => {
    assert.deepEqual(errors, []);
    assert.equal(statements.length, 1, "exactly one statement");
    const { tokens } = statements[0];
    assert.ok(["select", "with"].includes(tokens[0].value), "it starts with SELECT or WITH");
    for (const t of tokens) {
      if (t.type === "ident") assert.ok(!NOT_A_QUERY.has(t.value), `"${t.value}" is not allowed`);
      assert.notEqual(t.type, "dollar", "no dollar-quoted text");
      assert.notEqual(t.type, "qident", "no quoted identifiers");
    }
  });

  test(`${published}: every function, type and operator is qualified with pg_catalog (SEC-1 class, DI-1)`, () => {
    const { tokens } = statements[0];
    const qualifiedBy = (k, schema) => tokens[k - 1]?.value === "." && tokens[k - 2]?.value === schema;
    tokens.forEach((t, k) => {
      const next = tokens[k + 1];
      if (t.type === "ident" && next?.type === "punct" && next.value === "(") {
        assert.ok(KEYWORDS_BEFORE_PAREN.has(t.value) || qualifiedBy(k, "pg_catalog"), `unqualified call ${t.value}(`);
      }
      if (t.type === "op" && t.value === "::") {
        assert.equal(next?.value, "pg_catalog", "a cast names a pg_catalog type");
        assert.equal(tokens[k + 2]?.value, ".");
      } else if (t.type === "op" && t.value === "*") {
        // only count(*)
        assert.ok(tokens[k - 1]?.value === "(" && next?.value === ")" && tokens[k - 2]?.value === "count" && qualifiedBy(k - 2, "pg_catalog"),
          "* only in pg_catalog.count(*)");
      } else if (t.type === "op") {
        // operator(pg_catalog.<op>)
        assert.ok(qualifiedBy(k, "pg_catalog") && tokens[k - 3]?.value === "(" && tokens[k - 4]?.value === "operator" && next?.value === ")",
          `operator ${t.value} must be written operator(pg_catalog.${t.value})`);
      }
    });
  });

  test(`${published}: reads only the catalog and public.audit_logs, never the private schema`, () => {
    const { tokens } = statements[0];
    const ctes = new Set(tokens.filter((t, k) => t.type === "ident" && tokens[k + 1]?.value === "as" && tokens[k + 2]?.value === "(").map((t) => t.value));
    tokens.forEach((t, k) => {
      if (t.type === "ident" && (t.value === "from" || t.value === "join")) {
        const next = tokens[k + 1];
        if (next.value === "only") {
          assert.deepEqual(tokens.slice(k + 2, k + 5).map((x) => x.value), ["public", ".", "audit_logs"], "only public.audit_logs");
        } else if (next.value === "pg_catalog") {
          assert.equal(tokens[k + 2]?.value, ".");
        } else {
          assert.ok(ctes.has(next.value), `${t.value} ${next.value}: a catalog table, public.audit_logs (with ONLY) or a CTE of the file`);
        }
      }
      if (t.type === "ident" && t.value === "public" && tokens[k - 1]?.value !== "only") {
        assert.fail("public is named only after ONLY (and in the 'public.audit_logs' strings)");
      }
      if ((t.type === "ident" || t.type === "qident") && t.value === "private") assert.fail("the private schema is never named");
      if (t.type === "ident" && t.value === "only") assert.equal(tokens[k + 1]?.value, "public");
    });
  });

  test(`${published}: the anchor comes from psql variables only`, () => {
    const { tokens } = statements[0];
    const used = [];
    tokens.forEach((t, k) => {
      if (t.type === "punct" && t.value === ":") {
        assert.equal(tokens[k + 1]?.type, "string", "a psql variable is written :'name'");
        used.push(tokens[k + 1].value);
      }
    });
    assert.deepEqual([...new Set(used)].sort(), [...variables].sort());
  });
}
