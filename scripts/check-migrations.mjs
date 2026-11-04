// Migration guard (D47, D49): migrations contain schema and owner-approved real reference data only.
// They must never contain fictitious or test data, because a future Production project is built
// from the same migration files and must start with no fictional content.
//
// How it reads SQL (re-review R-G4, R-G7): a tokenizer that follows the PostgreSQL lexer. Comments
// (nested), single-quoted strings, E'' strings, quoted identifiers and dollar quotes of any tag
// length are recognised exactly as PostgreSQL does; unquoted identifiers are lower-cased and
// truncated to 63 bytes as PostgreSQL does. Every rule matches tokens, never text with the strings
// blanked out. Anything the tokenizer cannot read fails closed: an unterminated quote, an
// unexpected character, a non-ASCII character outside a string or comment, U&'' / U&"" escapes.
// Function bodies and DO bodies are tokenized in turn; a lexer error inside them fails too. A
// function definition or a DO block is recognised wherever it starts in a statement (in PL/pgSQL
// after BEGIN, THEN, LOOP ...), and dollar quotes are allowed only as such bodies, so no code can
// hide in a dollar-quoted "text". A string continued across a newline fails (PostgreSQL joins it).
//
// "Statements that run" are top-level statements and statements inside DO blocks. A function body
// does not run when it is defined, so rules for statements that run are relaxed there; the
// function is then a "writer" instead, and a migration never calls a writer.
//
// Rules for every file in supabase/migrations/*.sql:
// 0. Names (fix round 2, V1-1): a name with three parts (database.schema.object, which PostgreSQL
//    accepts for the current database, or record.field.field) fails anywhere; every rule that reads
//    a schema-qualified name fails closed when it cannot read one (an INSERT, ALTER TABLE, CREATE
//    TABLE/VIEW or trigger target).
// 1. INSERT in a statement that runs is allowed only as a plain reference INSERT:
//      insert into public.<reference table> (column, ...) values (constant, ...), ...;
//    with an approved reference table (REFERENCE_TABLES), an explicit column list without the
//    test-marker columns (is_test, data_source, target_is_test) and plain constants only (plain
//    '...' strings, numbers, true, false, null). Nothing else may follow the VALUES list.
// 2. No test markers: a reference INSERT's strings must not contain 'simulator', 'automated_test',
//    'seed' or an example.test address; no ALTER may set a default on a marker column (other than
//    false; DROP DEFAULT only as ALTER [COLUMN] x DROP DEFAULT; never generated), a reference table
//    may not be created with such a default, no CREATE TABLE may copy defaults with LIKE, no
//    column constraint may be named before DEFAULT (CONSTRAINT x DEFAULT), and no domain or base
//    type may have a default. A BEFORE or INSTEAD OF INSERT trigger on a reference table (or on a
//    table the guard cannot read), wherever it is created, may run only a function listed in
//    ALLOWED_REFERENCE_TRIGGERS, named by its exact schema-qualified signature and defined in the
//    files; every definition of such a function must be a PL/pgSQL body that never changes NEW
//    (assignment, INTO, FOR/FOREACH, ALIAS FOR, GET DIAGNOSTICS, CALL) and returns only NEW or NULL.
//    As in the guard on main, a string that reads as an INSERT into a business table fails
//    anywhere, and so does a string that reads as a pg_graphql mutation.
// 3. No COPY (anywhere, also in bodies), no EXPLAIN, no LOAD.
// 4. Function bodies. Every CREATE FUNCTION / CREATE PROCEDURE body must be dollar-quoted
//    (AS $$ ... $$) in LANGUAGE sql or plpgsql; any other form fails because the guard cannot read
//    it. An INSERT inside a body is allowed only in a reviewed writer function listed in
//    ALLOWED_WRITERS by exact signature, and only into the tables listed for it; its strings must
//    not contain test markers either. A function whose body or header (parameter defaults,
//    options) inserts, updates, deletes, merges or truncates, or names a writer, is a writer
//    itself. Every name in ALLOWED_WRITERS is a writer even when its definition is elsewhere.
//    A migration never names a writer in a statement that runs, with or without "(" (a call,
//    a trigger, an operator, an aggregate, a cast, a default, a policy, CALL ...); only GRANT,
//    REVOKE, COMMENT ON and DROP FUNCTION/PROCEDURE/ROUTINE may name one.
// 5. D49: bootstrap_first_creator may appear only in its own CREATE FUNCTION header, in REVOKE and
//    in COMMENT ON FUNCTION statements; anywhere else (a call, a GRANT, an ALTER, another function's
//    body or header, a string) fails.
// 6. No dynamic SQL anywhere, also in function bodies: EXECUTE fails, except as a privilege in
//    GRANT/REVOKE/ALTER DEFAULT PRIVILEGES and as EXECUTE FUNCTION/PROCEDURE in CREATE [EVENT]
//    TRIGGER. Built-ins that run SQL text or write outside the schema fail as any name, quoted or
//    not (query_to_xml and relatives, dblink, http, set_config, large-object and file functions,
//    create_secret, update_secret, resolve), and so do the names of the cron, vault, net, pgsodium,
//    realtime, supabase_functions, dblink, graphql, graphql_public, pgmq and pgmq_public schemas,
//    quoted or not, followed by "." or not, and inside a search_path string. CREATE EXTENSION only
//    for names in ALLOWED_EXTENSIONS; ALTER EXTENSION, subscriptions, foreign servers and foreign
//    tables fail. standard_conforming_strings, backslash_quote and session_replication_role may not
//    be named.
// 7. No other data change in statements that run: UPDATE (any form: ONLY, parentheses, "*",
//    aliases, in a CTE; after DO, in a rule action or ON CONFLICT, always; after FOR, as in OPEN
//    ... FOR UPDATE, unless a word of a locking clause or a policy follows), DELETE FROM, MERGE
//    INTO, TRUNCATE, CREATE TABLE ... AS (any form), SELECT/WITH ... INTO, materialized views
//    (create or refresh), ALTER COLUMN ... TYPE ... USING.
//    Schema changes that rewrite existing rows fail too (fix round 1, N1). ALTER TABLE is read
//    wherever it starts in a statement (also after BEGIN or THEN, and in function bodies). On an
//    existing table, ALTER TABLE may not DROP COLUMN, change a column's type (TYPE, SET DATA TYPE),
//    SET EXPRESSION, or ADD COLUMN with a DEFAULT other than null (SET DEFAULT only as ON
//    DELETE/UPDATE SET DEFAULT), GENERATED, a serial type, or a type that is neither a built-in
//    type (BUILTIN_TYPES, unquoted) nor a type created schema-qualified by a top-level statement
//    of the files (a domain with a default fills every row; fix round 2, V1-5 and V1-7).
//    "Existing" is every table except one created earlier in the same file by a plain top-level
//    CREATE TABLE <schema>.<name> (not IF NOT EXISTS, not temporary, not in a DO block or function
//    body) that no INSERT in the file has targeted yet; in function bodies every table is existing.
//    CREATE CAST and ALTER TYPE ... ALTER/DROP ATTRIBUTE fail everywhere (a cast or a typed table
//    change rewrites values).
// 8. Names stay what they are: no RENAME of any kind (TO, COLUMN, a bare column, CONSTRAINT, VALUE,
//    ATTRIBUTE), no SET SCHEMA, no INHERIT/INHERITS, no ATTACH PARTITION or PARTITION OF, nothing in
//    pg_temp, and CREATE TABLE/VIEW may use a reference table name only for the table in public
//    (no view, and no table of that name in another schema or unqualified).
// Compensating runtime control for what a static check cannot see: tests/db/070_census.test.sql
// requires a census of 0 and no rows in any table except the listed reference data on a database
// built from migrations alone. That database is empty, so a rewrite of populated business tables
// is caught only by this guard and the review. A static check cannot prove that arbitrary SQL
// changes no data; it rejects the constructs it knows can, and the review of every migration
// checks the rest (docs/review/step1-pr13/README.md section 8).
//
// Usage: node scripts/check-migrations.mjs [repository root]
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { join, resolve } from "node:path";

// Owner-approved reference data (D33 permission catalogue and defaults, D48 initial values).
const REFERENCE_TABLES = new Set(["call_types", "followup_reasons", "permissions", "role_permissions"]);

// Reviewed functions whose bodies may insert (rule 4), each pinned to its exact signature and the
// tables it may insert into. Adding or changing an entry is a reviewed change of this mandatory
// check; a migration still can never call any of them.
export const ALLOWED_WRITERS = new Map([
  ["private.write_audit(text,text,uuid,jsonb)", { tables: ["public.audit_logs"] }],
  ["private.authorize_account_creation(text,text,text)", { tables: ["public.account_requests"] }],
  ["private.admin_create_profile(uuid,text,text,text,text,uuid)", { tables: ["public.profiles"] }],
  ["private.admin_create_technician(uuid,text,text,text,text,boolean)", { tables: ["public.technicians"] }],
  ["private.request_account_change(text,uuid,text,text,text)", { tables: ["public.account_requests"] }],
  ["private.bootstrap_first_creator(uuid,text)", { tables: ["public.profiles"] }],
]);

