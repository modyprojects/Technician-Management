#!/usr/bin/env node
// PreToolUse guard against pushing to main or force-pushing (CLAUDE.md "Never push or force-push
// to main"; owner decisions 2026-11-18). The only path to main is a squash merge of a PR
// (mcp__github__merge_pull_request), which this guard leaves to the normal permission flow.
// Claude Code runs it before every Bash and mcp__github__* call with the call as JSON on stdin
// and reads one decision from stdout (no output = no decision).
//
// Bash: every git push in the command is found (env prefixes, wrappers such as `command`, `env`,
// `timeout`, git global options such as -C / -c / --git-dir, segments split on ; && || | & and
// newlines, subshells, $(...) and backticks, bash -c / sh -c strings, eval, heredocs and
// here-strings fed to a shell) and checked:
//   deny - force in any form (-f, --force, --force-with-lease, --force-if-includes, a "+" refspec),
//          --mirror, --all / --branches, --prune, a destination that is main, deleting main, or no
//          explicit refspec ("name the branch explicitly");
//   ask  - a remote or refspec that holds "$", a backtick or a glob, or HEAD / @ without a
//          destination, so it cannot be checked;
//   deny - "git" and "push" together in a command that cannot be parsed or that runs other
//          commands (xargs, find -exec, ssh, ...), a git push piped into a shell, base64-encoded
//          git push, and a -c alias that runs push.
// Known limits (a guardrail, not a sandbox; GitHub branch protection stays the real control):
// git aliases from git config files, scripts written to disk and run later, and other
// interpreters (python -c, node -e) without the words "git" and "push" are not seen.
// Known false positives (acceptable, they only block a harmless command): "git" and "push" as
// separate words in the arguments of a command that is not data-only, e.g. `node -e "// git push"`
// or `ssh host "git push origin claude/x"`. echo, printf, grep, rg, cat, gh (except gh alias /
// extension) and similar are data-only, so `echo "git push origin main"` passes, but piping it
// into a shell is denied. A path such as git-push-guard.mjs is one word and never matches.
//
// GitHub MCP: push_files, create_or_update_file and delete_file with branch main or no branch are
// denied. Everything else (merge_pull_request included) gets no decision.
//
// Fail closed: unreadable input or an internal error denies when the raw input mentions "push".
import { readFileSync, realpathSync } from "node:fs";
import { fileURLToPath } from "node:url";

class ParseError extends Error {}

const MAX_DEPTH = 8;

const SHELLS = new Set(["sh", "bash", "zsh", "dash", "ksh", "ash", "mksh"]);
/** Commands that run the rest of their arguments as a command. */
const WRAPPERS = new Set([
  "command", "builtin", "exec", "env", "nice", "nohup", "time", "timeout", "sudo", "doas", "stdbuf",
  "ionice", "chrt", "taskset", "unbuffer", "setsid", "busybox", "chronic", "caffeinate",
]);
/** What a wrapper is searched for. */
const TARGETS = new Set(["git", "eval", "gh", "source", ".", "xargs", "parallel", "find", ...SHELLS]);
/** Script paths that make a shell or `source` read its stdin. */
const STDIN_PATHS = new Set(["/dev/stdin", "-", "/proc/self/fd/0", "/dev/fd/0"]);
/** GIT_CONFIG_* variables that inject git configuration (GIT_CONFIG_NOSYSTEM only removes some). */
const GIT_CONFIG_ENV = /^GIT_CONFIG(?:_(COUNT|KEY_\d+|VALUE_\d+|PARAMETERS|GLOBAL|SYSTEM))?=/;
/** Shell keywords skipped before the command name. */
const RESERVED = new Set(["!", "{", "if", "then", "else", "elif", "do", "while", "until", "time"]);
/** Commands that never execute their arguments. */
const DATA_ONLY = new Set([
  "echo", "printf", "grep", "egrep", "fgrep", "rg", "cat", "head", "tail", "wc", "ls", "test", "[",
  "[[", "true", "false", ":",
]);
const ASSIGNMENT = /^[A-Za-z_][A-Za-z0-9_]*(?:\[[^\]]*\])?\+?=/;

const PUSH_LONG = [
  "verbose", "quiet", "repo", "all", "branches", "mirror", "delete", "tags", "dry-run", "porcelain",
  "force", "force-with-lease", "force-if-includes", "recurse-submodules", "thin", "receive-pack",
  "exec", "set-upstream", "progress", "prune", "no-verify", "verify", "follow-tags", "signed",
  "atomic", "push-option", "ipv4", "ipv6",
];
const PUSH_DANGEROUS = new Set(["force", "force-with-lease", "force-if-includes", "mirror", "all", "branches", "prune"]);
const PUSH_WITH_ARG = new Set(["repo", "receive-pack", "exec", "push-option", "recurse-submodules"]);
/** git global options that take the next word as their value. */
const GIT_GLOBAL_WITH_ARG = new Set([
  "-C", "-c", "--git-dir", "--work-tree", "--namespace", "--config-env", "--super-prefix", "--attr-source",
]);

