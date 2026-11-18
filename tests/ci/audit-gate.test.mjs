// The CI dependency audit gate (scripts/audit-gate.mjs): fails on every high or critical advisory
// except a listed, unexpired, development-only exception; fails closed on bad input.
import { test } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, readFileSync, symlinkSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, resolve, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import { evaluate } from "../../scripts/audit-gate.mjs";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const ID = "GHSA-fc5q-39xc-vjpf";
const advisory = (severity = "high", url = `https://github.com/advisories/${ID}`) => ({
  source: 1, name: "picomatch", title: "ReDoS", url, severity, range: "<=4.0.7",
});
const report = (via, nodes = ["node_modules/picomatch"], extra = {}) => ({
  auditReportVersion: 2,
  vulnerabilities: {
    picomatch: { name: "picomatch", severity: via.severity ?? "high", via: [via], nodes, isDirect: false },
    micromatch: { name: "micromatch", severity: via.severity ?? "high", via: ["picomatch"], nodes: ["node_modules/micromatch"] },
    ...extra,
  },
});
const lock = (dev = true) => ({
  packages: {
    "": {},
    "node_modules/picomatch": { version: "2.3.2", dev },
    "node_modules/tinyglobby/node_modules/picomatch": { version: "4.0.7", dev: true },
    "node_modules/micromatch": { version: "4.0.8", dev: true },
    "node_modules/next": { version: "16.4.3" },
  },
});
const exception = (over = {}) => ({
  exceptions: [{ advisory: ID, package: "picomatch", devOnly: true, expires: "2026-12-15", reason: "r", ...over }],
});
const run = (over = {}) =>
  evaluate({ report: report(advisory()), lock: lock(), exceptions: exception(), today: "2026-11-18", ...over });

test("an excepted, unexpired, dev-only high advisory passes", () => {
  const r = run();
  assert.equal(r.ok, true, r.errors.join("\n"));
  assert.equal(r.allowed.length, 1);
  assert.deepEqual(r.unused, []);
});

test("both installed copies must be dev-only", () => {
  const r = run({ report: report(advisory(), ["node_modules/picomatch", "node_modules/tinyglobby/node_modules/picomatch"]) });
  assert.equal(r.ok, true, r.errors.join("\n"));
});

test("a copy that is not dev-only fails the dev-only exception", () => {
  const r = run({ lock: lock(false) });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /non-dev/);
});

test("a copy missing from the lockfile fails closed", () => {
  const r = run({ report: report(advisory(), ["node_modules/unknown/node_modules/picomatch"]) });
  assert.equal(r.ok, false);
});

test("no installed copies listed fails closed", () => {
  assert.equal(run({ report: report(advisory(), []) }).ok, false);
});

test("an expired exception fails", () => {
  const r = run({ today: "2026-12-16" });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /expired/);
});

test("the expiry day itself still passes", () => {
  assert.equal(run({ today: "2026-12-15" }).ok, true);
});

test("a different high advisory on the same package fails", () => {
  const r = run({ report: report(advisory("high", "https://github.com/advisories/GHSA-2222-3333-4444")) });
  assert.equal(r.ok, false);
  assert.match(r.errors[0], /not excepted/);
});

test("the same advisory id on another package is not covered", () => {
  const other = { next: { name: "next", severity: "high", via: [{ ...advisory(), name: "next" }], nodes: ["node_modules/next"] } };
  const r = run({ report: report(advisory(), ["node_modules/picomatch"], other) });
  assert.equal(r.ok, false);
  assert.match(r.errors.join("\n"), /in next/);
});

test("a critical advisory without an exception fails", () => {
  const crit = { next: { name: "next", severity: "critical", via: [{ source: 9, name: "next", title: "x", url: "https://github.com/advisories/GHSA-2222-3333-4444", severity: "critical" }], nodes: ["node_modules/next"] } };
  assert.equal(run({ report: report(advisory(), ["node_modules/picomatch"], crit) }).ok, false);
});

test("moderate and low advisories never block", () => {
  const mod = { next: { name: "next", severity: "moderate", via: [{ source: 8, name: "next", title: "x", url: "https://github.com/advisories/GHSA-2222-3333-4444", severity: "moderate" }], nodes: ["node_modules/next"] } };
  const r = run({ report: report(advisory("low"), ["node_modules/picomatch"], mod), exceptions: { exceptions: [] } });
  assert.equal(r.ok, true, r.errors.join("\n"));
});

