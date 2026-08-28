// WHOLE-FILE mode classification, measured offline before any wiring.
//
// The question (2026-07-24): on Load, could the app safely pre-tick the mode
// checkboxes when a document is CLEARLY all UEB maths or CLEARLY all text —
// abstaining on anything mixed or thin? Per-line routing was measured at ~93%
// (mode-router.mjs) and rejected: one silent misroute is one confidently-wrong
// line. A whole-file call is different in kind: evidence aggregates over every
// line, a wrong call is conspicuous (the entire pane renders wrongly and one
// click fixes it), and abstention is allowed.
//
// Wiring bar: ~100% correct on the calls it makes, on ground-truth documents;
// real mixed papers should overwhelmingly abstain; Nemeth-without-switches
// must never be called 'ueb-maths'.
//
// Ground truth by construction:
//   ueb-maths docs — MathCAT-brailled curriculum/generated sets (the same
//                    canonical spellings a correctly-taught child types),
//                    chunked into documents; plus the shipped example file.
//   text docs      — real English prose forward-translated to UEB grade 2 by
//                    liblouis (including numeric prose: dates, money, "page
//                    47" — the adversarial case for a maths detector).
//   mixed docs     — the real SQA + UKAAF exam papers (prose and maths
//                    interleaved): the right answer is ABSTAIN.
//   nemeth docs    — MathCAT Nemeth output with NO switch indicators (a pure
//                    Nemeth file): 'ueb-maths' here would be the harmful call.
//
// Run: node connector/tools/doc-router.mjs [--show]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';
import { classifyDoc as sharedClassify } from '../mode-detect.mjs';
import { brfToUnicodeBraille } from '../../engine/brf-ascii.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(__dirname, '../..');
const require = createRequire(import.meta.url);
const { convert: nemeth } = require(path.join(ROOT, 'nemeth-to-latex.js'));
const mathcat = require(path.join(ROOT, 'engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.join(ROOT, 'web/vendor/temml.min.js'));
const show = process.argv.includes('--show');

// liblouis in node (same shim as mode-router.mjs)
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
const T1 = '/tables/unicode.dis,/tables/en-ueb-g1.ctb';

// ---- the shared classifier (connector/mode-detect.mjs) --------------------
// The app imports the same function; this run IS the app's behaviour.
const classifyDoc = (lines) => sharedClassify(lines, {
  parseUeb: uebMathsToLatex,
  backTranslate: (w) => louis.backTranslate(w, T),
});

// ---- assemble the labelled documents ---------------------------------------
const docs = [];   // {label, name, lines}

// curriculum + generated UEB maths (canonical spellings), chunked
const curSrc = fs.readFileSync(path.join(__dirname, 'curriculum.mjs'), 'utf8');
const dataEnd = curSrc.indexOf('const strip =');
const { CURRICULUM, GENERATED } = new Function(
  'fs', 'path', '__dirname',
  curSrc.slice(curSrc.indexOf('const CURRICULUM'), dataEnd) + '\nreturn { CURRICULUM, GENERATED };'
)(fs, path, __dirname);
const brailleAll = (exprs, code) => exprs.map((tex) => {
  try {
    const b = mathcat.mathml_to_braille(toMathML(temml, tex), code);
    return (typeof b === 'string' && /[⠁-⣿]/.test(b) && !/^ERROR/i.test(b)) ? b : null;
  } catch { return null; }
}).filter(Boolean);
for (const [stage, exprs] of CURRICULUM) {
  docs.push({ label: 'ueb-maths', name: `curriculum:${stage}`, lines: brailleAll(exprs, 'UEB') });
}
const gen = brailleAll(GENERATED, 'UEB');
for (let i = 0; i < gen.length; i += 15) {
  docs.push({ label: 'ueb-maths', name: `generated:${i / 15}`, lines: gen.slice(i, i + 15) });
}
// the shipped example file
docs.push({
  label: 'ueb-maths', name: 'examples/ueb-maths.brf',
  lines: fs.readFileSync(path.join(ROOT, 'connector/examples/ueb-maths.brf'), 'utf8')
    .split('\n').map((l) => brfToUnicodeBraille(l.toUpperCase())),
});

// text: real prose forward-translated to grade 2 (numeric prose included)
const PROSE = [
  ['story', [
    'Once upon a time there was a little girl who lived near the woods.',
    'Every morning she walked to school with her brother.',
    'The teacher asked the class to open their books.',
    'It was raining, so they stayed inside at playtime.',
    'She wrote a story about a dragon and read it aloud.',
    'Everyone clapped when she finished reading.',
    'After school they went home for tea.',
    'Her mother asked what she had learned today.',
  ]],
  ['classroom', [
    'Please hand in your homework on Friday.',
    'Remember to bring your PE kit tomorrow.',
    'The school trip will leave at nine in the morning.',
    'Write your name at the top of the page.',
    'Answer all the questions in full sentences.',
    'Put your hand up if you need help.',
    'Tidy your desk before you leave the room.',
  ]],
  ['numeric-prose', [
    'Turn to page 47 and read the first paragraph.',
    'The bus leaves at 8.45 on Tuesday 3 June.',
    'There are 30 children in the class and 4 teachers.',
    'The book costs 6.99 and the pencil costs 45p.',
    'She was born in 2014 and her brother in 2016.',
    'Chapter 12 begins on page 158.',
    'About 250 people came to the fair on 21 May.',
    'He scored 9 out of 10 in the spelling test.',
  ]],
  ['letter', [
    'Dear Mrs Brown, thank you for the lovely visit last week.',
    'The children enjoyed the museum very much indeed.',
    'We hope to come again in the summer term.',
    'Please thank the volunteers for their help.',
    'With best wishes from everyone in Year 5.',
  ]],
];
for (const [name, sentences] of PROSE) {
  docs.push({
    label: 'text', name: `prose:${name}`,
    lines: sentences.map((s) => { try { return louis.translate(s, T); } catch { return ''; } }),
  });
}

// mixed: the real exam papers, grouped by document
const paperLines = [
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'external/cache/sqa_lines.json'), 'utf8')),
  ...JSON.parse(fs.readFileSync(path.join(__dirname, 'external/cache/ukaaf_lines.json'), 'utf8')).filter((l) => l.mode !== 'uk-old'),
];
const byDoc = new Map();
for (const L of paperLines) {
  if (L.brf.includes('¤')) continue;
  if (!byDoc.has(L.doc)) byDoc.set(L.doc, []);
  byDoc.get(L.doc).push(brfToUnicodeBraille(L.brf.toUpperCase()));
}
for (const [doc, lines] of byDoc) docs.push({ label: 'mixed', name: `paper:${doc}`, lines });

