// PROBE: "what was the child trying to write?"
//
// The teaching value of this app is not only showing what the braille says —
// it is telling a sighted adult, who may not read braille, what the child
// probably MEANT when it comes out wrong.
//
// That is now tractable because we can translate FORWARD. For any candidate
// expression we can compute the braille it would have to be written as. So
// diagnosing a slip becomes a search: perturb what was typed, and keep the
// repairs that both parse cleanly AND reproduce themselves under forward
// translation. At roughly 0.5 ms a candidate we can afford thousands.
//
// This probe measures whether that actually works, using SIMULATED slips —
// we have no real learner data, so we take braille we already read correctly
// and break it the way a learner does (dropping a closing indicator, the
// numeric indicator, a grade-1 indicator).
//
// It reports three different things, which must not be confused:
//   noticed   — we can tell something is wrong. This is the honest minimum and
//               is worth having on its own: "this line does not look right".
//   in top 3  — the correct expression is among our suggestions.
//   first     — the correct expression is our best suggestion.
//
// Run: node connector/tools/repair-probe.mjs [--examples]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadTemml } from './lib/structure.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));

const strip = (s) => String(s).replace(/[⠀ ]/g, '');
const parse = (b, code) => (code === 'UEB' ? uebMathsToLatex(b) : convert(b));

// A reading is CONSISTENT if it parses without complaint and forward-translates
// back to the very braille it came from. That is the whole oracle.
function consistent(b, code) {
  const r = parse(b, code);
  if (!(r.latex || '').trim() || (r.warnings || []).length) return null;
  let x, back = '';
  try { x = temml.renderToString(r.latex); } catch { return null; }
  try { back = mathcat.mathml_to_braille(x, code); } catch { return null; }
  return strip(back) === strip(b) ? r.latex : null;
}

// The cells a learner most often drops: closers and mode indicators.
const REPAIR_CELLS = ['⠻', '⠾', '⠜', '⠼', '⠰', '⠐', '⠣', '⠹', '⠌', '⠘', '⠢', '⠔', '⠠'];

// Single-edit repair search. Deliberately tiny: one inserted or one removed
// cell. Bigger edits would find more but would also start inventing.
export function suggest(typed, code, limit = 3) {
  const cells = [...typed];
  const found = [];
  const seen = new Set();
  const tryIt = (cand, how) => {
    if (seen.has(cand) || cand === typed) return;
    seen.add(cand);
    const latex = consistent(cand, code);
    if (latex) found.push({ braille: cand, latex, how });
  };
  for (let i = 0; i <= cells.length; i++) {
    for (const c of REPAIR_CELLS) {
      tryIt([...cells.slice(0, i), c, ...cells.slice(i)].join(''), `add ${c} at cell ${i + 1}`);
    }
  }
  for (let i = 0; i < cells.length; i++) {
    tryIt([...cells.slice(0, i), ...cells.slice(i + 1)].join(''), `remove ${cells[i]} at cell ${i + 1}`);
  }
  return found.slice(0, limit);
}

const SLIPS = [
  ['drops a closing indicator', (c) => {
    for (let i = c.length - 1; i >= 0; i--) if ('⠻⠾⠜⠼'.includes(c[i])) return [...c.slice(0, i), ...c.slice(i + 1)];
    return null;
  }],
  ['drops the numeric indicator', (c) => {
    const i = c.indexOf('⠼'); return i < 0 ? null : [...c.slice(0, i), ...c.slice(i + 1)];
  }],
  ['drops a grade-1 indicator', (c) => {
    const i = c.indexOf('⠰'); return i < 0 ? null : [...c.slice(0, i), ...c.slice(i + 1)];
  }],
];

const LIMIT = 300;
let tried = 0, noticed = 0, inTop3 = 0, first = 0, slipWasValid = 0;
const examples = [];

outer:
for (const [code, f] of [['UEB', 'ueb-mathcat.json'], ['Nemeth', 'nemeth-mathcat.json']]) {
  for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', f), 'utf8'))) {
    if (c.ignored) continue;
    // Start from every line we can READ. An earlier version started only from
    // lines that already round-trip, which made the "noticed" figure 100% by
    // construction — the measurement flattered itself.
    const base = parse(c.braille, code);
    if (!(base.latex || '').trim() || (base.warnings || []).length) continue;
    for (const [slipName, slip] of SLIPS) {
      const broken = slip([...c.braille]);
      if (!broken || !broken.length) continue;
      const typed = broken.join('');
      if (typed === c.braille) continue;
      tried++;

      const r = parse(typed, code);
      const warned = (r.warnings || []).length > 0;
      if (!warned) { slipWasValid++; continue; }   // parser read it — no trigger, no advice
      noticed++;

      const s = suggest(typed, code, 3);
      const hit = s.findIndex((x) => strip(x.braille) === strip(c.braille));
      if (hit >= 0) inTop3++;
      if (hit === 0) first++;
      if (examples.length < 6 && hit === 0) {
        examples.push({ code, name: `${c.suite}/${c.name}`, slipName, typed, want: c.braille, s: s[0] });
      }
      if (tried >= LIMIT) break outer;
    }
  }
}

// Two denominators, and the difference matters. A third of these slips turn one
// valid expression into a DIFFERENT valid expression — dropping the numeric
// indicator turns "6" into the letter "f", which is perfectly good braille that
// simply means something else. Nothing can flag those, and counting them as
// misses would understate what is achievable.
// The product only offers advice where the PARSER COMPLAINED. That trigger
// cannot raise a false alarm — we speak only where we already admitted failure
// — but it is narrow, and the narrowness is the honest headline: most
// single-indicator slips simply produce OTHER VALID MATHS. Drop the numeric
// indicator and "6" becomes the letter "f". Nothing detects that from braille.
const all = (n) => `${String(Math.round(n / tried * 100)).padStart(3)}%`;
const trig = (n) => (noticed ? `${String(Math.round(n / noticed * 100)).padStart(3)}%` : '   —');
console.log(`Simulated learner slips applied to lines we read: ${tried}\n`);
console.log(`  produced OTHER VALID MATHS — undetectable      ${String(slipWasValid).padStart(5)}   ${all(slipWasValid)}`);
console.log(`  made the parser complain  — we can advise      ${String(noticed).padStart(5)}   ${all(noticed)}\n`);
console.log(`  of those ${noticed} advisable lines:                count    of them`);
console.log(`    correct answer among the suggestions       ${String(inTop3).padStart(5)}    ${trig(inTop3)}`);
console.log(`    correct answer was the FIRST suggestion    ${String(first).padStart(5)}    ${trig(first)}`);

if (process.argv.includes('--examples')) {
  console.log('\n--- what the teacher would be shown ---');
  for (const e of examples) {
    console.log(`\n  ${e.code} ${e.name} — child ${e.slipName}`);
    console.log(`    typed      ${e.typed}`);
    console.log(`    suggestion ${e.s.how}  ->  ${e.s.braille}`);
    console.log(`    which reads as  ${e.s.latex}`);
  }
}