// Extensions a migration may create (rule 6). None so far.
export const ALLOWED_EXTENSIONS = new Set([]);

// Reviewed trigger functions that may run BEFORE (or INSTEAD OF) INSERT on a reference table
// (rule 2, fix round 2 V1-2), pinned to their exact signature. Every definition of one of them in
// the files must also pass the body check (it never changes the new row). Adding an entry is a
// reviewed change of this mandatory check.
export const ALLOWED_REFERENCE_TRIGGERS = new Set(["private.tg_one_way_people()"]);

const MARKER_COLUMNS = new Set(["is_test", "data_source", "target_is_test"]);
const TEST_MARKERS = [
  { pattern: /\bsimulator\b/i, label: "data_source 'simulator'" },
  { pattern: /\bautomated_test\b/i, label: "data_source 'automated_test'" },
  { pattern: /\bseed\b/i, label: "data_source 'seed'" },
  { pattern: /example\.test/i, label: "example.test address" },
];
const BOOTSTRAP = "bootstrap_first_creator";
const DENIED_SETTINGS = /standard_conforming_strings|backslash_quote|session_replication_role/i;
// Schemas that run or store data outside the reviewed schema (rule 6). Their names fail as any name,
// quoted or not, and inside a search_path list (fix round 2, V1-3 and V1-4).
const DENIED_SCHEMAS = new Set(["cron", "vault", "net", "pgsodium", "realtime", "supabase_functions", "dblink", "graphql", "graphql_public", "pgmq", "pgmq_public"]);
// Functions that run SQL text or write outside the schema; they fail as any name, quoted or not.
// create_secret, update_secret (vault) and resolve (pg_graphql) also fail unqualified, in case a
// default search_path set outside the migrations reaches their schema.
const DENIED_FUNCTIONS =
  /^(?:query_to_xml|query_to_xml_and_xmlschema|query_to_xmlschema|cursor_to_xml|cursor_to_xmlschema|dblink\w*|http|http_\w+|set_config|lo_\w+|pg_file_\w+|pg_read_file|pg_read_binary_file|pg_ls_dir|create_secret|update_secret|resolve)$/;
// An `update` or `truncate` token right after one of these may not be a data change (FOR UPDATE,
// ON UPDATE, BEFORE/AFTER/OR UPDATE in triggers, GRANT/REVOKE privilege lists, INSTEAD OF UPDATE).
// After DO it always is (a rule action, or ON CONFLICT DO UPDATE): fix round 2, V1-1.
const BENIGN_BEFORE_UPDATE = new Set(["for", "key", "on", "before", "after", "or", "of", "grant", "revoke", ","]);
// After a benign word, `update` is harmless only when one of these follows it (or nothing does).
// Anything else (for example a name after OPEN ... FOR UPDATE, which starts an UPDATE) is reported
// as an UPDATE without reading its target (fix round 2, V1-1).
const AFTER_BENIGN_UPDATE = new Set([null, "of", "on", "or", "to", "nowait", "skip", "cascade", "restrict", "set", "no", ",", "(", ")",
  "limit", "offset", "fetch", "for", "loop", "using", "with"]);
const BENIGN_BEFORE_TRUNCATE = new Set(["before", "after", "or", "of", "grant", "revoke", ","]);
// Built-in types an ADD COLUMN on an existing table may use unqualified (fix round 2, V1-7): any
// other type may be a domain with a default, which fills every existing row.
const BUILTIN_TYPES = new Set(["bigint", "bit", "bool", "boolean", "bpchar", "bytea", "char", "character", "cidr", "date", "decimal",
  "double", "float", "float4", "float8", "inet", "int", "int2", "int4", "int8", "integer", "interval", "json", "jsonb", "macaddr",
  "macaddr8", "money", "numeric", "real", "smallint", "text", "time", "timestamp", "timestamptz", "timetz", "tsquery", "tsvector",
  "uuid", "varbit", "varchar", "xml"]);
// ALTER TABLE ... ADD <one of these> adds a table constraint, not a column.
const TABLE_CONSTRAINT_STARTS = new Set(["constraint", "primary", "unique", "check", "foreign", "exclude"]);
// A serial column is a column with a sequence default: adding one fills every existing row.
const SERIAL_TYPES = new Set(["serial", "serial2", "serial4", "serial8", "smallserial", "bigserial"]);

// ------------------------------------------------------------------------------------------------
// Tokenizer
// ------------------------------------------------------------------------------------------------
const OP_CHARS = "~!@#^&|`?+-*/%<>=";
const IDENT_START = /[A-Za-z_\u0080-\uffff]/;
const IDENT_CONT = /[A-Za-z0-9_$\u0080-\uffff]/;
const DOLLAR_TAG = /\$(?:[A-Za-z_\u0080-\uffff][A-Za-z0-9_\u0080-\uffff]*)?\$/y;
const PARAM = /\$[0-9]+/y;
const NUMBER = /(?:0[xX][0-9A-Fa-f_]+|0[oO][0-7_]+|0[bB][01_]+|(?:[0-9][0-9_]*(?:\.[0-9_]*)?|\.[0-9][0-9_]*)(?:[eE][+-]?[0-9]+)?)/y;
const NON_ASCII = /[^\x00-\x7f]/;

// PostgreSQL truncates identifiers to NAMEDATALEN - 1 = 63 bytes.
function truncateIdentifier(name) {
  if (Buffer.byteLength(name, "utf8") <= 63) return name;
  let out = "";
  let length = 0;
  for (const ch of name) {
    const size = Buffer.byteLength(ch, "utf8");
    if (length + size > 63) break;
    out += ch;
    length += size;
  }
  return out;
}

/**
 * Tokenizes SQL like the PostgreSQL lexer. Returns { tokens, errors, statements }: tokens are
 * { type, value, start } with type ident (lower-cased, truncated), qident (quoted identifier),
 * string (prefix "" | "e" | "b" | "x" | "n"), dollar (value = the body, tag = the delimiter),
 * number, param, op or punct. `statements` splits the tokens at ";" ({ tokens, code, bodies }).
 */
