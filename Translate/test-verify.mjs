// THE LAST NET MUST SEE WHAT THE READERS DROP.
//
// verify.mjs is the round-trip check behind the amber "Unverified" note: the
// reading we are about to show is brailled again by MathCAT and compared with
// what the braille user typed, after normalise() has removed the cells we
// deliberately do not represent. The help promises that "no note at all means
// the reading was verified".
//
// On 2026-09-02 (the Translate audit) the comparator was found to drop, in
// Nemeth, every dots-56 (the SUBSCRIPT indicator as well as the letter
// indicator), every blank (which decides whether dots-46 + k is = or kappa),
// and every dots-45/46 + digit pair (a superscript 2, a decimal point and its
// digit). So x-squared normalised to x, T-sub-A to TA and 3.14 to 34, and a
// reader that lost the square in Pythagoras was reported as verified. Each
// strip is now scoped to the one meaning it was written for. This file holds:
//
//   1. the cells the comparator must tell apart;
//   2. the spellings it must equate - the letter indicator MathCAT writes and
//      a child may not, typeform pairs, the baseline indicator after a script,
//      a numeric subscript written bare, spacing that carries nothing;
//   3. the whole round trip through the vendored MathCAT (pkg-nodejs) and
//      Temml, so a lost square is NOT verified and the note points at it.
//
// Cells are built from dot numbers - no braille literal in this file.
// Run: node Translate/test-verify.mjs   (from the repo root or Translate/)
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { normalise, verifyWith } from './verify.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`); }
};
const BLANK = String.fromCodePoint(0x2800);
const D = (s) => s.split(/\s+/).filter(Boolean)
  .map((d) => d === '_' ? BLANK : String.fromCodePoint(0x2800 + [...d].reduce((m, ch) => m | (1 << (Number(ch) - 1)), 0))).join('');
const dots = (b) => [...b].map((c) => c === BLANK ? '_' : [1, 2, 3, 4, 5, 6, 7, 8].filter((k) => (c.codePointAt(0) - 0x2800) & (1 << (k - 1))).join('')).join(' ');
const norm = (b, code) => dots(normalise(b, code).text);
const same = (a, b, code) => normalise(a, code).text === normalise(b, code).text;

console.log('cells the comparator must tell apart');
for (const [name, code, a, b] of [
  ['Nemeth x^2 | x', 'Nemeth', D('1346 45 23'), D('1346')],
  ['Nemeth T_A | T A', 'Nemeth', D('6 2345 56 6 1'), D('6 2345 _ 6 1')],
  ['Nemeth T_A | TA', 'Nemeth', D('6 2345 56 6 1'), D('6 2345 6 1')],
  ['Nemeth 3.14 | 34', 'Nemeth', D('3456 25 46 2 256'), D('3456 25 256')],
  ['Nemeth a identity b (spaced) | a Fraktur-l b (unspaced)', 'Nemeth', D('1 _ 456 123 _ 12'), D('1 456 123 12')],
  ['Nemeth a identity b | a Fraktur-l-b (blank before only)', 'Nemeth', D('1 _ 456 123 _ 12'), D('1 _ 456 123 12')],
  ['Nemeth a = b | a kappa-b', 'Nemeth', D('1 _ 46 13 _ 12'), D('1 _ 46 13 12')],
  ['Nemeth x = 5 | x kappa 5 (unspaced)', 'Nemeth', D('1346 _ 46 13 _ 3456 26'), D('1346 46 13 3456 26')],
  ['Nemeth a < b | akb (dots-5 is the prefix of <)', 'Nemeth', D('1 _ 5 13 _ 12'), D('1 13 12')],
  ['Nemeth x^{y_z} | x^{yz}', 'Nemeth', D('1346 45 13456 45 56 1356'), D('1346 45 13456 1356')],
  ['Nemeth x_{a_b} | x_{ab}', 'Nemeth', D('1346 56 1 56 56 12'), D('1346 56 1 12')],
  ['Nemeth x_{2+k} | x_2 + k', 'Nemeth', D('1346 56 23 346 13'), D('1346 23 346 13')],
  ['Nemeth sin_2 x | sin 2x (the multipurpose dots-5)', 'Nemeth', D('234 24 1345 23 1346'), D('234 24 1345 5 23 1346')],
  ['Nemeth lim: dots-5 + k inside the underscript is <, not a baseline', 'Nemeth', D('123 24 134 146 1346 _ 5 13 _ 3456 2 12456'), D('123 24 134 146 1346 _ 13 _ 3456 2 12456')],
  ['UEB x^2 | x', 'UEB', D('1346 56 35 3456 12'), D('1346')],
  ['UEB 1 2 | 12', 'UEB', D('3456 1 _ 3456 12'), D('3456 1 12')],
]) ok(name, !same(a, b, code), `both normalise to [${norm(a, code)}]`);

