// Tests for the pure logic of scripts/db-canary.mjs (no Docker): option and input parsing,
// snapshot parsing, multiset diffs, JSON-null handling for added columns, masking, the rule
// evaluators and coverage. The database part is covered by the self-test
// (node scripts/db-canary.mjs --selftest tests/db-canary-selftest) in the Database tests workflow.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, rmSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import {
  CanaryError,
  REPO_ROOT,
  SNAPSHOT_SQL,
  UsageError,
  caseMatches,
  compareRetained,
  emptyStateProblem,
  evaluateCoverage,
  evaluateDeterminism,
  evaluateFixtureStep,
  evaluateMigrationStep,
  firstDifference,
  foreignEmailDomains,
  main,
  multisetDiff,
  normalizeDump,
  otherProjectContainers,
  outsideChanges,
  parseArgs,
  parseExceptions,
  parseExpect,
  parseMigrationName,
  parseProjectId,
  parseSnapshot,
  planFixtures,
  planMigrations,
  psqlError,
  redact,
  resolveOptions,
  rowKey,
  schemaDifference,
  sequenceState,
  staleExceptions,
  unusedExceptions,
  valueShape,
  volatileColumns,
  withinRunChanges,
} from "../../scripts/db-canary.mjs";

const SCRIPT = join(REPO_ROOT, "scripts", "db-canary.mjs");

// A snapshot from plain values: { "schema.table": { columns, rows: [[...values]], kind } }.
function snap(tables, sequences = {}) {
  const map = new Map();
  for (const [key, def] of Object.entries(tables)) {
    const [schema, name] = key.split(".");
    map.set(key, {
      key,
      schema,
      name,
      kind: def.kind ?? "r",
      populated: def.populated ?? true,
      columns: def.columns,
      rows: def.rows.map((values) => Object.fromEntries(def.columns.map((c, i) => [c, JSON.stringify(values[i])]))),
    });
  }
  return { tables: map, sequences: new Map(Object.entries(sequences)) };
}

const AUTH = { columns: ["id", "email"], rows: [["u1", "canary@example.test"]] };
const throwsRule = (fn, rule, pattern, message) =>
  assert.throws(fn, (error) => error instanceof CanaryError && error.rule === rule && (!pattern || pattern.test(error.message)), message);

// ---------------------------------------------------------------------------------------------
// Options and inputs
// ---------------------------------------------------------------------------------------------

test("options: both value forms, help, and fail-closed errors", () => {
  assert.deepEqual(parseArgs(["--workdir", "a", "--fixtures=b"]), { workdir: "a", fixtures: "b" });
  assert.deepEqual(parseArgs(["--selftest", "cases"]), { selftest: "cases" });
  assert.equal(parseArgs(["--help"]).help, true);
  for (const bad of [["--bogus"], ["-x"], ["positional"], ["--workdir"], ["--workdir", "--fixtures", "x"], ["--workdir="],
    ["--workdir", "a", "--workdir", "b"], ["--selftest", "s", "--migrations", "m"]]) {
    assert.throws(() => parseArgs(bad), UsageError, JSON.stringify(bad));
  }
});

test("options: defaults resolve against the workdir and the repository root", () => {
  const o = resolveOptions({}, "/somewhere");
  assert.equal(o.workdir, REPO_ROOT);
  assert.equal(o.migrations, join(REPO_ROOT, "supabase", "migrations"));
  assert.equal(o.fixtures, join(REPO_ROOT, "tests", "db-canary"));
  assert.equal(o.selftest, null);
  const r = resolveOptions({ workdir: "w", selftest: "s" }, "/base");
  assert.equal(r.workdir, "/base/w");
  assert.equal(r.migrations, "/base/w/supabase/migrations");
  assert.equal(r.selftest, "/base/s");
});

test("project_id: top-level key only, validated", () => {
  assert.equal(parseProjectId('# c\nproject_id = "technician-management"\n[api]\nport = 1'), "technician-management");
  assert.equal(parseProjectId('project_id = "a.b_c-1" # comment'), "a.b_c-1");
  throwsRule(() => parseProjectId('[api]\nproject_id = "x"'), "R7", /not found/);
  throwsRule(() => parseProjectId('project_id = "bad name; rm"'), "R7", /invalid/);
  throwsRule(() => parseProjectId(""), "R7");
});

test("migrations: version parsing, file-name order, fail closed on anything else", () => {
  assert.deepEqual(parseMigrationName("20261104120000_access_and_permissions.sql"), { file: "20261104120000_access_and_permissions.sql", version: "20261104120000" });
  assert.equal(parseMigrationName("20261104120000.sql"), null);
  assert.equal(parseMigrationName("x_y.sql"), null);
  assert.equal(parseMigrationName("1_a.SQL"), null);
  const files = (...names) => names.map((name) => ({ name, isFile: true }));
  assert.deepEqual(planMigrations(files("2_b.sql", "10_a.sql", "1_c.sql")).map((m) => m.file), ["10_a.sql", "1_c.sql", "2_b.sql"]);
  assert.deepEqual(planMigrations([]), []);
  throwsRule(() => planMigrations(files("README.md")), "R7", /unexpected entry/);
  throwsRule(() => planMigrations([{ name: "1_a.sql", isFile: false }]), "R7", /unexpected entry/);
  throwsRule(() => planMigrations(files("1_a.sql", "1_b.sql")), "R7", /share the version/);
});

test("fixtures: base, exceptions, README and one file per known version; orphans fail", () => {
  const files = (...names) => names.map((name) => ({ name, isFile: true }));
  const plan = planFixtures(files("000_base.sql", "coverage-exceptions.json", "README.md", "20261104120000.sql"), ["20261104120000"]);
  assert.equal(plan.base, true);
  assert.equal(plan.exceptions, true);
  assert.deepEqual([...plan.fixtures], [["20261104120000", "20261104120000.sql"]]);
  throwsRule(() => planFixtures(files("2026110412000.sql"), ["20261104120000"]), "R7", /matches no migration/);
  throwsRule(() => planFixtures(files("notes.txt"), []), "R7", /unexpected entry/);
  throwsRule(() => planFixtures([{ name: "000_base.sql", isFile: false }], []), "R7");
});