export function lexSql(sql) {
  const tokens = [];
  const errors = [];
  const n = sql.length;
  const nonAscii = (text, what) => {
    if (NON_ASCII.test(text)) errors.push(`non-ASCII character in ${what}; only strings and comments may contain one`);
  };
  const readQuoted = (open, quote) => {
    let j = open + 1;
    let value = "";
    while (j < n) {
      if (sql[j] === quote) {
        if (sql[j + 1] === quote) {
          value += quote;
          j += 2;
          continue;
        }
        return { value, end: j + 1, closed: true };
      }
      value += sql[j];
      j += 1;
    }
    return { value, end: n, closed: false };
  };
  // b'' and x'' strings have no '' escape in PostgreSQL: the next quote ends them.
  const readBitString = (open) => {
    const end = sql.indexOf("'", open + 1);
    return end === -1 ? { value: sql.slice(open + 1), end: n, closed: false } : { value: sql.slice(open + 1, end), end: end + 1, closed: true };
  };
  // PostgreSQL continues a string literal across a newline ('a'<newline>'b' is one literal, and an
  // E'' string keeps its backslash escapes there). The guard does not model that: it fails closed.
  const checkContinuation = (end) => {
    let j = end;
    let newline = false;
    while (j < n) {
      if (/[ \t\f\v]/.test(sql[j])) j += 1;
      else if (sql[j] === "\n" || sql[j] === "\r") {
        newline = true;
        j += 1;
      } else if (sql[j] === "-" && sql[j + 1] === "-") {
        while (j < n && sql[j] !== "\n" && sql[j] !== "\r") j += 1;
      } else break;
    }
    if (newline && sql[j] === "'") errors.push("a string literal continued on the next line is not allowed; write it as one literal");
  };
  const pushString = (r, prefix, start) => {
    if (!r.closed) errors.push("unterminated string literal");
    tokens.push({ type: "string", value: r.value, prefix, start });
    checkContinuation(r.end);
    return r.end;
  };
  const readEscapeString = (open) => {
    let j = open + 1;
    let value = "";
    while (j < n) {
      if (sql[j] === "\\") {
        value += sql.slice(j, j + 2);
        j += 2;
        continue;
      }
      if (sql[j] === "'") {
        if (sql[j + 1] === "'") {
          value += "'";
          j += 2;
          continue;
        }
        return { value, end: j + 1, closed: true };
      }
      value += sql[j];
      j += 1;
    }
    return { value, end: n, closed: false };
  };
  let i = 0;
  while (i < n) {
    const c = sql[i];
    const next = sql[i + 1];
    // PostgreSQL's whitespace is exactly these characters; any other one (for example a no-break
    // space) is part of an identifier there, so it is not skipped here either.
    if (/[ \t\n\r\f\v]/.test(c)) {
      i += 1;
      continue;
    }
    if (c === "-" && next === "-") {
      while (i < n && sql[i] !== "\n" && sql[i] !== "\r") i += 1;
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
      continue;
    }
    if ((c === "u" || c === "U") && next === "&" && (sql[i + 2] === "'" || sql[i + 2] === '"')) {
      errors.push("U& Unicode escapes are not allowed in migrations (they can spell any name)");
      const r = readQuoted(i + 2, sql[i + 2]);
      tokens.push({ type: sql[i + 2] === "'" ? "string" : "qident", value: r.value, prefix: "u&", start: i });
      i = r.end;
      continue;
    }
    if (/[eE]/.test(c) && next === "'") {
      i = pushString(readEscapeString(i + 1), "e", i);
      continue;
    }
    if (/[bBxX]/.test(c) && next === "'") {
      i = pushString(readBitString(i + 1), c.toLowerCase(), i);
      continue;
    }
    if (/[nN]/.test(c) && next === "'") {
      i = pushString(readQuoted(i + 1, "'"), "n", i);
      continue;
    }
    if (c === "'") {
      i = pushString(readQuoted(i, "'"), "", i);
      continue;
    }
    if (IDENT_START.test(c)) {
      let j = i + 1;
      while (j < n && IDENT_CONT.test(sql[j])) j += 1;
      const raw = sql.slice(i, j);
      nonAscii(raw, "an identifier");
      tokens.push({ type: "ident", value: truncateIdentifier(raw.replace(/[A-Z]+/g, (s) => s.toLowerCase())), start: i });
      i = j;
      continue;
    }
    if (c === '"') {
      const r = readQuoted(i, '"');
      if (!r.closed) errors.push("unterminated quoted identifier");
      nonAscii(r.value, "a quoted identifier");
      tokens.push({ type: "qident", value: truncateIdentifier(r.value), start: i });
      i = r.end;
      continue;
    }
    if (c === "$") {
      DOLLAR_TAG.lastIndex = i;
      const tag = DOLLAR_TAG.exec(sql);
      if (tag) {
        nonAscii(tag[0], "a dollar-quote tag");
        const start = i + tag[0].length;
        const end = sql.indexOf(tag[0], start);
        if (end === -1) errors.push(`unterminated dollar-quoted string ${tag[0]}`);
        tokens.push({ type: "dollar", value: sql.slice(start, end === -1 ? n : end), tag: tag[0], start: i });
        i = end === -1 ? n : end + tag[0].length;
        continue;
      }
      PARAM.lastIndex = i;
      const param = PARAM.exec(sql);
      if (param) {
        tokens.push({ type: "param", value: param[0], start: i });
        i += param[0].length;
        continue;
      }
      errors.push('unexpected "$"');
      i += 1;
      continue;
    }
    if (/[0-9]/.test(c) || (c === "." && /[0-9]/.test(next ?? ""))) {
      NUMBER.lastIndex = i;
      const number = NUMBER.exec(sql);
      tokens.push({ type: "number", value: number[0], start: i });
      i += number[0].length;
      continue;
    }
    if (c === ":" && next === ":") {
      tokens.push({ type: "op", value: "::", start: i });
      i += 2;
      continue;
    }
    if ("(),;[].:".includes(c)) {
      tokens.push({ type: "punct", value: c, start: i });
      i += 1;
      continue;
    }
    if (OP_CHARS.includes(c)) {
      let j = i;
      while (j < n && OP_CHARS.includes(sql[j]) && !(sql[j] === "-" && sql[j + 1] === "-") && !(sql[j] === "/" && sql[j + 1] === "*")) j += 1;
      tokens.push({ type: "op", value: sql.slice(i, j), start: i });
      i = j;
      continue;
    }
    errors.push(`unexpected character ${JSON.stringify(c)}`);
    i += 1;
  }
  return { tokens, errors, statements: splitStatements(tokens) };
}

function splitStatements(tokens) {
  const statements = [];
  let current = [];
  const flush = () => {
    if (current.length > 0) {
      const bodies = [];
      const code = current
        .map((t) => {
          if (t.type === "dollar") {
            bodies.push(t.value);
            return `$body${bodies.length - 1}$`;
          }
          if (t.type === "string") return `${t.prefix}'${t.value.replace(/'/g, "''")}'`;
          if (t.type === "qident") return `"${t.value.replace(/"/g, '""')}"`;
          return t.value;
        })
        .join(" ");
      statements.push({ tokens: current, code, bodies });
    }
    current = [];
  };
  for (const token of tokens) {
    if (token.type === "punct" && token.value === ";") flush();
    else current.push(token);
  }
  flush();
  return statements;
}

/** The statements of `sql` without comments, dollar-quoted bodies expanded in turn. */
export function stripComments(sql) {
  const expand = (text) =>
    lexSql(text).statements.flatMap((s) => [s.code.replace(/\$body\d+\$/g, " "), ...s.bodies.flatMap(expand)]);
  return expand(sql).join(";\n");
}

// ------------------------------------------------------------------------------------------------
// Parsing helpers
// ------------------------------------------------------------------------------------------------
const isWord = (token, ...words) => token !== undefined && token.type === "ident" && words.includes(token.value);
const isPunct = (token, value) => token !== undefined && token.type === "punct" && token.value === value;
const isName = (token) => token !== undefined && (token.type === "ident" || token.type === "qident");
const wordAt = (tokens, k) => (tokens[k] && tokens[k].type === "ident" ? tokens[k].value : null);
const tokenKey = (token) => (token === undefined ? null : token.type === "ident" || token.type === "punct" ? token.value : `<${token.type}>`);

function startsWith(tokens, ...words) {
  return words.every((w, k) => isWord(tokens[k], w));
}

function containsSequence(tokens, ...words) {
  for (let k = 0; k + words.length <= tokens.length; k += 1) {
    if (words.every((w, m) => isWord(tokens[k + m], w))) return true;
  }
  return false;
}

// A possibly schema-qualified name at tokens[k]: { schema, name, next }. A third part
// (database.schema.name) is unreadable: null, so every caller fails closed (fix round 2, V1-1).
function qualifiedNameAt(tokens, k) {
  if (!isName(tokens[k])) return null;
  if (isPunct(tokens[k + 1], ".") && isName(tokens[k + 2])) {
    if (isPunct(tokens[k + 3], ".")) return null;
    return { schema: tokens[k].value, name: tokens[k + 2].value, next: k + 3, nameIndex: k + 2, schemaIndex: k };
  }
  return { schema: null, name: tokens[k].value, next: k + 1, nameIndex: k, schemaIndex: -1 };
}

function matchingParen(tokens, open) {
  let depth = 0;
  for (let k = open; k < tokens.length; k += 1) {
    if (isPunct(tokens[k], "(")) depth += 1;
    else if (isPunct(tokens[k], ")")) {
      depth -= 1;
      if (depth === 0) return k;
    }
  }
  return -1;
}

// Splits tokens[from, to) at commas of paren depth 0.
function splitTopLevel(tokens, from, to) {
  const parts = [];
  let depth = 0;
  let current = [];
  for (let k = from; k < to; k += 1) {
    const t = tokens[k];
    if (isPunct(t, "(") || isPunct(t, "[")) depth += 1;
    if (isPunct(t, ")") || isPunct(t, "]")) depth -= 1;
    if (depth === 0 && isPunct(t, ",")) {
      parts.push(current);
      current = [];
    } else {
      current.push(t);
    }
  }
  if (current.length > 0) parts.push(current);
  return parts;
}

const typeText = (tokens) =>
  tokens.reduce((text, t, k) => text + (k > 0 && isName(t) && isName(tokens[k - 1]) ? " " : "") + t.value, "");

// The identity signature types of a parameter list (OUT parameters excluded).
function parameterTypes(tokens, open, close) {
  if (close === open + 1) return [];
  return splitTopLevel(tokens, open + 1, close)
    .map((arg) => {
      const end = arg.findIndex((t) => isWord(t, "default") || (t.type === "op" && t.value === "="));
      let parts = end === -1 ? arg : arg.slice(0, end);
      let mode = "in";
      if (isWord(parts[0], "in", "out", "inout", "variadic")) {
        mode = parts[0].value;
        parts = parts.slice(1);
      }
      // "name type": drop the name. An unnamed multi-word type is misread, which only fails closed.
      if (parts.length >= 2 && isName(parts[0]) && isName(parts[1])) parts = parts.slice(1);
      return mode === "out" ? null : typeText(parts);
    })
    .filter((type) => type !== null);
}

