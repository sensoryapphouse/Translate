// Coverage probe: how much real maths can Connector actually render?
//
//   MathML --(MathCAT)--> UEB / Nemeth braille --(our converters)--> LaTeX
//
// Prints a pass/fail table and writes the passing expressions into
// connector/examples/. Anything that fails is reported, NOT quietly shipped —
// the examples folder should only contain things that genuinely work.
//
// Run: node connector/tools/coverage.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import fs from 'node:fs';
import { scoreCorpus } from './lib/score.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const nemeth = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));

const M = (s) => `<math>${s}</math>`;
const n = (x) => `<mn>${x}</mn>`;
const i = (x) => `<mi>${x}</mi>`;
const o = (x) => `<mo>${x}</mo>`;
const row = (...x) => `<mrow>${x.join('')}</mrow>`;
const frac = (a, b) => `<mfrac>${a}${b}</mfrac>`;
const sup = (a, b) => `<msup>${a}${b}</msup>`;
const sub = (a, b) => `<msub>${a}${b}</msub>`;
const sqrt = (a) => `<msqrt>${a}</msqrt>`;
const root = (a, b) => `<mroot>${a}${b}</mroot>`;

const CASES = [
  // --- arithmetic & number ---
  ['sum of fractions',      M(frac(n(1), n(2)) + o('+') + frac(n(1), n(3)) + o('=') + frac(n(5), n(6))), String.raw`\frac{1}{2}+\frac{1}{3}=\frac{5}{6}`],
  ['long decimal',          M(n('12.75') + o('&#xD7;') + n('4') + o('=') + n('51')), String.raw`12.75\times4=51`],
  ['negative numbers',      M(o('&#x2212;') + n(7) + o('+') + n(3) + o('=') + o('&#x2212;') + n(4)), String.raw`-7+3=-4`],
  ['percentage',            M(n(15) + o('%') + o('&#xD7;') + n(200) + o('=') + n(30)), String.raw`15\%\times200=30`],
  ['order of operations',   M(n(2) + o('+') + n(3) + o('&#xD7;') + n(4) + o('=') + n(14)), String.raw`2+3\times4=14`],
  ['brackets',              M(n(2) + o('(') + i('x') + o('+') + n(3) + o(')') + o('=') + n(14)), String.raw`2(x+3)=14`],

  // --- algebra ---
  ['two-step equation',     M(n(3) + i('x') + o('+') + n(2) + o('=') + n(11)), String.raw`3x+2=11`],
  ['simultaneous',          M(n(3) + i('x') + o('+') + n(2) + i('y') + o('=') + n(12)), String.raw`3x+2y=12`],
  ['expand squares',        M(sup(row(o('(') + i('a') + o('+') + i('b') + o(')')), n(2))), String.raw`(a+b)^{2}`],
  ['difference of squares', M(sup(i('a'), n(2)) + o('&#x2212;') + sup(i('b'), n(2))), String.raw`a^{2}-b^{2}`],
  ['cubic',                 M(sup(i('x'), n(3)) + o('&#x2212;') + n(2) + sup(i('x'), n(2)) + o('+') + n(1)), String.raw`x^{3}-2x^{2}+1`],
  ['power of power',        M(sup(i('x'), row(n(2) + i('n')))), String.raw`x^{2n}`],
  ['negative index',        M(sup(i('x'), row(o('&#x2212;') + n(1)))), String.raw`x^{-1}`],
  ['fractional index',      M(sup(i('x'), frac(n(1), n(2)))), String.raw`x^{\frac{1}{2}}`],
  ['subscripted vars',      M(sub(i('x'), n(1)) + o('+') + sub(i('x'), n(2))), String.raw`x_{1}+x_{2}`],

  // --- roots ---
  ['pythagoras',            M(sup(i('a'), n(2)) + o('+') + sup(i('b'), n(2)) + o('=') + sup(i('c'), n(2))), String.raw`a^{2}+b^{2}=c^{2}`],
  ['root of expression',    M(sqrt(row(sup(i('a'), n(2)) + o('+') + sup(i('b'), n(2))))), String.raw`\sqrt{a^{2}+b^{2}}`],
  ['nested roots',          M(sqrt(row(n(1) + o('+') + sqrt(n(2))))), String.raw`\sqrt{1+\sqrt{2}}`],
  ['cube root',             M(root(n(27), n(3))), String.raw`\sqrt[3]{27}`],
  ['fourth root',           M(root(n(16), n(4))), String.raw`\sqrt[4]{16}`],

  // --- fractions ---
  ['fraction of sums',      M(frac(row(i('x') + o('+') + n(1)), row(i('x') + o('&#x2212;') + n(1)))), String.raw`\frac{x+1}{x-1}`],
  ['nested fraction',       M(frac(frac(n(1), n(2)), n(3))), String.raw`\frac{\frac{1}{2}}{3}`],
  ['algebraic fraction',    M(frac(row(n(3) + i('x') + o('+') + n(1)), n(2)) + o('=') + n(5)), String.raw`\frac{3x+1}{2}=5`],

  // --- comparisons ---
  ['inequality chain',      M(n(0) + o('&#x3C;') + i('x') + o('&#x2264;') + n(10)), String.raw`0<x\le10`],
  ['not equal',             M(i('x') + o('&#x2260;') + n(0)), String.raw`x\neq0`],

  // --- the big one ---
  ['quadratic formula',     M(i('x') + o('=') + frac(row(o('&#x2212;') + i('b') + o('&#xB1;') +
                              sqrt(row(sup(i('b'), n(2)) + o('&#x2212;') + n(4) + i('a') + i('c')))), row(n(2) + i('a')))), String.raw`x=\frac{-b\pm\sqrt{b^{2}-4ac}}{2a}`],

  // --- expected to be beyond the core subset (documented, not shipped) ---
  ['trig function',         M(i('sin') + o('(') + i('x') + o(')') + o('+') + i('cos') + o('(') + i('x') + o(')')), String.raw`\sin(x)+\cos(x)`],
  ['logarithm',             M(sub(i('log'), n(10)) + o('(') + n(100) + o(')') + o('=') + n(2)), String.raw`\log_{10}(100)=2`],
  ['summation',             M('<munderover><mo>&#x2211;</mo><mrow><mi>n</mi><mo>=</mo><mn>1</mn></mrow><mn>10</mn></munderover>' + i('n')), String.raw`\sum_{n=1}^{10}n`],
  ['integral',              M('<msubsup><mo>&#x222B;</mo><mn>0</mn><mn>1</mn></msubsup>' + sup(i('x'), n(2)) + i('dx')), String.raw`\int_{0}^{1}x^{2}dx`],
  ['matrix',                M('<mtable><mtr><mtd><mn>1</mn></mtd><mtd><mn>2</mn></mtd></mtr><mtr><mtd><mn>3</mn></mtd><mtd><mn>4</mn></mtd></mtr></mtable>'), String.raw`matrix`],
  ['absolute value',        M(o('|') + i('x') + o('|') + o('=') + n(5)), String.raw`|x|=5`],
  ['scientific notation',   M(n('6.02') + o('&#xD7;') + sup(n(10), n(23))), String.raw`6.02\times10^{23}`],
  ['pi r squared',          M(i('A') + o('=') + i('&#x3C0;') + sup(i('r'), n(2))), String.raw`A=\pi r^{2}`],
];