test("coverage exceptions: strict format, reasons required, fail closed", () => {
  assert.deepEqual(parseExceptions("[]"), []);
  assert.deepEqual(parseExceptions('[{"table":"public.t","column":"c","reason":"set only later by an RPC"},{"table":"private.q","reason":"filled by a later step"}]'), [
    { table: "public.t", column: "c", reason: "set only later by an RPC" },
    { table: "private.q", column: null, reason: "filled by a later step" },
  ]);
  for (const bad of ["{", "{}", '[1]', '[{"table":"public.t","reason":"long enough reason","extra":1}]',
    '[{"table":"auth.users","reason":"long enough reason"}]', '[{"table":"t","reason":"long enough reason"}]',
    '[{"table":"public.t"}]', '[{"table":"public.t","reason":"short"}]', '[{"table":"public.t","column":"Bad Name","reason":"long enough reason"}]',
    '[{"table":"public.t","reason":"long enough reason"},{"table":"public.t","reason":"long enough reason"}]']) {
    throwsRule(() => parseExceptions(bad), "R7");
  }
});

test("self-test cases match on outcome, rule and message fragment", () => {
  const fail = { outcome: "fail", rule: "R1", message: "R1 — migration x: 1 existing row(s) changed" };
  assert.equal(caseMatches({ outcome: "fail", rule: "R1", match: null }, fail), true);
  assert.equal(caseMatches({ outcome: "fail", rule: "R1", match: "existing row" }, fail), true);
  assert.equal(caseMatches({ outcome: "fail", rule: "R2", match: null }, fail), false, "another rule fired");
  assert.equal(caseMatches({ outcome: "fail", rule: "R1", match: "schema" }, fail), false, "message fragment missing");
  assert.equal(caseMatches({ outcome: "pass", rule: null, match: null }, fail), false);
  assert.equal(caseMatches({ outcome: "fail", rule: "R1", match: null }, { outcome: "pass", rule: null, message: "" }), false);
  assert.equal(caseMatches({ outcome: "pass", rule: null, match: null }, { outcome: "pass", rule: null, message: "" }), true);
});

test("empty database state: zero relations, no private schema, empty history; fail closed otherwise", () => {
  assert.equal(emptyStateProblem('{"relations": 0, "private": 0, "history": 0}\n'), null);
  assert.match(emptyStateProblem('{"relations": 3, "private": 1, "history": 0}'), /not empty/);
  assert.match(emptyStateProblem('{"relations": 0, "private": 0, "history": 2}'), /not empty/);
  for (const bad of ["", "x", "[]", '{"relations": 0, "private": 0}', '{"relations": "0", "private": 0, "history": 0}',
    '{"relations": 0, "private": 0, "history": 0, "extra": 1}']) {
    assert.match(emptyStateProblem(bad), /unparsable|unexpected/, bad);
  }
});

test("self-test expectations: pass or fail with a rule", () => {
  assert.deepEqual(parseExpect('{"outcome":"pass"}'), { outcome: "pass", rule: null, match: null });
  assert.deepEqual(parseExpect('{"outcome":"fail","rule":"R3","match":"schema"}'), { outcome: "fail", rule: "R3", match: "schema" });
  for (const bad of ["x", "[]", '{"outcome":"fail"}', '{"outcome":"fail","rule":"R8"}', '{"outcome":"pass","rule":"R1"}', '{"outcome":"maybe"}', '{"outcome":"pass","x":1}']) {
    assert.throws(() => parseExpect(bad), (error) => error instanceof CanaryError && error.infra === true, bad);
  }
});

// ---------------------------------------------------------------------------------------------
// Snapshot parsing
// ---------------------------------------------------------------------------------------------

const tableLine = (key, columns, rows, extra = {}) => {
  const [schema, name] = key.split(".");
  return JSON.stringify({ type: "table", key, schema, name, kind: "r", populated: true, columns, rows, ...extra });
};
const seqLine = (relations, values = {}) => JSON.stringify({ type: "sequences", relations, values });
const STATE = JSON.stringify({ type: "state", cluster: "a".repeat(32), database: "b".repeat(32), local: "c".repeat(32), events: ["e1:login"], types: [] });
const END = '{"type":"end"}';

test("snapshot parsing: valid output", () => {
  const values = { "public.s": ["5", true, "1"], "auth.x": ["1", false, "1"], "public.r": ["1003", false, "1"] };
  const out = [tableLine("auth.users", ["id"], [{ id: '"u1"' }]), tableLine("public.t", ["a", "b"], []), seqLine(2, values), STATE, END, ""].join("\n");
  const s = parseSnapshot(out);
  assert.equal(s.tables.size, 2);
  assert.deepEqual(s.state, { cluster: "a".repeat(32), database: "b".repeat(32), local: "c".repeat(32), events: ["e1:login"], types: [] });
  assert.deepEqual(s.tables.get("auth.users").rows, [{ id: '"u1"' }]);
  assert.equal(s.sequences.get("public.s"), "5");
  assert.equal(s.sequences.get("auth.x"), null, "unused");
  assert.equal(s.sequences.get("public.r"), "1003 (not called)", "setval(..., false) is visible");
});

test("sequence state: unused is null; setval(..., false) and RESTART stay visible", () => {
  assert.equal(sequenceState("1", false, "1"), null);
  assert.equal(sequenceState("1", true, "1"), "1");
  assert.equal(sequenceState("7", true, "1"), "7");
  assert.equal(sequenceState("1003", false, "1"), "1003 (not called)");
  assert.equal(sequenceState("100", false, "100"), null, "a restart at the start value is the unused state");
  assert.notEqual(sequenceState("5", false, "1"), sequenceState("5", true, "1"));
});