// CREATE [OR REPLACE] FUNCTION|PROCEDURE: name, signature, body and language.
function parseDefinition(tokens) {
  let k = 0;
  if (!isWord(tokens[k], "create")) return null;
  k += 1;
  if (isWord(tokens[k], "or") && isWord(tokens[k + 1], "replace")) k += 2;
  if (!isWord(tokens[k], "function", "procedure")) return null;
  const name = qualifiedNameAt(tokens, k + 1);
  const definition = {
    nameIndexes: new Set(),
    schema: null,
    name: null,
    qualifiedName: "(unreadable name)",
    signature: null,
    bodyIndex: -1,
    language: null,
    readable: false,
  };
  if (!name || !isPunct(tokens[name.next], "(")) return definition;
  definition.nameIndexes = new Set([name.nameIndex, name.schemaIndex].filter((x) => x >= 0));
  definition.schema = name.schema;
  definition.name = name.name;
  definition.qualifiedName = (name.schema ? `${name.schema}.` : "") + name.name;
  const close = matchingParen(tokens, name.next);
  if (close === -1) return definition;
  definition.signature = `${definition.qualifiedName}(${parameterTypes(tokens, name.next, close).join(",")})`;
  let depth = 0;
  for (let m = close + 1; m < tokens.length; m += 1) {
    const t = tokens[m];
    if (isPunct(t, "(")) depth += 1;
    if (isPunct(t, ")")) depth -= 1;
    if (depth !== 0) continue;
    if (isWord(t, "as") && definition.bodyIndex === -1) {
      if (tokens[m + 1] && tokens[m + 1].type === "dollar" && !isPunct(tokens[m + 2], ",")) definition.bodyIndex = m + 1;
      else definition.bodyIndex = -2;
    }
    if (isWord(t, "language") && tokens[m + 1]) definition.language = String(tokens[m + 1].value).toLowerCase();
    if ((isWord(t, "begin") && isWord(tokens[m + 1], "atomic")) || isWord(t, "return")) definition.bodyIndex = -2;
  }
  definition.readable = definition.bodyIndex >= 0 && ["sql", "plpgsql"].includes(definition.language);
  return definition;
}

// ------------------------------------------------------------------------------------------------
// Statement checks
// ------------------------------------------------------------------------------------------------

// Data changes in a token list: INSERT, UPDATE, DELETE, MERGE, TRUNCATE.
function dataChanges(tokens) {
  const found = [];
  tokens.forEach((t, k) => {
    if (t.type !== "ident") return;
    const prev = tokenKey(tokens[k - 1]);
    if (t.value === "insert" && isWord(tokens[k + 1], "into")) found.push({ kind: "INSERT", index: k });
    if (t.value === "update" && updateChangesData(tokens, k)) found.push({ kind: "UPDATE", index: k });
    if (t.value === "delete" && isWord(tokens[k + 1], "from")) found.push({ kind: "DELETE", index: k });
    if (t.value === "merge" && isWord(tokens[k + 1], "into")) found.push({ kind: "MERGE", index: k });
    if (t.value === "truncate" && !BENIGN_BEFORE_TRUNCATE.has(prev)) found.push({ kind: "TRUNCATE", index: k });
  });
  return found;
}

// An `update` token is a data change unless a benign word precedes it, a harmless word follows it
// and what follows does not read as an UPDATE target followed by SET.
function updateChangesData(tokens, k) {
  if (!BENIGN_BEFORE_UPDATE.has(tokenKey(tokens[k - 1]))) return true;
  if (!AFTER_BENIGN_UPDATE.has(tokenKey(tokens[k + 1]))) return true;
  return relationThenSet(tokens, k + 1);
}

// UPDATE's target: [ONLY] [(] name [)] [*] [[AS] alias] SET
function relationThenSet(tokens, k) {
  if (isWord(tokens[k], "only")) k += 1;
  const paren = isPunct(tokens[k], "(");
  if (paren) k += 1;
  const name = qualifiedNameAt(tokens, k);
  if (!name) return false;
  k = name.next;
  if (paren) {
    if (!isPunct(tokens[k], ")")) return false;
    k += 1;
  }
  if (tokens[k] && tokens[k].type === "op" && tokens[k].value === "*") k += 1;
  if (isWord(tokens[k], "set")) return true;
  if (isWord(tokens[k], "as")) k += 1;
  return isName(tokens[k]) && isWord(tokens[k + 1], "set");
}

// The target of `insert into` at tokens[k] (k = index of "insert").
function insertTarget(tokens, k) {
  const name = qualifiedNameAt(tokens, k + 2);
  return name ? { ...name, table: name.name } : null;
}

const isConstant = (tokens, k) => {
  const t = tokens[k];
  if (t === undefined) return 0;
  if (t.type === "string" && t.prefix === "") return 1;
  if (t.type === "number") return 1;
  if (isWord(t, "true", "false", "null")) return 1;
  if (t.type === "op" && t.value === "-" && tokens[k + 1] && tokens[k + 1].type === "number") return 2;
  return 0;
};

// Rule 1 and 2 for an INSERT in a statement that runs.
function referenceInsertProblems(tokens, k, where) {
  const target = insertTarget(tokens, k);
  const reference = [...REFERENCE_TABLES].map((t) => `public.${t}`).join(", ");
  if (!target) return [`${where}: an INSERT target the guard cannot read is not allowed`];
  if (!REFERENCE_TABLES.has(target.table) || (target.schema !== null && target.schema !== "public")) {
    const shown = target.schema && target.schema !== "public" ? `${target.schema}.${target.table}` : target.table;
    return [`${where}: INSERT into "${shown}" is not allowed; migrations may insert only approved reference data (${reference})`];
  }
  if (target.schema === null) return [`${where}: INSERT into "${target.table}" must name the table as public.${target.table}`];
  if (k !== 0) return [`${where}: INSERT into "${target.table}" is allowed only as a plain statement (insert into public.<table> (columns) values (constants))`];
  const problems = [];
  let m = target.next;
  if (!isPunct(tokens[m], "(")) return [`${where}: INSERT into "${target.table}" must list its columns`];
  const close = matchingParen(tokens, m);
  const columns = close === -1 ? [] : splitTopLevel(tokens, m + 1, close);
  for (const column of columns) {
    if (column.length !== 1 || !isName(column[0])) problems.push(`${where}: INSERT into "${target.table}" must list plain column names`);
    else if (MARKER_COLUMNS.has(column[0].value)) {
      problems.push(`${where}: INSERT into "${target.table}" contains a test marker (sets ${column[0].value}; reference data keeps the default)`);
    }
  }
  m = close + 1;
  if (!isWord(tokens[m], "values")) return [...problems, `${where}: INSERT into "${target.table}" must use plain constant VALUES`];
  m += 1;
  for (;;) {
    if (!isPunct(tokens[m], "(")) return [...problems, `${where}: INSERT into "${target.table}" must use plain constant VALUES`];
    m += 1;
    for (;;) {
      const width = isConstant(tokens, m);
      if (width === 0) return [...problems, `${where}: INSERT into "${target.table}" must use plain constant VALUES (plain '...' strings, numbers, true, false, null)`];
      const t = tokens[m];
      if (t.type === "string") {
        for (const marker of TEST_MARKERS) {
          if (marker.pattern.test(t.value)) problems.push(`${where}: INSERT into "${target.table}" contains a test marker (${marker.label})`);
        }
      }
      m += width;
      if (isPunct(tokens[m], ",")) {
        m += 1;
        continue;
      }
      if (isPunct(tokens[m], ")")) break;
      return [...problems, `${where}: INSERT into "${target.table}" must use plain constant VALUES`];
    }
    m += 1;
    if (isPunct(tokens[m], ",")) {
      m += 1;
      continue;
    }
    break;
  }
  if (m !== tokens.length) problems.push(`${where}: INSERT into "${target.table}" must end after its VALUES list`);
  return problems;
}

// ALTER TABLE at tokens[k] ("alter", "table"): [IF EXISTS] [ONLY] name [*]. Returns the name and
// the index of the first action, or null when the name cannot be read.
function alterTableTarget(tokens, k) {
  let m = k + 2;
  if (isWord(tokens[m], "if") && isWord(tokens[m + 1], "exists")) m += 2;
  if (isWord(tokens[m], "only")) m += 1;
  const name = qualifiedNameAt(tokens, m);
  if (!name) return null;
  m = name.next;
  if (tokens[m] && tokens[m].type === "op" && tokens[m].value === "*") m += 1;
  return { name, next: m };
}