function newWord() {
  return { value: "", dynamic: false, quoted: false, unquoted: "" };
}

function newCommand(piped) {
  return { words: [], heredocs: [], herestrings: [], inputs: [], piped };
}

function base(value) {
  return value.split("/").pop().toLowerCase().replace(/\.exe$/, "");
}

/** True for git itself or a git-core program such as /usr/lib/git-core/git-push. */
function isGitName(name) {
  return name === "git" || name.startsWith("git-");
}

function isTarget(value) {
  const name = base(value);
  return TARGETS.has(name) || name.startsWith("git-");
}

/**
 * A small POSIX-shell parser. Every simple command it meets (also inside $(...), backticks,
 * process substitution and unquoted heredoc bodies) is appended to `commands` as
 * {words, heredocs, herestrings, piped}; each word is {value, dynamic, quoted, unquoted}.
 */
function makeParser(s, commands) {
  let i = 0;
  const n = s.length;
  const pending = [];

  function expect(ch) {
    if (s[i] !== ch) throw new ParseError(`missing ${ch}`);
    i++;
  }

  function readHeredocBodies() {
    while (pending.length > 0) {
      const doc = pending.shift();
      const lines = [];
      while (i < n) {
        let end = s.indexOf("\n", i);
        if (end < 0) end = n;
        const line = s.slice(i, end);
        i = Math.min(end + 1, n);
        if ((doc.stripTabs ? line.replace(/^\t+/, "") : line) === doc.delim) break;
        lines.push(line);
      }
      const body = lines.join("\n");
      doc.cmd.heredocs.push({ text: body, quoted: doc.quoted });
      // An unquoted body is expanded by the shell: its $(...) and backticks run.
      if (!doc.quoted) makeParser(body, commands).parseExpansions();
    }
  }

  function skipBraced() {
    let depth = 0;
    const scratch = newWord();
    while (i < n) {
      const c = s[i];
      if (c === "}") {
        i++;
        if (depth === 0) return;
        depth--;
      } else if (c === "{") {
        depth++;
        i++;
      } else if (c === "\\") {
        i += 2;
      } else if (c === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) throw new ParseError("unterminated quote");
        i = end + 1;
      } else if (c === '"') {
        i++;
        parseDouble(scratch, false);
      } else if (c === "$") {
        parseDollar(scratch, true);
      } else if (c === "`") {
        i++;
        parseList("`");
        expect("`");
      } else {
        i++;
      }
    }
    throw new ParseError("unterminated ${");
  }

  function parseDollar(word, inDouble) {
    const d = s[i + 1];
    word.dynamic = true;
    if (d === "(") {
      i += 2;
      parseList(")");
      expect(")");
      word.value += "$(…)";
      return;
    }
    if (d === "{") {
      i += 2;
      skipBraced();
      word.value += "${…}";
      return;
    }
    if (d === "'" && !inDouble) {
      let j = i + 2;
      while (j < n && s[j] !== "'") j += s[j] === "\\" ? 2 : 1;
      if (j >= n) throw new ParseError("unterminated $'");
      word.value += `$'${s.slice(i + 2, j)}'`;
      i = j + 1;
      return;
    }
    if (d === '"' && !inDouble) {
      i += 2;
      word.value += "$";
      parseDouble(word, false);
      return;
    }
    const match = /^(?:[A-Za-z_][A-Za-z0-9_]*|[0-9@*#?$!-])/.exec(s.slice(i + 1, i + 256));
    if (match !== null) {
      word.value += `$${match[0]}`;
      i += 1 + match[0].length;
      return;
    }
    word.value += "$";
    i++;
  }

  function parseDouble(word, toEof) {
    word.quoted = true;
    while (i < n) {
      const c = s[i];
      if (c === '"' && !toEof) {
        i++;
        return;
      }
      if (c === "\\") {
        const d = s[i + 1];
        if (d === "\n") {
          i += 2;
        } else if (d !== undefined && '$`"\\'.includes(d)) {
          word.value += d;
          i += 2;
        } else {
          word.value += c;
          i++;
        }
      } else if (c === "$") {
        parseDollar(word, true);
      } else if (c === "`") {
        i++;
        parseList("`");
        expect("`");
        word.value += "`…`";
        word.dynamic = true;
      } else {
        word.value += c;
        i++;
      }
    }
    if (!toEof) throw new ParseError("unterminated double quote");
  }

  function parseList(stop) {
    let cur = newCommand(false);
    let word = null;
    let target = null;
    let depth = 0;

    const w = () => {
      if (word === null) word = newWord();
      return word;
    };
    const endWord = () => {
      if (word === null) return;
      const done = word;
      word = null;
      if (target !== null) {
        const kind = target;
        target = null;
        if (kind.kind === "herestring") cur.herestrings.push(done);
        else if (kind.kind === "input") cur.inputs.push(done);
        else if (kind.kind === "heredoc") pending.push({ cmd: cur, delim: done.value, quoted: done.quoted, stripTabs: kind.stripTabs });
        return;
      }
      cur.words.push(done);
    };
    const endCommand = (pipedNext) => {
      endWord();
      target = null;
      if (cur.words.length > 0 || cur.herestrings.length > 0 || pending.some((doc) => doc.cmd === cur)) {
        commands.push(cur);
      }
      cur = newCommand(pipedNext);
    };

    while (i < n) {
      const c = s[i];
      if (stop === "`" && c === "`") {
        endCommand(false);
        return;
      }
      if (c === " " || c === "\t") {
        endWord();
        i++;
      } else if (c === "\n") {
        endCommand(false);
        i++;
        readHeredocBodies();
      } else if (c === "#" && word === null) {
        while (i < n && s[i] !== "\n") i++;
      } else if (c === ";") {
        endCommand(false);
        i++;
      } else if (c === "&") {
        if (s[i + 1] === ">") {
          endWord();
          i += s[i + 2] === ">" ? 3 : 2;
          target = { kind: "redirect" };
        } else {
          endCommand(false);
          i += s[i + 1] === "&" ? 2 : 1;
        }
      } else if (c === "|") {
        if (s[i + 1] === "|") {
          endCommand(false);
          i += 2;
        } else {
          endCommand(true);
          i += s[i + 1] === "&" ? 2 : 1;
        }
      } else if (c === "(") {
        endCommand(false);
        depth++;
        i++;
      } else if (c === ")") {
        if (depth > 0) {
          endCommand(false);
          depth--;
          i++;
        } else if (stop === ")") {
          endCommand(false);
          return;
        } else {
          endCommand(false);
          i++;
        }
      } else if (c === "<" || c === ">") {
        if (s[i + 1] === "(") {
          i += 2;
          parseList(")");
          expect(")");
          w().value += "<(…)";
          w().dynamic = true;
          continue;
        }
        if (word !== null && !word.quoted && /^\d+$/.test(word.value)) word = null;
        else endWord();
        if (s.startsWith("<<<", i)) {
          i += 3;
          target = { kind: "herestring" };
        } else if (s.startsWith("<<-", i)) {
          i += 3;
          target = { kind: "heredoc", stripTabs: true };
        } else if (s.startsWith("<<", i)) {
          i += 2;
          target = { kind: "heredoc", stripTabs: false };
        } else {
          i += [">>", ">|", ">&", "<&", "<>"].includes(s.slice(i, i + 2)) ? 2 : 1;
          // An input redirect (< file, < <(...)) is recorded: a shell reads its script from it.
          target = { kind: c === "<" ? "input" : "redirect" };
        }
      } else if (c === "\\") {
        if (s[i + 1] !== "\n" && i + 1 < n) {
          w().value += s[i + 1];
          w().quoted = true;
        }
        i += 2;
      } else if (c === "'") {
        const end = s.indexOf("'", i + 1);
        if (end < 0) throw new ParseError("unterminated single quote");
        w().value += s.slice(i + 1, end);
        w().quoted = true;
        i = end + 1;
      } else if (c === '"') {
        i++;
        parseDouble(w(), false);
      } else if (c === "$") {
        parseDollar(w(), false);
      } else if (c === "`") {
        i++;
        parseList("`");
        expect("`");
        w().value += "`…`";
        w().dynamic = true;
      } else {
        w().value += c;
        w().unquoted += c;
        i++;
      }
    }
    if (stop !== null) throw new ParseError(`missing ${stop}`);
    endCommand(false);
  }

  return {
    parseScript() {
      parseList(null);
    },
    parseExpansions() {
      parseDouble(newWord(), true);
    },
  };
}

/** Parses a shell command line into simple commands; throws ParseError. */
export function parseShell(text) {
  const commands = [];
  makeParser(text, commands).parseScript();
  return commands;
}

function uncheckable(word) {
  if (word.dynamic || /[$`]/.test(word.value) || /[*?[\]]/.test(word.value)) return true;
  // Unquoted brace expansion, e.g. {claude/x,main}.
  return /\{/.test(word.unquoted) && /\}/.test(word.unquoted);
}

/** True for main in any spelling git resolves to the remote's main branch. */
function isMain(ref) {
  const r = ref.trim().replace(/\/{2,}/g, "/").replace(/^\/+/, "");
  return /^(?:refs\/)?(?:heads\/)?main$/i.test(r);
}

/** Shell-like tokens of a text: "git-push-guard.mjs" stays one token, "os.system('git push" does not. */
function tokens(text) {
  return text.split(/[\s'"`;|&(){}<>=,]+/).filter((token) => token !== "");
}

function mentionsPush(text) {
  return tokens(text).some((token) => token.toLowerCase() === "push");
}

/** True when a text holds the words "git" (any path to it) and "push" as separate tokens. */
function mentionsGitPush(text) {
  const all = tokens(text);
  return all.some((token) => base(token) === "git") && all.some((token) => token.toLowerCase() === "push");
}

function hasGitAndPush(words) {
  return mentionsGitPush(words.map((word) => word.value).join(" "));
}

function analyzePush(args, out) {
  const positionals = [];
  let deleting = false;
  let endOfOptions = false;
  for (let j = 0; j < args.length; j++) {
    const word = args[j];
    const v = word.value;
    if (!endOfOptions && v === "--") {
      endOfOptions = true;
      continue;
    }
    if (!endOfOptions && v.startsWith("--")) {
      const eq = v.indexOf("=");
      const name = (eq < 0 ? v.slice(2) : v.slice(2, eq)).toLowerCase();
      if (uncheckable(word) && eq < 0) {
        out.ask.push(`git push option ${v} cannot be checked`);
        continue;
      }
      if (name.startsWith("no-")) continue;
      // git accepts any unambiguous prefix of a long option (--forc, --mirr).
      const candidates = PUSH_LONG.filter((option) => option.startsWith(name));
      const dangerous = candidates.find((option) => PUSH_DANGEROUS.has(option));
      if (dangerous !== undefined) {
        out.deny.push(`git push --${dangerous} is not allowed (never force-push or push every branch)`);
        continue;
      }
      if (candidates.includes("delete")) deleting = true;
      const resolved = candidates.includes(name) ? name : candidates.length === 1 ? candidates[0] : null;
      if (resolved !== null && PUSH_WITH_ARG.has(resolved) && eq < 0) j++;
      continue;
    }
    if (!endOfOptions && v.startsWith("-") && v.length > 1) {
      for (let p = 1; p < v.length; p++) {
        const ch = v[p];
        if (ch === "f") out.deny.push("git push -f is not allowed (never force-push)");
        else if (ch === "d") deleting = true;
        else if (ch === "o") {
          if (p === v.length - 1) j++;
          break;
        }
      }
      continue;
    }
    positionals.push(word);
  }

  const [remote, ...refspecs] = positionals;
  for (const word of refspecs) {
    const v = word.value;
    if (v.startsWith("+")) out.deny.push(`git push refspec ${v} forces the update (never force-push)`);
    const spec = v.replace(/^\++/, "");
    const colon = spec.indexOf(":");
    if (colon >= 0) {
      const destinations = [spec.slice(colon + 1), spec.slice(spec.lastIndexOf(":") + 1)];
      if (destinations.some(isMain)) {
        out.deny.push(colon === 0 ? `git push ${v} deletes main` : `git push ${v} pushes to main (merge a PR instead)`);
      }
    } else if (isMain(spec)) {
      out.deny.push(deleting ? "git push --delete main is not allowed" : "git push to main is not allowed (merge a PR instead)");
    } else if (/^(?:HEAD|@)$/i.test(spec)) {
      out.ask.push(`git push ${spec} without a destination pushes the current branch, which cannot be checked`);
    }
    if (uncheckable(word)) out.ask.push(`git push refspec ${v} cannot be checked`);
  }
  if (remote !== undefined && uncheckable(remote)) out.ask.push(`git push remote ${remote.value} cannot be checked`);
  if (refspecs.length === 0) out.deny.push("git push without an explicit refspec: name the branch explicitly");
}

/** Index of the git subcommand in `args` (after the global options), checking -c / --config-env. */
function findGitSubcommand(args, out) {
  let j = 0;
  while (j < args.length) {
    const v = args[j].value;
    if (GIT_GLOBAL_WITH_ARG.has(v)) {
      if ((v === "-c" || v === "--config-env") && args[j + 1] !== undefined) checkGitConfig(args[j + 1], v, out);
      j += 2;
    } else if (v.startsWith("--config-env=")) {
      checkGitConfig({ ...args[j], value: v.slice("--config-env=".length) }, "--config-env", out);
      j++;
    } else if (v.startsWith("-")) {
      j++;
    } else {
      break;
    }
  }
  return j;
}

function analyzeGit(args, out) {
  out.sawGit = true;
  const j = findGitSubcommand(args, out);
  const sub = args[j];
  if (sub === undefined) return;
  if (uncheckable(sub)) {
    out.ask.push(`git subcommand ${sub.value} cannot be checked`);
    return;
  }
  const rest = args.slice(j + 1);
  if (sub.value === "push") analyzePush(rest, out);
  else if (sub.value === "send-pack") out.ask.push("git send-pack pushes refs and cannot be checked");
  else if (sub.value === "subtree" && rest.some((word) => word.value === "push")) {
    out.ask.push("git subtree push cannot be checked");
  } else if (sub.value === "config") analyzeGitConfig(rest, out);
  else if (sub.value === "symbolic-ref") analyzeSymbolicRef(rest, out);
  else if (sub.value === "update-ref" && rest.some((word) => word.value === "--stdin")) {
    out.ask.push("git update-ref --stdin can create a symbolic ref to main and cannot be checked");
  }
}

/**
 * A configuration setting given to git (-c, --config-env, GIT_CONFIG_KEY_n, git config). Every
 * alias is denied (git's own quoting and "!" shell aliases rebuild "push" from any spelling), and
 * so are remote.<name>.push / .mirror (they choose what a push sends) and include files.
 */
function checkGitConfig(word, option, out) {
  const setting = word.value;
  if (uncheckable(word)) {
    out.ask.push(`git ${option} ${setting} cannot be checked`);
    return;
  }
  const key = setting.split("=")[0].trim().toLowerCase();
  if (key.startsWith("alias.")) {
    out.deny.push(`git ${option} ${key} defines an alias, which cannot be checked`);
  } else if (/^remote\..+\.(?:push|mirror)$/.test(key)) {
    out.deny.push(`git ${option} ${key} changes what git push sends, which cannot be checked`);
  } else if (/^include(?:if)?\./.test(key)) {
    out.deny.push(`git ${option} ${key} includes another config file, which cannot be checked`);
  } else if (key === "help.autocorrect") {
    out.ask.push("git -c help.autocorrect can run a mistyped push and cannot be checked");
  }
}

const CONFIG_WITH_ARG = new Set(["-f", "--file", "--blob", "--type", "--default", "--comment", "--value", "--url", "-t"]);
const CONFIG_SUBCOMMANDS = new Set(["get", "list", "unset", "remove-section", "rename-section", "edit"]);

/** git config writes persist, so a later push would use them: check every write. */
function analyzeGitConfig(args, out) {
  const positionals = [];
  let readOnly = false;
  for (let j = 0; j < args.length; j++) {
    const v = args[j].value;
    if (v === "--") {
      positionals.push(...args.slice(j + 1));
      break;
    }
    if (v.startsWith("-") && v.length > 1) {
      if (CONFIG_WITH_ARG.has(v)) j++;
      else if (/^--(?:get|list|unset|remove-section|rename-section|show-)/.test(v) || v === "-l") readOnly = true;
      continue;
    }
    positionals.push(args[j]);
  }
  if (positionals[0]?.value === "set") positionals.shift();
  else if (CONFIG_SUBCOMMANDS.has(positionals[0]?.value)) return;
  const [name, value] = positionals;
  if (readOnly || name === undefined || value === undefined) return;
  if (uncheckable(name) || uncheckable(value)) {
    out.ask.push(`git config ${name.value} ${value.value} cannot be checked`);
    return;
  }
  if (name.value.toLowerCase().startsWith("alias.")) {
    // git rebuilds "push" from pu""sh or pu\sh; a shell alias ("!...") can build it any way.
    if (/push/i.test(value.value.replace(/["'\\]/g, ""))) {
      out.deny.push(`git config ${name.value} defines an alias that pushes, which cannot be checked`);
    } else {
      out.ask.push(`git config ${name.value} defines an alias that later commands run unchecked`);
    }
    return;
  }
  checkGitConfig({ ...name, value: `${name.value}=${value.value}` }, "config", out);
}

/** git push resolves a local symbolic ref to its target, so a branch pointing at main pushes main. */
function analyzeSymbolicRef(args, out) {
  const positionals = [];
  for (let j = 0; j < args.length; j++) {
    const v = args[j].value;
    if (v === "-m") j++;
    else if (!v.startsWith("-")) positionals.push(args[j]);
  }
  const target = positionals[1];
  if (target !== undefined && (uncheckable(target) || isMain(target.value))) {
    out.ask.push(`git symbolic-ref ${positionals[0].value} ${target.value} can make a push of that branch update main`);
  }
}

/** GIT_CONFIG_* in an assignment, env argument or export: checked like git -c. */
function checkConfigEnv(word, out) {
  const match = GIT_CONFIG_ENV.exec(word.value);
  if (match === null) return;
  out.gitConfigEnv = true;
  const value = word.value.slice(match[0].length);
  const name = match[1] ?? "";
  if (name.startsWith("KEY_")) {
    checkGitConfig({ ...word, value }, `(${name.toLowerCase()})`, out);
  } else if (name === "PARAMETERS") {
    const lower = value.toLowerCase();
    if (/alias\./.test(lower) || /remote\.[^=\s]*\.(?:push|mirror)/.test(lower) || /include(?:if)?\./.test(lower)) {
      out.deny.push("GIT_CONFIG_PARAMETERS defines an alias, a push refspec or an include, which cannot be checked");
    }
  }
}

/**
 * xargs, parallel and find -exec run a command with arguments the guard cannot see. When that
 * command is git, its subcommand must be visible and not a placeholder.
 */
function analyzeRunner(name, cmd, args, out, depth) {
  let start = 0;
  if (name === "find") {
    start = args.findIndex((word) => ["-exec", "-execdir", "-ok", "-okdir"].includes(word.value)) + 1;
    if (start === 0) return;
  }
  const g = args.findIndex((word, index) => index >= start && (isGitName(base(word.value)) || SHELLS.has(base(word.value))));
  if (g < 0) {
    // GNU parallel without a command reads whole command lines from stdin or ::: lists.
    if (name === "parallel") out.pipedShell = true;
    return;
  }
  const program = base(args[g].value);
  if (SHELLS.has(program)) {
    out.pipedShell = true;
    analyzeShell(cmd, args.slice(g + 1), out, depth);
    return;
  }
  let replace = name === "xargs" ? null : "{";
  if (name === "xargs") {
    for (let p = 0; p < g; p++) {
      const v = args[p].value;
      if (v === "-I" || v === "-J") replace = args[p + 1]?.value || "{}";
      else if (/^-[IJ]./.test(v)) replace = v.slice(2);
      else if (v === "-i" || v === "--replace") replace = "{}";
      else if (/^-i./.test(v)) replace = v.slice(2);
      else if (v.startsWith("--replace=")) replace = v.slice("--replace=".length) || "{}";
    }
  }
  const gitArgs = program === "git" ? args.slice(g + 1) : [{ ...args[g], value: program.slice(4) }, ...args.slice(g + 1)];
  const sub = gitArgs[findGitSubcommand(gitArgs, out)];
  const hidden =
    sub === undefined ||
    [";", "+"].includes(sub.value) ||
    sub.value.startsWith(":::") ||
    (replace !== null && sub.value.includes(replace));
  if (hidden) {
    const text = `${name} runs git with a subcommand the guard cannot see (it can be push)`;
    if (name === "find") out.ask.push(text);
    else out.deny.push(text);
    return;
  }
  analyzeGit(gitArgs, out);
}

function analyzeStdinShell(cmd, out, depth) {
  for (const doc of cmd.heredocs) analyzeScript(doc.text, out, depth + 1);
  for (const word of cmd.herestrings) analyzeScript(word.value, out, depth + 1);
  // A pipe, an input redirect (< file, < <(...)) all feed the shell a script the guard cannot see.
  if (cmd.piped || cmd.inputs.length > 0) out.pipedShell = true;
}

/** A script argument that is really stdin or a process substitution: <(...) works like a pipe. */
function isStdinScript(word) {
  return STDIN_PATHS.has(word.value) || word.value.includes("<(…)");
}

function analyzeShell(cmd, args, out, depth) {
  let j = 0;
  let commandMode = false;
  let stdinMode = false;
  while (j < args.length) {
    const v = args[j].value;
    if (v === "--" || v === "-") {
      j++;
      break;
    }
    if (v.startsWith("--")) {
      j += v === "--rcfile" || v === "--init-file" ? 2 : 1;
    } else if (/^[-+][A-Za-z]+$/.test(v)) {
      if (v.includes("c")) commandMode = true;
      if (v.includes("s")) stdinMode = true;
      j += /[oO]/.test(v) ? 2 : 1;
    } else {
      break;
    }
  }
  if (commandMode) {
    // A dynamic script ("$CMD") re-parses as a dynamic command head, which is checked there.
    if (j < args.length) analyzeScript(args[j].value, out, depth + 1);
    return;
  }
  if (j < args.length && !stdinMode && !isStdinScript(args[j])) return; // a script file: not visible
  if (j < args.length && isStdinScript(args[j])) out.pipedShell = true;
  analyzeStdinShell(cmd, out, depth);
}

const GH_API_WITH_ARG = new Set(["-H", "--header", "-q", "--jq", "-t", "--template", "--hostname", "-p", "--preview", "--cache"]);

function analyzeGh(args, out) {
  const sub = args[0]?.value;
  if (sub === "alias" || sub === "extension" || sub === "ext") {
    if (hasGitAndPush(args)) out.deny.push(`gh ${sub} with git push cannot be checked`);
    return;
  }
  if (sub !== "api") return;
  let method = null;
  let fields = false;
  let endpoint = null;
  const fieldValues = [];
  for (let j = 1; j < args.length; j++) {
    const v = args[j].value;
    if (v === "-X" || v === "--method") {
      method = args[j + 1]?.value ?? "";
      j++;
    } else if (v.startsWith("--method=")) {
      method = v.slice("--method=".length);
    } else if (/^-X./.test(v)) {
      method = v.slice(2);
    } else if (["-f", "-F", "--field", "--raw-field", "--input"].includes(v)) {
      fields = true;
      fieldValues.push(args[j + 1]?.value ?? "");
      j++;
    } else if (/^-[fF]./.test(v) || /^--(?:field|raw-field|input)=/.test(v)) {
      fields = true;
      fieldValues.push(v);
    } else if (GH_API_WITH_ARG.has(v)) {
      j++;
    } else if (!v.startsWith("-") && endpoint === null) {
      endpoint = v;
    }
  }
  if (endpoint === null) return;
  const verb = (method ?? (fields ? "POST" : "GET")).toUpperCase();
  if (verb === "GET" || verb === "HEAD") return;
  const path = endpoint.replace(/[?#].*$/, "");
  if (/(?:^|\/)git\/refs\/(?:heads\/)?main$/i.test(path)) {
    out.deny.push("gh api write to refs/heads/main is a push to main (merge a PR instead)");
  } else if (/(?:^|\/)git\/refs(?:\/|$)|(?:^|\/)merges$|(?:^|\/)contents(?:\/|$)/i.test(path)) {
    out.ask.push(`gh api ${verb} ${path} can change a branch and cannot be checked`);
  } else if (/^graphql$/i.test(path) && fieldValues.some((value) => /createCommitOnBranch|updateRefs?\b|mergeBranch/i.test(value))) {
    out.ask.push("gh api graphql mutation can change a branch and cannot be checked");
  }
}

function isDynamic(word) {
  return word.dynamic || /[$`]/.test(word.value);
}

function analyzeCommand(cmd, out, depth) {
  const words = cmd.words;
  for (const word of words) checkConfigEnv(word, out);
  let k = 0;
  while (k < words.length) {
    const v = words[k].value;
    if (ASSIGNMENT.test(v) || RESERVED.has(v)) {
      k++;
      continue;
    }
    if (WRAPPERS.has(base(v))) {
      let j = k + 1;
      while (j < words.length && !isTarget(words[j].value)) j++;
      if (j >= words.length) {
        // No known target: a computed word (env $CMD) is the command the wrapper runs.
        j = words.findIndex((word, index) => index > k && isDynamic(word) && !word.value.startsWith("-") && !ASSIGNMENT.test(word.value));
      }
      if (j > k) {
        k = j;
        continue;
      }
    }
    break;
  }
  if (k >= words.length) return;
  const head = words[k];
  const rest = words.slice(k + 1);
  if (isDynamic(head)) {
    // $p, "$@", ${x}, $(...): decided in decideBash with the whole command text.
    out.dynamicExec = true;
    if (/git-(?:push|send-pack)/i.test(head.value)) {
      out.deny.push(`a computed path to a git-core program (${head.value}) cannot be checked`);
    }
    if (rest.some((word) => mentionsPush(word.value))) {
      out.deny.push(`a command computed at run time (${head.value}) is given "push", which cannot be checked`);
    }
    return;
  }
  const name = base(head.value);
  if (name === "git") {
    analyzeGit(rest, out);
  } else if (isGitName(name)) {
    // /usr/lib/git-core/git-push is git push.
    analyzeGit([{ ...head, value: name.slice(4) }, ...rest], out);
  } else if (SHELLS.has(name)) {
    analyzeShell(cmd, rest, out, depth);
  } else if (name === "eval") {
    analyzeScript(rest.map((word) => word.value).join(" "), out, depth + 1);
  } else if (name === "source" || name === ".") {
    if (rest.length > 0 && rest[0].value.includes("<(…)")) out.pipedShell = true;
    if (rest.length === 0 || isStdinScript(rest[0])) analyzeStdinShell(cmd, out, depth);
  } else if (name === "xargs" || name === "parallel" || name === "find") {
    analyzeRunner(name, cmd, rest, out, depth);
    if (hasGitAndPush(words)) out.deny.push(`git push inside ${name} cannot be checked (run git push directly)`);
  } else if (name === "gh") {
    analyzeGh(rest, out);
  } else if (!DATA_ONLY.has(name) && hasGitAndPush(words)) {
    out.deny.push(`git push inside ${name} cannot be checked (run git push directly)`);
  }
}

function analyzeScript(text, out, depth) {
  if (depth > MAX_DEPTH) {
    if (/push/i.test(text)) out.deny.push("a command nested too deeply mentions push and cannot be checked");
    return;
  }
  let commands;
  try {
    commands = parseShell(text);
  } catch (error) {
    if (!(error instanceof ParseError)) throw error;
    if (/push/i.test(text)) out.deny.push(`a command that mentions push could not be parsed (${error.message})`);
    return;
  }
  for (const cmd of commands) analyzeCommand(cmd, out, depth);
}

/** Decides a Bash command; returns {decision, reason} or null. */
export function decideBash(command) {
  const out = { deny: [], ask: [], pipedShell: false, dynamicExec: false, gitConfigEnv: false, sawGit: false };
  analyzeScript(command, out, 0);
  if (out.dynamicExec) {
    // A variable, here-string or $(...) can hold "git push" and run it as a command.
    if (mentionsGitPush(command)) out.deny.push("a command computed at run time in a command line that mentions git push cannot be checked");
    else out.ask.push("a command computed at run time ($x, \"$@\", $(...)) cannot be checked");
  }
  if (out.gitConfigEnv && out.sawGit) {
    out.ask.push("git configuration from GIT_CONFIG_* environment variables cannot be checked");
  }
  if (/base64/i.test(command)) {
    for (const token of command.match(/[A-Za-z0-9+/]{8,}={0,2}/g) ?? []) {
      const decoded = Buffer.from(token, "base64").toString("utf8");
      if (mentionsGitPush(decoded)) {
        out.deny.push("a base64-encoded git push cannot be checked");
        break;
      }
    }
    if (out.pipedShell) out.ask.push("base64 output piped into a shell cannot be checked");
  }
  if (out.pipedShell && mentionsGitPush(command)) {
    out.deny.push("git push piped into a shell cannot be checked");
  }
  return verdict(out);
}

const GITHUB_WRITE_TOOLS = new Set(["push_files", "create_or_update_file", "delete_file"]);

/** Decides a GitHub MCP call; returns {decision, reason} or null. */
export function decideGithub(name, toolInput) {
  if (!GITHUB_WRITE_TOOLS.has(name)) return null;
  const branch = toolInput?.branch;
  if (typeof branch !== "string" || branch.trim() === "") {
    return { decision: "deny", reason: `GitHub ${name} without a branch writes to the default branch (main): name a feature branch` };
  }
  if (isMain(branch)) {
    return { decision: "deny", reason: `GitHub ${name} on main is not allowed (merge a PR instead)` };
  }
  return null;
}

function verdict(out) {
  if (out.deny.length > 0) return { decision: "deny", reason: [...new Set(out.deny)].slice(0, 3).join("; ") };
  if (out.ask.length > 0) return { decision: "ask", reason: [...new Set(out.ask)].slice(0, 3).join("; ") };
  return null;
}

/** Returns {decision, reason} or null (no decision: normal permission flow). */
export function decide(input) {
  if (input === null || typeof input !== "object" || typeof input.tool_name !== "string") {
    throw new Error("unreadable tool call");
  }
  const toolInput = input.tool_input ?? {};
  if (input.tool_name === "Bash") {
    if (typeof toolInput.command !== "string") throw new Error("Bash call without a command");
    return decideBash(toolInput.command);
  }
  if (!input.tool_name.startsWith("mcp__")) return null;
  const rest = input.tool_name.slice("mcp__".length);
  const sep = rest.indexOf("__");
  if (sep < 0 || !/github/i.test(rest.slice(0, sep))) return null;
  return decideGithub(rest.slice(sep + 2), toolInput);
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
  let raw = "";
  let result;
  try {
    raw = readFileSync(0, "utf8");
    result = decide(JSON.parse(raw));
  } catch {
    result = /push/i.test(raw)
      ? { decision: "deny", reason: "git push guard failed closed: the tool call could not be checked" }
      : null;
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