// "No warnings" is NOT the same as "correct" — the trig case emitted s^{(}x)
// silently. A case only counts as working if the LaTeX matches what the
// expression actually is, compared loosely (whitespace, \left\right, braces
// around single tokens).
const norm = (s) => String(s || '')
  .replace(/\\left|\\right/g, '')
  .replace(/\{([^{}])\}/g, '$1')
  .replace(/\s+/g, '')
  .replace(/\\times|\\cdot/g, '*')
  .replace(/−/g, '-');
const ok = (r, want) => !!(r && r.latex && !(r.warnings || []).length && norm(r.latex) === norm(want));

const results = [];
for (const [label, mathml, want] of CASES) {
  const ueb = mathcat.mathml_to_braille(mathml, 'UEB');
  const nem = mathcat.mathml_to_braille(mathml, 'Nemeth');
  let u, e;
  try { u = uebMathsToLatex(ueb); } catch (err) { u = { latex: '', warnings: [String(err)] }; }
  try { e = nemeth.convert(nem); } catch (err) { e = { latex: '', warnings: [String(err)] }; }
  results.push({ label, want, ueb, nem, u, e, uOK: ok(u, want), eOK: ok(e, want) });
}

const mark = (ok) => (ok ? '✅' : '❌');
console.log('expression'.padEnd(22), 'UEB', 'Nem', ' latex (UEB)');
console.log('-'.repeat(78));
for (const r of results) {
  console.log(r.label.padEnd(22), ' ' + mark(r.uOK), ' ' + mark(r.eOK),
    ' ' + (r.u.latex || '—').slice(0, 40));
  const w = [...(r.u.warnings || []).map((x) => 'UEB: ' + x), ...(r.e.warnings || []).map((x) => 'Nem: ' + x)];
  if (w.length) console.log(' '.repeat(24) + w.slice(0, 2).join(' | ').slice(0, 90));
}