// ON DELETE|UPDATE SET DEFAULT (a foreign key action) at the DEFAULT token action[p].
const foreignKeySetDefault = (tokens, p) =>
  isWord(tokens[p - 1], "set") && isWord(tokens[p - 2], "delete", "update") && isWord(tokens[p - 3], "on");

// The type of an added column at tokens[k] may not be a domain with a default (fix round 2, V1-7):
// it must be a built-in type written unquoted (optionally pg_catalog.), or a type that a top-level
// statement of the migration files creates schema-qualified. Returns a problem or null.
function addedColumnTypeProblem(tokens, k, createdTypes) {
  const name = qualifiedNameAt(tokens, k);
  if (!name) return "ADD COLUMN with a type the guard cannot read";
  const builtin = tokens[name.nameIndex].type === "ident" && BUILTIN_TYPES.has(name.name);
  if ((name.schema === null || name.schema === "pg_catalog") && builtin) return null;
  if (name.schema !== null && createdTypes.has(`${name.schema}.${name.name}`)) return null;
  return `ADD COLUMN of type ${name.schema ? `${name.schema}.` : ""}${name.name} (neither a built-in type nor a type created schema-qualified in the migration files; a domain default would fill every existing row)`;
}

// An ALTER TABLE action that rewrites the values of existing rows (rule 7, fix round 1 N1), or null.
function rewritingAction(action, createdTypes) {
  if (isWord(action[0], "drop")) return isWord(action[1], "constraint") ? null : "DROP COLUMN";
  if (isWord(action[0], "alter")) {
    if (isWord(action[1], "constraint")) return null;
    if (action.some((t) => isWord(t, "type"))) return "ALTER COLUMN ... TYPE / SET DATA TYPE";
    if (action.some((t, k) => isWord(t, "set") && isWord(action[k + 1], "expression"))) return "ALTER COLUMN ... SET EXPRESSION";
    return null;
  }
  if (!isWord(action[0], "add")) return null;
  let m = 1;
  const columnKeyword = isWord(action[m], "column");
  if (columnKeyword) m += 1;
  if (!columnKeyword && TABLE_CONSTRAINT_STARTS.has(wordAt(action, m))) return null;
  for (let p = m; p < action.length; p += 1) {
    const t = action[p];
    // SET DEFAULT is harmless only as a foreign key action (ON DELETE/UPDATE SET DEFAULT); a column
    // constraint named "set" (CONSTRAINT set DEFAULT ...) is a default (fix round 2, V1-5).
    if (isWord(t, "default") && !foreignKeySetDefault(action, p)) {
      const plainNull = isWord(action[p + 1], "null") &&
        (action[p + 2] === undefined || isWord(action[p + 2], "not", "null", "check", "constraint", "references", "unique", "primary", "collate"));
      if (!plainNull) return "ADD COLUMN with a DEFAULT";
    }
    if (isWord(t, "generated")) return "ADD COLUMN ... GENERATED";
    if (t.type === "ident" && SERIAL_TYPES.has(t.value)) return "ADD COLUMN with a serial type";
  }
  if (isWord(action[m], "if") && isWord(action[m + 1], "not") && isWord(action[m + 2], "exists")) m += 3;
  return addedColumnTypeProblem(action, m + 1, createdTypes);
}

