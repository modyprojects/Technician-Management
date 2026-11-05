// Runtime canary-rows check for database migrations (D47; docs/testing.md "Canary rows check").
//
// The static migration guard (scripts/check-migrations.mjs) cannot prove that a migration changes
// no data. This check runs the migrations against the throwaway LOCAL Supabase database (Docker)
// and compares snapshots of every table. It is a tripwire for migrations that change, copy or
// derive data by accident or by oversight; a migration written to evade it (one that detects the
// harness) is left to the guard and to review (docs/testing.md, "Limits").
//   - reference runs A1 and A2: an empty database (zero migrations), no canary rows, migrations
//     1..N, a snapshot before and after each migration;
//   - canary run B: an empty database, the base canary rows outside public/private
//     (<fixtures>/000_base.sql), then for each migration k: snapshot, apply k, snapshot, compare,
//     insert the fixture <fixtures>/<version>.sql, check coverage.
//
// Rules (fail closed; the first failing step stops the run with a non-zero exit code):
//   R1 In public and private, no row of a table that existed before migration k may be removed or
//      changed (run A1 and run B). A column added by k may appear on existing rows only as JSON
//      null; a dropped column or a changed value is a change (a renamed column counts as dropped:
//      a rename can change what existing values mean).
//   R2 Rows that k adds to a pre-existing table in public or private are the same in A1 and B
//      (multiset, after masking the columns that k's added rows fill with volatile values).
//      Fallback signal: every sequence in public and private is in the same state in A1 and B.
//   R3 A table or materialized view created by k in public or private holds the same rows in A1
//      and B (after masking). The schema after k is the same in both runs: the tables and their
//      columns, the full `pg_dump --schema-only --binary-upgrade` text (functions, views,
//      defaults, comments, policies, grants, extension members, stored defaults of added
//      columns ...), cluster-wide state (roles, memberships, role settings) and the database's
//      settings; data copied into the schema makes them differ.
//   R4 Outside public and private, k adds, changes and removes no row at all (auth, storage,
//      vault, cron, net, realtime ..., and large objects in pg_catalog), changes no sequence, and
//      sets no role password, replication slot or replication origin, in A1 and B, except
//      BOOKKEEPING_TABLES.
//   R5 Volatile columns are the columns whose values differ between A1 and A2, found per
//      migration step (the rows that step adds, refined per group of rows) and per snapshot point;
//      they are masked (null stays null, the value's shape is kept, values equal in A1 and A2 must
//      reappear in B) and reported. Fixtures never consume a sequence.
//   R6 After each step every table in public and private has a row, and every column is non-null
//      in at least one row, except entries of <fixtures>/coverage-exceptions.json (an entry must
//      match a table or column after at least one step).
//   R7 Any psql error, Docker or CLI failure, unparsable output, nondeterminism between A1 and A2
//      (rows or schema), other services of the project writing to the database, a migration that
//      adds, changes or removes an event trigger (it would run code on later logins or DDL), or
//      unexpected state (including fixture hygiene: a fixture only adds rows and never changes the
//      schema, rows in tables with is_test are test-marked, e-mail addresses use example.test)
//      fails the run.
// Row values are the text of each column type's OUTPUT function (never to_jsonb or a cast, which a
// migration could redefine for a type it owns), with the JSON category of built-in types kept.
// Evaluation order inside a migration step: R4, R7 (event triggers), R1, R3 (schema), R2 (rows),
// R3 (rows), then the R2 sequence signal; fixture step: R7 (hygiene), R5; then R6.
//
// Usage:
//   node scripts/db-canary.mjs [--workdir <dir>] [--migrations <dir>] [--fixtures <dir>]
//   node scripts/db-canary.mjs --selftest tests/db-canary-selftest [--workdir <dir>] [--fixtures <dir>]
// Needs Docker, the Supabase CLI on PATH and a running local database (`supabase db start`), with
// no other service of the project running (they write to the database on their own).
// Empty database: the check runs `supabase db reset --local --no-seed` from a temporary folder
// with the same config.toml and no migrations before EACH run (a fresh local project, database
// "postgres"), and leaves the database as the canary run left it (fictional, test-marked rows):
// run `supabase db reset` afterwards to get your migrations back. The self-test resets once and
// clones that pristine copy into a separate database per run (see freshDatabase). It works on
// the local Docker database only: no remote project, no connection string, no secrets.
// Node standard library only (CI runs it without npm install).
import { spawnSync } from "node:child_process";
import { copyFileSync, existsSync, mkdirSync, mkdtempSync, readdirSync, readFileSync, realpathSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { dirname, join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const SCRIPT_PATH = fileURLToPath(import.meta.url);
export const REPO_ROOT = resolve(dirname(SCRIPT_PATH), "..");
export const PROTECTED_SCHEMAS = ["public", "private"];
export const BASE_FIXTURE = "000_base.sql";
export const EXCEPTIONS_FILE = "coverage-exceptions.json";
const PRISTINE_DB = "tm_canary_pristine";
const RUN_DB = "tm_canary_run";
const MIGRATION_RE = /^([0-9]+)_(.+)\.sql$/;
const FIXTURE_RE = /^([0-9]+)\.sql$/;
const MASK = "<masked>";
const SAMPLE_CHARS = 160;
const MAX_SAMPLES = 2;
const MAX_LISTED = 8;

const SHAPE_RE = /[0-9A-Fa-f]+/g;

// Tables that change on their own, without any migration. Measured on Supabase CLI 2.122.0
// (`supabase db start`, Postgres 17): no table changed between snapshots taken minutes apart or
// around DDL-only migrations, and migrations are applied here with psql (not the CLI), so
// supabase_migrations.* is never written. The list is therefore empty; an entry needs a measured
// reason (docs/review/db-canary/README.md).
export const BOOKKEEPING_TABLES = new Map();

export const RULES = {
  R1: "no existing row may change",
  R2: "rows added to existing tables must not depend on data",
  R3: "new tables and the schema must not depend on data",
  R4: "nothing outside public/private may change (rows, sequences, passwords, replication slots)",
  R5: "volatile columns and sequences",
  R6: "coverage",
  R7: "unexpected state",
};

const USAGE = `Usage:
  node scripts/db-canary.mjs [--workdir <dir>] [--migrations <dir>] [--fixtures <dir>]
  node scripts/db-canary.mjs --selftest <dir> [--workdir <dir>] [--fixtures <dir>]
Defaults: --workdir = repository root, --migrations = <workdir>/supabase/migrations,
          --fixtures = tests/db-canary. Resets the LOCAL database of <workdir> (Docker) before
          each run; afterwards run \`supabase db reset\` to get your migrations back.`;

export class CanaryError extends Error {
  constructor(rule, message, { infra = false } = {}) {
    super(message);
    this.rule = rule;
    this.infra = infra;
  }
}

export class UsageError extends Error {}

const infraError = (message) => new CanaryError("R7", message, { infra: true });

// ---------------------------------------------------------------------------------------------
// Options and inputs
// ---------------------------------------------------------------------------------------------

export function parseArgs(argv) {
  const known = new Set(["workdir", "migrations", "fixtures", "selftest"]);
  const opts = {};
  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--help" || arg === "-h") {
      opts.help = true;
      continue;
    }
    const match = /^--([a-z]+)(?:=([\s\S]*))?$/.exec(arg);
    if (!match || !known.has(match[1])) throw new UsageError(`unknown argument: ${arg}`);
    const name = match[1];
    if (Object.hasOwn(opts, name)) throw new UsageError(`--${name} given twice`);
    let value = match[2];
    if (value === undefined) {
      i += 1;
      value = argv[i];
      if (value === undefined || value.startsWith("--")) throw new UsageError(`--${name} needs a value`);
    }
    if (value === "") throw new UsageError(`--${name} needs a value`);
    opts[name] = value;
  }
  if (opts.selftest && opts.migrations) throw new UsageError("--migrations cannot be combined with --selftest");
  return opts;
}

export function resolveOptions(opts, cwd = process.cwd()) {
  const workdir = resolve(cwd, opts.workdir ?? REPO_ROOT);
  return {
    workdir,
    migrations: opts.migrations ? resolve(cwd, opts.migrations) : join(workdir, "supabase", "migrations"),
    fixtures: opts.fixtures ? resolve(cwd, opts.fixtures) : join(REPO_ROOT, "tests", "db-canary"),
    selftest: opts.selftest ? resolve(cwd, opts.selftest) : null,
  };
}

// project_id is a top-level key of supabase/config.toml (before the first [table]).
export function parseProjectId(text) {
  for (const raw of String(text).split(/\r?\n/)) {
    const line = raw.trim();
    if (line.startsWith("[")) break;
    const match = /^project_id\s*=\s*"([^"]*)"\s*(?:#.*)?$/.exec(line);
    if (match) {
      if (!/^[A-Za-z0-9][A-Za-z0-9_.-]{0,62}$/.test(match[1])) {
        throw new CanaryError("R7", `invalid project_id in supabase/config.toml: ${JSON.stringify(match[1])}`);
      }
      return match[1];
    }
  }
  throw new CanaryError("R7", "project_id not found in supabase/config.toml");
}

export function parseMigrationName(name) {
  const match = MIGRATION_RE.exec(name);
  return match ? { file: name, version: match[1] } : null;
}

// entries: [{ name, isFile }]. File names are data: they are only ever passed as argv elements
// or read as file paths, never put into a shell string.
export function planMigrations(entries) {
  const versions = new Set();
  const out = [];
  for (const entry of entries) {
    const parsed = parseMigrationName(entry.name);
    if (!entry.isFile || !parsed) {
      throw new CanaryError("R7", `unexpected entry in the migrations folder: ${JSON.stringify(entry.name)} (only <version>_<name>.sql files)`);
    }
    if (versions.has(parsed.version)) throw new CanaryError("R7", `two migrations share the version ${parsed.version}`);
    versions.add(parsed.version);
    out.push(parsed);
  }
  return out.sort((a, b) => (a.file < b.file ? -1 : a.file > b.file ? 1 : 0));
}

export function planFixtures(entries, versions) {
  const fixtures = new Map();
  let base = false;
  let exceptions = false;
  for (const entry of entries) {
    if (entry.isFile && entry.name === BASE_FIXTURE) base = true;
    else if (entry.isFile && entry.name === EXCEPTIONS_FILE) exceptions = true;
    else if (entry.isFile && entry.name === "README.md") continue;
    else {
      const match = FIXTURE_RE.exec(entry.name);
      if (entry.isFile && match && versions.includes(match[1])) fixtures.set(match[1], entry.name);
      else if (entry.isFile && match) throw new CanaryError("R7", `fixture ${entry.name} matches no migration version`);
      else throw new CanaryError("R7", `unexpected entry in the fixtures folder: ${JSON.stringify(entry.name)}`);
    }
  }
  return { fixtures, base, exceptions };
}

const SIMPLE_NAME = /^[a-z_][a-z0-9_$]*$/;

