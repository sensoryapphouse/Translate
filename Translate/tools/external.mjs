// EXTERNAL benchmark — equations we did NOT develop against.
//
// The curriculum and independent sets were written during development; even
// with discipline, sets you can see while fixing bugs stop being external.
// This runner scores JSON files in tools/external/ whose selections come from
// OUTSIDE the repo (published formula sheets, past papers), added only after
// the fact and never edited to make a failure pass.
//
// The loop and the three judgements are IDENTICAL to curriculum.mjs, so the
// numbers are directly comparable:
//   readable    parsed with no warnings
//   consistent  our reading forward-translates back to the SAME braille
//   faithful    token content matches the original expression
//
// The braille is still MathCAT's — this measures robustness to new MATHS, not
// to new transcribers. Independently transcribed braille is the stronger test
// and goes through the app's BRF Load, not this tool.
//
// Run: node connector/tools/external.mjs [--failures] [--code UEB|Nemeth]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourceTokens, faithfulness, latexTokens } from './lib/score.mjs';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert: nemeth } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));

const strip = (s) => String(s).replace(/[⠀ ]/g, '');
const only = (() => { const i = process.argv.indexOf('--code'); return i >= 0 ? process.argv[i + 1] : null; })();
const CODES = only ? [only] : ['UEB', 'Nemeth'];

const dir = path.join(__dirname, 'external');
const files = fs.readdirSync(dir).filter((f) => f.endsWith('.json'));
const failures = [];

console.log('External benchmark — sources selected after development, never tuned against\n');

for (const code of CODES) {
  console.log(`${'='.repeat(70)}\n${code}\n${'='.repeat(70)}`);
  console.log('  source                            n   readable  consistent  faithful');
  let TN = 0, TR = 0, TC = 0, TF = 0;
  for (const file of files) {
    const doc = JSON.parse(fs.readFileSync(path.join(dir, file), 'utf8'));
    for (const src of doc.sources) {
      let n = 0, readable = 0, consistent = 0, faithful = 0;
      for (const tex of src.items) {
        let mathml, braille;
        try { mathml = toMathML(temml, tex); } catch { continue; }
        try { braille = mathcat.mathml_to_braille(mathml, code); } catch { continue; }
        if (typeof braille !== 'string' || !/[⠀-⣿]/.test(braille) || /^ERROR/i.test(braille)) continue;
        n++;
        const r = code === 'UEB' ? uebMathsToLatex(braille) : nemeth(braille);
        const clean = !!(r.latex || '').trim() && !(r.warnings || []).length;
        if (!clean) {
          failures.push({ code, src: src.name, tex, braille, got: r.latex, why: (r.warnings || [])[0] || 'no output' });
          continue;
        }
        readable++;
        let back = '';
        try { back = mathcat.mathml_to_braille(toMathML(temml, r.latex), code); } catch { /* */ }
        const isConsistent = typeof back === 'string' && strip(back) === strip(braille);
        if (isConsistent) consistent++;
        else failures.push({ code, src: src.name, tex, braille, got: r.latex, why: 'reads as something else' });
        if (faithfulness(sourceTokens(mathml), latexTokens(r.latex)).ok) faithful++;
      }
      const p = (a) => (n ? String(Math.round(a / n * 100)).padStart(3) + '%' : '   —');
      console.log(`  ${src.name.padEnd(33)}${String(n).padStart(2)}     ${p(readable)}      ${p(consistent)}     ${p(faithful)}`);
      TN += n; TR += readable; TC += consistent; TF += faithful;
    }
  }
  const P = (a) => (TN ? String(Math.round(a / TN * 100)).padStart(3) + '%' : '   —');
  console.log(`  ${'ALL'.padEnd(33)}${String(TN).padStart(2)}     ${P(TR)}      ${P(TC)}     ${P(TF)}\n`);
}

if (process.argv.includes('--failures')) {
  for (const f of failures) {
    console.log(`\n  ${f.code} · ${f.src}`);
    console.log(`    wanted  ${f.tex}`);
    console.log(`    braille ${f.braille}`);
    console.log(`    got     ${JSON.stringify(f.got)}`);
    console.log(`    why     ${f.why}`);
  }
  if (!failures.length) console.log('\n  (no failures)');
}
