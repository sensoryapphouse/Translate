// THE READERS THE APP SHIPS MUST NEVER THROW.
//
// mathnode.mjs states the design: a child's braille is half-finished and
// often wrong, so a cell the parser cannot read becomes a visible `unreadable`
// node - never an exception. On 2026-09-02 the Nemeth reader was found to
// throw ReferenceErrors on seven cases of the reference corpus and on a third
// of random input (an undeclared `depth`, an unimported `Table`), and the
// speech path calls it with no try/catch, so a child typing a comma inside a
// subscript, or a matrix, got silence. This file holds the promise:
//
//   1. the seven corpus cases parse, and read as the corpus says they should;
//   2. NO case of either corpus makes either reader throw;
//   3. nor does random input - thirty thousand strings of cells, built from
//      codepoints with a fixed seed so a failure is reproducible.
//
// It scores the readers the app actually uses (nemeth-rules.mjs, ueb-rules.mjs)
// - not the older pair check.mjs's benchmarks score.
//
// Run: node Translate/test-maths-readers.mjs   (from the repo root or Translate/)
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nemethMathsToLatexV2, parseNemeth } from './nemeth-rules.mjs';
import { uebMathsToLatexV2, parseUeb } from './ueb-rules.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`); }
};
const norm = (t) => String(t || '').replace(/\\left|\\right/g, '').replace(/\s+/g, '');
const corpus = (f) => JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'corpus', f), 'utf8'));
const nemeth = corpus('nemeth-mathcat.json');
const ueb = corpus('ueb-mathcat.json');
const byName = (name) => nemeth.find((c) => c.name === name);

console.log('the seven cases that used to throw');
// [corpus case, what it must read as (normalised), why]
const CASES = [
  ['identity_matrix_126_linearize', '\\begin{pmatrix}1&0&0\\\\0&1&0\\\\0&0&1\\end{pmatrix}', 'Nemeth §126: an enlarged bracket round rows is a matrix'],
  ['comma_space_78_1',  'x_{i,j,k}',  'Nemeth §78: ⠪ inside a script is the comma'],
  ['comma_78_2',        'x_{(a,b)}',  '…inside a bracketed subscript too'],
  ['comma_78_3',        'x_{1,2}',    '…between numerals'],
  ['comma_in_sup_79_b_4', 'x_{i,j}',  '…two letters'],
];
for (const [name, want, why] of CASES) {
  const c = byName(name);
  let got = null, threw = null;
  try { got = nemethMathsToLatexV2(c.braille); } catch (e) { threw = e.message; }
  ok(`${name} parses (${why})`, !threw, threw || '');
  if (!threw) ok(`${name} reads as ${want}`, norm(got.latex) === norm(want) && !got.warnings.length, `got ${JSON.stringify(got.latex)} warnings ${JSON.stringify(got.warnings)}`);
}
{
  // Nested level indicators (⠰⠰ second level, ⠰ back to first) are NOT yet read
  // as levels - this case still reads wrongly - but it must not throw.
  const c = byName('comma_ellipsis_in_sub_79_b_5');
  let threw = null; try { nemethMathsToLatexV2(c.braille); } catch (e) { threw = e.message; }
  ok('comma_ellipsis_in_sub_79_b_5 parses (its level indicators are a known gap; it must still not throw)', !threw, threw || '');
}

console.log('\nno case of either corpus throws');
const sweep = (cases, parse, label) => {
  const thrown = [];
  for (const c of cases) { try { parse(c.braille); } catch (e) { thrown.push(`${c.name}: ${e.message.split('\n')[0]}`); } }
  ok(`${label}: ${cases.length} cases, none throws`, !thrown.length, thrown.slice(0, 4).join(' | '));
};
sweep(nemeth, parseNemeth, 'Nemeth reader over the Nemeth corpus');
sweep(ueb, parseUeb, 'UEB reader over the UEB corpus');
// and each reader over the OTHER code's braille, which is what a child who has
// the wrong maths code selected hands it
sweep(ueb, parseNemeth, 'Nemeth reader over UEB braille');
sweep(nemeth, parseUeb, 'UEB reader over Nemeth braille');