export function parseExceptions(text, source = EXCEPTIONS_FILE) {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CanaryError("R7", `${source}: not valid JSON`);
  }
  if (!Array.isArray(data)) throw new CanaryError("R7", `${source}: must be a JSON array`);
  const seen = new Set();
  return data.map((entry, index) => {
    const where = `${source}[${index}]`;
    if (!entry || typeof entry !== "object" || Array.isArray(entry)) throw new CanaryError("R7", `${where}: must be an object`);
    for (const key of Object.keys(entry)) {
      if (!["table", "column", "reason"].includes(key)) throw new CanaryError("R7", `${where}: unknown key ${JSON.stringify(key)}`);
    }
    const parts = typeof entry.table === "string" ? entry.table.split(".") : [];
    if (parts.length !== 2 || !PROTECTED_SCHEMAS.includes(parts[0]) || !SIMPLE_NAME.test(parts[1])) {
      throw new CanaryError("R7", `${where}: "table" must be public.<name> or private.<name>`);
    }
    if (entry.column !== undefined && (typeof entry.column !== "string" || !SIMPLE_NAME.test(entry.column))) {
      throw new CanaryError("R7", `${where}: "column" must be a column name`);
    }
    if (typeof entry.reason !== "string" || entry.reason.trim().length < 10) {
      throw new CanaryError("R7", `${where}: "reason" must explain the exception (10 characters or more)`);
    }
    const id = `${entry.table}.${entry.column ?? "*"}`;
    if (seen.has(id)) throw new CanaryError("R7", `${where}: duplicate entry ${id}`);
    seen.add(id);
    return { table: entry.table, column: entry.column ?? null, reason: entry.reason };
  });
}

export function parseExpect(text, source = "expect.json") {
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new CanaryError("R7", `${source}: not valid JSON`, { infra: true });
  }
  const bad = (message) => new CanaryError("R7", `${source}: ${message}`, { infra: true });
  if (!data || typeof data !== "object" || Array.isArray(data)) throw bad("must be an object");
  for (const key of Object.keys(data)) if (!["outcome", "rule", "match"].includes(key)) throw bad(`unknown key ${key}`);
  if (data.outcome === "pass") {
    if (data.rule !== undefined || data.match !== undefined) throw bad("a passing case has no rule or match");
  } else if (data.outcome === "fail") {
    if (typeof data.rule !== "string" || !/^R[1-7]$/.test(data.rule)) throw bad('"rule" must be R1..R7');
    if (data.match !== undefined && (typeof data.match !== "string" || data.match === "")) throw bad('"match" must be text');
  } else {
    throw bad('"outcome" must be "pass" or "fail"');
  }
  return { outcome: data.outcome, rule: data.rule ?? null, match: data.match ?? null };
}

// A self-test case is as expected when the outcome, the rule that fired and (if given) a message
// fragment all match.
export function caseMatches(expect, got) {
  return got.outcome === expect.outcome && got.rule === expect.rule && (!expect.match || String(got.message).includes(expect.match));
}

// The fresh database of a run must hold no relation in public or private, no private schema and
// an empty migration history. Returns a problem description, or null when the state is empty.
export function emptyStateProblem(stdout) {
  let state;
  try {
    state = JSON.parse(String(stdout).trim());
  } catch {
    return `unparsable empty-state output: ${truncate(stdout)}`;
  }
  const keys = ["relations", "private", "history"];
  if (!state || typeof state !== "object" || Array.isArray(state) || Object.keys(state).length !== keys.length ||
      !keys.every((k) => Number.isInteger(state[k]))) {
    return `unexpected empty-state output: ${truncate(stdout)}`;
  }
  return keys.every((k) => state[k] === 0) ? null : `the fresh database is not empty: ${JSON.stringify(state)}`;
}

// ---------------------------------------------------------------------------------------------
// Snapshots (pure)
// ---------------------------------------------------------------------------------------------

// A sequence's state as one comparable value: null while it is unused (never called and at its
// start value), else its last value, marked when is_called is false (setval(..., false) or
// ALTER SEQUENCE ... RESTART: the next nextval returns exactly that value).
export function sequenceState(lastValue, isCalled, startValue) {
  if (isCalled) return lastValue;
  return lastValue === startValue ? null : `${lastValue} (not called)`;
}

// Each output line is one JSON document: {"type":"table",...} per relation, then
// {"type":"sequences",...} ([last_value, is_called, start_value] read from each sequence),
// {"type":"state",...} (hashes of cluster-wide state, of the database's properties and of the
// within-run state: role passwords, replication slots and origins; the list of event triggers)
// and {"type":"end"}. Every row is an object mapping each column to the text of its value: the
// type's output function, as JSON (numbers and booleans bare, everything else a JSON string,
// null as null), so numbers keep their exact text.
export function parseSnapshot(stdout) {
  const tables = new Map();
  let sequences = null;
  let relations = null;
  let state = null;
  let ended = false;
  for (const line of String(stdout).split("\n")) {
    if (line.trim() === "") continue;
    if (ended) throw new CanaryError("R7", `unexpected snapshot output after the end marker: ${truncate(line)}`);
    let doc;
    try {
      doc = JSON.parse(line);
    } catch {
      throw new CanaryError("R7", `unparsable snapshot output: ${truncate(line)}`);
    }
    if (doc?.type === "table") {
      const ok =
        typeof doc.key === "string" && typeof doc.schema === "string" && typeof doc.name === "string" &&
        ["r", "p", "m"].includes(doc.kind) && typeof doc.populated === "boolean" &&
        Array.isArray(doc.columns) && doc.columns.every((c) => typeof c === "string") && Array.isArray(doc.rows);
      if (!ok) throw new CanaryError("R7", `malformed snapshot entry: ${truncate(line)}`);
      if (tables.has(doc.key)) throw new CanaryError("R7", `duplicate snapshot entry for ${doc.key}`);
      const columnSet = new Set(doc.columns);
      for (const row of doc.rows) {
        const keys = row && typeof row === "object" && !Array.isArray(row) ? Object.keys(row) : null;
        if (!keys || keys.length !== columnSet.size || !keys.every((k) => columnSet.has(k) && typeof row[k] === "string")) {
          throw new CanaryError("R7", `malformed row in the snapshot of ${doc.key}`);
        }
      }
      tables.set(doc.key, { key: doc.key, schema: doc.schema, name: doc.name, kind: doc.kind, populated: doc.populated, columns: doc.columns, rows: doc.rows });
    } else if (doc?.type === "sequences") {
      const values = doc.values;
      const number = (v) => typeof v === "string" && /^-?[0-9]+$/.test(v);
      if (sequences !== null || !Number.isInteger(doc.relations) || !values || typeof values !== "object" || Array.isArray(values) ||
          !Object.values(values).every((v) => Array.isArray(v) && v.length === 3 && number(v[0]) && typeof v[1] === "boolean" && number(v[2]))) {
        throw new CanaryError("R7", `malformed sequence snapshot: ${truncate(line)}`);
      }
      sequences = new Map(Object.entries(values).map(([key, [last, called, start]]) => [key, sequenceState(last, called, start)]));
      relations = doc.relations;
    } else if (doc?.type === "state") {
      const hash = (v) => typeof v === "string" && /^[0-9a-f]{32}$/.test(v);
      const names = (v) => Array.isArray(v) && v.every((e) => typeof e === "string");
      if (state !== null || !hash(doc.cluster) || !hash(doc.database) || !hash(doc.local) || !names(doc.events) || !names(doc.types)) {
        throw new CanaryError("R7", `malformed state entry: ${truncate(line)}`);
      }
      state = { cluster: doc.cluster, database: doc.database, local: doc.local, events: doc.events, types: doc.types };
    } else if (doc?.type === "end") {
      ended = true;
    } else {
      throw new CanaryError("R7", `unexpected snapshot output: ${truncate(line)}`);
    }
  }
  if (!ended || sequences === null || state === null) throw new CanaryError("R7", "incomplete snapshot output (no sequences, state or end marker)");
  if (relations !== tables.size) throw new CanaryError("R7", `snapshot holds ${tables.size} relations, the catalog lists ${relations}`);
  if (tables.size === 0) throw new CanaryError("R7", "empty snapshot: a Supabase database always has tables (auth, storage)");
  return { tables, sequences, state };
}

export const isProtected = (table) => PROTECTED_SCHEMAS.includes(table.schema);
// Sequence keys are quote_ident(schema).quote_ident(name); public and private never need quotes.
export const isProtectedSequence = (key) => PROTECTED_SCHEMAS.some((schema) => key.startsWith(`${schema}.`));
const isBookkeeping = (key) => BOOKKEEPING_TABLES.has(key);

// A masked value keeps its shape: every run of hexadecimal characters becomes one 0, so a random
// UUID, a timestamp or a random number still compares equal across runs, while text copied into
// a column that is volatile in the reference runs (for example coalesce(<data>, a random UUID))
// does not.
export function valueShape(value) {
  return String(value).replace(SHAPE_RE, "0");
}

export function rowKey(row, columns, mask = null) {
  return JSON.stringify(columns.map((column) => {
    const value = row[column];
    if (typeof value !== "string") throw new CanaryError("R7", `row has no value for column ${column}`);
    return mask && mask.has(column) && value !== "null" ? `${MASK}${valueShape(value)}` : value;
  }));
}

export function multisetDiff(aKeys, bKeys) {
  const counts = new Map();
  for (const key of aKeys) counts.set(key, (counts.get(key) ?? 0) + 1);
  const onlyB = [];
  for (const key of bKeys) {
    const n = counts.get(key) ?? 0;
    if (n > 0) counts.set(key, n - 1);
    else onlyB.push(key);
  }
  const onlyA = [];
  for (const [key, n] of counts) for (let i = 0; i < n; i += 1) onlyA.push(key);
  return { onlyA, onlyB };
}

const sameList = (a, b) => a.length === b.length && a.every((x, i) => x === b[i]);

// R1 for one table: every row that existed before must still exist unchanged; a column added by
// the migration must be JSON null on it. Returns the problems and the rows the step added.
export function compareRetained(before, after) {
  const dropped = before.columns.filter((c) => !after.columns.includes(c));
  const added = after.columns.filter((c) => !before.columns.includes(c));
  if (before.rows.length === 0) return { problems: [], addedRows: after.rows.slice() };
  if (dropped.length > 0) {
    return {
      problems: [{ message: `column(s) ${dropped.join(", ")} dropped: values of ${before.rows.length} existing row(s) removed` }],
      addedRows: [],
    };
  }
  const eligible = [];
  const addedRows = [];
  for (const row of after.rows) (added.every((c) => row[c] === "null") ? eligible : addedRows).push(row);
  const pool = new Map();
  eligible.forEach((row, index) => {
    const key = rowKey(row, before.columns);
    if (!pool.has(key)) pool.set(key, []);
    pool.get(key).push(index);
  });
  const missing = [];
  for (const row of before.rows) {
    const key = rowKey(row, before.columns);
    const slot = pool.get(key);
    if (slot && slot.length > 0) slot.pop();
    else missing.push(key);
  }
  for (const indexes of pool.values()) for (const index of indexes) addedRows.push(eligible[index]);
  const problems = [];
  if (missing.length > 0) {
    const what = added.length > 0 ? ` (or a new column ${added.join(", ")} was filled on it)` : "";
    problems.push({ message: `${missing.length} existing row(s) changed or removed${what}`, samples: samples(missing, "before") });
  }
  return { problems, addedRows };
}

