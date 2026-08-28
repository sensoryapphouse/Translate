// THE ACCEPTANCE CORPUS — real UK exam papers in braille, as a blind
// candidate receives them: SQA's publicly published .dxb braille papers
// (National 5 / Higher Mathematics, Applications, Physics, Chemistry), with
// SQA's own "Print Copy of Braille" PDFs alongside for eye-checks.
//
// These are professionally transcribed UK exam papers — the nearest public
// stand-in for the RNIB acceptance test. Lines are extracted from the DXB
// (ASCII braille between Duxbury style tokens; recipe in PLAN 2026-07-24).
//
// A paper mixes prose instructions with maths. Prose belongs to the app's
// liblouis text mode and is counted, not judged. For each MATHS line:
//   readable      parses with no warnings
//   quiet         the app's live verifier would stay SILENT (round-trip
//                 matches under verify.mjs's normalise) — i.e. the teacher
//                 sees maths with no amber
// "quiet" is the number that matters: it is what the teacher experiences.
//
// Run: node connector/tools/external-sqa.mjs [--show]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { normalise } from '../verify.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';
import { brfToUnicodeBraille } from '../../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));

const CACHE2 = path.join(__dirname, 'external', 'cache');
const lines = [
  ...JSON.parse(fs.readFileSync(path.join(CACHE2, 'sqa_lines.json'), 'utf8')),
  // UKAAF's published UEB samples (simple maths + the quadratic-formula
  // derivation); their old-UK-Maths-Code comparison section is a different
  // code and is excluded upstream at harvest (mode: 'uk-old').
  ...JSON.parse(fs.readFileSync(path.join(CACHE2, 'ukaaf_lines.json'), 'utf8')).filter((l) => l.mode !== 'uk-old'),
];
const show = process.argv.includes('--show');

// prose vs maths, judged on the ASCII braille: a maths line carries the
// numeric indicator or a two-cell operator, and is not dominated by words
// grade-2 words contract hard, so word runs are short — classify per TOKEN:
// a token is maths-ish if it is built of numeric/operator material; a line is
// a maths line when most tokens are maths-ish and a numeric indicator appears
const mathsToken = (t) => /^[#"0-9a-z()+=*.,:;<>%^_'\/;-]+$/i.test(t) && /#|"[678]|9#|\.\/|\^|;'/.test(t);
const isMathsLine = (brf) => {
  const toks = brf.split(/\s+/).filter(Boolean);
  if (!toks.length || !/#|;;;/.test(brf)) return false;
  const m = toks.filter(mathsToken).length;
  return m / toks.length >= 0.6;
};

const byDoc = new Map();
for (const L of lines) {
  if (!byDoc.has(L.doc)) byDoc.set(L.doc, { prose: 0, n: 0, read: 0, quiet: 0 });
  const d = byDoc.get(L.doc);
  if (L.brf.includes('¤')) { d.holes = (d.holes || 0) + 1; continue; }   // Duxbury-internal bytes lost in extraction — file artifact, not braille
  if (!isMathsLine(L.brf)) { d.prose++; continue; }
  d.n++;
  const brl = brfToUnicodeBraille(L.brf.toUpperCase());
  let r;
  try { r = uebMathsToLatex(brl); }
  catch (e) { r = { latex: '', warnings: ['threw'] }; }
  const clean = !!(r.latex || '').trim() && !(r.warnings || []).length;
  if (!clean) { if (show) console.log('  WARNED', L.brf.slice(0, 60), '→', ((r.warnings || [])[0] || '').slice(0, 40)); continue; }
  d.read++;
  let back = '';
  try { back = mathcat.mathml_to_braille(toMathML(temml, r.latex), 'UEB'); } catch { /* */ }
  if (typeof back !== 'string' || !/[⠀-⣿]/.test(back) || /^ERROR/i.test(back)) { d.quiet++; continue; }  // checked:false → silent
  // numeric-literal rows (data tables) are bijective — nothing to mis-read
  if (/^[⠀⠼⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠲⠂]+$/u.test(brl)) { d.quiet++; continue; }
  const ok = normalise(brl, 'UEB').text === normalise(back, 'UEB').text;
  if (ok) d.quiet++;
  else if (show) console.log('  AMBER ', L.brf.slice(0, 60), '→', JSON.stringify((r.latex || '').slice(0, 40)));
}

console.log('SQA braille exam papers — maths lines through the live pipeline\n');
console.log('  paper                                        maths  readable  quiet   (prose)');
let TN = 0, TR = 0, TQ = 0, TP = 0;
for (const [doc, d] of [...byDoc.entries()].sort()) {
  const pc = (a) => (d.n ? String(Math.round(a / d.n * 100)).padStart(3) + '%' : '  —');
  console.log(`  ${doc.slice(0, 44).padEnd(44)}${String(d.n).padStart(4)}     ${pc(d.read)}    ${pc(d.quiet)}   (${d.prose})`);
  TN += d.n; TR += d.read; TQ += d.quiet; TP += d.prose;
}
console.log(`  ${'ALL'.padEnd(44)}${String(TN).padStart(4)}     ${Math.round(TR / TN * 100)}%    ${Math.round(TQ / TN * 100)}%   (${TP})`);
