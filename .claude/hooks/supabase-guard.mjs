#!/usr/bin/env node
// PreToolUse guard for the Supabase MCP tools (CLAUDE.md "Supabase (D53)", D59; owner decisions
// 2026-11-18). Claude Code runs it before every mcp__Supabase__* call with the call as JSON on
// stdin ({tool_name, tool_input, cwd, ...}) and reads one decision from stdout:
//   - deny: another project, an organization-wide operation or a banned tool (list_projects,
//     get_organization, project and branch management, edge-function secrets);
//   - ask: apply_migration and every other write-capable tool, and every execute_sql call that is
//     not provably read-only (the owner approves it in the normal permission prompt);
//   - allow: execute_sql that starts with "set transaction read only;" and contains nothing that
//     could leave the read-only transaction or act outside the database (D59 read-only SQL);
//   - no output: other read tools (list_tables, list_migrations, get_advisors, ...) follow the
//     normal permission flow.
// The SQL check is deliberately conservative: a false positive only causes a permission prompt.
// Forbidden names are matched on several views of the query (raw, comments removed, quoted
// identifiers unwrapped, adjacent string literals joined), and every function that runs a SQL
// string (query_to_xml, ts_stat, pgTAP runners, ...) asks, because its string can build any name.
// The project check reads project_id, project_ref and, for project tools such as get_project, id.
// It fails closed: unreadable input or an internal error answers "ask".
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** The only Supabase project Claude Code may touch (CLAUDE.md, D53). */
export const PROJECT_REF = "ooxozvvrljjkyfduuiks";

/** Never called (same list as permissions.deny in .claude/settings.json; defence in depth). */
export const BANNED_TOOLS = new Set([
  "list_projects",
  "get_organization",
  "list_organizations",
  "create_project",
  "pause_project",
  "restore_project",
  "create_branch",
  "delete_branch",
  "merge_branch",
  "reset_branch",
  "rebase_branch",
  "create_edge_function_secret",
]);

/** Write-capable tool name prefixes: always the owner's approval (per-operation, D53). */
const WRITE_PREFIXES = [
  "apply_",
  "create_",
  "delete_",
  "update_",
  "merge_",
  "reset_",
  "rebase_",
  "pause_",
  "restore_",
  "deploy_",
  "run_",
  "submit_",
  "confirm_",
];

/** Tools that print API keys (CLAUDE.md: never list keys); answered with "ask". */
const KEY_TOOLS = new Set(["get_publishable_keys", "get_anon_key"]);

const READ_ONLY_HEAD = /^set\s+transaction\s+read\s+only\s*;/i;

/** Statements that end the read-only transaction, change the session or act outside a query. */
const STATEMENT_START =
  /^(?:commit|rollback|abort|end|begin|start\s+transaction|savepoint|release|prepare\s+transaction|set\s+session|set\s+local|set\s+role|reset|discard|copy|call|do|listen|notify|unlisten|vacuum|analy[sz]e|checkpoint|cluster|reindex|lock|load|alter\s+system)\b/i;

