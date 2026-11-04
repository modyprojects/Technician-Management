// Migration guard (D47, D49): migrations contain schema and owner-approved real reference data only.
// They must never contain fictitious or test data, because a future Production project is built
// from the same migration files and must start with no fictional content.
//
// Rules for every file in supabase/migrations/*.sql (comments are ignored; quotes, quoted
// identifiers and dollar-quoted bodies are parsed, so a ";" inside them does not split a statement).
// A "statement that runs" is a top-level statement or a statement inside a DO block.
// 1. INSERT is allowed only into approved reference tables (REFERENCE_TABLES).
// 2. An allowed INSERT must not contain test markers: 'simulator', 'automated_test', 'seed',
//    example.test addresses, or any explicit is_test value (reference data keeps the default false).
// 3. COPY ... FROM is not allowed.
// 4. Function bodies. Every CREATE FUNCTION / CREATE PROCEDURE body must be dollar-quoted
//    (AS $$ ... $$): a string-literal body, a BEGIN ATOMIC body or a RETURN body fails, because the
//    guard could not read it. A body is not run by the migration, but rules 1-3 still apply inside
//    it, except for the reviewed writer functions listed by schema-qualified name in
//    ALLOWED_WRITERS (PR 1.3: the account RPCs, private.write_audit and the first-Creator function
//    insert into business tables). A function whose body inserts, updates, deletes, merges or
//    truncates is a "writer", and so is every function whose body calls a writer. A migration must
//    never call a writer: any statement other than CREATE FUNCTION/PROCEDURE, GRANT, REVOKE,
//    COMMENT ON, ALTER and DROP FUNCTION/PROCEDURE/ROUTINE that names a writer followed by "("
//    fails. CREATE TRIGGER is not exempt, so a migration can never attach a writer as a trigger.
// 5. D49: bootstrap_first_creator may appear only in its own CREATE FUNCTION header, in REVOKE and
//    in COMMENT ON FUNCTION statements. A call (top level, DO block or any function body), a GRANT
//    or an ALTER fails.
// 6. No dynamic SQL in statements that run (EXECUTE): the guard could not read what it runs.
// 7. No other data change in statements that run: UPDATE ... SET, DELETE FROM, MERGE INTO,
//    TRUNCATE, CREATE TABLE ... AS, SELECT ... INTO and CREATE MATERIALIZED VIEW fail (for
//    example, a later migration must not change a permission-matrix value without its audit, D51).
// Compensating runtime control for what a static check cannot see: tests/db/070_census.test.sql
// requires a census of 0 and no rows in any table except the listed reference data on a database
// built from migrations alone.
//
// Usage: node scripts/check-migrations.mjs [repository root]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Owner-approved reference data (D33 permission catalogue and defaults, D48 initial values).
const REFERENCE_TABLES = new Set(["call_types", "followup_reasons", "permissions", "role_permissions"]);

// Reviewed functions whose bodies may insert into business tables (rule 4). Adding a name here is
// a reviewed change of this mandatory check; a migration still can never call any of them.
export const ALLOWED_WRITERS = new Set([
  "private.write_audit",
  "private.authorize_account_creation",
  "private.admin_create_profile",
  "private.admin_create_technician",
  "private.request_account_change",
  "private.bootstrap_first_creator",
]);

const TEST_MARKERS = [
  { pattern: /'simulator'/i, label: "data_source 'simulator'" },
  { pattern: /'automated_test'/i, label: "data_source 'automated_test'" },
  { pattern: /'seed'/i, label: "data_source 'seed'" },
  { pattern: /example\.test/i, label: "example.test address" },
  { pattern: /\bis_test\b/i, label: "sets is_test (reference data must keep the default false)" },
];

