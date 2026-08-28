// Build the FULL-CORPUS PACK: every corpus the converters are tested against,
// tabled braille-beside-print in one PDF — corpus-pack.pdf at the repo root.
//
// PRIVATE WORKING DOCUMENT. Most sections are third-party content (APH, NFB,
// BANA, SQA, UKAAF, UEB Online, MathCAT test data) cached under the
// no-redistribution rule in TEST-SOURCES.md. The PDF is gitignored and must
// not be published or handed on; the shareable equivalent is proof-pack.pdf
// (in-house sets only, make-proof-pdf.mjs).
//
// Pairings per source (provenance in each section header):
//   braille + source print   — APH (MathML), UEBO (print text, OCR braille),
//                              MathCAT bench corpora (MathML)
//   LaTeX → print + MathCAT braille (both codes) — formula sheets, in-house
//   braille → Connector's reading — book corpora (NFB/BANA), SQA/UKAAF
//                              maths-classified lines
//
// Run: node connector/tools/make-corpus-pdf.mjs

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

const J = (p) => JSON.parse(fs.readFileSync(path.join(__dirname, p), 'utf8'));
const esc = (s) => String(s).replace(/[&<>]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;' }[c]));
const mml = (tex) => { try { return toMathML(temml, tex); } catch { return null; } };
const brl = (tex, code) => {
  try {
    const b = mathcat.mathml_to_braille(toMathML(temml, tex), code);
    return (typeof b === 'string' && /[⠁-⣿]/.test(b) && !/^ERROR/i.test(b)) ? b : null;
  } catch { return null; }
};
const reading = (cells, code) => {
  try {
    const r = code === 'UEB' ? uebMathsToLatex(cells) : nemeth(cells);
    if ((r.latex || '').trim() && !(r.warnings || []).length) return { m: mml(r.latex), clean: true };
    return { m: null, clean: false };
  } catch { return { m: null, clean: false }; }
};

let rows = 0;
const counts = [];
const sections = [];
const sect = (title, note, thead, body, n) => {
  counts.push([title, n]);
  sections.push(`<h2>${esc(title)} <span class="n">(${n} rows)</span></h2><p class="note">${note}</p>
<table><thead><tr>${thead}</tr></thead><tbody>${body}</tbody></table>`);
};
const tdB = (c) => `<td class="b">${esc(c)}</td>`;
const tdP = (m) => `<td class="p">${m || '<span class="none">not readable</span>'}</td>`;

// ---- 1. in-house LaTeX sets (same rows as proof-pack, for completeness) ----
const curSrc = fs.readFileSync(path.join(__dirname, 'curriculum.mjs'), 'utf8');
const { CURRICULUM, GENERATED } = new Function('fs', 'path', '__dirname',
  curSrc.slice(curSrc.indexOf('const CURRICULUM'), curSrc.indexOf('const strip =')) + '\nreturn { CURRICULUM, GENERATED };')(fs, path, __dirname);
const latex3 = (items) => items.map((tex) => {
  const m = mml(tex); if (!m) return '';
  const u = brl(tex, 'UEB'), n = brl(tex, 'Nemeth');
  if (!u && !n) return '';
  rows++;
  return `<tr>${tdP(m)}${tdB(u || '—')}${tdB(n || '—')}</tr>`;
}).join('\n');
{
  const items = [...CURRICULUM.flatMap(([, e]) => e), ...GENERATED];
  const body = latex3(items);
  sect('In-house: curriculum + independent set', 'Print is the source; braille is MathCAT’s canonical transcription. Same rows as proof-pack.pdf.',
    '<th class="p">print</th><th>UEB</th><th>Nemeth</th>', body, items.length);
}

// ---- 2. published formula sheets (LaTeX) -----------------------------------
for (const file of ['external/school-formula-sheets.json', 'external/us-and-further.json']) {
  for (const src of J(file).sources) {
    const body = latex3(src.items);
    sect(`Formula sheet: ${src.name}`, 'Print is the published formula; braille is MathCAT’s canonical transcription.',
      '<th class="p">print</th><th>UEB</th><th>Nemeth</th>', body, src.items.length);
  }
}

// ---- 3. MathCAT bench corpora (braille + source MathML) --------------------
for (const [file, code] of [['corpus/ueb-mathcat.json', 'UEB'], ['corpus/nemeth-mathcat.json', 'Nemeth']]) {
  const cases = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'tools', file), 'utf8'));
  const body = cases.map((c) => {
    if (!c.braille || !c.mathml) return '';
    rows++;
    return `<tr>${tdB(c.braille)}${tdP(c.mathml)}</tr>`;
  }).join('\n');
  sect(`MathCAT test corpus — ${code}`, 'Braille and print both from the MathCAT project’s test data.',
    `<th>${code} braille</th><th class="p">print</th>`, body, cases.length);
}