console.log('spellings the comparator must equate');
for (const [name, code, a, b] of [
  ['Nemeth letter indicator + x | x', 'Nemeth', D('56 1346'), D('1346')],
  ['Nemeth [x] with the letter indicator (MathCAT) | without', 'Nemeth', D('4 12356 56 1346 4 23456'), D('4 12356 1346 4 23456')],
  ['Nemeth bold x | x', 'Nemeth', D('456 56 1346'), D('1346')],
  ['Nemeth script x | x', 'Nemeth', D('4 56 1346'), D('1346')],
  ['Nemeth sin x spaced | unspaced', 'Nemeth', D('234 24 1345 _ 1346'), D('234 24 1345 1346')],
  ['Nemeth 2 A | 2A', 'Nemeth', D('3456 23 _ 6 1'), D('3456 23 6 1')],
  ['Nemeth therefore q spaced | unspaced', 'Nemeth', D('6 16 _ 12345'), D('6 16 12345')],
  ['Nemeth a theta B spaced | unspaced (a blank before a Greek letter carries nothing)', 'Nemeth', D('6 1 _ 46 1456 _ 6 12'), D('6 1 46 1456 6 12')],
  ['Nemeth x^2 + y with the baseline indicator | without', 'Nemeth', D('1346 45 23 5 346 13456'), D('1346 45 23 346 13456')],
  ['Nemeth 6x^2 pi^2 n: blanks between terms | baseline indicators', 'Nemeth', D('3456 235 1346 45 23 _ 46 1234 45 23 _ 1345'), D('3456 235 1346 45 23 5 46 1234 45 23 5 1345')],
  ['Nemeth d^4 blank baseline ellipsis | baseline ellipsis', 'Nemeth', D('145 45 256 _ 5 3 3 3 _ 1356'), D('145 45 256 5 3 3 3 1356')],
  ['Nemeth 75 degrees F: blank + letter indicator | baseline indicator', 'Nemeth', D('3456 2356 26 45 46 16 _ 56 6 124'), D('3456 2356 26 45 46 16 5 6 124')],
  ['Nemeth lim: baseline before the termination sign | none', 'Nemeth', D('5 123 24 134 146 1346 1246 135 3456 2 36 5 12456'), D('5 123 24 134 146 1346 1246 135 3456 2 36 12456')],
  ['Nemeth lim with blanks inside the underscript, same', 'Nemeth', D('5 123 24 134 146 1346 _ 1246 135 _ 3456 2 36 5 12456 _ 12356 26 1346 346 2 23456'), D('5 123 24 134 146 1346 _ 1246 135 _ 3456 2 36 12456 _ 12356 26 1346 346 2 23456')],
  ['Nemeth Cl_4] with subscript and baseline indicators | bare digit', 'Nemeth', D('6 14 123 56 256 5 4 23456'), D('6 14 123 256 4 23456')],
  ['Nemeth Richard_1 explicit at the end | bare', 'Nemeth', D('6 1235 24 14 125 1 1235 145 56 2'), D('6 1235 24 14 125 1 1235 145 2')],
  ['Nemeth Richard_1 explicit before a blank | bare', 'Nemeth', D('6 1235 24 14 125 1 1235 145 56 2 _ 6 145'), D('6 1235 24 14 125 1 1235 145 2 _ 6 145')],
  ['Nemeth z.4 with MathCAT\'s dots-5 before the point | without', 'Nemeth', D('1356 5 46 256'), D('1356 46 256')],
  ['Nemeth double blank | single', 'Nemeth', D('1 _ _ 46 13 _ 12'), D('1 _ 46 13 _ 12')],
  ['Nemeth leading and trailing blanks | none', 'Nemeth', D('_ 1346 45 23 _'), D('1346 45 23')],
  ['UEB x = 5 spaced | unspaced', 'UEB', D('1346 _ 5 2356 _ 3456 15'), D('1346 5 2356 3456 15')],
  ['UEB grade-1 x | x', 'UEB', D('56 1346'), D('1346')],
  ['UEB grade-1 passage ... terminator | bare', 'UEB', D('56 56 56 1346 56 3'), D('1346')],
  ['UEB bold-symbol x | x', 'UEB', D('45 2 1346'), D('1346')],
]) ok(name, same(a, b, code), `[${norm(a, code)}] vs [${norm(b, code)}]`);

