#!/usr/bin/env node
// CI dependency audit gate. Replaces a bare `npm audit --audit-level=high`.
//
// Fails on every high or critical advisory, exactly like `npm audit --audit-level=high`, except an
// advisory listed in config/audit-exceptions.json that:
//   - names the advisory id (GHSA-…) and the package it is reported on,
//   - has not expired (the exception stops working on its "expires" date, so it is re-checked), and
//   - reaches only development dependencies (every installed copy is "dev": true in
//     package-lock.json), when the exception says "devOnly": true.
// Fails closed: an unreadable audit report, a missing lockfile entry or a malformed exception
// fails the gate. An exception that no longer matches anything is reported so it can be removed.
//
// Usage: node scripts/audit-gate.mjs [--report audit.json] [--lock package-lock.json]
//                                    [--exceptions config/audit-exceptions.json] [--today YYYY-MM-DD]
// Without --report it runs `npm audit --json` itself.
import { spawnSync } from "node:child_process";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..");
const BLOCKING = new Set(["high", "critical"]);
const GHSA = /^GHSA(-[23456789cfghjmpqrvwx]{4}){3}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;

function arg(name, fallback) {
  const i = process.argv.indexOf(name);
  return i === -1 ? fallback : process.argv[i + 1];
}

function readJson(path, what) {
  try {
    return JSON.parse(readFileSync(path, "utf8"));
  } catch (error) {
    throw new Error(`cannot read ${what} (${path}): ${error.message}`);
  }
}

function auditReport() {
  const file = arg("--report");
  if (file) return readJson(file, "audit report");
  const run = spawnSync("npm", ["audit", "--json"], { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });
  try {
    return JSON.parse(run.stdout);
  } catch {
    throw new Error(`npm audit did not return JSON (exit ${run.status}): ${(run.stderr || "").slice(0, 300)}`);
  }
}

function advisoryId(via) {
  const id = String(via.url || "").split("/").pop();
  return GHSA.test(id) ? id : `npm-${via.source}`;
}

export function evaluate({ report, lock, exceptions, today }) {
  const errors = [];
  const allowed = [];
  if (!report || typeof report.vulnerabilities !== "object" || report.vulnerabilities === null) {
    return { ok: false, errors: ["audit report has no vulnerabilities object"], allowed, unused: [] };
  }
  if (!lock || typeof lock.packages !== "object") {
    return { ok: false, errors: ["package-lock.json has no packages object"], allowed, unused: [] };
  }
  const list = Array.isArray(exceptions?.exceptions) ? exceptions.exceptions : null;
  if (!list) return { ok: false, errors: ["audit exceptions file has no exceptions array"], allowed, unused: [] };
  for (const e of list) {
    if (!GHSA.test(String(e.advisory)) || !e.package || !DATE.test(String(e.expires)) || !e.reason || typeof e.devOnly !== "boolean") {
      errors.push(`malformed exception ${JSON.stringify(e)} (needs advisory GHSA id, package, expires YYYY-MM-DD, reason, devOnly)`);
    }
  }
  if (errors.length) return { ok: false, errors, allowed, unused: [] };

  const used = new Set();
  for (const [name, vuln] of Object.entries(report.vulnerabilities)) {
    for (const via of vuln.via || []) {
      if (typeof via !== "object" || via === null) continue; // propagated from another package; checked there
      if (!BLOCKING.has(via.severity)) continue;
      const id = advisoryId(via);
      const label = `${via.severity} ${id} in ${name} (${via.title || "no title"})`;
      const e = list.find((x) => x.advisory === id && x.package === name);
      if (!e) {
        errors.push(`${label}: not excepted`);
        continue;
      }
      if (e.expires < today) {
        errors.push(`${label}: exception expired on ${e.expires}; re-check the advisory`);
        continue;
      }
      if (e.devOnly) {
        const nodes = Array.isArray(vuln.nodes) ? vuln.nodes : [];
        if (nodes.length === 0) {
          errors.push(`${label}: the report lists no installed copies, cannot prove dev-only`);
          continue;
        }
        const prod = nodes.filter((p) => lock.packages[p]?.dev !== true);
        if (prod.length) {
          errors.push(`${label}: reaches non-dev dependencies (${prod.join(", ")}), the dev-only exception does not apply`);
          continue;
        }
      }
      used.add(list.indexOf(e));
      allowed.push(`${label}: excepted until ${e.expires}${e.devOnly ? ", dev-only" : ""}`);
    }
  }
  const unused = list.filter((_, i) => !used.has(i)).map((e) => `${e.advisory} in ${e.package}`);
  return { ok: errors.length === 0, errors, allowed, unused };
}

const isMain = process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isMain) {
  try {
    const result = evaluate({
      report: auditReport(),
      lock: readJson(arg("--lock", resolve(root, "package-lock.json")), "package-lock.json"),
      exceptions: readJson(arg("--exceptions", resolve(root, "config/audit-exceptions.json")), "audit exceptions"),
      today: arg("--today", new Date().toISOString().slice(0, 10)),
    });
    for (const line of result.allowed) console.log(`allowed: ${line}`);
    for (const line of result.unused) console.log(`unused exception (remove it): ${line}`);
    for (const line of result.errors) console.error(`audit: ${line}`);
    console.log(result.ok ? "Audit gate passed: no unexcepted high or critical advisory." : "Audit gate FAILED.");
    process.exit(result.ok ? 0 : 1);
  } catch (error) {
    console.error(`Audit gate FAILED (fail closed): ${error.message}`);
    process.exit(1);
  }
}