// Rules that apply to every statement, in any context (top level, DO block, function body or header).
// `newTables` holds the tables created earlier in the same file (rule 7); empty in function bodies.
function anywhereProblems(tokens, where, { topLevel, sqlBody, newTables = new Set(), createdTypes = new Set() }) {
  const problems = [];
  const add = (message) => problems.push(`${where}: ${message}`);
  const first = wordAt(tokens, 0);
  const privilegeStatement = isWord(tokens[0], "grant", "revoke") || startsWith(tokens, "alter", "default", "privileges");
  let k0 = 1;
  if (isWord(tokens[1], "or") && isWord(tokens[2], "replace")) k0 = 3;
  if (isWord(tokens[k0], "constraint")) k0 += 1;
  const triggerStatement = first === "create" && (isWord(tokens[k0], "trigger") || (isWord(tokens[k0], "event") && isWord(tokens[k0 + 1], "trigger")));

  tokens.forEach((t, k) => {
    const next = tokens[k + 1];
    if (t.type === "ident") {
      if (t.value === "execute" && !privilegeStatement && !(triggerStatement && isWord(next, "function", "procedure"))) {
        add("dynamic SQL (EXECUTE) is not allowed in migrations; the guard cannot read what it runs");
      }
      if (t.value === "copy") add("COPY is not allowed in migrations");
      if (t.value === "explain") add("EXPLAIN is not allowed in migrations (EXPLAIN ANALYZE runs its statement)");
      if (t.value === "load" && next && next.type === "string") add("LOAD is not allowed in migrations");
      // Any RENAME (TO, COLUMN, a bare column, CONSTRAINT, VALUE, ATTRIBUTE): a marker column renamed
      // away, or an enum value renamed, changes what existing or inserted rows mean (N2).
      if (t.value === "rename") add("RENAME is not allowed in migrations (TO, COLUMN, CONSTRAINT, VALUE, ATTRIBUTE); names stay what they are");
      if (t.value === "create" && isWord(next, "cast")) add("CREATE CAST is not allowed in migrations (an assignment cast rewrites values in a column type change)");
      if ((t.value === "alter" || t.value === "drop") && isWord(next, "attribute")) {
        add("ALTER TYPE ... ALTER/DROP ATTRIBUTE is not allowed in migrations (it rewrites the columns of typed tables)");
      }
      if (t.value === "set" && isWord(next, "schema")) add("SET SCHEMA is not allowed in migrations; names stay what they are");
      if (t.value === "inherits" || (t.value === "inherit" && !isWord(tokens[k - 1], "no"))) add("INHERIT/INHERITS is not allowed in migrations");
      if (t.value === "attach" && isWord(next, "partition")) add("ATTACH PARTITION is not allowed in migrations");
      if (t.value === "partition" && isWord(next, "of")) add("PARTITION OF is not allowed in migrations");
      if (t.value === "materialized" && isWord(next, "view")) add("a materialized view is not allowed in migrations (it stores data)");
      if (/^pg_temp(?:_[0-9]+)?$/.test(t.value) && isPunct(next, ".")) add("pg_temp is not allowed in migrations");
      // CONSTRAINT <name> DEFAULT: a named default hides from rules that read "SET DEFAULT" or
      // "DROP DEFAULT" (fix round 2, V1-5); write DEFAULT without a constraint name.
      if (t.value === "constraint" && isName(next) && isWord(tokens[k + 2], "default")) {
        add("CONSTRAINT <name> DEFAULT is not allowed in migrations; write DEFAULT without a constraint name");
      }
    }
    if (isName(t)) {
      // Fix round 2, V1-3/V1-4: quoted or not, followed by "." or not (a search_path list).
      if (DENIED_SCHEMAS.has(t.value)) add(`the ${t.value} schema is not allowed in migrations (it runs or stores data outside the schema)`);
      if (DENIED_FUNCTIONS.test(t.value)) add(`${t.value}() is not allowed in migrations (it runs SQL text or writes outside the schema)`);
      // Fix round 2, V1-1: database.schema.name (PostgreSQL accepts the current database's name)
      // and record.field.field would slip past every rule that reads a schema-qualified name.
      if (isPunct(next, ".") && isName(tokens[k + 2]) && isPunct(tokens[k + 3], ".")) {
        add("a name with three parts (database.schema.object, record.field.field) is not allowed in migrations; write schema.object");
      }
      // A search_path list may not name a denied schema in a string either (fix round 2, V1-4).
      if (t.value === "search_path") {
        let m = k + 1;
        if (isWord(tokens[m], "to") || (tokens[m] && tokens[m].type === "op" && tokens[m].value === "=")) m += 1;
        for (; tokens[m] && (isName(tokens[m]) || tokens[m].type === "string"); m += 2) {
          if (tokens[m].type === "string") {
            for (const part of tokens[m].value.toLowerCase().split(/[\s,"]+/)) {
              if (DENIED_SCHEMAS.has(part)) add(`the ${part} schema is not allowed in migrations, also not in a search_path string`);
            }
          }
          if (!isPunct(tokens[m + 1], ",")) break;
        }
      }
    }
    if ((t.type === "ident" || t.type === "qident") && DENIED_SETTINGS.test(t.value)) add(`${t.value} may not be named in migrations`);
    if ((t.type === "string" || t.type === "dollar") && DENIED_SETTINGS.test(t.value)) add("standard_conforming_strings, backslash_quote and session_replication_role may not be named in migrations");
    if (t.type === "string" || t.type === "dollar") {
      // As on main: text that reads as an INSERT into a business table fails, even in a string.
      for (const m of t.value.matchAll(/\binsert\s+into\s+(?:"?([a-z_][a-z0-9_$]*)"?\s*\.\s*)?"?([a-z_][a-z0-9_$]*)"?/gi)) {
        if (!REFERENCE_TABLES.has(m[2].toLowerCase())) add(`a string reads as an INSERT into "${m[2].toLowerCase()}"; migrations never carry such text`);
      }
      // A pg_graphql mutation (insertInto...Collection, update...Collection, deleteFrom...Collection)
      // is an INSERT or UPDATE in another language (fix round 2, V1-3).
      if (/\b(?:insertInto|update|deleteFrom)\w*Collection\b/i.test(t.value)) add("a string reads as a pg_graphql mutation; migrations never carry such text");
    }
  });

  if (containsSequence(tokens, "create", "extension")) {
    const k = tokens.findIndex((t, m) => isWord(t, "create") && isWord(tokens[m + 1], "extension"));
    let m = k + 2;
    if (isWord(tokens[m], "if") && isWord(tokens[m + 1], "not") && isWord(tokens[m + 2], "exists")) m += 3;
    const name = isName(tokens[m]) ? tokens[m].value : null;
    if (!ALLOWED_EXTENSIONS.has(name)) add(`CREATE EXTENSION ${name ?? ""} is not allowed; only ALLOWED_EXTENSIONS may be created`);
  }
  for (const words of [["alter", "extension"], ["create", "subscription"], ["alter", "subscription"], ["create", "server"],
    ["create", "foreign"], ["import", "foreign"], ["create", "user", "mapping"]]) {
    if (containsSequence(tokens, ...words)) add(`${words.join(" ").toUpperCase()} is not allowed in migrations`);
  }

  // CREATE TABLE ... AS (any form), and reference table names.
  tokens.forEach((t, k) => {
    if (!isWord(t, "create")) return;
    let m = k + 1;
    if (isWord(tokens[m], "or") && isWord(tokens[m + 1], "replace")) m += 2;
    while (isWord(tokens[m], "global", "local", "temp", "temporary", "unlogged", "recursive")) m += 1;
    const isView = isWord(tokens[m], "view");
    if (!isWord(tokens[m], "table") && !isView) return;
    m += 1;
    if (isWord(tokens[m], "if") && isWord(tokens[m + 1], "not") && isWord(tokens[m + 2], "exists")) m += 3;
    const name = qualifiedNameAt(tokens, m);
    if (!name) add(`a ${isView ? "view" : "table"} name the guard cannot read is not allowed in migrations`);
    if (name && REFERENCE_TABLES.has(name.name) && (isView || name.schema !== "public")) {
      add(`"${name.name}" is a reference table name; it may exist only as the table public.${name.name}`);
    }
    if (isView) return;
    // CREATE TABLE ... (LIKE source INCLUDING DEFAULTS) copies another table's defaults, a marker
    // default true among them (fix round 2, V1-6).
    if (name && isPunct(tokens[name.next], "(")) {
      const close = matchingParen(tokens, name.next);
      if (splitTopLevel(tokens, name.next + 1, close === -1 ? tokens.length : close).some((element) => isWord(element[0], "like"))) {
        add("CREATE TABLE ... (LIKE ...) is not allowed in migrations (it copies another table's defaults); list the columns");
      }
    }
    let depth = 0;
    for (let p = name ? name.next : m; p < tokens.length; p += 1) {
      if (isPunct(tokens[p], "(")) depth += 1;
      if (isPunct(tokens[p], ")")) depth -= 1;
      if (depth === 0 && isWord(tokens[p], "as")) {
        add("CREATE TABLE ... AS is not allowed in migrations; they change schema and approved reference data only");
        break;
      }
    }
    // A reference table keeps the default false on its marker columns.
    if (name && REFERENCE_TABLES.has(name.name) && isPunct(tokens[name.next], "(")) {
      const close = matchingParen(tokens, name.next);
      for (const column of splitTopLevel(tokens, name.next + 1, close === -1 ? tokens.length : close)) {
        markerDefault(column, add);
      }
    }
  });

  // ALTER TABLE wherever it starts (also after BEGIN/THEN in a DO block or a function body): no
  // marker-column defaults, no TYPE ... USING, and no rewrite of an existing table's rows (N1).
  tokens.forEach((t, k) => {
    if (!isWord(t, "alter") || !isWord(tokens[k + 1], "table")) return;
    const target = alterTableTarget(tokens, k);
    // Without a readable target the actions cannot be found either (fix round 2, V1-1).
    if (!target) add("an ALTER TABLE target the guard cannot read is not allowed in migrations");
    const shown = target ? (target.name.schema ? `${target.name.schema}.` : "") + target.name.name : "(unreadable name)";
    const existing = !target || target.name.schema === null || !newTables.has(`${target.name.schema}.${target.name.name}`);
    for (const action of splitTopLevel(tokens, target ? target.next : k + 2, tokens.length)) {
      markerDefault(action, add);
      if (action.some((a) => isWord(a, "type")) && action.some((a) => isWord(a, "using"))) {
        add("ALTER COLUMN ... TYPE ... USING rewrites existing rows; not allowed in migrations");
      }
      const rewrite = existing ? rewritingAction(action, createdTypes) : null;
      if (rewrite) {
        add(`${rewrite} on the existing table ${shown} is not allowed in migrations (it rewrites existing rows); only a table created earlier in the same file by a plain top-level CREATE TABLE <schema>.<name> may be changed this way`);
      }
    }
  });

  // A domain default (or a base type's DEFAULT) would be a hidden column default.
  if (["domain", "type"].some((kind) => containsSequence(tokens, "create", kind) || containsSequence(tokens, "alter", kind)) &&
    tokens.some((t) => isWord(t, "default"))) {
    add("a domain default is not allowed in migrations (nor a base type's DEFAULT; it is a column default nobody sees)");
  }

  // SELECT/WITH ... INTO creates a table (top level and SQL-language bodies; in PL/pgSQL it assigns).
  if ((topLevel || sqlBody) && (["select", "with", "values", "table"].includes(first) || isPunct(tokens[0], "("))) {
    if (tokens.some((t) => isWord(t, "into"))) add("SELECT ... INTO is not allowed in migrations; they change schema and approved reference data only");
  }
  return problems;
}

// ALTER [COLUMN] <name> DROP DEFAULT: the whole action, ending at the DEFAULT token tokens[k].
const alterDropDefault = (tokens, k) =>
  k === tokens.length - 1 && isWord(tokens[k - 1], "drop") && isName(tokens[k - 2]) && isWord(tokens[0], "alter") &&
  (k === 3 || (k === 4 && isWord(tokens[1], "column")));

// A marker column's default is exactly `false` (not `false or true`), and it is never generated.
// DROP DEFAULT is harmless only as ALTER [COLUMN] x DROP DEFAULT; a column constraint named "drop"
// (CONSTRAINT drop DEFAULT true) is a default (fix round 2, V1-5).
function markerDefault(tokens, add) {
  const marker = tokens.find((t) => isName(t) && MARKER_COLUMNS.has(t.value));
  if (!marker) return;
  tokens.forEach((t, k) => {
    if (isWord(t, "default") && !alterDropDefault(tokens, k)) {
      const plainFalse = isWord(tokens[k + 1], "false") &&
        (tokens[k + 2] === undefined || isWord(tokens[k + 2], "not", "null", "check", "constraint", "references", "unique", "primary", "collate"));
      if (!plainFalse) add(`a default on ${marker.value} other than false is not allowed (test data must never be created by default)`);
    }
    if (isWord(t, "generated", "expression")) add(`${marker.value} may not be a generated column (test data must never be created by default)`);
  });
}

// PL/pgSQL statements that may change the trigger's NEW row (fix round 2, V1-2). NEW is the name
// `new`, quoted or not, also behind the function's block label (<function>.new).
const isNew = (t) => isName(t) && t.value === "new";
const STATEMENT_STARTS = new Set(["begin", "then", "else", "loop", "declare"]);

// A variable reference at tokens[k]: name (. name | [ ... ])*. Returns { end, hasNew } or null.
function targetChain(tokens, k) {
  if (!isName(tokens[k])) return null;
  let hasNew = isNew(tokens[k]);
  let m = k + 1;
  for (;;) {
    if (isPunct(tokens[m], ".") && isName(tokens[m + 1])) {
      hasNew = hasNew || isNew(tokens[m + 1]);
      m += 2;
    } else if (isPunct(tokens[m], "[")) {
      let depth = 0;
      for (; m < tokens.length; m += 1) {
        if (isPunct(tokens[m], "[")) depth += 1;
        if (isPunct(tokens[m], "]") && --depth === 0) break;
      }
      m += 1;
    } else return { end: m, hasNew };
  }
}

// A comma-separated list of variable references at tokens[k] names NEW.
function targetListHasNew(tokens, k) {
  for (;;) {
    const chain = targetChain(tokens, k);
    if (!chain) return false;
    if (chain.hasNew) return true;
    if (!isPunct(tokens[chain.end], ",")) return false;
    k = chain.end + 1;
  }
}

const isAssign = (tokens, k) =>
  (isPunct(tokens[k], ":") && tokens[k + 1] !== undefined && tokens[k + 1].type === "op" && tokens[k + 1].value.startsWith("="));

// NEW := / NEW.x := anywhere, NEW = at a statement start, INTO [STRICT] NEW..., FOR/FOREACH NEW...
// (which also reads `x ALIAS FOR new`), GET DIAGNOSTICS NEW... = ..., CALL with NEW (an INOUT argument).
function changesNew(tokens) {
  return tokens.some((t, k) => {
    if (isName(t) && !isPunct(tokens[k - 1], ".")) {
      const chain = targetChain(tokens, k);
      if (chain.hasNew && isAssign(tokens, chain.end)) return true;
      const atStart = k === 0 || isWord(tokens[k - 1], ...STATEMENT_STARTS);
      if (chain.hasNew && atStart && tokens[chain.end] && tokens[chain.end].type === "op" && tokens[chain.end].value.startsWith("=")) return true;
    }
    if (isWord(t, "into") && targetListHasNew(tokens, isWord(tokens[k + 1], "strict") ? k + 2 : k + 1)) return true;
    if (isWord(t, "for", "foreach") && targetListHasNew(tokens, k + 1)) return true;
    if (isWord(t, "diagnostics", "call") && tokens.slice(k + 1).some(isNew)) return true;
    return false;
  });
}

// An allowed reference-table trigger function (ALLOWED_REFERENCE_TRIGGERS) must leave the new row
// as it is: a readable PL/pgSQL body that never changes NEW and returns only NEW or NULL (a copy
// of NEW changed and returned, or jsonb_populate_record(new, ...), would change the stored row).
function referenceTriggerBodyProblems(d, where) {
  if (!d.readable || d.language !== "plpgsql") return [`${where}: a reviewed reference-table trigger function must have a dollar-quoted PL/pgSQL body`];
  const problems = [];
  for (const body of d.bodyStatements) {
    if (body.nested) {
      problems.push(`${where}: a reviewed reference-table trigger function may not define other functions`);
      continue;
    }
    if (changesNew(body.tokens)) problems.push(`${where}: a reviewed reference-table trigger function may not change the new row (NEW)`);
    body.tokens.forEach((t, k) => {
      if (isWord(t, "return") && !(isWord(body.tokens[k + 1], "new", "null") && body.tokens[k + 2] === undefined)) {
        problems.push(`${where}: a reviewed reference-table trigger function may return only NEW or NULL`);
      }
    });
  }
  return problems;
}

// CREATE [OR REPLACE] [CONSTRAINT] TRIGGER anywhere in a statement (also after BEGIN or THEN in a
// DO block or a function body): { table, before, insert, fn } or null. `table` and `fn` are null
// when the guard cannot read them.
function triggerInfo(tokens) {
  for (let k = 0; k < tokens.length; k += 1) {
    if (!isWord(tokens[k], "create")) continue;
    let m = k + 1;
    if (isWord(tokens[m], "or") && isWord(tokens[m + 1], "replace")) m += 2;
    if (isWord(tokens[m], "constraint")) m += 1;
    if (!isWord(tokens[m], "trigger")) continue;
    const onAt = tokens.findIndex((t, p) => p > m && isWord(t, "on"));
    const executeAt = tokens.findIndex((t, p) => p > m && isWord(t, "execute") && isWord(tokens[p + 1], "function", "procedure"));
    const events = tokens.slice(m, onAt === -1 ? tokens.length : onAt);
    return {
      table: onAt === -1 ? null : qualifiedNameAt(tokens, onAt + 1),
      before: events.some((t) => isWord(t, "before", "instead")),
      insert: events.some((t) => isWord(t, "insert")),
      fn: executeAt === -1 ? null : qualifiedNameAt(tokens, executeAt + 2),
    };
  }
  return null;
}

// A plain top-level CREATE [UNLOGGED] TABLE <schema>.<name> (not IF NOT EXISTS, not temporary):
// "<schema>.<name>", or null. IF NOT EXISTS does not count: the table may already exist with rows.
function plainCreatedTable(tokens) {
  if (!isWord(tokens[0], "create")) return null;
  let m = 1;
  if (isWord(tokens[m], "unlogged")) m += 1;
  if (!isWord(tokens[m], "table")) return null;
  const name = qualifiedNameAt(tokens, m + 1);
  if (!name || name.schema === null || !isPunct(tokens[name.next], "(")) return null;
  return `${name.schema}.${name.name}`;
}

// Statements that reference a writer without running it.
function referenceExempt(tokens) {
  return (
    isWord(tokens[0], "grant", "revoke") ||
    startsWith(tokens, "comment", "on") ||
    (isWord(tokens[0], "drop") && isWord(tokens[1], "function", "procedure", "routine"))
  );
}

const names = (tokens, skip = new Set()) =>
  new Set(tokens.filter((t, k) => !skip.has(k) && (t.type === "ident" || t.type === "qident")).map((t) => t.value.toLowerCase()));

const mentionsBootstrap = (tokens, skip = new Set()) =>
  tokens.some((t, k) => !skip.has(k) && ["ident", "qident", "string", "dollar"].includes(t.type) && t.value.toLowerCase().includes(BOOTSTRAP));

// ------------------------------------------------------------------------------------------------
// Files
// ------------------------------------------------------------------------------------------------

// Parses one level of SQL (a file, a DO body or a function body) into statements, recursively.
// A function definition or a DO block may start anywhere in a statement (in PL/pgSQL, after
// BEGIN, THEN, LOOP ...): the tokens before it become a statement of their own, so the nested
// body is always read as code. Dollar quotes are allowed only as such bodies; everywhere else
// (data, defaults, comments) a dollar-quoted text fails, so no code can hide in one.
function parseLevel(sql, where, problems, language) {
  const { statements, errors } = lexSql(sql);
  for (const error of errors) problems.push(`${where}: ${error}`);
  return statements.flatMap(({ tokens }) => parseStatement(tokens, where, problems, language));
}

const definitionStart = (tokens, k) =>
  isWord(tokens[k], "create") &&
  (isWord(tokens[k + 1], "function", "procedure") ||
    (isWord(tokens[k + 1], "or") && isWord(tokens[k + 2], "replace") && isWord(tokens[k + 3], "function", "procedure")));
const doStart = (tokens, k) =>
  isWord(tokens[k], "do") && tokens[k + 1] !== undefined && (tokens[k + 1].type === "dollar" || tokens[k + 1].type === "string" || isWord(tokens[k + 1], "language"));

function plainStatement(tokens, where, problems, language) {
  if (tokens.some((t) => t.type === "dollar")) {
    problems.push(`${where}: dollar-quoted text is allowed only as a function or DO body; write text as a '...' string`);
  }
  return { tokens, kind: "other", language };
}

function parseStatement(tokens, where, problems, language) {
  const k = tokens.findIndex((_, m) => definitionStart(tokens, m) || doStart(tokens, m));
  if (k === -1) return [plainStatement(tokens, where, problems, language)];
  const before = k > 0 ? [plainStatement(tokens.slice(0, k), where, problems, language)] : [];
  const own = tokens.slice(k);
  const statement = { tokens: own, kind: "other", language };
  if (definitionStart(own, 0)) {
    const definition = parseDefinition(own);
    statement.kind = "function";
    statement.definition = definition;
    if (own.some((t, m) => t.type === "dollar" && m !== definition.bodyIndex)) {
      problems.push(`${where}: dollar-quoted text is allowed only as a function or DO body; write text as a '...' string`);
    }
    if (definition.readable) {
      statement.body = parseLevel(own[definition.bodyIndex].value, `${where}: function ${definition.qualifiedName}`, problems, definition.language);
    }
  } else {
    statement.kind = "do";
    const bodies = own.filter((t) => t.type === "dollar");
    const languageIndex = own.findIndex((t) => isWord(t, "language"));
    const doLanguage = languageIndex === -1 ? "plpgsql" : String(own[languageIndex + 1]?.value ?? "").toLowerCase();
    const strings = own.filter((t) => t.type === "string").length - (languageIndex !== -1 && own[languageIndex + 1]?.type === "string" ? 1 : 0);
    if (bodies.length !== 1 || strings > 0 || doLanguage !== "plpgsql") {
      problems.push(`${where}: a DO block must have one dollar-quoted PL/pgSQL body`);
    }
    statement.body = bodies.length === 1 ? parseLevel(bodies[0].value, where, problems, "plpgsql") : [];
  }
  return [...before, statement];
}

/**
 * Checks migration files together (a writer defined in one file may be called in a later one).
 * `options.allowedWriters` replaces ALLOWED_WRITERS (tests only): a Map from the exact signature
 * ("schema.name(type,...)") to { tables: ["schema.table", ...] }.
 */
export function checkFiles(files, options = {}) {
  const allowedWriters = options.allowedWriters ?? ALLOWED_WRITERS;
  const allowedTriggers = options.allowedReferenceTriggers ?? ALLOWED_REFERENCE_TRIGGERS;
  const problems = [];
  const definitions = [];
  const running = [];

  // Walk every level; collect definitions with their header and flattened body statements.
  const walk = (statements, file, mode, owner, topLevel) => {
    for (const statement of statements) {
      if (statement.kind === "function") {
        const definition = {
          file,
          ...statement.definition,
          headerTokens: statement.tokens.filter((_, k) => k !== statement.definition.bodyIndex),
          headerSkip: statement.definition.nameIndexes,
          bodyStatements: [],
        };
        definitions.push(definition);
        if (mode === "run") running.push({ file, statement, topLevel, definition });
        else owner.bodyStatements.push({ tokens: statement.tokens, language: statement.language, nested: true });
        walk(statement.body ?? [], file, "body", definition, false);
        continue;
      }
      // A DO block's body is checked statement by statement below, not as a string.
      const tokens = statement.kind === "do" ? statement.tokens.filter((t) => t.type !== "dollar") : statement.tokens;
      if (mode === "run") running.push({ file, statement: { ...statement, tokens }, topLevel });
      else owner.bodyStatements.push({ tokens, language: statement.language });
      if (statement.kind === "do") walk(statement.body ?? [], file, mode, owner, false);
    }
  };
  for (const { name, sql } of files) walk(parseLevel(sql, name, problems, null), name, "run", null, true);

  // Types and domains a top-level statement creates schema-qualified (rule 7, V1-7).
  const createdTypes = new Set();
  for (const { statement, topLevel } of running) {
    if (!topLevel || !isWord(statement.tokens[0], "create") || !isWord(statement.tokens[1], "type", "domain")) continue;
    const name = qualifiedNameAt(statement.tokens, 2);
    if (name && name.schema !== null) createdTypes.add(`${name.schema}.${name.name}`);
  }

  // Rule 4: readable bodies and allowed inserts; every function that changes data is a writer.
  const writers = new Set([...allowedWriters.keys()].map((signature) => signature.replace(/\(.*$/, "").split(".").pop()));
  writers.add(BOOTSTRAP);
  for (const d of definitions) {
    const where = `${d.file}: function ${d.qualifiedName}`;
    if (!d.readable) {
      problems.push(`${d.file}: the body of ${d.qualifiedName} must be dollar-quoted (AS $$ ... $$) in LANGUAGE sql or plpgsql; string-literal, BEGIN ATOMIC and RETURN bodies are not allowed, because the guard cannot read them`);
      if (d.name) writers.add(d.name);
    }
    if (d.schema && /^pg_temp(?:_[0-9]+)?$/.test(d.schema)) problems.push(`${d.file}: ${d.qualifiedName}: functions in pg_temp are not allowed in migrations`);
    problems.push(...anywhereProblems(d.headerTokens, `${d.file}: function ${d.qualifiedName} (header)`, { topLevel: false, sqlBody: false, createdTypes }));
    if (d.signature && allowedTriggers.has(d.signature)) problems.push(...referenceTriggerBodyProblems(d, where));
    const entry = d.signature ? allowedWriters.get(d.signature) : undefined;
    for (const body of d.bodyStatements) {
      if (body.nested) continue;
      problems.push(...anywhereProblems(body.tokens, where, { topLevel: false, sqlBody: body.language === "sql", createdTypes }));
      problems.push(...referenceTriggerProblems(body.tokens, where));
      for (const change of dataChanges(body.tokens)) {
        if (d.name) writers.add(d.name);
        if (change.kind !== "INSERT") continue;
        const target = insertTarget(body.tokens, change.index);
        const qualified = target && target.schema ? `${target.schema}.${target.table}` : null;
        if (!entry || !qualified || !entry.tables.includes(qualified)) {
          problems.push(`${where}: INSERT into "${target ? target.table : "?"}" is not allowed (only the reviewed writer functions in ALLOWED_WRITERS, pinned to their signature and tables, may insert)`);
        }
      }
      if (entry) {
        for (const t of body.tokens) {
          if (t.type !== "string" && t.type !== "dollar") continue;
          for (const marker of TEST_MARKERS) {
            if (marker.pattern.test(t.value)) problems.push(`${where}: contains a test marker (${marker.label})`);
          }
        }
      }
    }
    // Rule 5 inside definitions: only bootstrap's own header names it.
    const ownName = d.name === BOOTSTRAP ? d.headerSkip : new Set();
    if (mentionsBootstrap(d.headerTokens, ownName) || d.bodyStatements.some((b) => !b.nested && mentionsBootstrap(b.tokens))) {
      problems.push(`${d.file}: bootstrap_first_creator is never called by a migration or by another function (D49)`);
    }
  }
  for (let changed = true; changed; ) {
    changed = false;
    for (const d of definitions) {
      if (!d.name || writers.has(d.name)) continue;
      const referenced = [...names(d.headerTokens, d.headerSkip), ...d.bodyStatements.flatMap((b) => [...names(b.tokens)])];
      if (referenced.some((name) => writers.has(name))) {
        writers.add(d.name);
        changed = true;
      }
    }
  }

  // Rule 2 (fix round 2, V1-2): a BEFORE or INSTEAD OF INSERT trigger on a reference table (or on a
  // table the guard cannot read) may only run a reviewed function of ALLOWED_REFERENCE_TRIGGERS,
  // named by its exact schema-qualified signature and defined in the files. Checked wherever the
  // trigger is created (a statement that runs, a DO block or a function body).
  function referenceTriggerProblems(tokens, where) {
    const trigger = triggerInfo(tokens);
    if (!trigger || !trigger.before || !trigger.insert || (trigger.table && !REFERENCE_TABLES.has(trigger.table.name))) return [];
    const shown = trigger.table ? trigger.table.name : "(unreadable name)";
    const signature = trigger.fn && trigger.fn.schema !== null ? `${trigger.fn.schema}.${trigger.fn.name}()` : null;
    if (!signature || !allowedTriggers.has(signature)) {
      return [`${where}: a BEFORE INSERT trigger on reference table ${shown} may run only a reviewed function of ALLOWED_REFERENCE_TRIGGERS, named schema-qualified (it could change the new row)`];
    }
    if (!definitions.some((d) => d.signature === signature)) {
      return [`${where}: a BEFORE INSERT trigger on reference table ${shown} must use a function defined in the migrations (${signature})`];
    }
    return [];
  }

  // Statements that run, in file order. `newTables` (rule 7): the tables this file created by a
  // plain top-level CREATE TABLE <schema>.<name> that no INSERT has targeted yet.
  let currentFile = null;
  let newTables = new Set();
  for (const { file, statement, topLevel, definition } of running) {
    const { tokens } = statement;
    if (file !== currentFile) {
      currentFile = file;
      newTables = new Set();
    }
    if (definition) {
      // The definition itself runs (it creates the function); rule 5 is checked above.
      continue;
    }
    problems.push(...anywhereProblems(tokens, file, { topLevel, sqlBody: false, newTables, createdTypes }));
    problems.push(...referenceTriggerProblems(tokens, file));
    for (const change of dataChanges(tokens)) {
      if (change.kind === "INSERT") {
        problems.push(...referenceInsertProblems(tokens, change.index, file));
        // A table that has rows is no longer new, whatever schema the INSERT names.
        const target = insertTarget(tokens, change.index);
        for (const key of [...newTables]) if (!target || key.endsWith(`.${target.table}`)) newTables.delete(key);
      } else problems.push(`${file}: ${change.kind} is not allowed in migrations; they change schema and approved reference data only`);
    }
    const created = topLevel ? plainCreatedTable(tokens) : null;
    if (created) newTables.add(created);
    const bootstrapExempt = isWord(tokens[0], "revoke") || startsWith(tokens, "comment", "on", "function");
    if (!bootstrapExempt && mentionsBootstrap(tokens)) {
      problems.push(`${file}: bootstrap_first_creator may only be defined, revoked or commented in migrations (D49)`);
    }
    if (!referenceExempt(tokens)) {
      for (const writer of [...names(tokens)].filter((name) => writers.has(name))) {
        problems.push(`${file}: the migration calls ${writer}(), a function that writes data; migrations never run or attach data-writing functions (D47)`);
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