function samples(keys, label) {
  return keys.slice(0, MAX_SAMPLES).map((key) => `${label}: ${truncate(redact(key))}`);
}

export function truncate(text, max = SAMPLE_CHARS) {
  const s = String(text).replace(/\s+/g, " ");
  return s.length > max ? `${s.slice(0, max)}…` : s;
}

// R4 for one run: outside public/private, nothing may change between two snapshots.
export function outsideChanges(before, after) {
  const problems = [];
  for (const t of before.tables.values()) {
    if (isProtected(t) || isBookkeeping(t.key)) continue;
    const a = after.tables.get(t.key);
    if (!a) {
      if (t.rows.length > 0) problems.push({ table: t.key, message: `table dropped with ${t.rows.length} row(s)` });
      continue;
    }
    if (!sameList(t.columns, a.columns) || t.kind !== a.kind) {
      if (t.rows.length > 0 || a.rows.length > 0) problems.push({ table: t.key, message: "definition changed on a table with rows" });
      continue;
    }
    const diff = multisetDiff(t.rows.map((r) => rowKey(r, t.columns)), a.rows.map((r) => rowKey(r, a.columns)));
    if (diff.onlyA.length > 0 || diff.onlyB.length > 0) {
      problems.push({
        table: t.key,
        message: `${diff.onlyB.length} row(s) added or changed, ${diff.onlyA.length} row(s) removed or changed`,
        samples: [...samples(diff.onlyA, "before"), ...samples(diff.onlyB, "after")],
      });
    }
  }
  for (const a of after.tables.values()) {
    if (isProtected(a) || isBookkeeping(a.key) || before.tables.has(a.key)) continue;
    if (a.rows.length > 0) {
      problems.push({ table: a.key, message: `new table holds ${a.rows.length} row(s)`, samples: samples(a.rows.map((r) => rowKey(r, a.columns)), "row") });
    }
  }
  // Sequences outside public/private: none changes on its own (measured), so a state that
  // changes, or appears or disappears while used, is an effect of the migration (a data-dependent
  // nextval, or setval / ALTER SEQUENCE ... RESTART, which may carry a value derived from data).
  for (const key of new Set([...before.sequences.keys(), ...after.sequences.keys()])) {
    if (isProtectedSequence(key)) continue;
    const had = before.sequences.has(key);
    const has = after.sequences.has(key);
    const v1 = had ? before.sequences.get(key) : null;
    const v2 = has ? after.sequences.get(key) : null;
    if ((had && has && v1 !== v2) || (!had && v2 !== null) || (!has && v1 !== null)) {
      problems.push({ table: key, message: `sequence ${had ? v1 ?? "unused" : "absent"} -> ${has ? v2 ?? "unused" : "absent"}` });
    }
  }
  return problems;
}

// Within one run (R4, R7): state that differs between runs on its own (role passwords carry
// random salts) but that no migration may change: role passwords, replication slots and origins
// (a hash), and event triggers (the list); and base types that are not owned by a superuser, which
// may exist at no point. Unit snapshots carry no schema state: nothing to compare.
export function withinRunChanges(before, after) {
  const s1 = before.schema;
  const s2 = after.schema;
  if (!s1 || !s2) return [];
  const problems = [];
  if (s2.types.length > 0) {
    problems.push({
      rule: "R7",
      message: `base type(s) not created by a superuser (pg_tle create_base_type): ${s2.types.slice(0, MAX_SAMPLES).map((e) => truncate(e, 80)).join("; ")}; its output function could hide stored values from the snapshot`,
    });
  }
  if (s1.local !== s2.local) {
    problems.push({ rule: "R4", message: "a role password, replication slot or replication origin was set, changed or removed (a migration never carries a password; a slot keeps WAL and survives the transaction)" });
  }
  if (!sameList(s1.events, s2.events)) {
    const added = s2.events.filter((e) => !s1.events.includes(e));
    const removed = s1.events.filter((e) => !s2.events.includes(e));
    problems.push({
      rule: "R7",
      message: `event triggers changed (added: ${added.slice(0, MAX_SAMPLES).map((e) => truncate(e, 80)).join("; ") || "none"}; removed: ${removed.slice(0, MAX_SAMPLES).map((e) => truncate(e, 80)).join("; ") || "none"}): an event trigger runs code on later logins or DDL, which this check cannot see`,
    });
  }
  return problems;
}

// Unified schema state of one snapshot point (R3, R7): pg_dump text plus hashes of cluster-wide
// state and of the database's own properties. Returns null when equal, else a short description.
export function schemaDifference(s1, s2, labels = ["first", "second"]) {
  if (!s1 || !s2) return null;
  if (s1.cluster !== s2.cluster) return "cluster-wide state differs (roles, role memberships, role settings or comments)";
  if (s1.database !== s2.database) return "database properties differ (settings, comment, privileges or owner)";
  if (s1.dump === s2.dump) return null;
  return `the schema dump differs at ${firstDifference(s1.dump, s2.dump, labels)}`;
}

// Where two texts differ, for messages (both sides truncated and redacted). Comment and blank
// lines are skipped, so the message names the changed statement rather than an unrelated
// "-- Name:" header; a line present on one side only is reported as such.
export function firstDifference(a, b, [nameA, nameB] = ["first", "second"]) {
  const significant = (text) => String(text).split("\n")
    .map((line, index) => ({ line, index }))
    .filter(({ line }) => line.trim() !== "" && !line.startsWith("--"));
  let la = significant(a);
  let lb = significant(b);
  let i = 0;
  while (i < la.length && i < lb.length && la[i].line === lb[i].line) i += 1;
  if (i === la.length && i === lb.length) {
    // The texts differ only in comment or blank lines: compare every line.
    la = String(a).split("\n").map((line, index) => ({ line, index }));
    lb = String(b).split("\n").map((line, index) => ({ line, index }));
    i = 0;
    while (i < la.length && i < lb.length && la[i].line === lb[i].line) i += 1;
  }
  const show = (entry) => JSON.stringify(truncate(redact(entry.line), 120));
  const left = la[i];
  const right = lb[i];
  const laterIn = (list, line) => list.slice(i + 1).some((entry) => entry.line === line);
  if (left && right) {
    if (laterIn(lb, left.line)) return `line ${right.index + 1}: only in ${nameB}: ${show(right)}`;
    if (laterIn(la, right.line)) return `line ${left.index + 1}: only in ${nameA}: ${show(left)}`;
    return `line ${left.index + 1}: ${nameA} ${show(left)} | ${nameB} ${show(right)}`;
  }
  if (right) return `line ${right.index + 1}: only in ${nameB}: ${show(right)}`;
  if (left) return `line ${left.index + 1}: only in ${nameA}: ${show(left)}`;
  return "an unknown line";
}

// `pg_dump --binary-upgrade` output, made comparable: pg_dump 17.6 and later frame the dump with
// \restrict / \unrestrict and a random key (dropped); binary-upgrade mode pins object ids (also
// of an extension's configuration tables and of TOAST tables) and sets each table's relfrozenxid
// and relminmxid, which differ between runs on their own. Those numbers become placeholders; the
// statements stay, so their count and targets are still compared. It also dumps each sequence's
// state (setval); that state is compared by the sequence rules instead (R2, R4, R5, with clearer
// messages), so its value and is_called become placeholders here too.
export function normalizeDump(text) {
  return String(text).split("\n")
    .filter((line) => !/^\\(un)?restrict(\s|$)/.test(line))
    .map((line) => {
      if (line.startsWith("SELECT pg_catalog.binary_upgrade_create_empty_extension(")) return line.replace(/'\{[0-9,]+\}'/g, "'{<oid>}'");
      return line
        .replace(/^(SELECT pg_catalog\.binary_upgrade_set_next_[a-z_]+\(')[0-9]+('::pg_catalog\.oid\);)$/, "$1<oid>$2")
        .replace(/^SET relfrozenxid = '[0-9]+', relminmxid = '[0-9]+'$/, "SET relfrozenxid = '<xid>', relminmxid = '<mxid>'")
        .replace(/^WHERE oid = '[0-9]+';$/, "WHERE oid = '<oid>';")
        .replace(/^(SELECT pg_catalog\.setval\(.*), -?[0-9]+, (?:true|false)\);$/, "$1, <value>, <is_called>);");
    })
    .join("\n");
}

// Containers of the same project other than its database (auth, storage, realtime ...) write to
// the database on their own; the check needs them stopped.
export function otherProjectContainers(names, projectId, container) {
  return names.filter((name) => name !== container && name.startsWith("supabase_") && name.endsWith(`_${projectId}`));
}

// The columns whose values differ between two row lists of the same length (per column, as
// multisets): the volatile columns of R5.
export function volatileColumns(columns, rows1, rows2) {
  const out = new Set();
  for (const column of columns) {
    const v1 = rows1.map((r) => r[column]).sort();
    const v2 = rows2.map((r) => r[column]).sort();
    if (!sameList(v1, v2)) out.add(column);
  }
  return out;
}

// Multiset intersection of two value lists.
function commonValues(values1, values2) {
  const counts = new Map();
  for (const v of values1) counts.set(v, (counts.get(v) ?? 0) + 1);
  const out = [];
  for (const v of values2) {
    const n = counts.get(v) ?? 0;
    if (n > 0) {
      counts.set(v, n - 1);
      out.push(v);
    }
  }
  return out;
}

function groupRows(rows, columns, mask) {
  const groups = new Map();
  for (const row of rows) {
    const key = rowKey(row, columns, mask);
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(row);
  }
  return groups;
}

// R5 mask of one table for one comparison, from the same rows in A1 (rows1) and A2 (rows2): the
// volatile columns, refined per group of rows that agree on every other column (the group key is
// the row with the volatile columns masked). A column is masked in a group only if it differs in
// that group, and its values that are equal in both reference runs ("fixed") must also appear in
// the canary run: so a deterministic row added next to a now() row, or a deterministic value next
// to a random one, cannot carry data (review round 1, F5). Returns null when nothing is volatile.
export function maskSpec(columns, rows1, rows2) {
  const all = volatileColumns(columns, rows1, rows2);
  if (all.size === 0) return null;
  const groups = new Map();
  const g2 = groupRows(rows2, columns, all);
  for (const [key, list1] of groupRows(rows1, columns, all)) {
    const list2 = g2.get(key) ?? [];
    const mask = volatileColumns([...all], list1, list2);
    const fixed = new Map();
    for (const column of mask) {
      const common = commonValues(list1.map((r) => r[column]), list2.map((r) => r[column]));
      if (common.length > 0) fixed.set(column, common);
    }
    groups.set(key, { mask, fixed });
  }
  return { columns: all, groups };
}

// A plain Set of columns (unit tests) is a mask without groups.
const asSpec = (spec) => (spec instanceof Set ? { columns: spec, groups: new Map() } : spec);

export function maskedKey(row, columns, spec) {
  const s = asSpec(spec);
  if (!s || s.columns.size === 0) return rowKey(row, columns);
  const group = s.groups.get(rowKey(row, columns, s.columns));
  return rowKey(row, columns, group ? group.mask : s.columns);
}