/** Text that is never allowed anywhere in an auto-approved query (strings and comments included). */
const ANYWHERE = [
  [/\bread\s+write\b/i, "read write"],
  [/\bdblink/i, "dblink"],
  [/\bset_config\b/i, "set_config"],
  [/\bpg_terminate_backend\b/i, "pg_terminate_backend"],
  [/\bpg_cancel_backend\b/i, "pg_cancel_backend"],
  [/\bpg_reload_conf\b/i, "pg_reload_conf"],
  [/\bpg_rotate_logfile/i, "pg_rotate_logfile"],
  [/\bpg_switch_wal\b/i, "pg_switch_wal"],
  [/\bpg_promote\b/i, "pg_promote"],
  [/\bpg_sleep/i, "pg_sleep"],
  [/\blo_import\b/i, "lo_import"],
  [/\blo_export\b/i, "lo_export"],
  [/\bpg_read_file\b/i, "pg_read_file"],
  [/\bpg_read_binary_file\b/i, "pg_read_binary_file"],
  [/\bpg_ls_\w*/i, "pg_ls_dir"],
  [/\bpg_stat_file\b/i, "pg_stat_file"],
  [/\bpg_file_\w+/i, "pg_file_write"],
  [/\bdefault_transaction_read_only\b/i, "default_transaction_read_only"],
  [/\btransaction_read_only"?\s*(?:=|\bto\b)/i, "transaction_read_only = / to"],
  // Additions beyond the owner's list (defence in depth, each only causes a prompt):
  [/\bu&['"]/i, "unicode-escaped literal (can hide a name)"],
  [/\bpg_background/i, "pg_background"],
  [/\bpg_notify\b/i, "pg_notify"],
  [/replication_slot/i, "replication slot function"],
  [/\bpg_logical_emit_message\b/i, "pg_logical_emit_message"],
  [/\bhttp(?:_\w+)?\s*\(/i, "http extension call"],
  [/\bnet\s*\.\s*http_/i, "pg_net call"],
  // Functions that run a SQL string: the string can spell any name above in pieces
  // ('pg_ter' || 'minate_backend'), so the executor itself needs approval.
  [/\bquery_to_xml/i, "query_to_xml (runs a SQL string)"],
  [/\bts_stat\b/i, "ts_stat (runs a SQL string)"],
  [/\bts_rewrite\b/i, "ts_rewrite (can run a SQL string)"],
  [/\bcrosstab\d*\b/i, "crosstab (runs a SQL string)"],
  [/\bconnectby\b/i, "connectby (builds and runs SQL)"],
  [/\bindex_advisor\b/i, "index_advisor (runs a SQL string)"],
  [/\bpgr_\w+/i, "pgRouting function (runs a SQL string)"],
  [
    /\b(?:lives_ok|dies_ok|throws_\w+|results_(?:eq|ne)|set_(?:eq|ne|has|hasnt)|bag_(?:eq|ne|has|hasnt)|is_empty|isnt_empty|row_eq|performs_\w+|runtests|do_tap|_runner)\b/i,
    "pgTAP runner (runs a SQL string)",
  ],
];

/** Quoted identifiers unwrapped ("http_get" -> http_get), so a quote cannot split a name from "(" or ".". */
function unwrapQuotedIdentifiers(text) {
  return text.replace(/"((?:[^"]|"")*)"/g, (_, name) => name.replace(/""/g, '"'));
}

/** Adjacent literals joined ('pg_ter' || 'minate' -> 'pg_terminate'), so a split name is seen whole. */
function joinConcatenatedLiterals(text) {
  return text.replace(/(?:'|\$\w*\$)(?:\s*::\s*\w+)?\s*\|\|\s*\(*\s*(?:[eE]?'|\$\w*\$)/g, "");
}

function isIdentChar(ch) {
  return ch !== undefined && /[A-Za-z0-9_$\u0080-￿]/.test(ch);
}

/** Index just after the block comment that starts at `start` (PostgreSQL nests them), or -1. */
function skipBlockComment(text, start) {
  let depth = 0;
  let i = start;
  while (i < text.length) {
    if (text.startsWith("/*", i)) {
      depth++;
      i += 2;
    } else if (text.startsWith("*/", i)) {
      depth--;
      i += 2;
      if (depth === 0) return i;
    } else {
      i++;
    }
  }
  return -1;
}

/** Index just after the line comment that starts at `start` (ends at CR or LF, as in PostgreSQL). */
function skipLineComment(text, start) {
  const match = /[\r\n]/.exec(text.slice(start));
  return match === null ? text.length : start + match.index + 1;
}

/** Removes leading whitespace and comments, repeatedly. An unterminated comment leaves "". */
export function stripLeadingTrivia(text) {
  let i = 0;
  for (;;) {
    while (i < text.length && /\s/.test(text[i])) i++;
    if (text.startsWith("--", i)) {
      i = skipLineComment(text, i);
    } else if (text.startsWith("/*", i)) {
      const end = skipBlockComment(text, i);
      if (end < 0) return "";
      i = end;
    } else {
      return text.slice(i);
    }
  }
}

/**
 * A small PostgreSQL lexer. `skeleton` has comments replaced by a space and every string, quoted
 * identifier and dollar-quoted body replaced by an empty placeholder, so a ";" in it is a real
 * statement separator. `noComments` keeps strings and drops comments. With `backslashEscapes`
 * every plain string honours backslash escapes (standard_conforming_strings off), a second view
 * that is checked as well so a lexer disagreement only adds findings.
 */
export function lexSql(text, backslashEscapes) {
  let skeleton = "";
  let noComments = "";
  let i = 0;
  const n = text.length;
  const dollarTag = /\$(?:[A-Za-z_\u0080-￿][A-Za-z0-9_\u0080-￿]*)?\$/y;
  while (i < n) {
    const c = text[i];
    if (c === "-" && text[i + 1] === "-") {
      i = skipLineComment(text, i);
      skeleton += " ";
      noComments += " ";
      continue;
    }
    if (c === "/" && text[i + 1] === "*") {
      const end = skipBlockComment(text, i);
      i = end < 0 ? n : end;
      skeleton += " ";
      noComments += " ";
      continue;
    }
    if (c === "'") {
      const prev = text[i - 1];
      const escapes = backslashEscapes || ((prev === "e" || prev === "E") && !isIdentChar(text[i - 2]));
      let j = i + 1;
      while (j < n) {
        if (escapes && text[j] === "\\") {
          j += 2;
        } else if (text[j] === "'") {
          if (text[j + 1] === "'") {
            j += 2;
          } else {
            j++;
            break;
          }
        } else {
          j++;
        }
      }
      j = Math.min(j, n);
      skeleton += "''";
      noComments += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === '"') {
      let j = i + 1;
      while (j < n) {
        if (text[j] === '"') {
          if (text[j + 1] === '"') {
            j += 2;
          } else {
            j++;
            break;
          }
        } else {
          j++;
        }
      }
      j = Math.min(j, n);
      skeleton += '""';
      noComments += text.slice(i, j);
      i = j;
      continue;
    }
    if (c === "$" && !isIdentChar(text[i - 1])) {
      dollarTag.lastIndex = i;
      const match = dollarTag.exec(text);
      if (match !== null) {
        const close = text.indexOf(match[0], i + match[0].length);
        const j = close < 0 ? n : close + match[0].length;
        skeleton += "''";
        noComments += text.slice(i, j);
        i = j;
        continue;
      }
    }
    skeleton += c;
    noComments += c;
    i++;
  }
  return { skeleton, noComments };
}

/** Decides an execute_sql query: "allow" only when provably inside a read-only transaction. */
export function classifySql(query) {
  if (typeof query !== "string") {
    return { decision: "ask", reason: "execute_sql needs approval: the query is not a string" };
  }
  if (!READ_ONLY_HEAD.test(stripLeadingTrivia(query))) {
    return {
      decision: "ask",
      reason: 'execute_sql needs approval: the query does not start with "set transaction read only;"',
    };
  }
  const findings = new Set();
  const views = [lexSql(query, false), lexSql(query, true)];
  const statementLists = [
    ...views.map((view) => view.skeleton.split(";").map((part) => part.trim())),
    query.split(";").map((part) => stripLeadingTrivia(part)),
  ];
  for (const statements of statementLists) {
    for (const statement of statements) {
      const match = STATEMENT_START.exec(statement);
      if (match !== null) findings.add(`a statement starting with "${match[0].replace(/\s+/g, " ").toLowerCase()}"`);
    }
  }
  const texts = [query];
  for (const view of views) {
    const unwrapped = unwrapQuotedIdentifiers(view.noComments);
    texts.push(view.noComments, unwrapped, joinConcatenatedLiterals(unwrapped));
  }
  for (const [pattern, label] of ANYWHERE) {
    if (texts.some((text) => pattern.test(text))) findings.add(label);
  }
  if (findings.size > 0) {
    return {
      decision: "ask",
      reason: `execute_sql needs approval: the query contains ${[...findings].slice(0, 4).join(", ")}`,
    };
  }
  return {
    decision: "allow",
    reason: 'read-only SQL: starts with "set transaction read only;" and has no escape from it (D59)',
  };
}

/** The tool name after "mcp__<server>__", and whether the server is Supabase. */
function splitToolName(toolName) {
  if (!toolName.startsWith("mcp__")) return { server: "", name: toolName };
  const rest = toolName.slice(5);
  const sep = rest.indexOf("__");
  if (sep < 0) return { server: rest, name: "" };
  return { server: rest.slice(0, sep), name: rest.slice(sep + 2) };
}

/** Returns {decision, reason} or null (no decision: normal permission flow). */
export function decide(input) {
  if (input === null || typeof input !== "object" || Array.isArray(input)) {
    return { decision: "ask", reason: "Supabase guard could not read the tool call" };
  }
  if (typeof input.tool_name !== "string") {
    return { decision: "ask", reason: "Supabase guard: the tool call has no tool name" };
  }
  const { server, name } = splitToolName(input.tool_name);
  if (!/supabase/i.test(server)) return null;
  const toolInput = input.tool_input ?? {};
  if (toolInput === null || typeof toolInput !== "object" || Array.isArray(toolInput)) {
    return { decision: "ask", reason: "Supabase guard: the tool input is not an object" };
  }
  if (BANNED_TOOLS.has(name)) {
    return { decision: "deny", reason: `Supabase ${name} is banned (CLAUDE.md D53: one project only, no organization access)` };
  }
  // get_project names the project "id"; other tools use "project_id" (or "project_ref").
  const projectKeys = ["project_id", "project_ref", ...(/project/i.test(name) ? ["id"] : [])];
  if (projectKeys.some((key) => Object.hasOwn(toolInput, key) && toolInput[key] !== PROJECT_REF)) {
    return { decision: "deny", reason: `Only Supabase project ${PROJECT_REF} may be used (CLAUDE.md D53)` };
  }
  if (Object.hasOwn(toolInput, "organization_id")) {
    return { decision: "deny", reason: "Organization-wide Supabase operations are banned (CLAUDE.md D53)" };
  }
  if (name === "execute_sql") {
    if (toolInput.project_id !== PROJECT_REF) {
      return { decision: "ask", reason: "execute_sql needs approval: no project_id was given" };
    }
    return classifySql(toolInput.query);
  }
  if (WRITE_PREFIXES.some((prefix) => name.startsWith(prefix))) {
    return { decision: "ask", reason: `Supabase ${name} can change the project: the owner approves each operation (D53)` };
  }
  if (KEY_TOOLS.has(name)) {
    return { decision: "ask", reason: `Supabase ${name} prints API keys (CLAUDE.md: never list keys)` };
  }
  return null;
}

function emit(result) {
  if (result === null) return;
  process.stdout.write(
    `${JSON.stringify({
      hookSpecificOutput: {
        hookEventName: "PreToolUse",
        permissionDecision: result.decision,
        permissionDecisionReason: result.reason,
      },
    })}\n`,
  );
}

function main() {
  let result;
  try {
    result = decide(JSON.parse(readFileSync(0, "utf8")));
  } catch {
    result = { decision: "ask", reason: "Supabase guard failed closed: the tool call could not be checked" };
  }
  emit(result);
}

function isEntryPoint() {
  try {
    return realpathSync(process.argv[1] ?? "") === realpathSync(fileURLToPath(import.meta.url));
  } catch {
    return false;
  }
}

if (isEntryPoint()) main();
