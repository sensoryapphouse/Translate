// Build Translate/examples/translate-tour.ebrl - the document the Help's
// "Open an example" button opens.
//
// WHY THIS IS A SCRIPT. The tour is shipped as the worked example of good
// braille, so it has to BE good braille. Until 2026-10-10 the file had no
// generator: it was built once, interactively, and the recipe lived only in a
// commit message (4ae660c8). A tester then found it had no capital signs and no
// full stops - every sentence was in lower case with no stop - and the only fix
// on offer was to repeat the recipe from memory. A recipe nobody can re-run is
// how that happens, so it now sits beside the thing it builds (as
// help-to-text.mjs does for the help).
//
// NO CELL IN THIS FILE IS TYPED. A cell typed or pasted by hand has corrupted a
// result in this project before, so every cell comes from a tool:
//   * The prose is translated by liblouis with the table list the app itself
//     uses for English grade 2 (braille-codes.mjs, "en-ueb-g2"), so the cells are
//     the cells the app would write.
//   * "Mother" is the one word written out in full. The tour teaches the
//     missed-contraction mark, and that needs a word that HAS a shorter spelling
//     that was not used. Its cells are liblouis's own uncontracted (grade 1)
//     spelling of the same word.
//   * The two sums are MathCAT's transcription of one case, 1/2 + 1/3 = 5/6 (the
//     first row of tools/coverage.mjs, and of examples/ueb-maths.brf and
//     nemeth-maths.brf). The Nemeth one is wrapped in the BANA switch signs from
//     nemeth-switch.mjs, with a blank on each side, as nemeth-maths.brf carries it.
//   * The package is written by writeEbraille(), the function Save calls.
//
// Checked before anything is written, and the build stops on any failure:
//   * every sentence starts with a capital and ends with a full stop in print -
//     the standard the example is there to show;
//   * its braille back-translates to that same sentence;
//   * "Mother" really does have a shorter spelling than the one used;
//   * the file, read back by the app's own reader, holds exactly these lines.
//
// REPRODUCIBLE. Nothing here reads the clock: MODIFIED is a constant, so the same
// inputs give the same bytes and --check can compare them. Change the wording,
// move MODIFIED to today, and run it.
//
// Verified when it was written (2026-10-10): fed the OLD lower-case wording, this
// recipe reproduces the shipped file's braille and sums cell for cell, and its
// identifier, which the writer derives from the sections.
//
// Run:  node Translate/tools/build-tour.mjs            (rewrites the file)
//       node Translate/tools/build-tour.mjs --check    (is the file what this would write? exit 1 if not)
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const APP = path.resolve(HERE, '..');                         // Translate/
const REPO = path.resolve(APP, '..');
const DEST = path.join(APP, 'examples', 'translate-tour.ebrl');