// Compares two row lists under a mask spec: the multiset difference of the masked rows, plus the
// fixed values of masked columns that the second list lacks.
export function compareMasked(columns, rowsA, rowsB, spec) {
  const s = asSpec(spec);
  const diff = multisetDiff(rowsA.map((r) => maskedKey(r, columns, s)), rowsB.map((r) => maskedKey(r, columns, s)));
  const fixedMissing = [];
  if (s && s.groups.size > 0) {
    const groupsB = groupRows(rowsB, columns, s.columns);
    for (const [key, group] of s.groups) {
      for (const [column, values] of group.fixed) {
        const missing = multisetDiff(values, (groupsB.get(key) ?? []).map((r) => r[column])).onlyA;
        for (const value of missing) fixedMissing.push({ column, value });
      }
    }
  }
  return { ...diff, fixedMissing };
}

const differs = (d) => d.onlyA.length > 0 || d.onlyB.length > 0 || d.fixedMissing.length > 0;

// R5 / R7: run the reference chain twice. Masks are found per snapshot point (whole tables, for
// the determinism check) and per migration step (stepMasks[k]: for a table that existed before
// migration k, from the rows k adds in A1 and in A2; for a table k creates, from its rows), so a
// column that is volatile in earlier rows (a now() default of reference rows) never hides data in
// rows a later migration adds; within a step, masks are refined per group of rows (maskSpec).
// Anything else that differs is nondeterminism (R7). Only public and private are compared across
// runs (R2, R3); outside them each run is compared with itself (R4), because every fresh reset
// writes its own initialisation timestamps there.
export function evaluateDeterminism(runA1, runA2) {
  const violations = [];
  const stepMasks = [];
  const masked = [];
  if (runA1.length !== runA2.length) {
    return { stepMasks, masked, violations: [{ rule: "R7", message: "the reference runs took a different number of snapshots" }] };
  }
  const protectedKeys = (s1, s2) => [...new Set([...s1.tables.keys(), ...s2.tables.keys()])]
    .filter((key) => isProtected(s1.tables.get(key) ?? s2.tables.get(key)) && !isBookkeeping(key));
  for (let i = 0; i < runA1.length; i += 1) {
    const s1 = runA1[i];
    const s2 = runA2[i];
    for (const key of protectedKeys(s1, s2)) {
      const t1 = s1.tables.get(key);
      const t2 = s2.tables.get(key);
      if (!t1 || !t2 || !sameList(t1.columns, t2.columns) || t1.kind !== t2.kind) {
        violations.push({ rule: "R7", point: i, table: key, message: "table definition differs between the two reference runs" });
      } else if (t1.rows.length !== t2.rows.length) {
        violations.push({ rule: "R7", point: i, table: key, message: `row count differs between the reference runs (${t1.rows.length} vs ${t2.rows.length})` });
      }
    }
    const seqKeys = new Set([...s1.sequences.keys(), ...s2.sequences.keys()].filter(isProtectedSequence));
    for (const key of seqKeys) {
      if (s1.sequences.get(key) !== s2.sequences.get(key)) {
        violations.push({ rule: "R7", point: i, table: key, message: "sequence state differs between the two reference runs" });
      }
    }
    const schema = schemaDifference(s1.schema, s2.schema, ["run A1", "run A2"]);
    if (schema) violations.push({ rule: "R7", point: i, message: `schema differs between the two reference runs (nondeterministic DDL): ${schema}` });
  }
  if (violations.length > 0) return { stepMasks, masked, violations };
  const pointMasks = runA1.map((s1, i) => {
    const masks = new Map();
    for (const key of protectedKeys(s1, runA2[i])) {
      const t1 = s1.tables.get(key);
      const t2 = runA2[i].tables.get(key);
      const spec = maskSpec(t1.columns, t1.rows, t2.rows);
      if (spec) masks.set(key, spec);
      if (differs(compareMasked(t1.columns, t1.rows, t2.rows, spec))) {
        violations.push({ rule: "R7", point: i, table: key, message: "rows differ between the reference runs beyond the volatile columns" });
      }
    }
    return masks;
  });
  for (let k = 0; k + 1 < runA1.length; k += 1) {
    const masks = new Map();
    for (const key of protectedKeys(runA1[k + 1], runA2[k + 1])) {
      const after1 = runA1[k + 1].tables.get(key);
      const before1 = runA1[k].tables.get(key);
      const before2 = runA2[k].tables.get(key);
      let spec = pointMasks[k + 1].get(key) ?? null;
      if (before1 && before2) {
        const added1 = compareRetained(before1, after1).addedRows;
        const added2 = compareRetained(before2, runA2[k + 1].tables.get(key)).addedRows;
        if (added1.length !== added2.length) {
          violations.push({ rule: "R7", point: k + 1, table: key, message: `the reference runs added a different number of rows (${added1.length} vs ${added2.length})` });
          continue;
        }
        spec = maskSpec(after1.columns, added1, added2);
        if (differs(compareMasked(after1.columns, added1, added2, spec))) {
          violations.push({ rule: "R7", point: k + 1, table: key, message: "rows added differ between the reference runs beyond the volatile columns" });
        }
      }
      if (spec) {
        masks.set(key, spec);
        masked.push(`${key}(${[...spec.columns].join(", ")}) at migration ${k + 1}`);
      }
    }
    stepMasks.push(masks);
  }
  return { stepMasks, masked, violations };
}

function compareRows(tA, tB, spec) {
  return compareMasked(tA.columns, tA.rows, tB.rows, spec);
}

function fixedSamples(d) {
  return d.fixedMissing.slice(0, MAX_SAMPLES).map((f) => `reference run value of masked column ${f.column}, equal in A1 and A2, missing in the canary run: ${truncate(redact(f.value))}`);
}

// One migration step: a = reference run A1, b = canary run B; each { before, after } snapshot;
// masks = this step's masks from evaluateDeterminism.
export function evaluateMigrationStep({ a, b, masks = new Map() }) {
  const violations = [];
  const runs = [["reference run", a], ["canary run", b]];
  for (const [run, s] of runs) {
    for (const p of outsideChanges(s.before, s.after)) violations.push({ rule: "R4", run, ...p });
    for (const p of withinRunChanges(s.before, s.after)) violations.push({ run, ...p });
  }
  const added = { "reference run": new Map(), "canary run": new Map() };
  for (const [run, s] of runs) {
    for (const t of s.before.tables.values()) {
      if (!isProtected(t) || isBookkeeping(t.key)) continue;
      const after = s.after.tables.get(t.key);
      if (!after) {
        if (t.rows.length > 0) violations.push({ rule: "R1", run, table: t.key, message: `table dropped with ${t.rows.length} row(s)` });
        continue;
      }
      // compareRetained also reports the lost rows; this branch only names the cause.
      if (t.kind === "m" && after.kind === "m" && t.populated && !after.populated && t.rows.length > 0) {
        violations.push({ rule: "R1", run, table: t.key, message: "materialized view emptied (WITH NO DATA)" });
        continue;
      }
      const result = compareRetained(t, after);
      for (const p of result.problems) violations.push({ rule: "R1", run, table: t.key, ...p });
      added[run].set(t.key, { columns: after.columns, rows: result.addedRows });
    }
  }
  const protectedKeys = (snap) => [...snap.tables.values()].filter((t) => isProtected(t) && !isBookkeeping(t.key)).map((t) => t.key);
  for (const key of new Set([...protectedKeys(a.after), ...protectedKeys(b.after)])) {
    const tA = a.after.tables.get(key);
    const tB = b.after.tables.get(key);
    if (!tA || !tB || tA.kind !== tB.kind || !sameList(tA.columns, tB.columns)) {
      violations.push({ rule: "R3", table: key, message: `schema after the migration differs between the runs (${tA ? "present" : "missing"} in the reference run, ${tB ? "present" : "missing"} in the canary run)` });
    }
  }
  const schema = schemaDifference(a.after.schema, b.after.schema, ["reference run", "canary run"]);
  if (schema) violations.push({ rule: "R3", message: `schema after the migration differs between the runs (data written into the schema): ${schema}` });
  if (violations.length > 0) return violations;
  for (const [key, addedA] of added["reference run"]) {
    const addedB = added["canary run"].get(key);
    if (!addedB) continue;
    const diff = compareRows(addedA, addedB, masks.get(key));
    if (differs(diff)) {
      violations.push({
        rule: "R2",
        table: key,
        message: `rows added differ between the runs (reference run added ${addedA.rows.length}, canary run added ${addedB.rows.length})`,
        samples: [...samples(diff.onlyB, "canary run only"), ...samples(diff.onlyA, "reference run only"), ...fixedSamples(diff)].slice(0, 2 * MAX_SAMPLES),
      });
    }
  }
  for (const key of protectedKeys(a.after)) {
    if (a.before.tables.has(key)) continue;
    const diff = compareRows(a.after.tables.get(key), b.after.tables.get(key), masks.get(key));
    if (differs(diff)) {
      violations.push({
        rule: "R3",
        table: key,
        message: `new ${a.after.tables.get(key).kind === "m" ? "materialized view" : "table"} holds different rows in the runs (reference run ${a.after.tables.get(key).rows.length}, canary run ${b.after.tables.get(key).rows.length})`,
        samples: [...samples(diff.onlyB, "canary run only"), ...samples(diff.onlyA, "reference run only"), ...fixedSamples(diff)].slice(0, 2 * MAX_SAMPLES),
      });
    }
  }
  if (violations.length > 0) return violations;
  // Sequence states before the migration are equal in both runs as long as every earlier step
  // passed and R5 held for every fixture; comparing them too keeps the check self-contained.
  const differing = [];
  const state = (snap, key) => (snap.sequences.has(key) ? snap.sequences.get(key) ?? "unused" : "absent");
  for (const key of new Set([...a.after.sequences.keys(), ...b.after.sequences.keys()].filter(isProtectedSequence))) {
    if (state(a.before, key) !== state(b.before, key) || state(a.after, key) !== state(b.after, key)) {
      differing.push(`${key} (reference run ${state(a.before, key)} -> ${state(a.after, key)}, canary run ${state(b.before, key)} -> ${state(b.after, key)})`);
    }
  }
  if (differing.length > 0) {
    violations.push({ rule: "R2", message: `sequence(s) changed differently in the runs (data-dependent nextval or setval): ${differing.slice(0, MAX_LISTED).join("; ")}` });
  }
  return violations;
}

const EMAIL_RE = /[A-Za-z0-9._%+-]+@([A-Za-z0-9-]+(?:\.[A-Za-z0-9-]+)+)/g;

export function foreignEmailDomains(text) {
  const domains = [];
  for (const match of String(text).matchAll(EMAIL_RE)) {
    const domain = match[1].toLowerCase();
    if (domain !== "example.test" && !domain.endsWith(".example.test")) domains.push(domain);
  }
  return domains;
}