test("snapshot parsing: fails closed on malformed or incomplete output", () => {
  const ok = tableLine("auth.users", ["id"], [{ id: '"u1"' }]);
  const cases = {
    "no end marker": [ok, seqLine(1), STATE].join("\n"),
    "no sequences": [ok, STATE, END].join("\n"),
    "no state": [ok, seqLine(1), END].join("\n"),
    "two states": [ok, seqLine(1), STATE, STATE, END].join("\n"),
    "state hash not md5": [ok, seqLine(1), JSON.stringify({ type: "state", cluster: "x", database: "b".repeat(32) }), END].join("\n"),
    "garbage line": [ok, "NOTICE: hello", seqLine(1), STATE, END].join("\n"),
    "output after end": [ok, seqLine(1), STATE, END, ok].join("\n"),
    "relation count mismatch": [ok, seqLine(2), STATE, END].join("\n"),
    "empty snapshot": [seqLine(0), STATE, END].join("\n"),
    "row with an extra key": [tableLine("auth.users", ["id"], [{ id: '"u1"', x: "1" }]), seqLine(1), STATE, END].join("\n"),
    "row with a missing key": [tableLine("auth.users", ["id", "e"], [{ id: '"u1"' }]), seqLine(1), STATE, END].join("\n"),
    "row value not text": [tableLine("auth.users", ["id"], [{ id: 1 }]), seqLine(1), STATE, END].join("\n"),
    "unknown relation kind": [tableLine("auth.users", ["id"], [], { kind: "v" }), seqLine(1), STATE, END].join("\n"),
    "duplicate relation": [ok, ok, seqLine(2), STATE, END].join("\n"),
    "sequence value not an array": [ok, seqLine(1, { "public.s": "5" }), STATE, END].join("\n"),
    "sequence value not numeric": [ok, seqLine(1, { "public.s": ["x", true, "1"] }), STATE, END].join("\n"),
    "sequence is_called not boolean": [ok, seqLine(1, { "public.s": ["5", "t", "1"] }), STATE, END].join("\n"),
    "two sequence documents": [ok, seqLine(1), seqLine(1), STATE, END].join("\n"),
    "state without local hash": [ok, seqLine(1), JSON.stringify({ type: "state", cluster: "a".repeat(32), database: "b".repeat(32), events: [] }), END].join("\n"),
    "state events not a list": [ok, seqLine(1), JSON.stringify({ type: "state", cluster: "a".repeat(32), database: "b".repeat(32), local: "c".repeat(32), events: "x", types: [] }), END].join("\n"),
    "state without types": [ok, seqLine(1), JSON.stringify({ type: "state", cluster: "a".repeat(32), database: "b".repeat(32), local: "c".repeat(32), events: [] }), END].join("\n"),
    "unknown document": [ok, '{"type":"other"}', seqLine(1), STATE, END].join("\n"),
  };
  for (const [name, out] of Object.entries(cases)) throwsRule(() => parseSnapshot(out), "R7", undefined, name);
});

// ---------------------------------------------------------------------------------------------
// Multisets, rows and masking
// ---------------------------------------------------------------------------------------------

test("multiset diff counts duplicates and ignores order", () => {
  assert.deepEqual(multisetDiff(["a", "b", "a"], ["a", "a", "b"]), { onlyA: [], onlyB: [] });
  assert.deepEqual(multisetDiff(["a", "a"], ["a"]), { onlyA: ["a"], onlyB: [] });
  assert.deepEqual(multisetDiff(["a"], ["a", "c", "c"]), { onlyA: [], onlyB: ["c", "c"] });
});

test("row keys keep exact value text and masking keeps null", () => {
  const big1 = { n: "9007199254740993" };
  const big2 = { n: "9007199254740992" };
  assert.notEqual(rowKey(big1, ["n"]), rowKey(big2, ["n"]));
  assert.notEqual(rowKey({ n: "1.10" }, ["n"]), rowKey({ n: "1.1" }, ["n"]));
  const mask = new Set(["t"]);
  assert.equal(rowKey({ t: '"2026-01-01"' }, ["t"], mask), rowKey({ t: '"2027-05-05"' }, ["t"], mask));
  assert.notEqual(rowKey({ t: "null" }, ["t"], mask), rowKey({ t: '"2027-05-05"' }, ["t"], mask));
  throwsRule(() => rowKey({}, ["missing"]), "R7");
});

test("masking keeps the value's shape: random ids and timestamps match, copied text does not", () => {
  assert.equal(valueShape('"3f2a9c1e-0b4d-4e2f-9a7b-1c2d3e4f5a6b"'), '"0-0-0-0-0"');
  assert.equal(valueShape('"2026-11-05 10:11:12.123456+00"'), valueShape('"2026-11-05 23:59:01.9+00"'));
  assert.equal(valueShape("0.123456789"), valueShape("0.5"));
  const mask = new Set(["note"]);
  const uuid = { note: '"9b1d2c3e-4f5a-4b6c-8d7e-0f1a2b3c4d5e"' };
  assert.equal(rowKey(uuid, ["note"], mask), rowKey({ note: '"0a1b2c3d-4e5f-4a6b-9c7d-8e9f0a1b2c3d"' }, ["note"], mask));
  assert.notEqual(rowKey(uuid, ["note"], mask), rowKey({ note: '"canary.active@example.test,canary.deleted@example.test"' }, ["note"], mask),
    "coalesce(<data>, gen_random_uuid()::text): data in the canary run, a random UUID in the reference runs");
});