const louis = await import(path.join(REPO, 'engine/louis.mjs'));
const { writeEbraille, readEbraille } = await import(path.join(APP, 'ebraille.mjs'));
const { NEM_OPEN, NEM_CLOSE } = await import(path.join(APP, 'nemeth-switch.mjs'));
const mathcat = createRequire(import.meta.url)(path.join(REPO, 'engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
await louis.init(path.join(REPO, 'liblouis/tables'));

const checkOnly = process.argv.includes('--check');

// ---- what the tour says ------------------------------------------------------
const TITLE = 'A quick tour of Translate';
const SPELT_OUT = ['Mother'];                  // written in full, so its dots can be marked
const SAY = {
  welcome: 'Welcome to Translate.',
  click:   'Click any word to see how it was written.',
  mother:  'Mother is written out in full here.',
  under:   'The dotted underline shows where a contraction could have been used.',
  load:    'Press Load to open more examples.',
};
// x^2 + 3x + 2 = 0, the same equation in both maths codes.
//
// A QUADRATIC, NOT A SUM OF FRACTIONS (tester, 17 Oct: "a quadratic equation
// may be better for showing off"). It carries a superscript and an implied
// multiplication, which is more of what a child meets than 1/2 + 1/3, and it
// is still short enough to read at a glance. The quadratic FORMULA was tried
// first and rejected: MathCAT wraps it in UEB grade-1 passage indicators and
// it runs to 30-odd cells, which is a showpiece for the transcriber rather
// than for the child.
//
// CHECKED BOTH WAYS BEFORE IT WAS CHOSEN, because the tour must not be the one
// document that carries an "Unverified" notice: MathCAT transcribes it to
// ueb  x^2+3x+2 = 0   and  nemeth  x^2 + 3x + 2  =  0,
// and the app's own readers take both back to exactly that with no warnings.
const SUM_MATHML = '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>3</mn><mi>x</mi>'
                 + '<mo>+</mo><mn>2</mn><mo>=</mo><mn>0</mn></math>';
const MODIFIED = '2026-10-17T12:00:00Z';       // move this when the wording changes

// ---- the tools' tables and the app's conventions -------------------------------
const G2 = '/tables/unicode.dis,/tables/en-ueb-g2.ctb';   // = braille-codes.mjs "en-ueb-g2"
const G1 = '/tables/unicode.dis,/tables/en-ueb-g1.ctb';
const BLANK = String.fromCodePoint(0x2800);
const cell = (...dots) => String.fromCodePoint(0x2800 + dots.reduce((m, d) => m | (1 << (d - 1)), 0));
const CAPITAL = cell(6), FULL_STOP = cell(2, 5, 6);
// liblouis writes a space as the blank cell; the app's buffer holds an ordinary
// space between words, and so does every .ebrl it has ever written.
const asBuffer = (s) => s.split(BLANK).join(' ');

const fail = (msg) => { console.error('build-tour: ' + msg); process.exit(1); };

function prose(sentence) {
  if (!/^[A-Z].*\.$/.test(sentence)) fail(`"${sentence}" must start with a capital and end with a full stop`);
  const words = sentence.split(' ');
  const cells = louis.translate(sentence, G2).split(BLANK);
  if (cells.length !== words.length) fail(`"${sentence}": ${words.length} words in print, ${cells.length} in braille`);
  words.forEach((w, i) => {
    if (!SPELT_OUT.includes(w)) return;
    const full = louis.translate(w, G1);
    if (full.length <= louis.translate(w, G2).length) fail(`"${w}" has no shorter spelling, so writing it in full teaches nothing`);
    cells[i] = full;
  });
  const braille = cells.join(' ');
  if (!braille.startsWith(CAPITAL)) fail(`"${sentence}" does not start with the capital sign`);
  if (!braille.endsWith(FULL_STOP)) fail(`"${sentence}" does not end with the full stop`);
  const back = louis.backTranslate(asBuffer(braille).split(' ').join(BLANK), G2);
  if (back !== sentence) fail(`"${sentence}" comes back from braille as "${back}"`);
  console.log(`  ${braille}\n    <- ${JSON.stringify(sentence)}  (back: ${JSON.stringify(back)})`);
  return braille;
}

console.log('prose');
const lines = Object.fromEntries(Object.entries(SAY).map(([k, s]) => [k, prose(s)]));

const uebSum = asBuffer(mathcat.mathml_to_braille(SUM_MATHML, 'UEB'));
const nemSum = `${NEM_OPEN} ${asBuffer(mathcat.mathml_to_braille(SUM_MATHML, 'Nemeth'))} ${NEM_CLOSE}`;
console.log('sums\n  UEB    ' + uebSum + '\n  Nemeth ' + nemSum);

const sections = [
  { mode: 'text', lines: [lines.welcome, lines.click, lines.mother, lines.under] },
  { mode: 'ueb',  lines: [uebSum] },
  { mode: 'text', lines: [nemSum, lines.load] },
];

const bytes = writeEbraille({
  title: TITLE,
  titleBraille: louis.translate(TITLE, G2),     // as Save brailles its title for the entry page
  creator: 'Sensory App House Ltd',
  producer: 'Sensory App House Ltd',
  language: 'en',
  modified: MODIFIED,
  sections,
});

// The app's own reader must hand back exactly what was meant.
const back = await readEbraille(new Uint8Array(bytes).buffer);
const sameSections = JSON.stringify(back.sections.map((s) => ({ mode: s.mode, lines: s.lines })))
                  === JSON.stringify(sections);
if (!sameSections) fail('the file does not read back as the sections it was built from');
if (back.title !== TITLE) fail(`the file reads back titled "${back.title}"`);

if (checkOnly) {
  const have = fs.existsSync(DEST) ? fs.readFileSync(DEST) : Buffer.alloc(0);
  const same = Buffer.compare(have, Buffer.from(bytes)) === 0;
  console.log(same ? 'up to date' : 'STALE: examples/translate-tour.ebrl is not what this builds - run it without --check');
  process.exit(same ? 0 : 1);
}
fs.writeFileSync(DEST, bytes);
console.log(`wrote ${path.relative(REPO, DEST)} (${bytes.length} bytes)`);