// ---- 4. APH tutorials (braille + source MathML) ----------------------------
const aph = J('external/cache/aph_pairs.json');
for (const code of Object.keys(aph)) {
  const body = aph[code].map((p) => {
    if (!p.braille || !p.mathml) return '';
    rows++;
    return `<tr>${tdB(p.braille)}${tdP(p.mathml)}</tr>`;
  }).join('\n');
  sect(`APH ${code} tutorial`, 'APH wrote both the braille and the print MathML — neither side is ours.',
    `<th>${code} braille</th><th class="p">print</th>`, body, aph[code].length);
}

// ---- 5. UEB Online manuals (OCR braille + print text) ----------------------
{
  const pairs = J('external/cache/uebo_pairs.json');
  const body = pairs.map((p) => {
    if (!p.braille || !p.print) return '';
    rows++;
    return `<tr>${tdB(p.braille)}<td class="t">${esc(p.print)}</td></tr>`;
  }).join('\n');
  sect('UEB Online manuals (NextSense)', 'Braille recovered from page images by our dot-OCR — artefact cells possible; print is the adjacent print line.',
    '<th>braille (OCR)</th><th>print text</th>', body, pairs.length);
}

// ---- 6. braille-only books → Connector's reading ---------------------------
const bookRows = (items, code) => {
  let n = 0;
  const body = items.map(({ brf }) => {
    const cells = brfToUnicodeBraille(String(brf).toUpperCase());
    if (!/[⠁-⣿]/u.test(cells)) return '';
    // equations only: needs maths-looking content and a clean parse
    if (!/[⠹⠼⠫⠜⠘⠰⠨⠷⠾⠳]/u.test(cells)) return '';
    const r = reading(cells, code);
    if (!r.clean || !r.m) return '';
    n++; rows++;
    return `<tr>${tdB(cells)}${tdP(r.m)}</tr>`;
  }).join('\n');
  return { body, n };
};
{
  const bana = J('external/cache/bana_items.json');
  const nfb = J('external/cache/nfb_items.json');
  for (const [title, items] of [
    ['BANA Nemeth 2022 + chemistry (code books)', bana],
    ['NFB transcriber course (UEB with Nemeth)', nfb],
  ]) {
    const { body, n } = bookRows(items, 'Nemeth');
    sect(title, 'Braille-only source; the print column is Connector’s reading (clean parses only — warned and prose lines omitted).',
      '<th>Nemeth braille</th><th class="p">Connector reads it as</th>', body, n);
  }
}