console.log('\nnor does random input');
{
  let seed = 12345;
  const rnd = () => (seed = (seed * 1103515245 + 12345) & 0x7fffffff) / 0x7fffffff;
  const cell = () => (rnd() < 0.12 ? ' ' : String.fromCodePoint(0x2800 + 1 + Math.floor(rnd() * 63)));
  const dots = (str) => [...str].map((c) => (c === ' ' ? '_' : [1, 2, 3, 4, 5, 6].filter((d) => (c.codePointAt(0) - 0x2800) & (1 << (d - 1))).join(''))).join(' ');
  const N = 30000;
  const bad = { nemeth: [], ueb: [] };
  for (let n = 0; n < N; n++) {
    let s = ''; const len = 1 + Math.floor(rnd() * 12);
    for (let i = 0; i < len; i++) s += cell();
    try { parseNemeth(s); } catch (e) { bad.nemeth.push(dots(s) + ' -> ' + e.message.split('\n')[0]); }
    try { parseUeb(s); } catch (e) { bad.ueb.push(dots(s) + ' -> ' + e.message.split('\n')[0]); }
  }
  ok(`Nemeth reader: ${N} random inputs, none throws`, !bad.nemeth.length, `${bad.nemeth.length} threw, e.g. ${bad.nemeth[0]}`);
  ok(`UEB reader: ${N} random inputs, none throws`, !bad.ueb.length, `${bad.ueb.length} threw, e.g. ${bad.ueb[0]}`);
}

// THE LATEX THE READERS EMIT MUST BE WELL FORMED (2026-09-02, the audit's
// gate work). Two spellings were malformed in ways nothing measured: a closing
// vertical bar emitted \left| again (|-9| = 9 printed "\left| - 9\left| = 9",
// which Temml renders as a run-on), and a lowercase Greek command carried no
// trailing space, so \pi followed by r emitted "\pir" - an unknown command
// where the GCSE circle-area formula should be. Both reached the print pane:
// the round-trip comparator strips \left, \right and whitespace, so it could
// not see either one, and the corpus judges tokenise the same way.
console.log('the LaTeX both readers emit is well formed');
{
  const SP = String.fromCodePoint(0x2800);
  const D = (str) => str.split(/\s+/).filter(Boolean)
    .map((d) => (d === '_' ? SP : String.fromCodePoint(0x2800 + [...d].reduce((m, ch) => m | (1 << (Number(ch) - 1)), 0)))).join('');
  // \leftarrow and \rightarrow are their own commands, not delimiters
  const balanced = (tex) => (String(tex).match(/\\left(?![a-zA-Z])/g) || []).length === (String(tex).match(/\\right(?![a-zA-Z])/g) || []).length;
  const readN = (cells) => { try { return nemethMathsToLatexV2(cells); } catch (e) { return { latex: 'THREW ' + e.message, warnings: ['threw'] }; } };
  const readU = (cells) => { try { return uebMathsToLatexV2(cells); } catch (e) { return { latex: 'THREW ' + e.message, warnings: ['threw'] }; } };

  // |-9| = 9 : bar, minus, numeric 9, bar, blank, =, blank, numeric 9
  const abs = readN(D('1256 36 3456 35 1256 _ 46 13 _ 3456 35'));
  ok('Nemeth: a closing vertical bar is \\right| , not a second \\left|', /\\right\|/.test(abs.latex) && !/\\left\|[^|]*\\left\|/.test(abs.latex), JSON.stringify(abs.latex));
  ok('Nemeth: the absolute-value row is balanced', balanced(abs.latex), JSON.stringify(abs.latex));
  const twoAbs = readN(D('1256 3456 25 _ 36 _ 3456 2 2 1256 346 1256 36 3456 23 1256'));
  ok('Nemeth: two absolute values in one line are balanced', balanced(twoAbs.latex) && (twoAbs.latex.match(/\\right\|/g) || []).length === 2, JSON.stringify(twoAbs.latex));
  const norm2 = readN(D('1256 1256 1346 1256 1256'));
  ok('Nemeth: the double bar (a norm) still closes with \\right\\|', /\\right\\\|/.test(norm2.latex), JSON.stringify(norm2.latex));
  const paren = readN(D('12356 1 346 12 23456'));
  ok('Nemeth: ordinary parentheses are untouched by the self-closing rule', balanced(paren.latex) && /\\left\(/.test(paren.latex) && /\\right\)/.test(paren.latex), JSON.stringify(paren.latex));

  // pi r : Greek indicator, p, r  |  and the same in UEB
  const piN = readN(D('46 1234 1235'));
  ok('Nemeth: a Greek command does not run into the next letter', /\\pi\s/.test(piN.latex) && !/\\pir/.test(piN.latex), JSON.stringify(piN.latex));
  const piU = readU(D('46 1234 1235'));
  ok('UEB: a Greek command does not run into the next letter', /\\pi\s/.test(piU.latex) && !/\\pir/.test(piU.latex), JSON.stringify(piU.latex));
  ok('Nemeth: omicron stays a plain o (it is not a command)', /\bo\b/.test(readN(D('46 135 1346')).latex), JSON.stringify(readN(D('46 135 1346')).latex));

  // every corpus row, both codes: what we emit must balance its own \left/\right
  const unbalanced = [];
  for (const [name, cases, read] of [['Nemeth', nemeth, readN], ['UEB', ueb, readU]]) {
    for (const c of cases) {
      const r = read(c.braille);
      if (!balanced(r.latex)) unbalanced.push(`${name} ${c.name}: ${String(r.latex).slice(0, 60)}`);
    }
  }
  // EIGHT ROWS ARE STILL UNBALANCED, AND EACH ONE IS A READER GAP, not an
  // emitter slip: a closing bracket swallowed into a subscript run (letter_26,
  // extension_field), and the set-builder bar of Nemeth §145, where { x | x < 10 }
  // opens a group the reader never closes. They are named so a NINTH cannot
  // appear unnoticed; fixing them belongs with the reader's failure buckets.
  const KNOWN_UNBALANCED = new Set([
    'Nemeth letter_26_b_18', 'Nemeth letter_26_b_19',
    'Nemeth mathml_spec_example_86_a', 'Nemeth mathml_spec_example_alt_char_86_a',
    'Nemeth set_vertical_bar_145_1', 'Nemeth vertical_bar_145_4',
    'Nemeth extension_field_not_ratio', 'Nemeth comparison_ops_151_14',
  ]);
  const newly = unbalanced.filter((u) => !KNOWN_UNBALANCED.has(u.split(':')[0]));
  ok('no NEW corpus row emits an unmatched \\left or \\right', !newly.length, `${newly.length} new, e.g. ${newly[0]}`);
  ok(`the eight known unbalanced rows are still exactly eight (Nemeth §145 set-builder bars and swallowed closers)`, unbalanced.length === 8, `${unbalanced.length}: ${unbalanced.map((u) => u.split(':')[0]).join(', ')}`);
  // and no command may be followed immediately by a letter that changes it
  const fused = [];
  for (const [name, cases, read] of [['Nemeth', nemeth, readN], ['UEB', ueb, readU]]) {
    for (const c of cases) {
      const m = /\\(alpha|beta|gamma|delta|epsilon|zeta|eta|theta|iota|kappa|lambda|mu|nu|xi|pi|rho|sigma|tau|upsilon|phi|chi|psi|omega)[a-zA-Z]/.exec(read(c.braille).latex || '');
      if (m) fused.push(`${name} ${c.name}: ${m[0]}`);
    }
  }
  ok('no Greek command is fused to the letter after it', !fused.length, `${fused.length} fused, e.g. ${fused[0]}`);
}