// nemeth without switches: MathCAT Nemeth spellings, chunked
const nemLines = brailleAll(GENERATED.slice(0, 120), 'Nemeth');
for (let i = 0; i < nemLines.length; i += 15) {
  docs.push({ label: 'nemeth', name: `nemeth:${i / 15}`, lines: nemLines.slice(i, i + 15) });
}
// nemeth WITH switch indicators (exactly what this app saves): declared
// markup, so the classifier must CALL these 'nemeth', not merely abstain
docs.push({
  label: 'nemeth-switched', name: 'examples/nemeth-maths.brf (as shipped)',
  lines: fs.readFileSync(path.join(ROOT, 'connector/examples/nemeth-maths.brf'), 'utf8')
    .split('\n').map((l) => brfToUnicodeBraille(l.toUpperCase())),
});
for (let i = 0; i < nemLines.length; i += 15) {
  docs.push({ label: 'nemeth-switched', name: `nemeth-switched:${i / 15}`,
    lines: nemLines.slice(i, i + 15).map((l) => `⠸⠩⠀${l}⠀⠸⠱`) });
}
docs.push({
  label: 'nemeth', name: 'examples/nemeth (unswitched)',
  lines: fs.readFileSync(path.join(ROOT, 'connector/examples/nemeth-maths.brf'), 'utf8')
    .split('\n').map((l) => brfToUnicodeBraille(l.toUpperCase()).replace(/⠸⠩⠀?|⠀?⠸⠱/gu, '').trim()),
});

// ---- run --------------------------------------------------------------------
const tally = {};   // label → {n, calls:{}, wrong:[]}
for (const d of docs) {
  const r = classifyDoc(d.lines);
  const t = tally[d.label] || (tally[d.label] = { n: 0, calls: {}, wrong: [] });
  t.n++;
  t.calls[r.call] = (t.calls[r.call] || 0) + 1;
  const harmful = (d.label === 'ueb-maths' && r.call === 'text')
    || (d.label === 'text' && r.call === 'ueb-maths')
    || (d.label === 'nemeth' && r.call === 'ueb-maths')
    || (d.label === 'nemeth-switched' && r.call !== 'nemeth');
  if (harmful) t.wrong.push({ name: d.name, ...r });
  if (show) console.log(`${d.label.padEnd(10)} ${String(r.call).padEnd(10)} f=${r.f?.toFixed(2) ?? ' —  '} ${d.name}`);
}
console.log('\nlabel        docs   calls');
for (const [label, t] of Object.entries(tally)) {
  const calls = Object.entries(t.calls).map(([k, v]) => `${k}:${v}`).join('  ');
  console.log(`${label.padEnd(12)}${String(t.n).padStart(4)}   ${calls}`);
  for (const w of t.wrong) console.log(`   HARMFUL: ${w.name} → ${w.call} (f=${w.f?.toFixed(2)})`);
}
