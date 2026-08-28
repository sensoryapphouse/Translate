// Round-trip verification: does our reading REPRODUCE the braille it came from?
//
// The idea. Back-translation (braille -> maths) is ambiguous and hard. FORWARD
// translation (MathML -> braille) is solved, authoritative, and already vendored
// in this repo — MathCAT, the same implementation that produced the corpus. So
// take our answer, translate it forward again, and compare:
//
//     braille --(our parser)--> LaTeX --(Temml)--> MathML --(MathCAT)--> braille'
//
// If braille' == braille, our reading is CONSISTENT with the input. If it
// differs, our reading is provably wrong — it describes some other expression.
//
// Why this is worth more than the other measures:
//   • It needs NO ground truth. It works on any braille anyone types, not just
//     corpus cases with known MathML. That makes it usable at runtime, and it
//     makes an unlimited test set possible.
//   • It is decisive about STRUCTURE. Invert a fraction and the braille changes.
//
// What it is NOT. It measures INFORMATION PRESERVATION, not fitness for purpose.
// We deliberately discard typeform and grade-1 indicators — a teacher wants to
// read "25 km²", not a record of which indicators were used — so those cases
// fail the strict comparison while being exactly what we intend. The --loose
// figure ignores that class so the two can be told apart.
//
// WHAT "EQUALLY VALID" ACTUALLY MEANS — and what it does NOT mean.
//
// Where our reading differs structurally from the source but BOTH forward-
// translate to the same braille, the two are equally consistent with the input.
// It is tempting to call that ambiguity in the braille. It is not, and calling
// it that excuses real errors:
//
// Rendering all 59 such cases and comparing what a reader would SEE:
//     8   render identically
//    19   differ only in styling (CuSO4 upright vs italic)
//    27   differ by a glyph variant of the same thing (⇢ vs →, ˙ vs ·, ⋅ vs •)
//     5   are GENUINELY different — an equilibrium arrow drawn ⇌ instead of
//         ↽−−⇀, Lewis dots placed on the wrong side of CH3
//
// So 54 are presentation and 5 are defects. The braille itself is very nearly
// unambiguous: testing the classic suspected ambiguities, only f(x)
// (multiply vs apply) and °F vs the ℉ ligature are real, and print has the same
// ambiguity in both. Across 840 distinct braille strings in these corpora there
// is not one case where the same braille genuinely means two different things.
//
// Run:
//   node connector/tools/roundtrip.mjs            summary
//   node connector/tools/roundtrip.mjs --bugs     the provably-wrong list
//   node connector/tools/roundtrip.mjs --ambiguous  readings that are merely different

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourceTokens } from './lib/score.mjs';
import { loadTemml, compareStructure, toMathML } from './lib/structure.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert: nemethConvert } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));
const normLeaf = (t) => sourceTokens(`<mo>${t}</mo>`);

// Spacing carries no meaning for our purpose and MathCAT is stricter about it
// than a reader would be.
const strict = (s) => String(s).replace(/[⠀ ]/g, '');
// Additionally drop the indicators we discard ON PURPOSE, so that a deliberate
// design decision is not counted as an error.
const loose = (s) => strict(s)
  .replace(/⠰⠰⠰|⠰⠰/g, '')             // UEB grade-1 passage / word indicator
  .replace(/[⠘⠨⠸⠈][⠂⠆⠶⠄]/g, '')       // UEB typeform prefix + level
  .replace(/⠸⠰|⠨⠰|⠈⠰/g, '')           // Nemeth bold / double-struck / script
  .replace(/⠰/g, '');                  // remaining grade-1 / letter indicators

const CORPORA = [['UEB', 'ueb-mathcat.json'], ['Nemeth', 'nemeth-mathcat.json']];

const stats = {};
const bugs = [];
const ambiguous = [];
let sourceReproduced = 0, sourceTotal = 0;

for (const [code, file] of CORPORA) {
  const s = stats[code] = { n: 0, parsed: 0, strict: 0, loose: 0 };
  for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', file), 'utf8'))) {
    if (c.ignored) continue;
    s.n++;

    // Sanity: the vendored forward translator must agree with the corpus, or
    // every number below is meaningless.
    sourceTotal++;
    let srcBack = '';
    try { srcBack = mathcat.mathml_to_braille(c.mathml, code); } catch { /* counted as a miss */ }
    const srcOk = strict(srcBack) === strict(c.braille);
    if (srcOk) sourceReproduced++;

    const r = code === 'UEB' ? uebMathsToLatex(c.braille) : nemethConvert(c.braille);
    if (!(r.latex || '').trim() || (r.warnings || []).length) continue;
    s.parsed++;

    let ourXml, back = '';
    try { ourXml = toMathML(temml, r.latex); } catch { continue; }
    try { back = mathcat.mathml_to_braille(ourXml, code); } catch { /* empty */ }

    const okStrict = strict(back) === strict(c.braille);
    const okLoose = loose(back) === loose(c.braille);
    if (okStrict) s.strict++;
    if (okLoose) s.loose++;

    const st = compareStructure(c.mathml, ourXml, normLeaf);
    if (st.nSource === 0 || st.ok) continue;
    // Our structure differs from the source. Which kind of difference is it?
    if (okStrict && srcOk) ambiguous.push({ code, c, latex: r.latex });
    else if (!okLoose) bugs.push({ code, c, latex: r.latex, back });
  }
}

const pc = (a, b) => (b ? `${String(Math.round(a / b * 100)).padStart(3)}%` : '   —');

console.log('Round-trip verification — does our reading reproduce its own input?\n');
console.log(`  sanity: the vendored MathCAT reproduces the corpus braille from the`);
console.log(`  source MathML for ${sourceReproduced}/${sourceTotal} cases (${pc(sourceReproduced, sourceTotal).trim()}).\n`);
console.log('  code     parsed        reproduces input   ignoring presentation');
for (const [code, s] of Object.entries(stats)) {
  console.log(`  ${code.padEnd(7)} ${String(s.parsed).padStart(4)}/${String(s.n).padEnd(5)} ` +
              `${String(s.strict).padStart(5)} ${pc(s.strict, s.parsed)}        ` +
              `${String(s.loose).padStart(5)} ${pc(s.loose, s.parsed)}`);
}

console.log('\n  Where our structure differs from the source MathML:');
console.log(`    provably WRONG  (does not reproduce the braille) : ${bugs.length}`);
console.log(`    equally CONSISTENT (both readings give the same braille) : ${ambiguous.length}`);
console.log(`      — mostly presentation (styling, glyph variants); a few are`);
console.log(`        real defects. Not evidence that the braille is ambiguous.`);

if (process.argv.includes('--bugs')) {
  console.log('\n--- provably wrong ---');
  for (const b of bugs.slice(0, 40)) {
    console.log(`  ${b.code} ${b.c.suite}/${b.c.name}`);
    console.log(`    input  ${b.c.braille}`);
    console.log(`    ours   ${JSON.stringify(b.latex).slice(0, 80)}`);
    console.log(`    back   ${b.back}`);
  }
}
if (process.argv.includes('--ambiguous')) {
  console.log('\n--- merely different (both readings reproduce the braille) ---');
  for (const a of ambiguous.slice(0, 40)) {
    console.log(`  ${a.code} ${a.c.suite}/${a.c.name}`);
    console.log(`    input  ${a.c.braille}`);
    console.log(`    ours   ${JSON.stringify(a.latex).slice(0, 80)}`);
  }
}