// THE SIGNS THE CORPUS ASKED FOR (2026-09-02). The shipped Nemeth reader read
// 63% of its corpus cleanly; 279 of the 755 rows failed on an unrecognised
// cell, and bucketing those by cell - then reading the SOURCE MathML of the
// rows each cell appeared in - named the missing signs one by one. Every
// meaning below came from the corpus that way, never from the dots alone.
console.log('the signs the corpus named');
{
  const SP = String.fromCodePoint(0x2800);
  const D = (str) => str.split(/\s+/).filter(Boolean)
    .map((d) => (d === '_' ? SP : String.fromCodePoint(0x2800 + [...d].reduce((m, ch) => m | (1 << (Number(ch) - 1)), 0)))).join('');
  const read = (cells) => { try { return nemethMathsToLatexV2(cells); } catch (e) { return { latex: 'THREW ' + e.message, warnings: ['threw'] }; } };
  const sign = (name, cells, want, why) => {
    const r = read(cells);
    ok(`${name} (${why})`, String(r.latex).includes(want) && !(r.warnings || []).length,
       `got ${JSON.stringify(r.latex)} warnings ${JSON.stringify(r.warnings)}`);
  };
  // "(A, b)" - dot 6 before a space is the comma; before a letter it is still the capital
  sign('comma', D('12356 1 6 _ 12 23456'), ', ', 'dot 6 then a space');
  sign('capital is not a comma', D('6 1 346 6 12'), 'A + B', 'dot 6 then a letter');
  sign('ellipsis', D('3456 2 6 _ 3 3 3 6 _ 3456 23'), '\\ldots', 'three dots-3, as in "1, ..., 2"');
  sign('prime', D('6 1 3'), "A'", 'a bare dot 3');
  sign('double prime', D('6 1 3 3'), "A''", 'two of them');
  sign('all capitals', D('6 6 1245 124 12356 1234 23456'), 'GF', 'dots 6 twice capitalises the word');
  sign('element of', D('1346 _ 4 15 _ 13456'), '\\in', 'dots 4-15, from "72 in Z240"');
  sign('asterisk', D('6 14 4 3456'), '\\ast', 'dots 4-3456, from "C *"');
  sign('diagonal fraction line', D('3456 2 356 456 34 3456 26'), '/', 'dots 456-34, from "10/5 = 2"');
  sign('identity, spaced', D('1235 _ 456 123 _ 234'), '\\equiv', 'spaced dots 456-123, from "r = s (mod n)"');
  sign('square brackets', D('4 12356 1346 4 23456'), '\\left[', 'dots 4 with the parenthesis cells');
  sign('tilde, spaced', D('1346 _ 4 156 _ 13456'), '\\sim', 'dots 4-156, from "x ~ y"');
  sign('tilde, as a prefix', D('4 156 1234'), '\\sim', 'from "~p"');
  // the Fraktur letter the identity sign must not swallow: same cells, no spaces
  {
    const r = read(D('1 456 123 12'));
    ok('unspaced, the identity cells are NOT a relation (they are a Fraktur letter)',
       !String(r.latex).includes('\\equiv'), JSON.stringify(r.latex));
  }
}

