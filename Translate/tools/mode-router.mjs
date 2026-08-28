// THE MODE ROUTER, measured offline before it touches the app.
//
// Design under test (PLAN 2026-07-24): each finished line is scored by BOTH
// engines the app already ships —
//   maths side  parses clean, and (when checkable) round-trips to the same
//               cells; plus structural signals (⠼ numeric indicators,
//               operators, grade-1 passages)
//   text side   liblouis back-translation yields real words
// — and routed to the winner. Ctrl+M stays the child's override; the ⠸⠩
// Nemeth switch stays absolute.
//
// Measured against the labelled UK corpora (SQA + UKAAF harvests): the
// harvest classifier's maths/prose split is the silver label. The router must
// clear ~99% on these lines before any app wiring is worth doing.
//
// Run: node connector/tools/mode-router.mjs [--errors]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';
import { brfToUnicodeBraille } from '../../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);

// liblouis in node: provide the wasm factory and serve tables from disk
globalThis.createLiblouis = require(path.join(ROOT, 'engine/liblouis-wasm.js'));
const realFetch = globalThis.fetch;
globalThis.fetch = async (url) => {
  const m = /tables\/(.+)$/.exec(String(url));
  if (m) {
    const buf = fs.readFileSync(path.join(ROOT, 'dist/tables', m[1]));
    return { ok: true, arrayBuffer: async () => buf.buffer.slice(buf.byteOffset, buf.byteOffset + buf.byteLength) };
  }
  return realFetch(url);
};
const louis = await import(path.join(ROOT, 'engine/louis-browser.mjs'));
await louis.init({ tablesBaseUrl: 'local://tables' });
globalThis.fetch = realFetch;
const T = '/tables/unicode.dis,/tables/en-ueb-g2.ctb';

const CACHE = path.join(__dirname, 'external', 'cache');
const lines = [
  ...JSON.parse(fs.readFileSync(path.join(CACHE, 'sqa_lines.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(CACHE, 'ukaaf_lines.json'), 'utf8')).filter((l) => l.mode !== 'uk-old'),
];

// silver label: the harvest classifier from external-sqa.mjs
const mathsToken = (t) => /^[#"0-9a-z()+=*.,:;<>%^_'\/;-]+$/i.test(t) && /#|"[678]|9#|\.\/|\^|;'/.test(t);
const label = (brf) => {
  // Duxbury style tables leaked by the harvest are neither prose nor maths
  if (/[A-Z][a-z]+[A-Z]/.test(brf) && /-/.test(brf)) return 'junk';
  const toks = brf.split(/\s+/).filter(Boolean);
  if (!toks.length) return 'text';
  const words = toks.filter((t) => /^[,;.]*[a-z?!&\]\['"]{3,}[0-9.,]*$/i.test(t) && !mathsToken(t)).length;
  const hasOp = /"[678]|;7|;6/.test(brf);
  const mathsy = /#|;;;/.test(brf) || hasOp;
  if (!mathsy) return 'text';
  const ratio = toks.filter(mathsToken).length / toks.length;
  if (hasOp && words >= 2) return 'mixed';         // "gradient = …" — either routing is defensible
  if (ratio >= 0.6 || (hasOp && words <= 1)) return 'maths';
  return words >= 2 ? 'text' : 'maths';
};

// THE ROUTER: both-engines duel plus structural signals
function route(brl) {
  // maths signals
  let mathsClean = false, latex = '';
  try {
    const r = uebMathsToLatex(brl);
    mathsClean = !!(r.latex || '').trim() && !(r.warnings || []).length;
    latex = r.latex || '';
  } catch { /* */ }
  const numeric = (brl.match(/⠼/gu) || []).length;
  const ops = (brl.match(/⠐⠶|⠐⠖|⠐⠤|⠐⠦|⠐⠌|⠰⠔|⠰⠢/gu) || []).length;
  const passage = /⠰⠰⠰/u.test(brl);
  // text signal: back-translate and count dictionary-looking words
  let words = 0, tokens = 0;
  for (const w of brl.split('⠀').filter(Boolean)) {
    tokens++;
    let t = '';
    try { t = louis.backTranslate(w, T) || ''; } catch { /* */ }
    if (/^[A-Za-z][a-z’']*[.,;:!?)]*$/.test(t.trim()) && t.trim().length >= 2) words++;
  }
  const wordRatio = tokens ? words / tokens : 0;
  const mathsScore = (mathsClean ? 1 : 0) + numeric * 0.5 + ops * 0.7 + (passage ? 1.5 : 0);
  const textScore = wordRatio * 3;
  return mathsScore > textScore ? 'maths' : 'text';
}

let n = 0, agree = 0;
const skipped = {};
const errors = [];
for (const L of lines) {
  if (L.brf.includes('¤')) continue;
  const brl = brfToUnicodeBraille(L.brf.toUpperCase());
  if (!/[⠁-⣿]/.test(brl)) continue;
  const want = label(L.brf);
  if (want === 'junk' || want === 'mixed') { skipped[want] = (skipped[want] || 0) + 1; continue; }
  n++;
  const got = route(brl);
  if (want === got) agree++;
  else errors.push({ doc: L.doc, want, got, brf: L.brf.slice(0, 64) });
}
console.log(`mode router vs silver labels: ${agree}/${n} = ${(agree / n * 100).toFixed(1)}%   (excluded: ${JSON.stringify(skipped)})`);
const byClass = { 'maths→text': 0, 'text→maths': 0 };
for (const e of errors) byClass[`${e.want}→${e.got}`]++;
console.log('  misroutes:', JSON.stringify(byClass));
if (process.argv.includes('--errors')) {
  for (const e of errors.slice(0, 40)) console.log(`  ${e.want}→${e.got}  ${e.brf}`);
}