console.log('the map points a divergence at a typed cell');
{
  const r = normalise(D('_ 1346 _ 46 13 _ 3456 26'), 'Nemeth');   // " x = 5 " -> x, blank, =, blank, 5
  ok('map indexes the original string', r.map.every((m, k) => k === 0 || m > r.map[k - 1]) && r.map[0] === 1, JSON.stringify(r.map));
}

console.log('the round trip through MathCAT and Temml');
const mathcat = require(path.join(HERE, '..', 'engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const { loadTemml } = await import('./tools/lib/structure.mjs');
const temml = loadTemml(path.join(HERE, '..', 'web/vendor/temml.min.js'));
const verdict = (brl, latex, code) => verifyWith(mathcat, temml, brl, latex, code);
for (const [name, code, typed, latex, want, cell] of [
  ['Nemeth x^2 read as x is NOT verified', 'Nemeth', D('1346 45 23'), 'x', false, 1],
  ['Nemeth x^2 read as x^{2} is verified', 'Nemeth', D('1346 45 23'), 'x^{2}', true],
  ['Nemeth T_A read as TA is NOT verified', 'Nemeth', D('6 2345 56 6 1'), 'TA', false],
  ['Nemeth T_A read as T_{A} is verified', 'Nemeth', D('6 2345 56 6 1'), 'T_{A}', true],
  ['Nemeth 3.14 read as 34 is NOT verified', 'Nemeth', D('3456 25 46 2 256'), '34', false],
  ['Nemeth 3.14 read as 3.14 is verified', 'Nemeth', D('3456 25 46 2 256'), '3.14', true],
  ['Nemeth a identity b read as a Fraktur-l b is NOT verified', 'Nemeth', D('1 _ 456 123 _ 12'), 'a \\mathfrak{l} b', false],
  ['Nemeth a identity b read as a \\equiv b is verified', 'Nemeth', D('1 _ 456 123 _ 12'), 'a \\equiv b', true],
  ['Nemeth a < b read as akb is NOT verified', 'Nemeth', D('1 _ 5 13 _ 12'), 'akb', false],
  ['Nemeth a < b read as a < b is verified', 'Nemeth', D('1 _ 5 13 _ 12'), 'a < b', true],
  ['Nemeth unspaced x kappa 5 read as x = 5 is NOT verified', 'Nemeth', D('1346 46 13 3456 26'), 'x = 5', false],
  ['Nemeth a bare x is verified (MathCAT writes the letter indicator)', 'Nemeth', D('1346'), 'x', true],
  ['Nemeth bold x read as x is verified (typeform is not represented)', 'Nemeth', D('456 56 1346'), 'x', true],
  ['Nemeth Pythagoras is verified', 'Nemeth', D('1346 45 23 5 346 13456 45 23 _ 46 13 _ 1356 45 23'), 'x^{2} + y^{2} = z^{2}', true],
  ['Nemeth CO_2 typed bare is verified', 'Nemeth', D('6 14 6 135 23'), 'CO_{2}', true],
  ['UEB x^2 read as x is NOT verified', 'UEB', D('1346 56 35 3456 12'), 'x', false],
  ['UEB x^2 read as x^{2} is verified', 'UEB', D('1346 56 35 3456 12'), 'x^{2}', true],
  ['UEB unspaced x=5 read as x = 5 is verified', 'UEB', D('1346 5 2356 3456 15'), 'x = 5', true],
]) {
  const v = verdict(typed, latex, code);
  ok(name, v.checked && v.ok === want && (cell === undefined || v.cell === cell), JSON.stringify(v));
}

console.log(`\n${pass} passed, ${fail} failed`);
process.exit(fail ? 1 : 0);