// A fixture only adds rows (R7), keeps test markers and example.test addresses (R7, D47) and
// consumes no sequence (R5).
export function evaluateFixtureStep(before, after) {
  const violations = [];
  const schema = schemaDifference(before.schema, after.schema, ["before", "after"]);
  if (schema) violations.push({ rule: "R7", message: `a fixture must not change the schema: ${schema}` });
  for (const p of withinRunChanges(before, after)) violations.push({ rule: "R7", message: `a fixture must only add rows: ${p.message}` });
  const keys = new Set([...before.tables.keys(), ...after.tables.keys()]);
  for (const key of keys) {
    if (isBookkeeping(key)) continue;
    const tB = before.tables.get(key);
    const tA = after.tables.get(key);
    if (!tB || !tA || !sameList(tB.columns, tA.columns) || tB.kind !== tA.kind) {
      violations.push({ rule: "R7", table: key, message: "a fixture must not change the schema" });
      continue;
    }
    const result = compareRetained(tB, tA);
    for (const p of result.problems) violations.push({ rule: "R7", table: key, message: `a fixture must only add rows: ${p.message}`, samples: p.samples });
    for (const row of result.addedRows) {
      if (tA.columns.includes("is_test") && row.is_test !== "true") {
        violations.push({ rule: "R7", table: key, message: "a fixture row must be test-marked (is_test = true, D47)", samples: samples([rowKey(row, tA.columns)], "row") });
        break;
      }
      const domains = foreignEmailDomains(tA.columns.map((c) => row[c]).join(" "));
      if (domains.length > 0) {
        violations.push({ rule: "R7", table: key, message: `a fixture e-mail address must use example.test (found ${[...new Set(domains)].join(", ")})` });
        break;
      }
    }
  }
  if (violations.length > 0) return violations;
  const changed = [];
  for (const key of new Set([...before.sequences.keys(), ...after.sequences.keys()])) {
    const state = (snap) => (snap.sequences.has(key) ? snap.sequences.get(key) ?? "unused" : "absent");
    if (state(before) !== state(after)) changed.push(`${key} (${state(before)} -> ${state(after)})`);
  }
  if (changed.length > 0) {
    violations.push({ rule: "R5", message: `the fixture consumed sequence value(s): ${changed.slice(0, MAX_LISTED).join("; ")}; insert explicit ids (OVERRIDING SYSTEM VALUE for identity columns)` });
  }
  return violations;
}

// R6: every table in public/private has a row and every column a non-null value somewhere.
export function evaluateCoverage(snapshot, exceptions = []) {
  const gaps = [];
  for (const t of snapshot.tables.values()) {
    if (!isProtected(t) || t.kind === "m" || isBookkeeping(t.key)) continue;
    if (exceptions.some((e) => e.table === t.key && e.column === null)) continue;
    if (t.rows.length === 0) {
      gaps.push({ table: t.key, column: null });
      continue;
    }
    for (const column of t.columns) {
      if (exceptions.some((e) => e.table === t.key && e.column === column)) continue;
      if (t.rows.every((r) => r[column] === "null")) gaps.push({ table: t.key, column });
    }
  }
  return gaps;
}

export function coverageStats(snapshot, exceptions = []) {
  let tables = 0;
  let columns = 0;
  for (const t of snapshot.tables.values()) {
    if (!isProtected(t) || t.kind === "m" || isBookkeeping(t.key)) continue;
    tables += 1;
    columns += t.columns.length;
  }
  return { tables, columns, exceptions: exceptions.length };
}

// The exceptions that name a table (and column) missing from one snapshot.
export function staleExceptions(snapshot, exceptions) {
  return exceptions.filter((e) => {
    const t = snapshot.tables.get(e.table);
    return !t || (e.column !== null && !t.columns.includes(e.column));
  });
}

// The file of exceptions is global (not per migration): an entry is stale when its table (and
// column) exists after NO step of the chain. An entry for a table that a later migration drops
// stays valid, because it applied to the steps before the drop.
export function unusedExceptions(snapshots, exceptions) {
  return exceptions.filter((e) => snapshots.every((s) => staleExceptions(s, [e]).length === 1));
}

export function redact(text) {
  return String(text)
    .replace(/eyJ[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}\.[A-Za-z0-9_-]{8,}/g, "[redacted]")
    .replace(/sb_(?:secret|publishable)_[A-Za-z0-9_-]+/g, "[redacted]")
    .replace(/\b(key|secret|password|token)(\s*[:=]\s*)\S+/gi, "$1$2[redacted]")
    .replace(/postgres(?:ql)?:\/\/\S+/g, "[redacted-url]");
}

export function psqlError(stderr) {
  const lines = String(stderr).split("\n").filter((l) => /\b(ERROR|FATAL|DETAIL|HINT|CONTEXT):/.test(l) || /^LINE \d+:/.test(l));
  return truncate(redact((lines.length > 0 ? lines : String(stderr).trim().split("\n").slice(-3)).join(" | ")), 400);
}

export function formatViolations(violations, context) {
  const lines = [];
  for (const v of violations.slice(0, MAX_LISTED)) {
    const where = [context, v.run, v.table].filter(Boolean).join(", ");
    lines.push(`  ${v.rule} (${RULES[v.rule]}) — ${where}: ${v.message}`);
    for (const s of v.samples ?? []) lines.push(`      ${s}`);
  }
  if (violations.length > MAX_LISTED) lines.push(`  … and ${violations.length - MAX_LISTED} more`);
  return lines.join("\n");
}

function throwIf(violations, context) {
  if (violations.length === 0) return;
  throw new CanaryError(violations[0].rule, formatViolations(violations, context));
}

// ---------------------------------------------------------------------------------------------
// Local database (Docker); every command is an argv array, never a shell string
// ---------------------------------------------------------------------------------------------

function run(command, args, { input, timeoutMs = 10 * 60_000 } = {}) {
  const result = spawnSync(command, args, {
    input,
    encoding: "utf8",
    maxBuffer: 1024 * 1024 * 1024,
    timeout: timeoutMs,
    killSignal: "SIGKILL",
  });
  if (result.error) throw infraError(`${command} could not run (${result.error.code ?? result.error.message})`);
  if (result.signal) throw infraError(`${command} was stopped (${result.signal})`);
  return result;
}

function psql(ctx, { role, db, input, args = [] }) {
  return run("docker", ["exec", "-i", ctx.container, "psql", "-X", "-q", "-A", "-t", "-v", "ON_ERROR_STOP=1", "-U", role, "-d", db, ...args], { input });
}

function admin(ctx, statements, what) {
  const result = psql(ctx, { role: "supabase_admin", db: "template1", args: statements.flatMap((s) => ["-c", s]) });
  if (result.status !== 0) throw infraError(`${what} failed: ${psqlError(result.stderr)}`);
  return result.stdout.trim();
}