const BOOTSTRAP = /bootstrap_first_creator/i;
const IDENT = String.raw`"?[a-z_][a-z0-9_$]*"?`;
const FUNCTION_DEFINITION = new RegExp(
  String.raw`^create\s+(?:or\s+replace\s+)?(?:function|procedure)\s+(?:"?([a-z_][a-z0-9_$]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_$]*)"?\s*\(`,
  "i",
);
const DOLLAR_BODY = /\bas\s+\$body\d+\$/i;
const UNREADABLE_BODY = [/\bbegin\s+atomic\b/i, /\bas\s+(?:e|u&)?'/i, /\breturn\b/i];
const CALL_EXEMPT = /^(?:grant|revoke|comment\s+on|(?:alter|drop)\s+(?:function|procedure|routine))\b/i;
const BOOTSTRAP_EXEMPT = /^(?:revoke|comment\s+on\s+function)\b/i;
const DYNAMIC_SQL = /\bexecute\b(?!\s+(?:function|procedure|on)\b)/i;
// Rule 7 inside any statement text (top level and DO blocks).
const DATA_CHANGES = [
  { pattern: new RegExp(String.raw`\bupdate\s+(?:only\s+)?(?:${IDENT}\s*\.\s*)?${IDENT}(?:\s+(?:as\s+)?${IDENT})?\s+set\b`, "i"), label: "UPDATE" },
  { pattern: /\bdelete\s+from\b/i, label: "DELETE" },
  { pattern: /\bmerge\s+into\b/i, label: "MERGE" },
  { pattern: new RegExp(String.raw`\btruncate\s+(?:table\s+)?(?:only\s+)?(?!on\b)${IDENT}`, "i"), label: "TRUNCATE" },
];
// Rule 7 for top-level statements only (in PL/pgSQL, SELECT ... INTO assigns a variable).
const TOP_LEVEL_DATA_CHANGES = [
  {
    pattern: new RegExp(String.raw`^create\s+(?:(?:global|local)\s+)?(?:(?:temp|temporary|unlogged)\s+)?table\s+(?:if\s+not\s+exists\s+)?(?:${IDENT}\s*\.\s*)?${IDENT}\s*(?:\([^)]*\)\s*)?(?:with\s*\([^)]*\)\s*)?as\b`, "i"),
    label: "CREATE TABLE ... AS",
  },
  { pattern: /^select\b(?:(?!\bfrom\b)[\s\S])*\binto\b/i, label: "SELECT ... INTO" },
  { pattern: /^create\s+(?:or\s+replace\s+)?materialized\s+view\b/i, label: "CREATE MATERIALIZED VIEW" },
];

/**
 * Splits SQL into statements. Comments are removed; single-quoted strings (including E'' strings)
 * and quoted identifiers are kept; every dollar-quoted body is taken out and replaced by a
 * placeholder, so a statement is { code, bodies }. Unterminated quotes are reported in `errors`.
 */
export function lexSql(sql) {
  const statements = [];
  const errors = [];
  let code = "";
  let bodies = [];
  const flush = () => {
    if (code.trim()) statements.push({ code: code.trim(), bodies });
    code = "";
    bodies = [];
  };
  const n = sql.length;
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    const prev = i > 0 ? sql[i - 1] : "";
    if (c === "-" && next === "-") {
      const end = sql.indexOf("\n", i);
      i = end === -1 ? n : end;
      code += " ";
      continue;
    }
    if (c === "/" && next === "*") {
      let depth = 1;
      i += 2;
      while (i < n && depth > 0) {
        if (sql[i] === "/" && sql[i + 1] === "*") {
          depth += 1;
          i += 2;
        } else if (sql[i] === "*" && sql[i + 1] === "/") {
          depth -= 1;
          i += 2;
        } else {
          i += 1;
        }
      }
      if (depth > 0) errors.push("unterminated block comment");
      code += " ";
      continue;
    }
    if (c === "'") {
      const backslashEscapes = /[eE]/.test(prev) && !/[A-Za-z0-9_$]/.test(i > 1 ? sql[i - 2] : "");
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (backslashEscapes && sql[j] === "\\") {
          j += 2;
          continue;
        }
        if (sql[j] === "'") {
          if (sql[j + 1] === "'") {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) errors.push("unterminated string literal");
      code += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      let closed = false;
      while (j < n) {
        if (sql[j] === '"') {
          if (sql[j + 1] === '"') {
            j += 2;
            continue;
          }
          closed = true;
          break;
        }
        j += 1;
      }
      if (!closed) errors.push("unterminated quoted identifier");
      code += sql.slice(i, j + 1);
      i = j + 1;
      continue;
    }
    if (c === "$" && !/[A-Za-z0-9_$]/.test(prev)) {
      const tag = /^\$(?:[A-Za-z_][A-Za-z0-9_]*)?\$/.exec(sql.slice(i, i + 64));
      if (tag) {
        const start = i + tag[0].length;
        const end = sql.indexOf(tag[0], start);
        if (end === -1) errors.push(`unterminated dollar-quoted string ${tag[0]}`);
        bodies.push(sql.slice(start, end === -1 ? n : end));
        code += ` $body${bodies.length - 1}$ `;
        i = end === -1 ? n : end + tag[0].length;
        continue;
      }
    }
    if (c === ";") {
      flush();
      i += 1;
      continue;
    }
    code += c;
    i += 1;
  }
  flush();
  return { statements, errors };
}

// Every statement of `sql` as text; dollar-quoted bodies (DO blocks, nested bodies) are lexed in
// turn and their statements appended.
function expandAll(sql) {
  return lexSql(sql).statements.flatMap(expandStatement);
}

function expandStatement(statement) {
  return [statement.code.replace(/\$body\d+\$/g, " "), ...statement.bodies.flatMap(expandAll)];
}

/** Kept for compatibility: the statements of `sql` with comments removed. */
export function stripComments(sql) {
  return expandAll(sql).join(";\n");
}

// Rules 1-3 on statement texts.
function dataProblems(fragments, where) {
  const problems = [];
  for (const fragment of fragments) {
    const text = fragment.trim();
    if (!text) continue;
    if (/^copy\b[\s\S]*\bfrom\b/i.test(text)) {
      problems.push(`${where}: COPY ... FROM is not allowed in migrations`);
      continue;
    }
    for (const insert of text.matchAll(/\binsert\s+into\s+(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/gi)) {
      const table = insert[2].toLowerCase();
      if (!REFERENCE_TABLES.has(table)) {
        problems.push(`${where}: INSERT into "${table}" is not allowed; migrations may insert only approved reference data (${[...REFERENCE_TABLES].join(", ")})`);
        continue;
      }
      for (const marker of TEST_MARKERS) {
        if (marker.pattern.test(text)) {
          problems.push(`${where}: INSERT into "${table}" contains a test marker (${marker.label})`);
        }
      }
    }
  }
  return problems;
}

// String literals are blanked for rules 6 and 7 (a COMMENT ON text may say "TRUNCATE"); a string
// run as SQL needs EXECUTE, which rule 6 refuses.
const withoutStrings = (text) => text.replace(/'(?:[^']|'')*'/g, "''");

// Rule 7 (and the data changes that make a function a writer).
function changeProblems(fragments, where, topLevel) {
  const problems = [];
  for (const fragment of fragments) {
    const text = withoutStrings(fragment.trim());
    if (!text) continue;
    for (const { pattern, label } of DATA_CHANGES) {
      if (pattern.test(text)) problems.push(`${where}: ${label} is not allowed in migrations; they change schema and approved reference data only`);
    }
  }
  if (topLevel) {
    for (const { pattern, label } of TOP_LEVEL_DATA_CHANGES) {
      if (pattern.test(withoutStrings(topLevel))) problems.push(`${where}: ${label} is not allowed in migrations; they change schema and approved reference data only`);
    }
  }
  return problems;
}

const callsOf = (texts, names) =>
  [...names].filter((name) => {
    const call = new RegExp(`(^|[^a-z0-9_$])"?${name.replace(/\$/g, "\\$")}"?\\s*\\(`, "i");
    return texts.some((text) => call.test(text));
  });

/**
 * Checks migration files together (a writer defined in one file may be called in a later one).
 * `options.allowedWriters` replaces ALLOWED_WRITERS (tests only).
 */
export function checkFiles(files, options = {}) {
  const allowedWriters = options.allowedWriters ?? ALLOWED_WRITERS;
  const problems = [];
  const parsed = files.map(({ name, sql }) => {
    const { statements, errors } = lexSql(sql);
    for (const error of errors) problems.push(`${name}: ${error}`);
    return {
      name,
      statements: statements.map((statement) => {
        const definition = FUNCTION_DEFINITION.exec(statement.code);
        const header = statement.code.replace(/\$body\d+\$/g, " ");
        return {
          code: statement.code,
          header,
          bodyFragments: statement.bodies.flatMap(expandAll),
          fragments: expandStatement(statement),
          functionName: definition ? definition[2].toLowerCase() : null,
          qualifiedName: definition
            ? (definition[1] ? `${definition[1].toLowerCase()}.` : "") + definition[2].toLowerCase()
            : null,
          readableBody: definition
            ? DOLLAR_BODY.test(statement.code) && !UNREADABLE_BODY.some((pattern) => pattern.test(header))
            : true,
        };
      }),
    };
  });

  // Rule 4: readable bodies, allowed writers, then every function that calls a writer.
  const definitions = parsed.flatMap((file) =>
    file.statements.filter((statement) => statement.functionName).map((statement) => ({ file: file.name, ...statement })),
  );
  const writers = new Set();
  for (const d of definitions) {
    if (!d.readableBody) {
      problems.push(`${d.file}: the body of ${d.qualifiedName} must be dollar-quoted (AS $$ ... $$); string-literal, BEGIN ATOMIC and RETURN bodies are not allowed, because the guard cannot read them`);
      writers.add(d.functionName);
      continue;
    }
    const inserts = dataProblems(d.bodyFragments, `${d.file}: function ${d.qualifiedName}`);
    if (inserts.length > 0) {
      writers.add(d.functionName);
      if (!allowedWriters.has(d.qualifiedName)) {
        problems.push(...inserts.map((p) => `${p} (only the reviewed writer functions in ALLOWED_WRITERS may insert)`));
      }
    }
    if (changeProblems(d.bodyFragments, "", null).length > 0) writers.add(d.functionName);
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of definitions) {
      if (!writers.has(d.functionName) && callsOf(d.bodyFragments, writers).length > 0) {
        writers.add(d.functionName);
        changed = true;
      }
    }
  }

  for (const file of parsed) {
    for (const statement of file.statements) {
      if (statement.functionName) {
        // Rule 5 inside definitions: only bootstrap's own header names it.
        const ownHeader = statement.functionName === "bootstrap_first_creator";
        if ((!ownHeader && BOOTSTRAP.test(statement.header)) || statement.bodyFragments.some((f) => BOOTSTRAP.test(f))) {
          problems.push(`${file.name}: bootstrap_first_creator is never called by a migration or by another function (D49)`);
        }
        continue;
      }
      problems.push(...dataProblems(statement.fragments, file.name));
      problems.push(...changeProblems(statement.fragments, file.name, statement.header.trim()));
      if (statement.fragments.some((f) => DYNAMIC_SQL.test(withoutStrings(f)))) {
        problems.push(`${file.name}: dynamic SQL (EXECUTE) is not allowed in migrations; the guard cannot read what it runs`);
      }
      if (statement.fragments.some((f) => BOOTSTRAP.test(f)) && !BOOTSTRAP_EXEMPT.test(statement.code)) {
        problems.push(`${file.name}: bootstrap_first_creator may only be defined, revoked or commented in migrations (D49)`);
      }
      if (!CALL_EXEMPT.test(statement.code)) {
        for (const writer of callsOf(statement.fragments, writers)) {
          problems.push(`${file.name}: the migration calls ${writer}(), a function that writes data; migrations never run data-writing functions (D47)`);
        }
      }
    }
  }
  return problems;
}

export function checkSql(sql, fileName = "migration.sql", options = {}) {
  return checkFiles([{ name: fileName, sql }], options);
}

export function checkRepository(root) {
  const dir = join(root, "supabase", "migrations");
  if (!existsSync(dir)) return [];
  const files = readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .map((name) => ({ name, sql: readFileSync(join(dir, name), "utf8") }));
  return checkFiles(files);
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const root = resolve(process.argv[2] ?? process.cwd());
  const problems = checkRepository(root);
  if (problems.length > 0) {
    console.error("Migration guard failed (D47: no test or fictitious data in migrations; D49):");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log("Migration guard passed: no test or fictitious data in supabase/migrations.");
}