const bothOK = results.filter((r) => r.uOK && r.eOK);
const partial = results.filter((r) => (r.uOK || r.eOK) && !(r.uOK && r.eOK));
const neither = results.filter((r) => !r.uOK && !r.eOK);
console.log('\n%d/%d work in BOTH codes, %d in one only, %d in neither',
  bothOK.length, results.length, partial.length, neither.length);

// COVERAGE.md IS THIS TOOL'S OUTPUT; THE EXAMPLES ARE NOT (2026-09-02).
// It also used to drop ueb-maths.brl and nemeth-maths.brl into examples/, two
// untracked files beside the .brf examples the app actually ships - so running
// the tool to refresh the document left litter that looked like an example.
// Pass --write-examples to get them back for a one-off comparison.
const dir = path.resolve(__dirname, '../examples');
fs.mkdirSync(dir, { recursive: true });
if (process.argv.includes('--write-examples')) {
  fs.writeFileSync(path.join(dir, 'ueb-maths.brl'),
    results.filter((r) => r.uOK).map((r) => r.ueb).join('\n') + '\n');
  fs.writeFileSync(path.join(dir, 'nemeth-maths.brl'),
    results.filter((r) => r.eOK).map((r) => r.nem).join('\n') + '\n');
  console.log('wrote examples: %d UEB lines, %d Nemeth lines',
    results.filter((r) => r.uOK).length, results.filter((r) => r.eOK).length);
}

fs.writeFileSync(path.join(dir, 'COVERAGE.md'),
  '# What Translate can render\n\n' +
  'Generated by `node Translate/tools/coverage.mjs`. Braille comes from MathCAT,\n' +
  'so these are authentic transcriptions; ✅ means our converter reproduced the\n' +
  'expression with no warnings.\n\n' +
  '| Expression | UEB | Nemeth |\n|---|:--:|:--:|\n' +
  results.map((r) => `| ${r.label} | ${mark(r.uOK)} | ${mark(r.eOK)} |`).join('\n') + '\n' +
  corpusSection('UEB', 'ueb-mathcat.json', uebMathsToLatex) +
  corpusSection('Nemeth', 'nemeth-mathcat.json', nemeth.convert));



// Both codes, measured the same way, from the same shared scorer. The table at
// the top of the document is a HAND-PICKED set and flatters us — it read 85%
// while authentic transcriptions scored 53% — so the real figures are computed
// here rather than typed in, and cannot drift.
function corpusSection(code, file, convert) {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', file), 'utf8'));
  const s = scoreCorpus(cases, convert);
  const p = (n) => `**${n}/${s.total} (${Math.round(n / s.total * 100)}%)**`;
  const bySuite = new Map();
  for (const r of s.scored) {
    const e = bySuite.get(r.suite) || { n: 0, clean: 0, faithful: 0 };
    e.n++; if (r.clean) e.clean++; if (r.f.ok) e.faithful++;
    bySuite.set(r.suite, e);
  }
  return `\n## ${code}, against MathCAT's own test suite\n\n` +
    `${s.total} authentic transcriptions` +
    (s.skipped ? ` (${s.skipped} more that MathCAT itself marks #[ignore], excluded)` : '') + '.\n\n' +
    `- parsed with no warnings: ${p(s.clean)}\n` +
    `- content matches the source MathML: ${p(s.faithful)}\n` +
    `- both: ${p(s.both)}\n\n` +
    '| suite | cases | clean | faithful |\n|---|--:|--:|--:|\n' +
    [...bySuite].sort((a, b) => (a[1].faithful / a[1].n) - (b[1].faithful / b[1].n))
      .map(([k, e]) => `| ${k} | ${e.n} | ${Math.round(e.clean / e.n * 100)}% | ${Math.round(e.faithful / e.n * 100)}% |`)
      .join('\n') + '\n';
}