test("the snapshot reads values through output functions, never to_jsonb or a cast", () => {
  assert.doesNotMatch(SNAPSHOT_SQL, /to_jsonb\(/, "to_jsonb applies a user-defined cast to json");
  assert.match(SNAPSHOT_SQL, /pg_catalog\.format\('%%s', canary_row_\.%/);
  assert.match(SNAPSHOT_SQL, /num_nulls\(canary_row_/, "null test that a composite of nulls does not fool");
  assert.match(SNAPSHOT_SQL, /s\.last_value::text, s\.is_called/, "sequence state read from the sequence itself");
});

test("R1 retained rows: an added column must be JSON null on existing rows", () => {
  const before = snap({ "public.t": { columns: ["id", "name"], rows: [[1, "a"], [2, "b"]] } }).tables.get("public.t");
  const same = snap({ "public.t": { columns: ["id", "name"], rows: [[2, "b"], [1, "a"], [3, "c"]] } }).tables.get("public.t");
  const res = compareRetained(before, same);
  assert.deepEqual(res.problems, []);
  assert.deepEqual(res.addedRows, [{ id: "3", name: '"c"' }]);

  const nullColumn = snap({ "public.t": { columns: ["id", "name", "color"], rows: [[1, "a", null], [2, "b", null]] } }).tables.get("public.t");
  assert.deepEqual(compareRetained(before, nullColumn).problems, []);

  const filled = snap({ "public.t": { columns: ["id", "name", "color"], rows: [[1, "a", "red"], [2, "b", null]] } }).tables.get("public.t");
  const filledRes = compareRetained(before, filled);
  assert.equal(filledRes.problems.length, 1);
  assert.match(filledRes.problems[0].message, /1 existing row\(s\) changed or removed \(or a new column color was filled/);
  assert.equal(filledRes.addedRows.length, 1); // the filled row counts as a new row for R2

  const falseDefault = snap({ "public.t": { columns: ["id", "name", "flag"], rows: [[1, "a", false], [2, "b", false]] } }).tables.get("public.t");
  assert.equal(compareRetained(before, falseDefault).problems.length, 1);

  const dropped = snap({ "public.t": { columns: ["id"], rows: [[1], [2]] } }).tables.get("public.t");
  assert.match(compareRetained(before, dropped).problems[0].message, /column\(s\) name dropped/);

  const changed = snap({ "public.t": { columns: ["id", "name"], rows: [[1, "a"], [2, "B"]] } }).tables.get("public.t");
  assert.match(compareRetained(before, changed).problems[0].message, /1 existing row/);
  const removed = snap({ "public.t": { columns: ["id", "name"], rows: [[1, "a"]] } }).tables.get("public.t");
  assert.equal(compareRetained(before, removed).problems.length, 1);
  const retyped = snap({ "public.t": { columns: ["id", "name"], rows: [["1", "a"], ["2", "b"]] } }).tables.get("public.t");
  assert.equal(compareRetained(before, retyped).problems.length, 1, "int to text changes the JSON value");

  const empty = snap({ "public.t": { columns: ["id", "name"], rows: [] } }).tables.get("public.t");
  assert.deepEqual(compareRetained(empty, dropped).problems, [], "no rows, no data to change");
});

// ---------------------------------------------------------------------------------------------
// Rule evaluators
// ---------------------------------------------------------------------------------------------

const ref = (rows) => ({ columns: ["code", "label"], rows });
const items = (rows) => ({ columns: ["id", "name", "is_test"], rows });

test("migration step: identical reference rows in both runs pass", () => {
  const aBefore = snap({ "auth.users": { columns: AUTH.columns, rows: [] } });
  const aAfter = snap({ "auth.users": { columns: AUTH.columns, rows: [] }, "public.ref": ref([["r", "תיקון"]]) });
  const bBefore = snap({ "auth.users": AUTH });
  const bAfter = snap({ "auth.users": AUTH, "public.ref": ref([["r", "תיקון"]]) });
  assert.deepEqual(evaluateMigrationStep({ a: { before: aBefore, after: aAfter }, b: { before: bBefore, after: bAfter } }), []);
});

test("migration step: R1 for a changed canary row, R4 for auth, R2 and R3 for copies", () => {
  const base = { "auth.users": AUTH, "public.items": items([["i1", "x", true]]), "public.log": { columns: ["id"], rows: [] } };
  const aBase = { "auth.users": { columns: AUTH.columns, rows: [] }, "public.items": items([]), "public.log": { columns: ["id"], rows: [] } };
  const a = { before: snap(aBase), after: snap(aBase) };
  const step = (after) => evaluateMigrationStep({ a, b: { before: snap(base), after: snap(after) } });

  const r1 = step({ ...base, "public.items": items([["i1", "changed", true]]) });
  assert.equal(r1[0].rule, "R1");
  assert.equal(r1[0].run, "canary run");

  const r4 = step({ ...base, "auth.users": { columns: AUTH.columns, rows: [["u1", "other@example.test"]] } });
  assert.equal(r4[0].rule, "R4");
  assert.equal(r4[0].table, "auth.users");

  const r2 = step({ ...base, "public.log": { columns: ["id"], rows: [["i1"]] } });
  assert.equal(r2[0].rule, "R2");

  const aNew = { before: snap(aBase), after: snap({ ...aBase, "public.copy": { columns: ["id"], rows: [] } }) };
  const r3 = evaluateMigrationStep({ a: aNew, b: { before: snap(base), after: snap({ ...base, "public.copy": { columns: ["id"], rows: [["i1"]] } }) } });
  assert.equal(r3[0].rule, "R3");

  const r3schema = step({ ...base, "public.flagged": { columns: ["id"], rows: [] } });
  assert.equal(r3schema[0].rule, "R3");
  assert.match(r3schema[0].message, /schema after the migration differs/);

  const dropped = { ...base };
  delete dropped["public.items"];
  const aDropped = { ...aBase };
  delete aDropped["public.items"];
  const r1drop = evaluateMigrationStep({ a: { before: snap(aBase), after: snap(aDropped) }, b: { before: snap(base), after: snap(dropped) } });
  assert.equal(r1drop[0].rule, "R1");
  assert.match(r1drop[0].message, /table dropped with 1 row/);
});

test("migration step: a materialized view emptied WITH NO DATA is named as such (R1)", () => {
  const mv = (rows, populated) => snap({ "public.mv": { columns: ["n"], rows, kind: "m", populated } });
  const v = evaluateMigrationStep({ a: { before: mv([], true), after: mv([], false) }, b: { before: mv([[3]], true), after: mv([], false) } });
  assert.equal(v[0].rule, "R1");
  assert.equal(v[0].message, "materialized view emptied (WITH NO DATA)");
});

test("migration step: sequences that differ already before the migration are an R2 failure too", () => {
  const t = { "public.items": items([]) };
  const v = evaluateMigrationStep({ a: { before: snap(t, { "public.c": null }), after: snap(t, { "public.c": "1" }) },
    b: { before: snap(t, { "public.c": "1" }), after: snap(t, { "public.c": "1" }) } });
  assert.equal(v[0].rule, "R2");
  assert.match(v[0].message, /reference run unused -> 1, canary run 1 -> 1/);
});

test("violation samples are redacted like every other message", () => {
  const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoic2VydmljZSJ9", "c2lnbmF0dXJlLXZhbHVl"].join(".");
  const before = snap({ "auth.users": { columns: ["id", "note"], rows: [["u1", `token ${fakeJwt}`]] } });
  const after = snap({ "auth.users": { columns: ["id", "note"], rows: [] } });
  const [problem] = outsideChanges(before, after);
  assert.equal(problem.samples.length, 1);
  assert.doesNotMatch(problem.samples[0], /eyJhbGci/);
  assert.match(problem.samples[0], /\[redacted\]/);
});

test("migration step: R4 also flags a new table outside public/private that holds rows", () => {
  const empty = snap({ "auth.users": { columns: AUTH.columns, rows: [] } });
  const withBucket = snap({ "auth.users": { columns: AUTH.columns, rows: [] }, "storage.buckets": { columns: ["id"], rows: [["evidence"]] } });
  assert.equal(outsideChanges(empty, withBucket)[0].message, "new table holds 1 row(s)");
  const v = evaluateMigrationStep({ a: { before: empty, after: withBucket }, b: { before: empty, after: withBucket } });
  assert.equal(v[0].rule, "R4");
  assert.equal(v[0].run, "reference run");
});

test("migration step: masked volatile columns do not hide counts or null-ness", () => {
  const masks = new Map([["public.ref", new Set(["id"])]]);
  const aBefore = snap({ "public.ref": { columns: ["id", "code"], rows: [] } });
  const bBefore = aBefore;
  const after = (rows) => snap({ "public.ref": { columns: ["id", "code"], rows } });
  const same = evaluateMigrationStep({ a: { before: aBefore, after: after([["u-a", "r"]]) }, b: { before: bBefore, after: after([["u-b", "r"]]) }, masks });
  assert.deepEqual(same, [], "a random id differs but is masked");
  const extra = evaluateMigrationStep({ a: { before: aBefore, after: after([["u-a", "r"]]) }, b: { before: bBefore, after: after([["u-b", "r"], ["u-c", "r"]]) }, masks });
  assert.equal(extra[0].rule, "R2");
  const nulled = evaluateMigrationStep({ a: { before: aBefore, after: after([[null, "r"]]) }, b: { before: bBefore, after: after([["u-b", "r"]]) }, masks });
  assert.equal(nulled[0].rule, "R2");
});

test("migration step: a sequence that advances differently is the R2 fallback signal", () => {
  const t = { "public.items": items([]) };
  const a = { before: snap(t, { "public.counter": null }), after: snap(t, { "public.counter": null }) };
  const b = { before: snap(t, { "public.counter": null, "auth.refresh_tokens_id_seq": null }), after: snap(t, { "public.counter": "1", "auth.refresh_tokens_id_seq": null }) };
  const v = evaluateMigrationStep({ a, b });
  assert.equal(v.length, 1);
  assert.equal(v[0].rule, "R2");
  assert.match(v[0].message, /public\.counter/);
  assert.doesNotMatch(v[0].message, /auth\./);
});

test("R4: a sequence outside public/private must not advance, appear with a value or vanish with one", () => {
  const t = { "public.items": items([]) };
  const at = (seqs) => snap(t, seqs);
  assert.deepEqual(outsideChanges(at({ "auth.s": "3", "public.p": null }), at({ "auth.s": "3", "public.p": "9" })), [], "public is R2's business");
  assert.deepEqual(outsideChanges(at({}), at({ "app.new_seq": null })), [], "a new, unused sequence is schema only");
  assert.match(outsideChanges(at({ "auth.s": null }), at({ "auth.s": "1" }))[0].message, /sequence unused -> 1/);
  assert.match(outsideChanges(at({ "auth.s": null }), at({ "auth.s": "5003 (not called)" }))[0].message, /sequence unused -> 5003 \(not called\)/,
    "setval(<data>, false) outside public/private");
  assert.match(outsideChanges(at({}), at({ "app.c": "2" }))[0].message, /sequence absent -> 2/);
  assert.match(outsideChanges(at({ "app.c": "2" }), at({}))[0].message, /sequence 2 -> absent/);
  const v = evaluateMigrationStep({ a: { before: at({ "app.c": null }), after: at({ "app.c": null }) }, b: { before: at({ "app.c": null }), after: at({ "app.c": "1" }) } });
  assert.equal(v[0].rule, "R4");
  assert.equal(v[0].run, "canary run");
  assert.equal(v[0].table, "app.c");
});

// Schema states as snapshot() attaches them: pg_dump text, cluster and database hashes, the
// within-run hash (passwords, slots, origins) and the event triggers.
const schemaOf = (dump, cluster = "c".repeat(32), database = "d".repeat(32), local = "1".repeat(32), events = [], types = []) =>
  ({ dump, cluster, database, local, events, types });
const withSchema = (snapshot, schema) => Object.assign(snapshot, { schema });

test("schema state: dumps, cluster and database hashes compared exactly; first difference reported", () => {
  const base = "CREATE SCHEMA auth;\nCOMMENT ON TABLE public.items IS 'x';\nEND";
  assert.equal(schemaDifference(schemaOf(base), schemaOf(base)), null);
  assert.equal(schemaDifference(null, schemaOf(base)), null, "no schema state (unit snapshots): nothing to compare");
  const changed = "CREATE SCHEMA auth;\nCOMMENT ON TABLE public.items IS 'פריט קנרית';\nEND";
  const message = schemaDifference(schemaOf(base), schemaOf(changed), ["reference run", "canary run"]);
  assert.match(message, /line 2: reference run "COMMENT ON TABLE public\.items IS 'x';" \| canary run "COMMENT ON TABLE public\.items IS 'פריט קנרית';"/);
  assert.match(schemaDifference(schemaOf(base, "a".repeat(32)), schemaOf(base)), /cluster-wide state differs/);
  assert.match(schemaDifference(schemaOf(base, undefined, "e".repeat(32)), schemaOf(base)), /database properties differ/);
  assert.equal(firstDifference("a\nb", "a\nb\nc"), 'line 3: only in second: "c"');
  assert.equal(firstDifference("x", "y", ["A", "B"]), 'line 1: A "x" | B "y"');
  assert.doesNotMatch(firstDifference("password=hunter2", "x"), /hunter2/, "redacted");
});

test("schema state: the difference names the changed statement, not an unrelated comment header", () => {
  const before = ["--", "-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime", "--", "", "CREATE FUNCTION realtime.apply_rls() AS 1;", "END"].join("\n");
  const after = ["--", "-- Name: items_count(); Type: FUNCTION; Schema: public", "--", "", "CREATE FUNCTION public.items_count() AS 2;", "",
    "--", "-- Name: apply_rls(jsonb, integer); Type: FUNCTION; Schema: realtime", "--", "", "CREATE FUNCTION realtime.apply_rls() AS 1;", "END"].join("\n");
  assert.equal(firstDifference(before, after, ["before", "after"]), 'line 5: only in after: "CREATE FUNCTION public.items_count() AS 2;"');
  assert.equal(firstDifference(after, before, ["after", "before"]), 'line 5: only in after: "CREATE FUNCTION public.items_count() AS 2;"');
  assert.equal(firstDifference("-- a\nX", "-- b\nX"), 'line 1: first "-- a" | second "-- b"', "only comments differ: compare them");
});

test("schema state: pg_dump's random \\restrict lines are dropped, nothing else", () => {
  const dump = "--\n\\restrict AbC123\nCREATE SCHEMA auth;\n\\unrestrict AbC123\n\\restricted_is_not_a_command\n";
  assert.equal(normalizeDump(dump), "--\nCREATE SCHEMA auth;\n\\restricted_is_not_a_command\n");
});

test("schema state: binary-upgrade object ids, transaction ids and sequence states become placeholders, data stays", () => {
  const dump = [
    "SELECT pg_catalog.binary_upgrade_set_next_heap_pg_class_oid('16501'::pg_catalog.oid);",
    "SELECT pg_catalog.binary_upgrade_create_empty_extension('supabase_vault', 'vault', false, '0.3.1', '{16608,16700}', '{\"\"}', ARRAY[]::pg_catalog.text[]);",
    "UPDATE pg_catalog.pg_class",
    "SET relfrozenxid = '992', relminmxid = '1'",
    "WHERE oid = '16711';",
    "SELECT pg_catalog.binary_upgrade_set_missing_value('public.t'::pg_catalog.regclass,'c','canary@example.test');",
    "CREATE TABLE public.t (id integer DEFAULT 16501);",
    "SELECT pg_catalog.setval('public.counter', 101, false);",
  ].join("\n");
  assert.equal(normalizeDump(dump), [
    "SELECT pg_catalog.binary_upgrade_set_next_heap_pg_class_oid('<oid>'::pg_catalog.oid);",
    "SELECT pg_catalog.binary_upgrade_create_empty_extension('supabase_vault', 'vault', false, '0.3.1', '{<oid>}', '{\"\"}', ARRAY[]::pg_catalog.text[]);",
    "UPDATE pg_catalog.pg_class",
    "SET relfrozenxid = '<xid>', relminmxid = '<mxid>'",
    "WHERE oid = '<oid>';",
    "SELECT pg_catalog.binary_upgrade_set_missing_value('public.t'::pg_catalog.regclass,'c','canary@example.test');",
    "CREATE TABLE public.t (id integer DEFAULT 16501);",
    "SELECT pg_catalog.setval('public.counter', <value>, <is_called>);",
  ].join("\n"));
});

test("within one run: a password, slot or origin change is R4, an event trigger change R7", () => {
  const t = { "public.items": items([]) };
  const s = (local, events = ["pgrst_ddl_watch:ddl_command_end"]) => withSchema(snap(t), schemaOf("D", undefined, undefined, local, events));
  assert.deepEqual(withinRunChanges(s("1".repeat(32)), s("1".repeat(32))), []);
  assert.deepEqual(withinRunChanges(snap(t), snap(t)), [], "unit snapshots carry no schema state");
  const pw = evaluateMigrationStep({ a: { before: s("1".repeat(32)), after: s("2".repeat(32)) }, b: { before: s("3".repeat(32)), after: s("3".repeat(32)) } });
  assert.equal(pw[0].rule, "R4");
  assert.equal(pw[0].run, "reference run");
  assert.match(pw[0].message, /password, replication slot or replication origin/);
  const ev = evaluateMigrationStep({ a: { before: s("1".repeat(32)), after: s("1".repeat(32)) },
    b: { before: s("1".repeat(32)), after: s("1".repeat(32), ["leak_login:login", "pgrst_ddl_watch:ddl_command_end"]) } });
  assert.equal(ev[0].rule, "R7");
  assert.match(ev[0].message, /event triggers changed \(added: leak_login:login; removed: none\)/);
  const fx = evaluateFixtureStep(s("1".repeat(32)), s("4".repeat(32)));
  assert.equal(fx[0].rule, "R7");
  assert.match(fx[0].message, /a fixture must only add rows: a role password/);
  const typed = withSchema(snap(t), schemaOf("D", undefined, undefined, "1".repeat(32), [], ["public.leaky"]));
  const ty = evaluateMigrationStep({ a: { before: s("1".repeat(32), []), after: s("1".repeat(32), []) }, b: { before: s("1".repeat(32), []), after: typed } });
  assert.equal(ty[0].rule, "R7");
  assert.equal(ty[0].run, "canary run");
  assert.match(ty[0].message, /base type\(s\) not created by a superuser \(pg_tle create_base_type\): public\.leaky/);
});

test("R3: data written into the schema (a comment, a role) differs between the runs", () => {
  const t = { "public.items": items([]) };
  const s = (dump, cluster) => withSchema(snap(t), schemaOf(dump, cluster));
  const same = evaluateMigrationStep({ a: { before: s("A"), after: s("B") }, b: { before: s("A"), after: s("B") } });
  assert.deepEqual(same, []);
  const comment = evaluateMigrationStep({ a: { before: s("A"), after: s("B\nCOMMENT 'none'") }, b: { before: s("A"), after: s("B\nCOMMENT 'פריט'") } });
  assert.equal(comment[0].rule, "R3");
  assert.match(comment[0].message, /data written into the schema.*line 2: reference run/);
  const role = evaluateMigrationStep({ a: { before: s("A"), after: s("B") }, b: { before: s("A"), after: s("B", "f".repeat(32)) } });
  assert.match(role[0].message, /cluster-wide state differs/);
});

test("determinism and fixtures: schema differences are R7", () => {
  const t = { "public.items": items([]) };
  const s = (dump) => withSchema(snap(t), schemaOf(dump));
  const d = evaluateDeterminism([s("X")], [s("Y")]);
  assert.equal(d.violations[0].rule, "R7");
  assert.match(d.violations[0].message, /nondeterministic DDL/);
  const f = evaluateFixtureStep(s("X"), s("X\nCREATE FUNCTION public.f()"));
  assert.equal(f[0].rule, "R7");
  assert.match(f[0].message, /a fixture must not change the schema/);
  assert.deepEqual(evaluateFixtureStep(s("X"), s("X")), []);
});

test("large objects are snapshot relations outside public/private (R4)", () => {
  const lo = (rows) => snap({ "pg_catalog.pg_largeobject": { columns: ["loid", "pageno", "data"], rows } });
  const v = outsideChanges(lo([]), lo([[16500, 0, "\\x6361"]]));
  assert.equal(v[0].table, "pg_catalog.pg_largeobject");
});

test("other services of the project are detected by container name", () => {
  const names = ["supabase_db_technician-management", "supabase_auth_technician-management", "supabase_db_other",
    "supabase_storage_technician-management", "my_technician-management", "supabase_rest_technician-management-2"];
  assert.deepEqual(otherProjectContainers(names, "technician-management", "supabase_db_technician-management"),
    ["supabase_auth_technician-management", "supabase_storage_technician-management"]);
  assert.deepEqual(otherProjectContainers(["supabase_db_technician-management"], "technician-management", "supabase_db_technician-management"), []);
});

test("determinism: volatile columns are found and masked; other differences fail (R7)", () => {
  const point = (rows, extra = {}) => snap({ "public.ref": { columns: ["id", "code", "created_at"], rows }, ...extra });
  const a1 = [point([]), point([["u1", "r", "t1"], ["u2", "i", "t1"]], { "storage.migrations": { columns: ["at"], rows: [["x"]] } })];
  const a2 = [point([]), point([["u9", "r", "t2"], ["u8", "i", "t2"]], { "storage.migrations": { columns: ["at"], rows: [["y"]] } })];
  const { stepMasks, masked, violations } = evaluateDeterminism(a1, a2);
  assert.deepEqual(violations, []);
  assert.deepEqual([...stepMasks[0].get("public.ref").columns].sort(), ["created_at", "id"]);
  assert.equal(stepMasks[0].has("storage.migrations"), false, "outside public/private is compared within one run only");
  assert.deepEqual(masked, ["public.ref(id, created_at) at migration 1"]);

  const count = evaluateDeterminism([point([["u1", "r", "t"]])], [point([])]);
  assert.equal(count.violations[0].rule, "R7");
  assert.match(count.violations[0].message, /row count differs/);

  // Two columns whose values swap between rows: each column's values match, the rows do not.
  const swap1 = [snap({ "public.p": { columns: ["a", "b"], rows: [["x", "1"], ["y", "2"]] } })];
  const swap2 = [snap({ "public.p": { columns: ["a", "b"], rows: [["x", "2"], ["y", "1"]] } })];
  assert.match(evaluateDeterminism(swap1, swap2).violations[0].message, /beyond the volatile columns/);

  const seq = evaluateDeterminism([snap({}, { "public.s": "1" })], [snap({}, { "public.s": "2" })]);
  assert.equal(seq.violations[0].rule, "R7");
  const schema = evaluateDeterminism([snap({ "public.x": { columns: ["a"], rows: [] } })], [snap({})]);
  assert.match(schema.violations[0].message, /definition differs/);
  assert.match(evaluateDeterminism([point([])], [point([]), point([])]).violations[0].message, /different number of snapshots/);
  assert.deepEqual(volatileColumns(["a", "b"], [{ a: "1", b: "x" }], [{ a: "2", b: "x" }]), new Set(["a"]));
});

test("masks are per migration step: a column volatile in earlier reference rows does not hide data in rows added later (R2)", () => {
  // Migration 1 inserts reference rows with updated_at = now() (volatile); migration 2 adds a row
  // whose updated_at encodes data: equal in A1 and A2 (no data there), different in the canary run.
  const rp = (rows) => ({ columns: ["role", "key", "updated_at"], rows });
  const step0 = snap({ "public.rp": rp([]) });
  const a1 = [step0, snap({ "public.rp": rp([["m", "cal", "t-a1"]]) }), snap({ "public.rp": rp([["m", "cal", "t-a1"], ["m", "notes", "2000-01-01 00:00:00.000001+00"]]) })];
  const a2 = [step0, snap({ "public.rp": rp([["m", "cal", "t-a2"]]) }), snap({ "public.rp": rp([["m", "cal", "t-a2"], ["m", "notes", "2000-01-01 00:00:00.000001+00"]]) })];
  const d = evaluateDeterminism(a1, a2);
  assert.deepEqual(d.violations, []);
  assert.deepEqual([...d.stepMasks[0].get("public.rp").columns], ["updated_at"], "migration 1: the reference rows' now()");
  assert.equal(d.stepMasks[1].has("public.rp"), false, "migration 2 adds a deterministic row: nothing masked");
  const bBefore = snap({ "public.rp": rp([["m", "cal", "t-b"]]) });
  const bAfter = snap({ "public.rp": rp([["m", "cal", "t-b"], ["m", "notes", "2000-01-01 00:00:00.837261+00"]]) });
  const v = evaluateMigrationStep({ a: { before: a1[1], after: a1[2] }, b: { before: bBefore, after: bAfter }, masks: d.stepMasks[1] });
  assert.equal(v[0].rule, "R2");
  // With the old per-table mask (updated_at masked for the whole table) the copy would pass.
  assert.deepEqual(evaluateMigrationStep({ a: { before: a1[1], after: a1[2] }, b: { before: bBefore, after: bAfter }, masks: new Map([["public.rp", new Set(["updated_at"])]]) }), []);
});

test("masks are per group of rows: a deterministic row added next to a now() row cannot carry data (R2)", () => {
  // The reviewers' a06: one added row with updated_at = now(), one whose updated_at encodes data
  // (constant in A1 and A2). The column differs between A1 and A2, but only in the now() row.
  const rp = (rows) => ({ columns: ["role", "key", "updated_at"], rows });
  const before = snap({ "public.rp": rp([]) });
  const a1 = [before, snap({ "public.rp": rp([["manager", "notes", "2000-01-01 00:00:00.000001+00"], ["cs", "notes", "2026-11-05 10:00:00.1+00"]]) })];
  const a2 = [before, snap({ "public.rp": rp([["manager", "notes", "2000-01-01 00:00:00.000001+00"], ["cs", "notes", "2026-11-05 10:00:07.9+00"]]) })];
  const d = evaluateDeterminism(a1, a2);
  assert.deepEqual(d.violations, []);
  assert.deepEqual([...d.stepMasks[0].get("public.rp").columns], ["updated_at"]);
  const ok = snap({ "public.rp": rp([["manager", "notes", "2000-01-01 00:00:00.000001+00"], ["cs", "notes", "2026-11-05 10:01:00.5+00"]]) });
  assert.deepEqual(evaluateMigrationStep({ a: { before, after: a1[1] }, b: { before, after: ok }, masks: d.stepMasks[0] }), [], "the now() row may differ");
  const leak = snap({ "public.rp": rp([["manager", "notes", "2000-01-01 00:00:00.837261+00"], ["cs", "notes", "2026-11-05 10:01:00.5+00"]]) });
  const v = evaluateMigrationStep({ a: { before, after: a1[1] }, b: { before, after: leak }, masks: d.stepMasks[0] });
  assert.equal(v[0].rule, "R2");
  // Two rows in one group (a random key makes them agree on every other column): the value that is
  // equal in A1 and A2 must still appear in the canary run.
  const q = (rows) => ({ columns: ["id", "kind", "at"], rows });
  const qa1 = [before, snap({ "public.q": q([["u1", "x", "2026-11-05 10:00:00.1+00"], ["u2", "x", "2000-01-01 00:00:00.5+00"]]) })];
  const qa2 = [before, snap({ "public.q": q([["u8", "x", "2026-11-05 10:00:09.3+00"], ["u9", "x", "2000-01-01 00:00:00.5+00"]]) })];
  const qd = evaluateDeterminism(qa1, qa2);
  assert.deepEqual(qd.violations, []);
  assert.deepEqual(evaluateMigrationStep({ a: { before: snap({}), after: qa1[1] }, b: { before: snap({}), after: qa2[1] }, masks: qd.stepMasks[0] }), []);
  const qleak = snap({ "public.q": q([["u5", "x", "2026-11-05 10:02:00.4+00"], ["u6", "x", "2000-01-01 00:00:03.5+00"]]) });
  const qv = evaluateMigrationStep({ a: { before: snap({}), after: qa1[1] }, b: { before: snap({}), after: qleak }, masks: qd.stepMasks[0] });
  assert.equal(qv[0].rule, "R3");
  assert.match(qv[0].samples.join(" "), /masked column at, equal in A1 and A2, missing in the canary run/);
});

test("fixture step: only added, test-marked rows with example.test addresses; no sequence", () => {
  const before = snap({ "public.items": items([]), "auth.users": { columns: AUTH.columns, rows: [] } }, { "public.s": null });
  const good = snap({ "public.items": items([["i1", "x", true]]), "auth.users": AUTH }, { "public.s": null });
  assert.deepEqual(evaluateFixtureStep(before, good), []);

  const notTest = snap({ "public.items": items([["i1", "x", false]]), "auth.users": { columns: AUTH.columns, rows: [] } }, { "public.s": null });
  assert.match(evaluateFixtureStep(before, notTest)[0].message, /test-marked/);

  const realMail = snap({ "public.items": items([]), "auth.users": { columns: AUTH.columns, rows: [["u2", "someone@company.co.il"]] } }, { "public.s": null });
  const mailV = evaluateFixtureStep(before, realMail);
  assert.equal(mailV[0].rule, "R7");
  assert.match(mailV[0].message, /company\.co\.il/);

  const seq = snap({ "public.items": items([["i1", "x", true]]), "auth.users": { columns: AUTH.columns, rows: [] } }, { "public.s": "1" });
  const seqV = evaluateFixtureStep(before, seq);
  assert.equal(seqV[0].rule, "R5");
  assert.match(seqV[0].message, /public\.s \(unused -> 1\)/);

  const withRow = snap({ "public.items": items([["i1", "x", true]]), "auth.users": { columns: AUTH.columns, rows: [] } });
  const changed = snap({ "public.items": items([["i1", "y", true]]), "auth.users": { columns: AUTH.columns, rows: [] } });
  assert.match(evaluateFixtureStep(withRow, changed)[0].message, /only add rows/);
  const newTable = snap({ "public.items": items([["i1", "x", true]]), "auth.users": { columns: AUTH.columns, rows: [] }, "public.extra": { columns: ["a"], rows: [] } });
  assert.match(evaluateFixtureStep(withRow, newTable)[0].message, /schema/);
});

test("coverage: rows and non-null columns in public/private, with reasoned exceptions", () => {
  const s = snap({
    "public.empty": { columns: ["a"], rows: [] },
    "public.partial": { columns: ["a", "b", "c"], rows: [[1, null, null], [2, null, 3]] },
    "private.full": { columns: ["a"], rows: [[1]] },
    "public.mv": { columns: ["a"], rows: [], kind: "m" },
    "auth.users": { columns: ["id"], rows: [] },
  });
  assert.deepEqual(evaluateCoverage(s), [{ table: "public.empty", column: null }, { table: "public.partial", column: "b" }]);
  const exceptions = [
    { table: "public.empty", column: null, reason: "table-level exception" },
    { table: "public.partial", column: "b", reason: "column-level exception" },
  ];
  assert.deepEqual(evaluateCoverage(s, exceptions), []);
  assert.deepEqual(staleExceptions(s, exceptions), []);
  const stale = [{ table: "public.gone", column: null, reason: "x" }, { table: "public.partial", column: "zz", reason: "x" }];
  assert.equal(staleExceptions(s, stale).length, 2);
});

test("coverage exceptions are global: an entry for a table a later migration drops is not stale", () => {
  const exception = { table: "public.job_queue", column: null, reason: "emptied by design, dropped later" };
  const step1 = snap({ "public.job_queue": { columns: ["id"], rows: [] } });
  const step2 = snap({ "public.other": { columns: ["id"], rows: [[1]] } });
  assert.deepEqual(staleExceptions(step2, [exception]), [exception], "missing after the last step");
  assert.deepEqual(unusedExceptions([step1, step2], [exception]), [], "but it applied to step 1");
  assert.deepEqual(unusedExceptions([step2], [exception]), [exception], "an entry that matches no step is stale");
  assert.deepEqual(unusedExceptions([], [exception]), [exception], "zero migrations: every entry is stale");
});

test("helpers: e-mail domains, redaction, psql errors", () => {
  assert.deepEqual(foreignEmailDomains('"a@example.test" {"e":"b@sub.example.test"}'), []);
  assert.deepEqual(foreignEmailDomains('"x@gmail.com" "y@Example.Test.evil.io"'), ["gmail.com", "example.test.evil.io"]);
  // A fictional JWT-shaped value, joined at run time so the source never holds a token-shaped
  // literal (the secret scan would rightly flag one).
  const fakeJwt = ["eyJhbGciOiJIUzI1NiJ9", "eyJyb2xlIjoiYW5vbiJ9", "c2lnbmF0dXJlLXZhbHVl"].join(".");
  const secretish = `token=abc123 ${fakeJwt} sb_secret_ABCdef postgresql://u:p@h:5432/db`;
  const out = redact(secretish);
  for (const leaked of ["abc123", "eyJhbGci", "sb_secret_ABC", "u:p@h"]) assert.equal(out.includes(leaked), false, leaked);
  assert.equal(psqlError('psql:<stdin>:3: ERROR:  relation "x" does not exist\nLINE 1: select * from x\nnoise'), 'psql:<stdin>:3: ERROR: relation "x" does not exist | LINE 1: select * from x');
});

test("CLI: a failing check exits 1 and a usage error 2, also through a symlinked path (no Docker needed)", () => {
  const dir = mkdtempSync(join(tmpdir(), "db-canary-test-"));
  try {
    const link = join(dir, "db-canary-link.mjs");
    symlinkSync(SCRIPT, link);
    const noConfig = join(dir, "no-project");
    for (const script of [SCRIPT, link]) {
      const failing = spawnSync(process.execPath, [script, "--workdir", noConfig], { encoding: "utf8" });
      assert.equal(failing.status, 1, `${script}: ${failing.stderr}`);
      assert.match(failing.stderr, /db-canary: FAIL R7/);
      const usage = spawnSync(process.execPath, [script, "--bogus"], { encoding: "utf8" });
      assert.equal(usage.status, 2, `${script}: ${usage.stderr}`);
      assert.match(usage.stderr, /unknown argument/);
    }
  } finally {
    rmSync(dir, { recursive: true, force: true });
  }
});

test("main: usage errors exit 2 and need no Docker", () => {
  const errors = [];
  const original = console.error;
  console.error = (...args) => errors.push(args.join(" "));
  try {
    assert.equal(main(["--bogus"]), 2);
    assert.equal(main(["--selftest", "a", "--migrations", "b"]), 2);
  } finally {
    console.error = original;
  }
  assert.match(errors.join("\n"), /unknown argument/);
});
