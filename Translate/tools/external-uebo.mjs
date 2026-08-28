// TIER-2c — the UEB Online training-manual pairs, recovered by dot-OCR.
//
// Each pair is (print text line, braille line) from the NextSense manuals —
// braille printed as images, decoded by our lattice OCR (see PLAN 2026-07-23).
// The print is plain TEXT ("0.5", "4 - 2 = 2", "Read parts I, II and V."), not
// MathML, so both sides go through latexTokens and compare as token multisets.
//
//   maths pairs     print looks symbolic → judged readable + faithful-to-print
//   literary pairs  print is prose (the app's liblouis text mode owns these) —
//                   counted, not judged here
//   OCR risk        a failing pair may be an OCR miss, not a parser miss; the
//                   failure list shows the decoded cells so an eye can rule
//
// Run: node connector/tools/external-uebo.mjs [--failures]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { faithfulness, latexTokens } from './lib/score.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';
import { brfToUnicodeBraille } from '../../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const pairs = JSON.parse(fs.readFileSync(path.join(__dirname, 'external', 'cache', 'uebo_pairs.json'), 'utf8'));

const MATHY = /[0-9]|[+\-=×÷<>%$°√]|\^|\//;
const words = (t) => (t.match(/[A-Za-z]{3,}/g) || []);

const norm = (t) => t
  .replace(/[−–]/g, '-').replace(/×/g, ' \\times ').replace(/÷/g, ' \\div ')
  .replace(/°/g, '^{\\circ}').replace(/’/g, "'").replace(/\s+/g, ' ').trim();

let n = 0, readable = 0, faithful = 0, literary = 0, empty = 0, ocrN = 0, ocrExact = 0;
const failures = [];
const byDoc = new Map();
for (const p of pairs) {
  const doc = p.doc.split('/')[0];
  if (!byDoc.has(doc)) byDoc.set(doc, { n: 0, r: 0, f: 0, lit: 0 });
  const d = byDoc.get(doc);
  let print = (p.print || '').trim();
  if (!print) { empty++; continue; }
  // the OCR picks up exercise-number bullets as stray leading ⠂ cells
  const braille = p.braille.replace(/^(?:⠂⠀*)+/u, '').replace(/⠀+$/u, '');
  // junk pairs the OCR/pairing can produce: table-of-contents dot leaders
  // (decoded as runs of lower cells), and bands of fewer than two real cells
  const lowerOnly = [...braille.replace(/⠀/gu, '')].every((c) => !((c.codePointAt(0) - 0x2800) & 0b001001));
  if (/\.{4,}/.test(print) || lowerOnly || [...braille.replace(/⠀/gu, '')].length < 2) {
    empty++; continue;
  }
  // the Extension manual's "print" column is often the braille itself in BRF
  // ASCII notation (it teaches transcription). Those rows cannot judge the
  // parser — but they VALIDATE the OCR: decode the ASCII, compare cells.
  {
    const asBrf = brfToUnicodeBraille(print.toUpperCase()).replace(/\s+/gu, '⠀');
    const ours = braille.replace(/\s+/gu, '⠀');
    if (/[⠁-⣿]/.test(asBrf)) {
      const a = [...asBrf.replace(/⠀/gu, '')], b = [...ours.replace(/⠀/gu, '')];
      const overlap = a.filter((c, i2) => b[i2] === c).length;
      if (a.length >= 2 && overlap / Math.max(a.length, b.length) >= 0.8) {
        ocrN++; if (a.join('') === b.join('')) ocrExact++;
        continue;
      }
    }
  }
  const w = words(print);
  if (w.length >= 2 || !MATHY.test(print)) { literary++; d.lit++; continue; }
  // symbol-display rows: "= equals", "+ plus (dot 5…)" — judge the symbol only
  if (w.length === 1 && /^[^A-Za-z\s]/.test(print)) print = print.split(/\s+/)[0];
  n++; d.n++;
  let r;
  try { r = uebMathsToLatex(braille); }
  catch (e) { r = { latex: '', warnings: ['threw: ' + e.message] }; }
  const clean = !!(r.latex || '').trim() && !(r.warnings || []).length;
  if (clean) { readable++; d.r++; }
  const ok = clean && faithfulness(latexTokens(norm(print)), latexTokens(r.latex)).ok;
  if (ok) { faithful++; d.f++; }
  else failures.push({ doc: p.doc, print, braille, got: r.latex,
                       why: clean ? 'differs from print' : ((r.warnings || [])[0] || 'no output') });
}

console.log('UEB Online manual pairs (dot-OCR) — print-truth judge\n');
console.log('  manual        maths-n  readable  faithful   (prose pairs)');
for (const [doc, d] of byDoc) {
  const pc = (a) => (d.n ? String(Math.round(a / d.n * 100)).padStart(3) + '%' : '  —');
  console.log(`  ${doc.padEnd(14)}${String(d.n).padStart(4)}     ${pc(d.r)}      ${pc(d.f)}        (${d.lit})`);
}
console.log(`  ${'ALL'.padEnd(14)}${String(n).padStart(4)}     ${Math.round(readable / n * 100)}%      ${Math.round(faithful / n * 100)}%        (${literary} prose, ${empty} junk/unpaired)`);
if (ocrN) console.log(`  OCR validation rows (print IS ascii braille): ${ocrN}, cell-exact ${Math.round(ocrExact / ocrN * 100)}%`);

if (process.argv.includes('--failures')) {
  for (const f of failures.slice(0, Number(process.env.MAXFAILS || 60))) {
    console.log(`\n  ${f.doc}`);
    console.log(`    print   ${f.print}`);
    console.log(`    braille ${f.braille}`);
    console.log(`    got     ${JSON.stringify(f.got)}`);
    console.log(`    why     ${f.why}`);
  }
}
