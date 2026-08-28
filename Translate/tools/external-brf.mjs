// TIER-2b — braille-only corpora from published transcriber-training courses.
//
// The NFB "Introduction to Braille Mathematics Using UEB with Nemeth" lessons
// carry their braille as SimBraille (BRF ASCII) in the PDF text layer. The
// print side of each example is often an image, so unlike the APH pairs there
// is no print ground truth — the judges are therefore:
//   readable    our parser reads the segment with no warnings
//   consistent  our reading forward-brailles (MathCAT) back to the same cells
// "consistent" is the load-bearing one: a wrong structure cannot survive it.
// It DOES lean on MathCAT's dialect, so hand-written spellings MathCAT would
// braille differently count as inconsistent even when our reading is right —
// the number is a floor, not a ceiling.
//
// Items: external/cache/nfb_items.json (git-ignored - and see external-braille.mjs:
// the rule named the OLD directory, so this was tracked until 2026-08-28; harvested from the lesson
// PDFs at nfb.org — see PLAN movement log 2026-07-23 for the fetch recipe).
//
// Run: node connector/tools/external-brf.mjs [--failures] [--causes]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { brfToUnicodeBraille } from '../../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert: nemeth } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));

const limitIx = process.argv.indexOf('--limit');
const LIMIT = limitIx >= 0 ? Number(process.argv[limitIx + 1]) : Infinity;
const CACHE = path.join(__dirname, 'external', 'cache');
const items = [
  ...JSON.parse(fs.readFileSync(path.join(CACHE, 'nfb_items.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(CACHE, 'bana_items.json'), 'utf8')),
].slice(0, LIMIT);
const strip = (s) => String(s).replace(/[⠀ ]/g, '');

const byDoc = new Map();
for (const it of items) {
  const corpus = it.doc.includes('/') ? it.doc.split('/')[0] : it.doc.replace(/\d+$/, '');
  if (!byDoc.has(corpus)) byDoc.set(corpus, []);
  byDoc.get(corpus).push(it);
}

console.log('NFB lesson corpus — Nemeth segments from the transcriber course\n');
console.log('  document          n   readable  consistent');
const failures = [];
let TN = 0, TR = 0, TC = 0, displays = 0, prose = 0, spatial = 0, lists = 0;
for (const [doc, list] of byDoc.entries()) {
  let n = 0, readable = 0, consistent = 0;
  for (const it of list) {
    const brl = brfToUnicodeBraille(it.brf.toUpperCase()).replace(/⠀+/g, '⠀').trim();
    if (!/[⠁-⣿]/.test(brl)) continue;
    // the code books display individual SYMBOLS between switches — one or two
    // cells is an indicator being exhibited, not an expression to judge
    if ([...brl.replace(/⠀/gu, '')].length <= 2) { displays++; continue; }
    // SPATIAL LAYOUTS: separator rules (runs of ⠒ or ⠶) mark worked columns,
    // tables and long division — the parked spatial territory, not linear
    // expressions. EXERCISE LISTS: two or more ⠼N⠸⠲ item markers in one
    // segment are a numbered list, not one expression.
    if (/⠒{5,}|⠶{5,}/u.test(brl)) { spatial++; continue; }
    // drawn fraction rule-lines (⠹⠒⠒…⠼) and free-hanging ⠸ bond strokes are
    // flattened 2-D structures — spatial territory
    if (/⠹⠒⠒+⠼/u.test(brl) || /⠀⠸⠀/u.test(brl)) { spatial++; continue; }
    // orbital-box diagrams (spin pairs ⠣⠩ / boxes), long division frames
    // (divisor⠕dividend…⠪quotient), and dotted matrix displays
    if ((brl.match(/⠣⠩|⠣⠿|⠣⠨⠅/gu) || []).length >= 2) { spatial++; continue; }
    if (/⠕[⠼⠁-⠚⠠⠂⠄]+⠪/u.test(brl)) { spatial++; continue; }
    if (/^(⠩|⠣)[⠁-⠽]/u.test(brl)) { spatial++; continue; }          // modifier fragment: under/over content ran over
    if (/ \/\* | \*\/ /.test(brl) || /⠌⠡/u.test(brl)) { spatial++; continue; }
    if ((brl.match(/⠈⠠⠷|⠄⠄⠄/gu) || []).length >= 2 && /⠈⠠⠷/u.test(brl)) { spatial++; continue; }
    if ((brl.match(/⠼[⠂⠆⠒⠲⠢⠖⠶⠦⠔⠴]{1,3}⠸⠲/gu) || []).length >= 2 ||
        (brl.match(/⠼[⠂⠆⠒⠲⠢⠖⠶⠦⠔⠴]{1,3}⠾/gu) || []).length >= 2) { lists++; continue; }
    // PROSE-MIXED lines: the books interleave sentences with maths ("12x−4 =
    // 12x−4 ,'ALL TRUE"), and ⠠⠄ marks a switch back to prose mid-line. The
    // app's text mode owns words; these lines cannot round-trip as one
    // expression. Counted apart, like the APH word problems.
    {
      const words2 = (brl.match(/⠠[⠁-⠽]{4,}/gu) || []).length;
      if (brl.includes('⠠⠄') || words2 >= 2) { prose++; continue; }
    }
    // symbol-INVENTORY lines (typeface alphabets, arrow tables): many short
    // space-separated groups, most opening with a prefix cell — lists being
    // exhibited, not expressions
    {
      const groups = brl.split('⠀').filter(Boolean);
      const PREF = new Set(['⠸', '⠨', '⠈', '⠐', '⠠', '⠰', '⠫', '⠘']);
      const shortPref = groups.filter((g) => [...g].length <= 4 && PREF.has([...g][0]));
      if (groups.length >= 4 && shortPref.length / groups.length >= 0.6) { displays++; continue; }
      // an exercise token: a lone ⠫-led shape/arrow (fill-in-the-blank
      // inventory) with at most a couple of companions
      if (groups.length <= 4 && [...(groups[0] || '')][0] === '⠫') { displays++; continue; }
    }
    n++;
    if (process.env.TRACE) console.error('item', TN + n, JSON.stringify(it.brf.slice(0, 40)));
    let r;
    try { r = nemeth(brl); } catch (e) { r = { latex: '', warnings: ['threw: ' + e.message] }; }
    const clean = !!(r.latex || '').trim() && !(r.warnings || []).length;
    if (clean) readable++;
    let ok = false;
    if (clean) {
      try {
        const back = mathcat.mathml_to_braille(toMathML(temml, r.latex), 'Nemeth');
        ok = typeof back === 'string' && strip(back) === strip(brl);
      } catch { /* */ }
    }
    if (ok) consistent++;
    else failures.push({ doc, brf: it.brf, brl, got: r.latex, why: clean ? 'round-trips differently' : ((r.warnings || [])[0] || 'no output') });
  }
  const pc = (a) => (n ? String(Math.round(a / n * 100)).padStart(3) + '%' : '  —');
  console.log(`  ${doc.padEnd(16)}${String(n).padStart(3)}     ${pc(readable)}      ${pc(consistent)}`);
  TN += n; TR += readable; TC += consistent;
}
console.log(`  ${'ALL'.padEnd(16)}${String(TN).padStart(3)}     ${Math.round(TR / TN * 100)}%      ${Math.round(TC / TN * 100)}%   (+${displays} displays, ${prose} prose-mixed, ${spatial} spatial layouts, ${lists} numbered lists not judged)`);

if (process.argv.includes('--causes')) {
  const tally = {};
  for (const f of failures) {
    const key = f.why.replace(/at cell \d+/, 'at cell N').slice(0, 70);
    tally[key] = (tally[key] || 0) + 1;
  }
  console.log('\nfailure causes:');
  for (const [k, v] of Object.entries(tally).sort((a, b) => b[1] - a[1]).slice(0, 20))
    console.log('  ' + String(v).padStart(4) + '  ' + k);
}
if (process.argv.includes('--failures')) {
  for (const f of failures.slice(0, Number(process.env.MAXFAILS || 40))) {
    console.log(`\n  ${f.doc}`);
    console.log(`    brf ${f.brf}`);
    console.log(`    brl ${f.brl}`);
    console.log(`    got ${JSON.stringify(f.got)}`);
    console.log(`    why ${f.why}`);
  }
}