// A RATCHET ON THE READER'S OWN CORPUS. These figures rose from 464/735 clean
// on 2 September as the signs above were added; they may rise again, and must
// never fall. bench.mjs reports the same numbers with MATHS_IMPL=v2.
// A FUNCTION NAME IS NOT A LETTER WITH A SUPERSCRIPT (2026-09-02, the audit).
// The contracted "sin" is the letter s followed by the "in" contraction - the
// same two cells as s with a superscript indicator - so "6 m s^-1" read as
// "6 m sin -1". Grade 1 suspends contractions, and that is the discriminator;
// it reaches exactly as far as its own indicator says, which is what "x sin 60"
// (a single indicator, two cells and a space earlier) proves.
console.log('UEB function names fire on functions, not on letters');
{
  const SP2 = String.fromCodePoint(0x2800);
  const D3 = (str) => str.split(/\s+/).filter(Boolean)
    .map((d) => (d === '_' ? SP2 : String.fromCodePoint(0x2800 + [...d].reduce((m, ch) => m | (1 << (Number(ch) - 1)), 0)))).join('');
  const readU = (cells) => { try { return uebMathsToLatexV2(cells).latex || ''; } catch (e) { return 'THREW ' + e.message; } };
  for (const [name, cells, want, why] of [
    ['s to the minus one', D3('3456 124 _ 56 134 _ 56 56 234 35 126 5 36 3456 1 345'), 's^{-1}', 'a grade-1 word indicator makes it a script'],
    ['x sin 60', D3('56 1346 _ 234 35 3456 124 245'), '\\sin', 'the single indicator belonged to the x, before the space'],
    ['a capitalised name is still the name', D3('6 234 35 3456 14 245'), '\\sin', '"Sin 30" was read as S to the 30'],
    ['Sec A', D3('6 234 15 14 _ 6 1'), '\\sec', 'the capital indicator sat in front of every table entry'],
  ]) ok(`${name} (${why})`, readU(cells).includes(want), `got ${JSON.stringify(readU(cells))}`);
}

console.log('the shipped readers, over their own corpora');
{
  const score = (cases, read) => {
    let clean = 0;
    for (const c of cases) {
      let r; try { r = read(c.braille); } catch { continue; }
      if ((r.latex || '').trim() && !(r.warnings || []).length) clean++;
    }
    return clean;
  };
  const nClean = score(nemeth, nemethMathsToLatexV2);
  const uClean = score(ueb, uebMathsToLatexV2);
  ok(`Nemeth reader: ${nClean}/${nemeth.length} rows read with no warning (floor 601)`, nClean >= 601, `${nClean} is below the floor`);
  ok(`UEB reader: ${uClean}/${ueb.length} rows read with no warning (floor 171)`, uClean >= 171, `${uClean} is below the floor`);
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
