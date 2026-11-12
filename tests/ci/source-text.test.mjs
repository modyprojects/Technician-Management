// SQL sources hold no invisible character (PR 1.4 integration fix INT-1, review README
// docs/review/step1-pr14/README.md §11). A bidi override, a zero-width or other default-ignorable
// character, a control character or a space other than U+0020 written literally into a migration,
// a down script or a pgTAP file is invisible in review and on GitHub ("Trojan Source"), and it can
// change what a CHECK or a string compares. Such code points are written as escapes instead (ARE
// escapes in plain strings, or chr(n) in tests). Tab, line feed and carriage return are allowed.
import { test } from "node:test";
import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { dirname, join, resolve } from "node:path";
import { fileURLToPath } from "node:url";

const root = resolve(dirname(fileURLToPath(import.meta.url)), "..", "..");
const dirs = [
  join("supabase", "migrations"),
  join("supabase", "rollback"),
  join("tests", "db"),
];

// Inclusive code point ranges that must not appear literally. Written as numbers, not escapes.
const FORBIDDEN = [
  [0x0000, 0x0008], [0x000b, 0x000c], [0x000e, 0x001f], [0x007f, 0x009f], // controls (not tab, LF, CR)
  [0x00a0, 0x00a0], [0x1680, 0x1680], [0x2000, 0x200a], [0x202f, 0x202f], [0x205f, 0x205f],
  [0x2800, 0x2800], [0x3000, 0x3000], // spaces other than U+0020, braille pattern blank
  [0x2028, 0x2029], [0xfff9, 0xfffb], // line and paragraph separators, interlinear annotation
  // Default_Ignorable_Code_Point (Unicode DerivedCoreProperties), bidi controls included
  [0x00ad, 0x00ad], [0x034f, 0x034f], [0x061c, 0x061c], [0x115f, 0x1160], [0x17b4, 0x17b5],
  [0x180b, 0x180f], [0x200b, 0x200f], [0x202a, 0x202e], [0x2060, 0x206f], [0x3164, 0x3164],
  [0xfe00, 0xfe0f], [0xfeff, 0xfeff], [0xffa0, 0xffa0], [0xfff0, 0xfff8], [0x1bca0, 0x1bca3],
  [0x1d173, 0x1d17a], [0xe0000, 0xe0fff],
];

function forbidden(cp) {
  return FORBIDDEN.some(([low, high]) => cp >= low && cp <= high);
}

function findInvisible(text) {
  const hits = [];
  let line = 1;
  for (const ch of text) {
    const cp = ch.codePointAt(0);
    if (cp === 0x0a) line += 1;
    else if (forbidden(cp)) hits.push(`line ${line}: U+${cp.toString(16).toUpperCase().padStart(4, "0")}`);
  }
  return hits;
}

test("the scan recognises the characters it forbids (positive control)", () => {
  const samples = [0x202e, 0x200f, 0x00a0, 0x00ad, 0xe0001, 0xfe0f, 0x3164, 0x2800, 0x0007];
  for (const cp of samples) {
    assert.equal(findInvisible(`select 'a${String.fromCodePoint(cp)}b';`).length, 1, `U+${cp.toString(16)}`);
  }
  assert.deepEqual(findInvisible("select 'תיקון — ok';\tselect 1;\r\n"), []);
});

for (const dir of dirs) {
  const full = join(root, dir);
  const files = existsSync(full) ? readdirSync(full).filter((name) => name.endsWith(".sql")).sort() : [];
  for (const name of files) {
    test(`${dir}/${name}: no invisible, bidi or non-ASCII space character written literally`, () => {
      assert.deepEqual(findInvisible(readFileSync(join(full, name), "utf8")), []);
    });
  }
}
