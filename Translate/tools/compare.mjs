// Run BOTH UEB parsers over everything, side by side.
//
// The question is whether a rule-registry design, written from the standard,
// beats the one that grew from test failures — and the honest way to settle that
// is to run them on identical input and count, not to argue about architecture.
//
//   v1  connector/ueb-maths-to-latex.mjs   single pass, emits LaTeX text,
//                                          precedence = statement order
//   v2  connector/ueb-rules.mjs            ordered rule registry, builds a tree,
//                                          every rule tagged with its GTM section
//
// Judged the same three ways as everything else, plus a direct head-to-head:
//   readable    parsed with no warnings
//   consistent  forward-translates back to the SAME braille (the decisive one —
//               no ground truth needed, and a wrong structure cannot survive it)
//   faithful    content matches the source
//
// Run: node connector/tools/compare.mjs [--diffs] [--only <corpus>]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourceTokens, faithfulness, latexTokens } from './lib/score.mjs';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { uebMathsToLatex as v1 } from '../ueb-maths-to-latex.mjs';
import { uebMathsToLatexV2 as v2 } from '../ueb-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));
const strip = (s) => String(s).replace(/[⠀ ]/g, '');

// --- the corpora -----------------------------------------------------------
function corpusAuthentic() {
  const cs = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', 'ueb-mathcat.json'), 'utf8'));
  return cs.filter((c) => !c.ignored).map((c) => ({ braille: c.braille, mathml: c.mathml, name: `${c.suite}/${c.name}` }));
}
function corpusFromLatex(file) {
  let list = [];
  try { list = JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', file), 'utf8')); } catch { return []; }
  const out = [];
  for (const tex of list) {
    let mathml, braille;
    try { mathml = toMathML(temml, tex); } catch { continue; }
    try { braille = mathcat.mathml_to_braille(mathml, 'UEB'); } catch { continue; }
    if (typeof braille !== 'string' || !/[⠀-⣿]/.test(braille) || /^ERROR/i.test(braille)) continue;
    out.push({ braille, mathml, name: tex.slice(0, 40) });
  }
  return out;
}

const CORPORA = [
  ['authentic (MathCAT UEB tests)', corpusAuthentic()],
  ['independent school set', corpusFromLatex('curriculum-generated.json')],
];

// --- scoring ---------------------------------------------------------------
function score(cases, parse) {
  let readable = 0, consistent = 0, faithful = 0;
  const detail = [];
  for (const c of cases) {
    let r;
    try { r = parse(c.braille); } catch (e) { r = { latex: '', warnings: ['threw: ' + e.message] }; }
    const clean = !!(r.latex || '').trim() && !(r.warnings || []).length;
    let cons = false, faith = false;
    if (clean) {
      readable++;
      let back = '';
      try { back = mathcat.mathml_to_braille(toMathML(temml, r.latex), 'UEB'); } catch { /* */ }
      cons = typeof back === 'string' && strip(back) === strip(c.braille);
      if (cons) consistent++;
      try { faith = faithfulness(sourceTokens(c.mathml), latexTokens(r.latex)).ok; } catch { /* */ }
      if (faith) faithful++;
    }
    detail.push({ name: c.name, braille: c.braille, latex: r.latex, warn: (r.warnings || [])[0], clean, cons, faith });
  }
  return { n: cases.length, readable, consistent, faithful, detail };
}

const pc = (a, b) => (b ? `${String(Math.round(a / b * 100)).padStart(3)}%` : '   —');
const only = (() => { const k = process.argv.indexOf('--only'); return k >= 0 ? process.argv[k + 1] : null; })();

console.log('UEB: the grown parser (v1) against the rule-registry parser (v2)\n');
const allDiffs = [];

for (const [label, cases] of CORPORA) {
  if (!cases.length) continue;
  if (only && !label.includes(only)) continue;
  const a = score(cases, v1);
  const b = score(cases, v2);
  console.log(`${label} — ${cases.length} cases`);
  console.log('                   readable  consistent  faithful');
  console.log(`  v1  grown         ${pc(a.readable, a.n)}      ${pc(a.consistent, a.n)}     ${pc(a.faithful, a.n)}`);
  console.log(`  v2  from rules    ${pc(b.readable, b.n)}      ${pc(b.consistent, b.n)}     ${pc(b.faithful, b.n)}`);

  // head to head, which is what actually decides it
  let v2Better = 0, v1Better = 0, same = 0;
  for (let k = 0; k < cases.length; k++) {
    const x = a.detail[k], y = b.detail[k];
    const sx = (x.clean ? 1 : 0) + (x.cons ? 2 : 0), sy = (y.clean ? 1 : 0) + (y.cons ? 2 : 0);
    if (sy > sx) { v2Better++; allDiffs.push({ label, win: 'v2', ...x, v2latex: y.latex, v2warn: y.warn }); }
    else if (sx > sy) { v1Better++; allDiffs.push({ label, win: 'v1', ...x, v2latex: y.latex, v2warn: y.warn }); }
    else same++;
  }
  console.log(`  head to head: v2 better on ${v2Better}, v1 better on ${v1Better}, no difference on ${same}\n`);
}

if (process.argv.includes('--diffs')) {
  for (const w of ['v1', 'v2']) {
    const list = allDiffs.filter((d) => d.win === w);
    if (!list.length) continue;
    console.log(`--- ${list.length} cases where ${w.toUpperCase()} is better ---`);
    for (const d of list.slice(0, 25)) {
      console.log(`  ${d.name}`);
      console.log(`    ${d.braille.slice(0, 56)}`);
      console.log(`    v1 ${JSON.stringify(d.latex).slice(0, 62)}${d.warn ? '  ⚠' : ''}`);
      console.log(`    v2 ${JSON.stringify(d.v2latex).slice(0, 62)}${d.v2warn ? '  ⚠' : ''}`);
    }
    console.log('');
  }
}
