// Build the PROOF PACK: every in-house test expression tabled as
// print | UEB braille | Nemeth braille, one PDF a human proofreader can
// red-pen. In-house sets only (curriculum, independent set, example files) —
// the third-party corpora are cached under a no-redistribution rule and
// never leave the machine.
//
// Provenance, stated on the title page:
//   • curriculum / independent rows — the print IS the source expression;
//     the braille is MathCAT's canonical transcription of it.
//   • example-file rows — the braille IS the file; the print is Connector's
//     reading of it (so a wrong reading is visible here as a wrong equation).
//
// Writes proof-pack.html (scratch) and prints proof-pack.pdf at the repo
// root via headless Chrome. Run: node connector/tools/make-proof-pdf.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';
import { brfToUnicodeBraille } from '../../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const { convert: nemeth } = require(path.join(ROOT, 'nemeth-to-latex.js'));
const mathcat = require(path.join(ROOT, 'engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.join(ROOT, 'web/vendor/temml.min.js'));

const braille = (tex, code) => {
  try {
    const b = mathcat.mathml_to_braille(toMathML(temml, tex), code);
    return (typeof b === 'string' && /[⠁-⣿]/.test(b) && !/^ERROR/i.test(b)) ? b : null;
  } catch { return null; }
};
const mathml = (tex) => { try { return toMathML(temml, tex); } catch { return null; } };

// ---- the sets ---------------------------------------------------------------
const curSrc = fs.readFileSync(path.join(__dirname, 'curriculum.mjs'), 'utf8');
const dataEnd = curSrc.indexOf('const strip =');
const { CURRICULUM, GENERATED } = new Function(
  'fs', 'path', '__dirname',
  curSrc.slice(curSrc.indexOf('const CURRICULUM'), dataEnd) + '\nreturn { CURRICULUM, GENERATED };'
)(fs, path, __dirname);

// ---- HTML -------------------------------------------------------------------
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
let missing = 0, rows = 0;
const row3 = (tex) => {
  const m = mathml(tex);
  if (!m) return '';
  const u = braille(tex, 'UEB'), n = braille(tex, 'Nemeth');
  if (!u && !n) { missing++; return ''; }
  rows++;
  return `<tr><td class="p">${m}</td><td class="b">${u ? esc(u) : '<span class="none">—</span>'}</td><td class="b">${n ? esc(n) : '<span class="none">—</span>'}</td></tr>`;
};
const table3 = (items) => `<table><thead><tr><th class="p">print</th><th>UEB</th><th>Nemeth</th></tr></thead><tbody>${items.map(row3).join('\n')}</tbody></table>`;

// example files: braille is the source, print is Connector's reading
const exampleRows = (file, parse, strip) => {
  const brf = fs.readFileSync(path.join(ROOT, 'connector/examples', file), 'utf8');
  return brf.split('\n')
    .map((l) => brfToUnicodeBraille(l.toUpperCase()))
    .filter((l) => /[⠁-⣿]/u.test(l))
    .map((brl) => {
      const cells = strip ? brl.replace(/⠸⠩⠀?|⠀?⠸⠱/gu, '').trim() : brl;
      let m = null;
      try {
        const r = parse(cells);
        if ((r.latex || '').trim() && !(r.warnings || []).length) m = mathml(r.latex);
      } catch { /* shown as unreadable */ }
      rows++;
      return `<tr><td class="b">${esc(cells)}</td><td class="p">${m || '<span class="none">not readable</span>'}</td></tr>`;
    }).join('\n');
};

const today = new Date().toISOString().slice(0, 10);
const sections = [];
sections.push(`<h1>Connector proof pack — in-house sets</h1>
<p class="meta">${today} · print | UEB | Nemeth · braille by MathCAT (canonical transcription of the print), except the example-file
sections where the braille is the file and the print is Connector's reading of it. Anything that looks wrong in ANY cell is a
finding — please mark it.</p>`);

for (const [stage, exprs] of CURRICULUM) {
  sections.push(`<h2>Curriculum — ${esc(stage)}</h2>${table3(exprs)}`);
}
sections.push(`<h2>Independent set (${GENERATED.length} expressions)</h2>${table3(GENERATED)}`);
sections.push(`<h2>Example file — ueb-maths.brf (braille → Connector's reading)</h2>
<table><thead><tr><th>UEB braille</th><th class="p">Connector reads it as</th></tr></thead><tbody>${exampleRows('ueb-maths.brf', uebMathsToLatex, false)}</tbody></table>`);
sections.push(`<h2>Example file — nemeth-maths.brf (switch wrappers not shown)</h2>
<table><thead><tr><th>Nemeth braille</th><th class="p">Connector reads it as</th></tr></thead><tbody>${exampleRows('nemeth-maths.brf', nemeth, true)}</tbody></table>`);

const html = `<!doctype html><meta charset="utf-8"><title>Connector proof pack</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font: 10.5pt/1.4 -apple-system, "Helvetica Neue", sans-serif; color: #111; }
  h1 { font-size: 15pt; margin: 0 0 4pt; }
  h2 { font-size: 11.5pt; margin: 14pt 0 4pt; page-break-after: avoid; }
  .meta { color: #444; font-size: 9pt; margin: 0 0 8pt; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 8pt; text-transform: uppercase; letter-spacing: .04em;
       color: #555; border-bottom: 1pt solid #999; padding: 2pt 6pt; }
  td { border-bottom: 0.5pt solid #ccc; padding: 3pt 6pt; vertical-align: middle;
       page-break-inside: avoid; }
  tr { page-break-inside: avoid; }
  td.p { width: 34%; }
  td.p math { font-size: 12pt; }
  td.b { font-family: "Apple Braille", "Segoe UI Symbol"; font-size: 13pt; line-height: 1.35;
         word-break: break-all; }
  .none { color: #999; font-style: italic; font-family: -apple-system, sans-serif; font-size: 9pt; }
</style>
${sections.join('\n')}`;

const htmlPath = path.join(ROOT, 'proof-pack.html');
const pdfPath = path.join(ROOT, 'proof-pack.pdf');
fs.writeFileSync(htmlPath, html);

const CHROME = '/Applications/Google Chrome.app/Contents/MacOS/Google Chrome';
execFileSync(CHROME, [
  '--headless', '--disable-gpu', '--no-pdf-header-footer',
  `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`,
], { stdio: 'pipe' });
fs.unlinkSync(htmlPath);

console.log(`rows: ${rows} (skipped, MathCAT couldn't braille either code: ${missing})`);
console.log(`proof-pack.pdf: ${(fs.statSync(pdfPath).size / 1e6).toFixed(1)} MB`);