function sleepMs(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

const COPY_PROPERTIES = (target, source) => `do $$
declare
  v_src oid := (select oid from pg_catalog.pg_database where datname = '${source}');
  v_dst oid := (select oid from pg_catalog.pg_database where datname = '${target}');
begin
  execute pg_catalog.format('alter database %I owner to %I', '${target}',
    (select pg_catalog.pg_get_userbyid(datdba) from pg_catalog.pg_database where oid = v_src));
  delete from pg_catalog.pg_db_role_setting where setdatabase = v_dst;
  insert into pg_catalog.pg_db_role_setting (setdatabase, setrole, setconfig)
    select v_dst, setrole, setconfig from pg_catalog.pg_db_role_setting where setdatabase = v_src;
  update pg_catalog.pg_database d set datacl = s.datacl, datconnlimit = s.datconnlimit
    from pg_catalog.pg_database s where s.oid = v_src and d.oid = v_dst;
  delete from pg_catalog.pg_shdescription where objoid = v_dst and classoid = 'pg_catalog.pg_database'::pg_catalog.regclass;
  insert into pg_catalog.pg_shdescription (objoid, classoid, description)
    select v_dst, classoid, description from pg_catalog.pg_shdescription
    where objoid = v_src and classoid = 'pg_catalog.pg_database'::pg_catalog.regclass;
end
$$`;

// Owner, encoding, locale, ACL, connection limit, database-level settings and comment. Setting
// values (the local JWT secret is one) stay inside the database: only a comparison is returned.
const SAME_PROPERTIES = (a, b) => `select count(distinct h) = 1 and count(*) = 2 from (
  select pg_catalog.md5((pg_catalog.to_jsonb(d) - array['oid', 'datname', 'datfrozenxid', 'datminmxid'])::text
    || coalesce((select pg_catalog.string_agg(s.setrole::text || '=' || pg_catalog.array_to_string(s.setconfig, pg_catalog.chr(31)), pg_catalog.chr(30) order by s.setrole)
                 from pg_catalog.pg_db_role_setting s where s.setdatabase = d.oid), '')
    || coalesce((select pg_catalog.string_agg(x.description, pg_catalog.chr(30)) from pg_catalog.pg_shdescription x
                 where x.objoid = d.oid and x.classoid = 'pg_catalog.pg_database'::pg_catalog.regclass), '')) as h
  from pg_catalog.pg_database d where d.datname in ('${a}', '${b}')) s`;

// Cluster-wide state a migration could change and a database clone would not reset (roles,
// memberships, role settings, tablespaces, other databases). Only a hash leaves the database.
const CLUSTER_FINGERPRINT = `select pg_catalog.md5(coalesce(pg_catalog.string_agg(x, pg_catalog.chr(10) order by x), '')) from (
  select pg_catalog.concat_ws(':', 'role', rolname, rolsuper, rolinherit, rolcreaterole, rolcreatedb, rolcanlogin,
                              rolreplication, rolbypassrls, rolconnlimit, rolvaliduntil) as x from pg_catalog.pg_roles
  union all select pg_catalog.concat_ws(':', 'member', roleid::regrole, member::regrole, grantor::regrole, admin_option,
                                        inherit_option, set_option) from pg_catalog.pg_auth_members
  union all select pg_catalog.concat_ws(':', 'setting', setrole::regrole, pg_catalog.array_to_string(setconfig, ','))
            from pg_catalog.pg_db_role_setting where setdatabase = 0
  union all select pg_catalog.concat_ws(':', 'tablespace', spcname) from pg_catalog.pg_tablespace
  union all select pg_catalog.concat_ws(':', 'database', datname) from pg_catalog.pg_database
            where datname <> all (array['${PRISTINE_DB}', '${RUN_DB}'])
  union all select pg_catalog.concat_ws(':', 'comment', classoid::regclass, objoid, description) from pg_catalog.pg_shdescription
            where classoid <> 'pg_catalog.pg_database'::pg_catalog.regclass
  union all select pg_catalog.concat_ws(':', 'parameter', parname, paracl::text) from pg_catalog.pg_parameter_acl
  union all select pg_catalog.concat_ws(':', 'subscription', subname) from pg_catalog.pg_subscription) s`;

// Cluster-wide state that differs between two fresh resets on its own (role passwords carry
// random salts), so it is compared within one run only (R4): a migration may not set or change a
// role password (a precomputed verifier stores any 16 bytes verbatim) or create a replication slot
// or origin (named from data, non-transactional, and a slot keeps WAL). Only a hash leaves the
// database; the passwords are hashed inside it first.
const LOCAL_FINGERPRINT = `select pg_catalog.md5(coalesce(pg_catalog.string_agg(x, pg_catalog.chr(10) order by x), '')) from (
  select pg_catalog.concat_ws(':', 'password', rolname, pg_catalog.md5(rolpassword)) as x from pg_catalog.pg_authid
            where rolpassword is not null
  union all select pg_catalog.concat_ws(':', 'slot', slot_name, slot_type, plugin, database, temporary, two_phase, failover)
            from pg_catalog.pg_replication_slots
  union all select pg_catalog.concat_ws(':', 'origin', roname) from pg_catalog.pg_replication_origin) s`;

// The current database's event triggers (R7, within one run): one runs code on every later login or
// DDL command, an effect the check cannot see. Names and functions only. Event triggers that belong
// to an extension owned by a superuser come from the image's vetted extension scripts (pg_tle adds
// one), not from the migration's author, and are not listed; a postgres-owned extension (built
// with pg_tle) does not qualify.
const EVENT_TRIGGERS = `select coalesce(pg_catalog.jsonb_agg(pg_catalog.concat_ws(':', e.evtname, e.evtevent, e.evtenabled,
    e.evtfoid::pg_catalog.regprocedure::text, pg_catalog.array_to_string(e.evttags, ',')) order by e.evtname), '[]'::jsonb)
  from pg_catalog.pg_event_trigger e
  where not exists (
    select from pg_catalog.pg_depend d
    join pg_catalog.pg_extension x on x.oid = d.refobjid
    join pg_catalog.pg_roles r on r.oid = x.extowner
    where d.classid = 'pg_catalog.pg_event_trigger'::pg_catalog.regclass and d.objid = e.oid and d.deptype = 'e'
      and d.refclassid = 'pg_catalog.pg_extension'::pg_catalog.regclass and r.rolsuper)`;

// Base types (not arrays) owned by a role that is not a superuser (R7). CREATE TYPE for a base type
// needs a superuser, so such a type comes from a privileged path such as pg_tle's create_base_type,
// whose output function is ordinary code: it could show only part of a stored value, and the
// snapshot reads values through output functions.
const UNTRUSTED_TYPES = `select coalesce(pg_catalog.jsonb_agg(t.oid::pg_catalog.regtype::text order by t.oid::pg_catalog.regtype::text), '[]'::jsonb)
  from pg_catalog.pg_type t
  join pg_catalog.pg_roles r on r.oid = t.typowner
  where t.typtype = 'b' and t.typsubscript <> 'pg_catalog.array_subscript_handler'::pg_catalog.regproc and not r.rolsuper`;

// The current database's own properties (owner, privileges, connection limit, settings, comment).
// Setting values (the local JWT secret is one) stay inside the database: only a hash leaves it.
const DATABASE_FINGERPRINT = `select pg_catalog.md5(pg_catalog.concat_ws(pg_catalog.chr(30),
  (select pg_catalog.concat_ws(':', pg_catalog.pg_get_userbyid(d.datdba), d.datacl::text, d.datconnlimit, d.datallowconn)
     from pg_catalog.pg_database d where d.datname = pg_catalog.current_database()),
  (select pg_catalog.string_agg(s.setrole::regrole::text || '=' || pg_catalog.array_to_string(s.setconfig, pg_catalog.chr(31)), pg_catalog.chr(30) order by s.setrole)
     from pg_catalog.pg_db_role_setting s
     where s.setdatabase = (select oid from pg_catalog.pg_database where datname = pg_catalog.current_database())),
  (select pg_catalog.string_agg(x.description, pg_catalog.chr(30)) from pg_catalog.pg_shdescription x
     where x.classoid = 'pg_catalog.pg_database'::pg_catalog.regclass
       and x.objoid = (select oid from pg_catalog.pg_database where datname = pg_catalog.current_database()))))`;

// Clone mode: the whole cluster-wide state of the pristine copy (compared before each run), and the
// names of its roles, replication slots and origins (kept by restoreCluster).
const CLUSTER_STATE = `select (${CLUSTER_FINGERPRINT}) || (${LOCAL_FINGERPRINT})`;
const CLUSTER_NAMES = `select pg_catalog.jsonb_build_object(
  'roles', (select coalesce(pg_catalog.jsonb_agg(rolname::text order by rolname), '[]'::jsonb) from pg_catalog.pg_roles),
  'slots', (select coalesce(pg_catalog.jsonb_agg(slot_name::text order by slot_name), '[]'::jsonb) from pg_catalog.pg_replication_slots),
  'origins', (select coalesce(pg_catalog.jsonb_agg(roname order by roname), '[]'::jsonb) from pg_catalog.pg_replication_origin))::text`;

const EMPTY_STATE = `select pg_catalog.jsonb_build_object(
  'relations', (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace
                where n.nspname in ('public', 'private')),
  'private', (select count(*) from pg_catalog.pg_namespace where nspname = 'private'),
  'history', case when pg_catalog.to_regclass('supabase_migrations.schema_migrations') is null then 0
             else (pg_catalog.xpath('/row/c/text()', pg_catalog.query_to_xml(
               'select count(*) as c from supabase_migrations.schema_migrations', false, true, '')))[1]::text::int end)::text`;

const SYSTEM_SCHEMA_FILTER = (column) =>
  `${column} <> all (array['pg_catalog', 'information_schema', 'pg_toast']) and ${column} !~ '^pg_(toast_)?temp_'`;

// Snapshot relations: tables, partitioned tables and materialized views outside the system
// schemas, plus the two catalogs that hold user data (large objects), so R4 sees a migration that
// copies rows into a large object.
const SNAPSHOT_RELATIONS = `c.relkind in ('r', 'p', 'm') and (${SYSTEM_SCHEMA_FILTER("n.nspname")}
  or (n.nspname = 'pg_catalog' and c.relname in ('pg_largeobject', 'pg_largeobject_metadata')))`;

// Snapshot rows: each column's text comes from its type's OUTPUT function (format('%s'), which
// never applies a cast), not from to_jsonb: to_jsonb applies a cast to json if one exists for a
// user-defined type, and a migration owns the types it creates, so it could make the snapshot show
// any value (review round 1, F1). Output functions of base types are created by a superuser only.
// Output text also keeps what to_jsonb normalizes away (array lower bounds, json whitespace and
// duplicate keys). The JSON category of built-in types is kept, so a type change such as integer
// to text still changes the value text: numbers bare, booleans true/false, everything else a JSON
// string. Null is `null`, tested with num_nulls: a composite value whose fields are all null IS
// NULL without being null.
const COLUMN_TEXT = String.raw`pg_catalog.format(
      $c$case when pg_catalog.num_nulls(canary_row_.%1$I) = 1 then 'null' else %2$s end$c$,
      a.attname,
      case t.typcategory
        when 'N' then pg_catalog.format($v$pg_catalog.format('%%s', canary_row_.%I)$v$, a.attname)
        when 'B' then pg_catalog.format($v$case pg_catalog.format('%%s', canary_row_.%1$I) when 't' then 'true' when 'f' then 'false' else pg_catalog.to_json(pg_catalog.format('%%s', canary_row_.%1$I))::text end$v$, a.attname)
        else pg_catalog.format($v$pg_catalog.to_json(pg_catalog.format('%%s', canary_row_.%I))::text$v$, a.attname)
      end)`;

// Sequences: last_value and is_called read from each sequence itself (pg_sequences shows null for
// both an unused sequence and one set with setval(..., false), review round 1, F3), plus the start
// value, as [last_value, is_called, start_value].
const SEQUENCE_VALUES = String.raw`(select case when count(*) = 0 then $v$'{}'::jsonb$v$
     else pg_catalog.format($v$(select pg_catalog.jsonb_object_agg(x.k, x.v) from (%s) x)$v$,
       pg_catalog.string_agg(pg_catalog.format(
         $s$select %L::text as k, pg_catalog.jsonb_build_array(s.last_value::text, s.is_called, %L::text) as v from %I.%I s$s$,
         pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname), q.seqstart::text, n.nspname, c.relname),
         ' union all ' order by n.nspname, c.relname)) end
   from pg_catalog.pg_class c
   join pg_catalog.pg_namespace n on n.oid = c.relnamespace
   join pg_catalog.pg_sequence q on q.seqrelid = c.oid
   where c.relkind = 'S' and ${SYSTEM_SCHEMA_FILTER("n.nspname")})`;

export const SNAPSHOT_SQL = String.raw`\set ON_ERROR_STOP 1
set search_path = '';
set timezone = 'UTC';
set datestyle = 'ISO, YMD';
set intervalstyle = 'postgres';
set extra_float_digits = 1;
set bytea_output = 'hex';
set statement_timeout = 0;
begin transaction isolation level repeatable read, read only;
select pg_catalog.format(
  $q$select pg_catalog.jsonb_build_object('type', 'table', 'key', %L, 'schema', %L, 'name', %L, 'kind', %L, 'populated', %L::boolean, 'columns', %L::jsonb, 'rows', %s)::text$q$,
  pg_catalog.quote_ident(n.nspname) || '.' || pg_catalog.quote_ident(c.relname), n.nspname, c.relname, c.relkind::text, c.relispopulated::text,
  cols.names::text,
  case when c.relkind = 'm' and not c.relispopulated then $r$'[]'::jsonb$r$
       else pg_catalog.format($r$(select coalesce(pg_catalog.jsonb_agg(pg_catalog.jsonb_object(array[%s]::text[], array[%s]::text[])), '[]'::jsonb) from %I.%I canary_row_)$r$,
              cols.keys, cols.texts, n.nspname, c.relname)
  end)
from pg_catalog.pg_class c
join pg_catalog.pg_namespace n on n.oid = c.relnamespace
cross join lateral (
  select coalesce(pg_catalog.jsonb_agg(a.attname::text order by a.attnum), '[]'::jsonb) as names,
         coalesce(pg_catalog.string_agg(pg_catalog.quote_literal(a.attname), ', ' order by a.attnum), '') as keys,
         coalesce(pg_catalog.string_agg(${COLUMN_TEXT}, ', ' order by a.attnum), '') as texts
  from pg_catalog.pg_attribute a
  join pg_catalog.pg_type t on t.oid = a.atttypid
  where a.attrelid = c.oid and a.attnum > 0 and not a.attisdropped) cols
where ${SNAPSHOT_RELATIONS}
order by n.nspname, c.relname
\gexec
select pg_catalog.format($q$select pg_catalog.jsonb_build_object('type', 'sequences', 'relations', %s, 'values', %s)::text$q$,
  (select count(*) from pg_catalog.pg_class c join pg_catalog.pg_namespace n on n.oid = c.relnamespace where ${SNAPSHOT_RELATIONS}),
  ${SEQUENCE_VALUES})
\gexec
select pg_catalog.jsonb_build_object('type', 'state', 'cluster', (${CLUSTER_FINGERPRINT}), 'database', (${DATABASE_FINGERPRINT}),
  'local', (${LOCAL_FINGERPRINT}), 'events', (${EVENT_TRIGGERS}), 'types', (${UNTRUSTED_TYPES}))::text;
select '{"type":"end"}';
commit;
`;

// The schema text of one snapshot point (R3, R7): `pg_dump --schema-only --binary-upgrade` of the
// database, run inside the container so client and server versions match (Postgres 17 dumps no
// statistics). Binary-upgrade mode also dumps what a plain dump leaves out (review round 1, F2,
// F4): every member of an extension with its comment (a postgres-owned extension, for example
// through pg_tle, could otherwise hide a function body or comment built from data) and the stored
// default of an added column (pg_attribute.attmissingval). normalizeDump drops the object ids and
// transaction ids that this mode adds.
function schemaDump(ctx) {
  const started = Date.now();
  const dump = run("docker", ["exec", ctx.container, "pg_dump", "-U", "supabase_admin", "-d", ctx.db, "--schema-only", "--binary-upgrade"]);
  if (dump.status !== 0) throw infraError(`pg_dump --schema-only --binary-upgrade failed: ${psqlError(dump.stderr)}`);
  const text = normalizeDump(dump.stdout);
  if (!/^CREATE SCHEMA auth;$/m.test(text)) throw infraError("unexpected pg_dump output (no CREATE SCHEMA auth)");
  ctx.timings.schema += Date.now() - started;
  return text;
}

function snapshot(ctx) {
  const started = Date.now();
  const result = psql(ctx, { role: "supabase_admin", db: ctx.db, input: SNAPSHOT_SQL });
  if (result.status !== 0) throw infraError(`snapshot failed: ${psqlError(result.stderr)}`);
  const snap = parseSnapshot(result.stdout);
  ctx.timings.snapshot += Date.now() - started;
  ctx.counts.snapshots += 1;
  snap.schema = { dump: schemaDump(ctx), ...snap.state };
  return snap;
}

// The file is sent base64-encoded and executed by \gexec, so psql never interprets its text
// (no backslash meta-commands from migrations or fixtures); -1 makes it one transaction.
function applySql(ctx, file, label) {
  const started = Date.now();
  const bytes = readFileSync(file);
  const driver = `select pg_catalog.convert_from(pg_catalog.decode('${bytes.toString("base64")}', 'base64'), 'UTF8')\n\\gexec\n`;
  const result = psql(ctx, { role: "postgres", db: ctx.db, input: driver, args: ["-1", "-f", "-"] });
  ctx.timings.apply += Date.now() - started;
  if (result.status !== 0) throw new CanaryError("R7", `  R7 (${RULES.R7}) — ${label}: SQL error: ${psqlError(result.stderr)}`);
}

function ensureRunning(ctx) {
  const result = run("docker", ["inspect", "--format", "{{.State.Running}}", ctx.container]);
  if (result.status !== 0 || result.stdout.trim() !== "true") {
    throw infraError(`the local database container ${ctx.container} is not running; start it with \`supabase db start\` in ${ctx.workdir}`);
  }
  const listed = run("docker", ["ps", "--format", "{{.Names}}"]);
  if (listed.status !== 0) throw infraError("docker ps failed");
  const others = otherProjectContainers(listed.stdout.split("\n").map((n) => n.trim()).filter(Boolean), ctx.projectId, ctx.container);
  if (others.length > 0) {
    throw infraError(`other services of this project are running (${others.slice(0, MAX_LISTED).join(", ")}); they write to the database on their own. Run \`supabase stop\` and then \`supabase db start\` (database only)`);
  }
}

function serverVersion(ctx) {
  return admin(ctx, ["select pg_catalog.version()"], "reading the server version");
}

// Full reset: `supabase db reset --local --no-seed` from a temporary folder that holds the same
// config.toml and an empty migrations folder, so the database equals a fresh local project with
// zero migrations (and a fresh cluster: roles included).
function cliReset(ctx) {
  const started = Date.now();
  ensureRunning(ctx);
  const before = serverVersion(ctx);
  const tmp = mkdtempSync(join(tmpdir(), "db-canary-"));
  try {
    mkdirSync(join(tmp, "supabase", "migrations"), { recursive: true });
    copyFileSync(join(ctx.workdir, "supabase", "config.toml"), join(tmp, "supabase", "config.toml"));
    const result = run("supabase", ["--workdir", tmp, "db", "reset", "--local", "--no-seed"]);
    if (result.status !== 0) {
      throw infraError(`supabase db reset failed (exit ${result.status}): ${truncate(redact(`${result.stderr}`.trim().split("\n").slice(-3).join(" | ")), 400)}`);
    }
  } finally {
    rmSync(tmp, { recursive: true, force: true });
  }
  ensureRunning(ctx);
  if (serverVersion(ctx) !== before) throw infraError("the server version changed across supabase db reset");
  ctx.timings.reset.push(Date.now() - started);
}

// Clone mode (self-test only): one full reset gives a pristine zero-migration copy of "postgres";
// every run then gets its own database RUN_DB cloned from it (CREATE DATABASE ... TEMPLATE, about
// 0.2 s instead of a reset). "postgres" itself is never dropped: the pg_net background worker
// segfaults when it restarts while "postgres" is missing, which crashes the whole server.
function createPristine(ctx) {
  const started = Date.now();
  admin(ctx, [`drop database if exists ${RUN_DB} with (force)`, `drop database if exists ${PRISTINE_DB} with (force)`], "dropping old canary databases");
  // CREATE DATABASE ... TEMPLATE postgres needs no other session on "postgres": the pg_net worker
  // and the pg_cron launcher are stopped and reconnect (to the existing database) a second later.
  let lastError = "";
  for (let attempt = 1; attempt <= 10; attempt += 1) {
    const result = psql(ctx, {
      role: "supabase_admin",
      db: "template1",
      args: [
        "-c", "select count(pg_catalog.pg_terminate_backend(pid)) from pg_catalog.pg_stat_activity where datname = 'postgres' and pid <> pg_catalog.pg_backend_pid()",
        "-c", `create database ${PRISTINE_DB} template postgres`,
      ],
    });
    if (result.status === 0) {
      lastError = "";
      break;
    }
    lastError = psqlError(result.stderr);
    if (!/being accessed by other users/.test(result.stderr)) break;
    sleepMs(200);
  }
  if (lastError) throw infraError(`creating the pristine database failed: ${lastError}`);
  admin(ctx, [COPY_PROPERTIES(PRISTINE_DB, "postgres")], "copying database properties");
  if (admin(ctx, [SAME_PROPERTIES("postgres", PRISTINE_DB)], "comparing database properties") !== "t") {
    throw infraError("the pristine database properties differ from the original");
  }
  ctx.pristine = true;
  ctx.fingerprint = admin(ctx, [CLUSTER_STATE], "reading the cluster fingerprint");
  ctx.pristineNames = admin(ctx, [CLUSTER_NAMES], "reading the cluster's roles, slots and origins");
  ctx.timings.pristine += Date.now() - started;
}

// Clone mode, after a run that changed cluster-wide state: drop the run's database, then every
// role, replication slot and replication origin that the pristine state did not have, and compare
// the fingerprint again (about 0.3 s instead of a 19 s reset). Anything else (an existing role
// altered, a privilege on another database ...) leaves the fingerprint different or makes a drop
// fail, and the caller falls back to a full reset.
function restoreCluster(ctx) {
  let names;
  try {
    names = JSON.parse(ctx.pristineNames);
  } catch {
    return false;
  }
  if (!["roles", "slots", "origins"].every((k) => Array.isArray(names?.[k]) && names[k].every((n) => typeof n === "string"))) return false;
  const literal = `'${JSON.stringify(names).replaceAll("'", "''")}'::jsonb`;
  const result = psql(ctx, {
    role: "supabase_admin",
    db: "template1",
    args: [
      "-c", `drop database if exists ${RUN_DB} with (force)`,
      "-c", `do $$
declare
  v jsonb := ${literal};
  r record;
begin
  for r in select slot_name::text as n from pg_catalog.pg_replication_slots where not (v -> 'slots') ? slot_name::text loop
    perform pg_catalog.pg_drop_replication_slot(r.n);
  end loop;
  for r in select roname as n from pg_catalog.pg_replication_origin where not (v -> 'origins') ? roname loop
    perform pg_catalog.pg_replication_origin_drop(r.n);
  end loop;
  for r in select rolname::text as n from pg_catalog.pg_roles where not (v -> 'roles') ? rolname::text loop
    execute pg_catalog.format('drop role %I', r.n);
  end loop;
end
$$`,
    ],
  });
  if (result.status !== 0) return false;
  return admin(ctx, [CLUSTER_STATE], "reading the cluster fingerprint") === ctx.fingerprint;
}

function cloneRunDatabase(ctx) {
  admin(ctx, [
    `drop database if exists ${RUN_DB} with (force)`,
    `create database ${RUN_DB} template ${PRISTINE_DB}`,
    COPY_PROPERTIES(RUN_DB, PRISTINE_DB),
  ], "cloning the pristine database");
  if (admin(ctx, [SAME_PROPERTIES(RUN_DB, PRISTINE_DB)], "comparing database properties") !== "t") {
    throw infraError("the cloned database properties differ from the pristine copy");
  }
}

// An empty database for one run. Reset mode (the check): a full `supabase db reset`, so every run
// starts from exactly a fresh local project with zero migrations, in the database "postgres".
// Clone mode (the self-test): a clone of the pristine copy; if a run changed cluster-wide state
// (roles ...), which a clone would not undo, a full reset rebuilds the pristine copy first.
function freshDatabase(ctx) {
  if (ctx.mode === "reset") {
    cliReset(ctx);
  } else {
    if (!ctx.pristine) {
      cliReset(ctx);
      createPristine(ctx);
    } else if (admin(ctx, [CLUSTER_STATE], "reading the cluster fingerprint") !== ctx.fingerprint) {
      const started = Date.now();
      if (restoreCluster(ctx)) {
        ctx.counts.restores += 1;
        ctx.timings.restore += Date.now() - started;
      } else {
        ctx.counts.fallbackResets += 1;
        cliReset(ctx);
        createPristine(ctx);
      }
    }
    const started = Date.now();
    cloneRunDatabase(ctx);
    ctx.counts.clones += 1;
    ctx.timings.clone += Date.now() - started;
  }
  const result = psql(ctx, { role: "supabase_admin", db: ctx.db, input: EMPTY_STATE });
  if (result.status !== 0) throw infraError(`checking the empty database failed: ${psqlError(result.stderr)}`);
  const problem = emptyStateProblem(result.stdout);
  if (problem) throw infraError(problem);
}

// Reset mode leaves "postgres" as the canary run left it (fictional, test-marked rows). Clone mode
// drops its two databases; if a run changed cluster-wide state, a full reset removes that too.
function cleanup(ctx) {
  if (!ctx.pristine) return true;
  try {
    if (admin(ctx, [CLUSTER_STATE], "reading the cluster fingerprint") !== ctx.fingerprint && !restoreCluster(ctx)) {
      cliReset(ctx);
    } else {
      admin(ctx, [`drop database if exists ${RUN_DB} with (force)`, `drop database if exists ${PRISTINE_DB}`], "dropping the canary databases");
    }
    ctx.pristine = false;
    return true;
  } catch (error) {
    console.error(`db-canary: cleanup failed (${error.message}); run \`supabase db reset\` to rebuild the local database`);
    return false;
  }
}

// ---------------------------------------------------------------------------------------------
// The check
// ---------------------------------------------------------------------------------------------

function log(ctx, message) {
  if (!ctx.quiet) console.log(`db-canary: ${message}`);
}

function readEntries(dir) {
  return readdirSync(dir, { withFileTypes: true }).map((d) => ({ name: d.name, isFile: d.isFile() }));
}

const seconds = (ms) => `${(ms / 1000).toFixed(1)} s`;

export function makeContext(options, { quiet = false } = {}) {
  const configPath = join(options.workdir, "supabase", "config.toml");
  if (!existsSync(configPath)) throw infraError(`${configPath} not found (--workdir)`);
  const projectId = parseProjectId(readFileSync(configPath, "utf8"));
  return {
    workdir: options.workdir,
    projectId,
    container: `supabase_db_${projectId}`,
    mode: "reset",
    db: "postgres",
    pristine: false,
    fingerprint: null,
    pristineNames: null,
    quiet,
    timings: { reset: [], pristine: 0, clone: 0, restore: 0, apply: 0, snapshot: 0, schema: 0 },
    counts: { clones: 0, snapshots: 0, fallbackResets: 0, restores: 0 },
  };
}

function loadInputs({ migrationsDir, fixturesDir, baseFallbackDir, requireFixturesDir }) {
  const migrations = existsSync(migrationsDir) ? planMigrations(readEntries(migrationsDir)) : [];
  const versions = migrations.map((m) => m.version);
  if (requireFixturesDir && !existsSync(fixturesDir)) throw new CanaryError("R7", `fixtures folder ${fixturesDir} not found`);
  const plan = existsSync(fixturesDir) ? planFixtures(readEntries(fixturesDir), versions) : { fixtures: new Map(), base: false, exceptions: false };
  let baseFixture = plan.base ? join(fixturesDir, BASE_FIXTURE) : null;
  if (!baseFixture && baseFallbackDir && existsSync(join(baseFallbackDir, BASE_FIXTURE))) baseFixture = join(baseFallbackDir, BASE_FIXTURE);
  if (!baseFixture) throw new CanaryError("R7", `${join(fixturesDir, BASE_FIXTURE)} not found (base canary rows)`);
  const exceptions = plan.exceptions ? parseExceptions(readFileSync(join(fixturesDir, EXCEPTIONS_FILE), "utf8"), EXCEPTIONS_FILE) : [];
  return { migrations, fixtures: plan.fixtures, baseFixture, exceptions };
}

function referenceRun(ctx, migrationsDir, migrations, name) {
  freshDatabase(ctx);
  const snaps = [snapshot(ctx)];
  for (const m of migrations) {
    applySql(ctx, join(migrationsDir, m.file), `migration ${m.file}, ${name} (no canary rows)`);
    snaps.push(snapshot(ctx));
  }
  return snaps;
}

function rel(path) {
  const r = relative(REPO_ROOT, path);
  return r.startsWith("..") ? path : r;
}

// Runs A1, A2 and B for one migrations folder; throws CanaryError on the first violation.
export function checkChain(ctx, { migrationsDir, fixturesDir, baseFallbackDir = null, requireFixturesDir = true }) {
  const inputs = loadInputs({ migrationsDir, fixturesDir, baseFallbackDir, requireFixturesDir });
  const { migrations, fixtures, baseFixture, exceptions } = inputs;
  log(ctx, `${migrations.length} migration(s) in ${rel(migrationsDir)}; fixtures ${rel(fixturesDir)}`);

  const a1 = referenceRun(ctx, migrationsDir, migrations, "reference run A1");
  const a2 = referenceRun(ctx, migrationsDir, migrations, "reference run A2");
  const determinism = evaluateDeterminism(a1, a2);
  throwIf(determinism.violations, "reference runs A1/A2");

  freshDatabase(ctx);
  let before = snapshot(ctx);
  const fresh = schemaDifference(a1[0].schema, before.schema, ["reference run A1", "canary run"]);
  if (fresh) throw infraError(`the fresh databases of the reference and canary runs differ: ${fresh}`);
  applySql(ctx, baseFixture, `base fixture ${rel(baseFixture)}, canary run`);
  let after = snapshot(ctx);
  throwIf(evaluateFixtureStep(before, after), `base fixture ${BASE_FIXTURE}`);
  before = after;
  const steps = [];

  for (let k = 0; k < migrations.length; k += 1) {
    const m = migrations[k];
    applySql(ctx, join(migrationsDir, m.file), `migration ${m.file}, canary run (it passed in the reference runs, so it fails only with canary rows present)`);
    const afterK = snapshot(ctx);
    throwIf(evaluateMigrationStep({ a: { before: a1[k], after: a1[k + 1] }, b: { before, after: afterK }, masks: determinism.stepMasks[k] }), `migration ${m.file}`);
    let state = afterK;
    const fixture = fixtures.get(m.version);
    if (fixture) {
      applySql(ctx, join(fixturesDir, fixture), `fixture ${fixture}, canary run`);
      const afterF = snapshot(ctx);
      throwIf(evaluateFixtureStep(afterK, afterF), `fixture ${fixture}`);
      state = afterF;
    }
    const gaps = evaluateCoverage(state, exceptions);
    if (gaps.length > 0) {
      const target = join(rel(fixturesDir), `${m.version}.sql`);
      const verb = fixture ? "extend" : "add";
      throwIf(gaps.map((g) => ({
        rule: "R6",
        table: g.table,
        message: g.column === null
          ? `no rows after this step; ${verb} ${target} with rows for it`
          : `column ${g.column} is null in every row; ${verb} ${target} with a row that sets it (or add a reasoned entry to ${EXCEPTIONS_FILE})`,
      })), `after migration ${m.file}${fixture ? ` and fixture ${fixture}` : ""}`);
    }
    steps.push(state);
    before = state;
  }

  const stale = unusedExceptions(steps, exceptions);
  throwIf(stale.map((e) => ({ rule: "R6", table: e.table, message: `stale ${EXCEPTIONS_FILE} entry: ${e.column ? `column ${e.column}` : "the table"} exists after no migration` })), "coverage exceptions");

  let rows = 0;
  let protectedRows = 0;
  for (const t of before.tables.values()) {
    rows += t.rows.length;
    if (isProtected(t)) protectedRows += t.rows.length;
  }
  return {
    migrations: migrations.length,
    fixtures: fixtures.size,
    tables: before.tables.size,
    protectedTables: [...before.tables.values()].filter(isProtected).length,
    rows,
    protectedRows,
    masked: determinism.masked,
    coverage: coverageStats(before, exceptions),
  };
}

function printSummary(ctx, summary, elapsedMs) {
  const c = summary.coverage;
  console.log([
    `db-canary: PASS — ${summary.migrations} migration(s) checked (${summary.fixtures} fixture file(s))`,
    `  tables in the final canary snapshot: ${summary.tables} (${summary.protectedTables} in public/private); rows: ${summary.rows} (${summary.protectedRows} in public/private)`,
    `  masked volatile columns (R5): ${summary.masked.length > 0 ? summary.masked.join("; ") : "none"}`,
    `  coverage (R6): ${c.tables} table(s), ${c.columns} column(s), ${c.exceptions} exception(s)`,
    timingLine(ctx, elapsedMs),
  ].join("\n"));
}

function timingLine(ctx, elapsedMs) {
  const t = ctx.timings;
  const resets = t.reset.map(seconds).join(", ") || "none";
  const clones = ctx.mode === "clone"
    ? `; pristine copy ${seconds(t.pristine)}; ${ctx.counts.clones} database clone(s) ${seconds(t.clone)}; ` +
      `${ctx.counts.restores} cluster restore(s) ${seconds(t.restore)}; ${ctx.counts.fallbackResets} fallback reset(s)`
    : "";
  return `  elapsed ${seconds(elapsedMs)} (supabase db reset ${t.reset.length}x: ${resets}${clones}; ` +
    `SQL ${seconds(t.apply)}; ${ctx.counts.snapshots} snapshot(s): rows ${seconds(t.snapshot)}, schema ${seconds(t.schema)})`;
}

function runSelftest(ctx, options) {
  const dir = options.selftest;
  if (!existsSync(dir)) throw infraError(`self-test folder ${dir} not found`);
  const cases = readEntries(dir).filter((e) => !e.isFile).map((e) => e.name).sort();
  if (cases.length === 0) throw infraError(`no self-test cases in ${dir}`);
  ctx.quiet = true;
  ctx.mode = "clone";
  ctx.db = RUN_DB;
  const results = [];
  for (const name of cases) {
    const caseDir = join(dir, name);
    const expect = parseExpect(readFileSync(join(caseDir, "expect.json"), "utf8"), `${name}/expect.json`);
    const started = Date.now();
    let got;
    try {
      checkChain(ctx, {
        migrationsDir: join(caseDir, "migrations"),
        fixturesDir: join(caseDir, "fixtures"),
        baseFallbackDir: options.fixtures,
        requireFixturesDir: false,
      });
      got = { outcome: "pass", rule: null, message: "" };
    } catch (error) {
      if (!(error instanceof CanaryError) || error.infra) throw error;
      got = { outcome: "fail", rule: error.rule, message: error.message };
    }
    const ok = caseMatches(expect, got);
    results.push({ name, expect, got, ok, ms: Date.now() - started });
    const label = (r) => (r.outcome === "pass" ? "pass" : `fail ${r.rule}`);
    console.log(`db-canary self-test: ${ok ? "ok  " : "MISMATCH"} ${name.padEnd(34)} expected ${label(expect).padEnd(8)} got ${label(got).padEnd(8)} ${seconds(Date.now() - started)}`);
    if (got.outcome === "fail") console.log(`    ${truncate(got.message.trim().split("\n")[0], 220)}`);
  }
  const failed = results.filter((r) => !r.ok);
  console.log(`db-canary self-test: ${results.length - failed.length}/${results.length} cases as expected`);
  return failed.length === 0;
}

export function main(argv) {
  let opts;
  try {
    opts = parseArgs(argv);
  } catch (error) {
    if (error instanceof UsageError) {
      console.error(`db-canary: ${error.message}\n${USAGE}`);
      return 2;
    }
    throw error;
  }
  if (opts.help) {
    console.log(USAGE);
    return 0;
  }
  const options = resolveOptions(opts);
  const started = Date.now();
  let ctx = null;
  let code = 1;
  try {
    ctx = makeContext(options);
    if (options.selftest) {
      code = runSelftest(ctx, options) ? 0 : 1;
      console.log(timingLine(ctx, Date.now() - started));
    } else {
      const summary = checkChain(ctx, { migrationsDir: options.migrations, fixturesDir: options.fixtures });
      printSummary(ctx, summary, Date.now() - started);
      code = 0;
    }
  } catch (error) {
    if (error instanceof CanaryError) {
      console.error(`db-canary: FAIL ${error.rule} (${RULES[error.rule]})\n${error.message.startsWith("  ") ? error.message : `  ${error.message}`}`);
      if (ctx) console.error(timingLine(ctx, Date.now() - started));
    } else {
      console.error(`db-canary: FAIL R7 (${RULES.R7}) — unexpected error: ${redact(error?.stack ?? error)}`);
    }
    code = 1;
  } finally {
    if (ctx && !cleanup(ctx)) code = 1;
  }
  return code;
}

// Run as a script (also through a symlinked path: Node resolves the main module's symlinks, so a
// plain path comparison would silently skip main() and exit 0).
function isMainModule() {
  if (!process.argv[1]) return false;
  try {
    return realpathSync(resolve(process.argv[1])) === realpathSync(SCRIPT_PATH);
  } catch {
    return false;
  }
}
if (isMainModule()) process.exitCode = main(process.argv.slice(2));