test("a clean report passes and lists the exception as unused", () => {
  const r = run({ report: { auditReportVersion: 2, vulnerabilities: {} } });
  assert.equal(r.ok, true);
  assert.deepEqual(r.unused, [`${ID} in picomatch`]);
});

test("malformed exceptions fail closed", () => {
  for (const bad of [{ advisory: "CVE-2026-1" }, { expires: "15/12/2026" }, { reason: "" }, { devOnly: "yes" }, { devOnly: false }, { package: "" }]) {
    assert.equal(run({ exceptions: exception(bad) }).ok, false, JSON.stringify(bad));
  }
  assert.equal(run({ exceptions: {} }).ok, false);
});

test("a malformed report or lockfile fails closed", () => {
  assert.equal(run({ report: {} }).ok, false);
  assert.equal(run({ report: null }).ok, false);
  assert.equal(run({ lock: {} }).ok, false);
});

test("the committed exceptions file is valid and dev-only", () => {
  const file = JSON.parse(readFileSync(join(root, "config", "audit-exceptions.json"), "utf8"));
  for (const e of file.exceptions) {
    assert.match(e.advisory, /^GHSA-/);
    assert.equal(e.devOnly, true, "only development-only exceptions are allowed");
  }
});

test("the CLI fails closed on an unreadable report and passes a clean one", () => {
  const dir = mkdtempSync(join(tmpdir(), "audit-gate-"));
  const bad = join(dir, "bad.json");
  writeFileSync(bad, "not json");
  const fail = spawnSync(process.execPath, [join(root, "scripts", "audit-gate.mjs"), "--report", bad], { encoding: "utf8" });
  assert.equal(fail.status, 1);
  const good = join(dir, "good.json");
  writeFileSync(good, JSON.stringify({ auditReportVersion: 2, vulnerabilities: {} }));
  const pass = spawnSync(process.execPath, [join(root, "scripts", "audit-gate.mjs"), "--report", good], { encoding: "utf8" });
  assert.equal(pass.status, 0, pass.stderr);
  // Run through a symlinked path: the CLI must still run (no silent pass).
  const crit = join(dir, "crit.json");
  writeFileSync(crit, JSON.stringify({ auditReportVersion: 2, vulnerabilities: { next: { name: "next", severity: "critical", via: [{ source: 9, name: "next", title: "x", url: "https://github.com/advisories/GHSA-2222-3333-4444", severity: "critical" }], nodes: ["node_modules/next"] } } }));
  const link = join(dir, "gate-link.mjs");
  symlinkSync(join(root, "scripts", "audit-gate.mjs"), link);
  const viaLink = spawnSync(process.execPath, [link, "--report", crit], { encoding: "utf8" });
  assert.equal(viaLink.status, 1, "a symlinked invocation must not pass silently");
  // A bare --today must not disable expiry.
  const bare = spawnSync(process.execPath, [join(root, "scripts", "audit-gate.mjs"), "--report", good, "--today"], { encoding: "utf8" });
  assert.equal(bare.status, 1);
});

test("invalid today values fail closed", () => {
  for (const today of [undefined, "0", "2026-1-1", ""]) assert.equal(run({ today }).ok, false, String(today));
});

test("npm error reports and unknown report versions fail closed", () => {
  assert.equal(run({ report: { auditReportVersion: 2, error: { code: "ENOAUDIT" }, vulnerabilities: {} } }).ok, false);
  assert.equal(run({ report: { vulnerabilities: {} } }).ok, false);
  assert.equal(run({ report: { auditReportVersion: 1, advisories: {} } }).ok, false);
});

test("a high or critical entry without an explaining advisory fails closed", () => {
  const shapes = [
    { x: { name: "x", severity: "critical", via: [], nodes: ["node_modules/x"] } },
    { x: { name: "x", severity: "critical", via: "picomatch", nodes: ["node_modules/x"] } },
    { x: { name: "x", severity: "critical", via: ["missing-package"], nodes: ["node_modules/x"] } },
  ];
  for (const extra of shapes) {
    assert.equal(run({ report: report(advisory(), ["node_modules/picomatch"], extra) }).ok, false, JSON.stringify(extra));
  }
});
