// How often would the app's amber "Unverified" note fire on a correctly-taught
// child's work? The curriculum sets stand in for the child: each expression is
// forward-brailled by MathCAT (what the child would type), read by our parser,
// and then pushed through the app's OWN verify path — verify.mjs's normalise,
// which is deliberately more lenient than the benchmark judges (grade-1 and
// typeform indicators dropped, Nemeth baseline ⠐ dropped).
//
// Every amber here is a FALSE positive by construction (the braille is the
// canonical spelling), so this run measures the nuisance rate, stage by stage.
//
// Run: node connector/tools/amber-rate.mjs [--show]

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { normalise } from '../verify.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';
// curriculum.mjs keeps its data private; lift it via a tiny re-parse
import fs from 'node:fs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert: nemeth } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));

// Reuse curriculum.mjs's own data: evaluate just its CURRICULUM/GENERATED
// definitions (everything before the argv handling) in a scratch scope.
const curSrc = fs.readFileSync(path.join(__dirname, 'curriculum.mjs'), 'utf8');
const dataEnd = curSrc.indexOf('const strip =');
const { CURRICULUM, GENERATED } = new Function(
  'fs', 'path', '__dirname',
  curSrc.slice(curSrc.indexOf('const CURRICULUM'), dataEnd) +
  '\nreturn { CURRICULUM, GENERATED };'
)(fs, path, __dirname);

const show = process.argv.includes('--show');

for (const code of ['UEB', 'Nemeth']) {
  console.log(`\n${code}`);
  console.log('  stage                          n   clean   ambers');
  let TN = 0, TC = 0, TA = 0;
  const stages = [...CURRICULUM, ['independent', GENERATED]];
  for (const [stage, exprs] of stages) {
    let n = 0, clean = 0, ambers = 0;
    for (const tex of exprs) {
      let mathml, braille;
      try { mathml = toMathML(temml, tex); } catch { continue; }
      try { braille = mathcat.mathml_to_braille(mathml, code); } catch { continue; }
      if (typeof braille !== 'string' || !/[⠀-⣿]/.test(braille) || /^ERROR/i.test(braille)) continue;
      n++;
      const r = code === 'UEB' ? uebMathsToLatex(braille) : nemeth(braille);
      if (!(r.latex || '').trim() || (r.warnings || []).length) continue;   // warned rows show warnings, not ambers
      clean++;
      let back = '';
      try { back = mathcat.mathml_to_braille(toMathML(temml, r.latex), code); } catch { /* */ }
      if (typeof back !== 'string' || !/[⠀-⣿]/.test(back)) continue;        // checked:false in the app
      const a = normalise(braille, code), b = normalise(back, code);
      if (a.text !== b.text) {
        ambers++;
        if (show) console.log(`    AMBER  ${tex.slice(0, 56)}\n           typed ${braille}\n           back  ${back}`);
      }
    }
    console.log(`  ${String(stage).padEnd(28)}${String(n).padStart(4)}   ${String(clean).padStart(4)}   ${String(ambers).padStart(4)}`);
    TN += n; TC += clean; TA += ambers;
  }
  console.log(`  ${'ALL'.padEnd(28)}${String(TN).padStart(4)}   ${String(TC).padStart(4)}   ${String(TA).padStart(4)}   (amber rate ${TC ? (TA / TC * 100).toFixed(1) : '—'}% of clean lines)`);
}
