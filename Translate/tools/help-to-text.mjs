// Render Translate's in-app help as a plain text file, for circulation.
//
// WHY IT LIVES IN THE REPO. The help is the only description of the app that
// non-technical readers get, and it changes whenever behaviour does. Written
// once in a scratch directory, this got lost the moment that directory was
// cleared, and the circulated copy silently went stale. It belongs beside the
// help it renders.
//
// BRAILLE APPEARS TWICE - once as Unicode cells, once as ASCII braille -
// because a reader whose font or mail client cannot draw the dots still needs
// to see what the example says. The ASCII comes from the engine's own BRF64
// table (engine/brf-ascii.mjs), never from a table written out here, and the
// cell RANGE is built from codepoints for the same reason: a hand-copied cell
// has silently corrupted a result in this project before.
//
// Run:  node tools/help-to-text.mjs                       (from Translate/)
//       node tools/help-to-text.mjs --out ~/Downloads     (somewhere else too)
//       node tools/help-to-text.mjs --check               (stale? exit 1)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');                       // Translate/
const REPO = path.resolve(APP, '..');
const SRC = path.join(APP, 'index.html');
const DEST = path.join(APP, 'Translate-Help.txt');           // the copy we keep

const { unicodeBrailleToBrf } = await import(path.join(REPO, 'engine/brf-ascii.mjs'));

const argv = process.argv.slice(2);
const checkOnly = argv.includes('--check');
const outAt = argv.indexOf('--out');
const alsoTo = outAt >= 0 ? argv[outAt + 1] : null;

// ---- pull the help dialog out of the page -----------------------------------
const page = fs.readFileSync(SRC, 'utf8');
const dlgAt = page.indexOf('<dialog id="helpDialog"');
if (dlgAt < 0) throw new Error('help dialog not found in index.html');
const dlg = page.slice(dlgAt);
const bodyAt = dlg.indexOf('<div class="help-body">');
if (bodyAt < 0) throw new Error('help body not found');
const body = dlg.slice(bodyAt, dlg.indexOf('</dialog>'));

const ENT = { '&amp;': '&', '&lt;': '<', '&gt;': '>', '&quot;': '"', '&#39;': "'",
              '&nbsp;': ' ', '&ldquo;': '“', '&rdquo;': '”',
              '&mdash;': '—', '&ndash;': '–', '&hellip;': '…' };
const decode = (s) => s.replace(/&[a-z#0-9]+;/gi, (m) => ENT[m] ?? m);

// ---- braille: the cells, then the same cells as ASCII -----------------------
const BLANK = String.fromCodePoint(0x2800);
const LAST = String.fromCodePoint(0x28FF);
const FIRST_INKED = String.fromCodePoint(0x2801);
const CELL_RUN = new RegExp(`[${BLANK}-${LAST}]+`, 'gu');
const HAS_DOTS = new RegExp(`[${FIRST_INKED}-${LAST}]`, 'u');

let brailleCount = 0;
const markBraille = (text) => text.replace(CELL_RUN, (run) => {
  if (!HAS_DOTS.test(run)) return run;          // a run of blank cells is a space
  brailleCount++;
  return `${run} (Unicode braille) / ${unicodeBrailleToBrf(run)} (ASCII braille)`;
});

// ---- HTML -> text ------------------------------------------------------------
const wrap = (s, width = 78, indent = '') => {
  const words = s.split(/\s+/).filter(Boolean);
  const lines = []; let line = '';
  for (const w of words) {
    if (line.trim() && (line + ' ' + w).length > width) { lines.push(line); line = indent + w; }
    else line = line.trim() ? line + ' ' + w : w;
  }
  if (line.trim()) lines.push(line);
  return lines.join('\n');
};

const out = [];
const blocks = body.match(/<(h2|h3|p|li|button)\b[^>]*>[\s\S]*?<\/\1>/g) || [];
for (const b of blocks) {
  const tag = b.match(/^<(\w+)/)[1];
  // The "Open an example" paragraph holds a BUTTON and its explanation. Run
  // together they read as one baffling sentence, so the control is named as a
  // control and its note left as a note.
  if (/class="[^"]*\btry-it\b/.test(b)) {
    const grab = (re) => decode(((b.match(re) || [, ''])[1]).replace(/<[^>]+>/g, '')).replace(/\s+/g, ' ').trim();
    const btn = grab(/<button[^>]*>([\s\S]*?)<\/button>/);
    const note = grab(/<span class="note">([\s\S]*?)<\/span>/);
    if (btn) out.push(`[ ${btn} ]   - a button in the Help window.`, '');
    if (note) out.push(wrap('Note: ' + markBraille(note)), '');
    continue;
  }
  const isNote = /class="[^"]*\bnote\b/.test(b);
  const inner = b.replace(/^<\w+[^>]*>/, '').replace(/<\/\w+>$/, '').replace(/<[^>]+>/g, '');
  const text = markBraille(decode(inner)).replace(/\s+/g, ' ').trim();
  if (!text) continue;
  if (tag === 'h2') out.push('='.repeat(78), text.toUpperCase(), '='.repeat(78), '');
  else if (tag === 'h3') out.push('', text, '-'.repeat(Math.min(text.length, 78)), '');
  else if (tag === 'li') out.push(wrap('- ' + text, 78, '  '), '');
  else if (tag === 'button') out.push(`[ ${text} ]   - a button in the Help window.`, '');
  else out.push(wrap(isNote ? 'Note: ' + text : text), '');
}

// No date stamp in the file: it would change on every run and make the check
// below useless. Git records when it changed.
const header = [
  'TRANSLATE - HELP',
  'Plain-text copy of the in-app help.',
  'https://brailletranslate.pages.dev',
  '',
  'Braille examples appear twice: first as Unicode braille (the dot patterns,',
  'which need a font that can draw them), then as ASCII braille (the plain',
  'characters an embosser or a BRF file uses for the same cells).',
  '',
  '',
].join('\n');

const text = header + out.join('\n').replace(/\n{3,}/g, '\n\n') + '\n';

// ---- every pair must survive the round trip ---------------------------------
const { brfToUnicodeBraille } = await import(path.join(REPO, 'engine/brf-ascii.mjs'));
const flat = text.replace(/\s+/g, ' ');
const pair = new RegExp(`([${BLANK}-${LAST}]+) \\(Unicode braille\\) / (.+?) \\(ASCII braille\\)`, 'gu');
let pairs = 0, bad = 0;
for (const m of flat.matchAll(pair)) {
  pairs++;
  if (brfToUnicodeBraille(m[2]) !== m[1]) { bad++; console.error(`MISMATCH: ${m[1]} <-> ${m[2]}`); }
}

if (checkOnly) {
  const current = fs.existsSync(DEST) ? fs.readFileSync(DEST, 'utf8') : '';
  const stale = current !== text;
  console.log(stale ? 'STALE: Translate-Help.txt does not match the help - run this without --check'
                    : 'up to date');
  process.exit(stale || bad ? 1 : 0);
}

fs.writeFileSync(DEST, text, 'utf8');
if (alsoTo) fs.writeFileSync(path.join(alsoTo.replace(/^~/, process.env.HOME), 'Translate-Help.txt'), text, 'utf8');

console.log('read   :', SRC, `(${blocks.length} blocks)`);
console.log('wrote  :', DEST, `${Buffer.byteLength(text)} bytes, ${text.split('\n').length} lines`);
if (alsoTo) console.log('       :', path.join(alsoTo, 'Translate-Help.txt'));
console.log('braille:', brailleCount, 'examples labelled;', pairs, 'pairs checked,', bad, 'mismatched');
process.exit(bad ? 1 : 0);
