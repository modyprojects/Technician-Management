// Migration guard (D47): migrations contain schema and owner-approved real reference data only.
// They must never contain fictitious or test data, because a future Production project is built
// from the same migration files and must start with no fictional content.
//
// Rules for every file in supabase/migrations/*.sql (comments are ignored):
// 1. INSERT is allowed only into approved reference tables (REFERENCE_TABLES).
// 2. An allowed INSERT must not contain test markers: 'simulator', 'automated_test', 'seed',
//    example.test addresses, or any explicit is_test value (reference data keeps the default false).
// 3. COPY ... FROM is not allowed.
//
// Usage: node scripts/check-migrations.mjs [repository root]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Owner-approved reference data (D33 permission catalogue and defaults, D48 initial values).
const REFERENCE_TABLES = new Set(["call_types", "followup_reasons", "permissions", "role_permissions"]);

const TEST_MARKERS = [
  { pattern: /'simulator'/i, label: "data_source 'simulator'" },
  { pattern: /'automated_test'/i, label: "data_source 'automated_test'" },
  { pattern: /'seed'/i, label: "data_source 'seed'" },
  { pattern: /example\.test/i, label: "example.test address" },
  { pattern: /\bis_test\b/i, label: "sets is_test (reference data must keep the default false)" },
];

export function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/--[^\n]*/g, " ");
}

export function checkSql(sql, fileName = "migration.sql") {
  const problems = [];
  const code = stripComments(sql);
  // Statements are split on semicolons; good enough for INSERT/COPY detection in migrations.
  for (const statement of code.split(";")) {
    const text = statement.trim();
    if (!text) continue;
    if (/^copy\b[\s\S]*\bfrom\b/i.test(text)) {
      problems.push(`${fileName}: COPY ... FROM is not allowed in migrations`);
      continue;
    }
    const insert = /\binsert\s+into\s+(?:"?([a-z_][a-z0-9_]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_]*)"?/i.exec(text);
    if (!insert) continue;
    const table = insert[2].toLowerCase();
    if (!REFERENCE_TABLES.has(table)) {
      problems.push(`${fileName}: INSERT into "${table}" is not allowed; migrations may insert only approved reference data (${[...REFERENCE_TABLES].join(", ")})`);
      continue;
    }
    for (const marker of TEST_MARKERS) {
      if (marker.pattern.test(text)) {
        problems.push(`${fileName}: INSERT into "${table}" contains a test marker (${marker.label})`);
      }
    }
  }
  return problems;
}

export function checkRepository(root) {
  const dir = join(root, "supabase", "migrations");
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith(".sql"))
    .sort()
    .flatMap((name) => checkSql(readFileSync(join(dir, name), "utf8"), name));
}

const isMain = process.argv[1] && resolve(process.argv[1]) === resolve(new URL(import.meta.url).pathname);
if (isMain) {
  const root = resolve(process.argv[2] ?? process.cwd());
  const problems = checkRepository(root);
  if (problems.length > 0) {
    console.error("Migration guard failed (D47: no test or fictitious data in migrations):");
    for (const problem of problems) console.error(`- ${problem}`);
    process.exit(1);
  }
  console.log("Migration guard passed: no test or fictitious data in supabase/migrations.");
}