// ---- 7. UK papers → Connector's reading ------------------------------------
{
  const mathsToken = (t) => /^[#"0-9a-z()+=*.,:;<>%^_'\/;-]+$/i.test(t) && /#|"[678]|9#|\.\/|\^|;'/.test(t);
  const mathsy = (brf) => {
    const toks = brf.split(/\s+/).filter(Boolean);
    return toks.length > 0 && toks.filter(mathsToken).length / toks.length >= 0.6;
  };
  const uk = [
    ...J('external/cache/sqa_lines.json'),
    ...J('external/cache/ukaaf_lines.json').filter((l) => l.mode !== 'uk-old'),
  ];
  let n = 0;
  const body = uk.map(({ brf }) => {
    if (!brf || brf.includes('¤') || !mathsy(brf)) return '';
    const cells = brfToUnicodeBraille(brf.toUpperCase());
    if (!/[⠁-⣿]/u.test(cells)) return '';
    const r = reading(cells, 'UEB');
    if (!r.clean || !r.m) return '';
    n++; rows++;
    return `<tr>${tdB(cells)}${tdP(r.m)}</tr>`;
  }).join('\n');
  sect('UK papers: SQA + UKAAF (maths-classified lines)', 'Real exam braille; the print column is Connector’s reading (maths-classified, clean parses only).',
    '<th>UEB braille</th><th class="p">Connector reads it as</th>', body, n);
}

// ---- render -----------------------------------------------------------------
const today = new Date().toISOString().slice(0, 10);
const toc = counts.map(([t, n]) => `<tr><td>${esc(t)}</td><td class="num">${n}</td></tr>`).join('\n');
const html = `<!doctype html><meta charset="utf-8"><title>Connector corpus pack</title>
<style>
  @page { size: A4; margin: 14mm 12mm; }
  body { font: 10pt/1.35 -apple-system, "Helvetica Neue", sans-serif; color: #111; }
  h1 { font-size: 15pt; margin: 0 0 4pt; }
  h2 { font-size: 11.5pt; margin: 14pt 0 2pt; page-break-after: avoid; }
  h2 .n { color: #777; font-weight: normal; font-size: 9pt; }
  .meta, .note { color: #444; font-size: 8.5pt; margin: 0 0 6pt; }
  .private { border: 1.5pt solid #a00; color: #a00; padding: 6pt 8pt; font-size: 9.5pt; margin: 8pt 0; }
  table { border-collapse: collapse; width: 100%; }
  th { text-align: left; font-size: 7.5pt; text-transform: uppercase; letter-spacing: .04em;
       color: #555; border-bottom: 1pt solid #999; padding: 2pt 5pt; }
  td { border-bottom: 0.5pt solid #ccc; padding: 2.5pt 5pt; vertical-align: middle; page-break-inside: avoid; }
  tr { page-break-inside: avoid; }
  td.p { width: 40%; } td.p math { font-size: 11pt; }
  td.b { font-family: "Apple Braille", "Segoe UI Symbol"; font-size: 12pt; line-height: 1.3; word-break: break-all; }
  td.t { font-size: 9.5pt; }
  td.num { text-align: right; }
  .none { color: #999; font-style: italic; font-size: 8.5pt; }
</style>
<h1>Connector corpus pack — every test source, braille beside print</h1>
<p class="meta">${today} · full-corpus companion to proof-pack.pdf</p>
<div class="private">PRIVATE WORKING DOCUMENT — contains cached third-party braille and print (APH, NFB, BANA, SQA, UKAAF,
NextSense, MathCAT test data) held under a no-redistribution rule. Do not publish or pass on. The shareable pack is
proof-pack.pdf (in-house sets only).</div>
<table>${toc}</table>
${sections.join('\n')}`;

const htmlPath = path.join(ROOT, 'corpus-pack.html');
const pdfPath = path.join(ROOT, 'corpus-pack.pdf');
fs.writeFileSync(htmlPath, html);
execFileSync('/Applications/Google Chrome.app/Contents/MacOS/Google Chrome',
  ['--headless', '--disable-gpu', '--no-pdf-header-footer', `--print-to-pdf=${pdfPath}`, `file://${htmlPath}`],
  { stdio: 'pipe', maxBuffer: 1024 * 1024 * 64 });
fs.unlinkSync(htmlPath);
for (const [t, n] of counts) console.log(`${String(n).padStart(6)}  ${t}`);
console.log(`total rows rendered: ${rows}`);
console.log(`corpus-pack.pdf: ${(fs.statSync(pdfPath).size / 1e6).toFixed(1)} MB`);
