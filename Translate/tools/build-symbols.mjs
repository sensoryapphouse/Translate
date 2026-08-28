// Generate connector/ueb-symbols.mjs from MathCAT's UEB symbol table.
//
// Source: daisy/MathCAT  Rules/Braille/UEB/unicode.yaml  (MIT © Neil Soiffer /
// DAISY Consortium). We invert its character → braille mapping to get
// braille → character, which is the direction we need and which nobody
// publishes. Generated, not hand-typed, so it can be regenerated and audited.
//
// Run: node connector/tools/build-symbols.mjs <path-to-unicode.yaml>

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const src = process.argv[2];
if (!src || !fs.existsSync(src)) {
  console.error('usage: node build-symbols.mjs <UEB unicode.yaml>');
  process.exit(1);
}

const isCell = (ch) => ch >= '⠀' && ch <= '⣿';

const LETTER_CELLS = new Set(
  ['1','12','14','145','15','124','1245','125','24','245','13','123','134',
   '1345','135','1234','12345','1235','234','2345','136','1236','2456',
   '1346','13456','1356']
    .map((p) => String.fromCodePoint(0x2800 + [...p].reduce((a, d) => a | (1 << (Number(d) - 1)), 0))));

// Characters we must NOT emit blindly: our parser handles these structurally
// (or they are letters/digits), so a flat symbol lookup would be wrong.
const SKIP_CHARS = new Set([
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  '(', ')', '[', ']', '{', '}', '|', '/', '.', ',', '-', '+', '=', '<', '>',
  '^', '_', '*', ' ',
]);

// A few where a LaTeX command renders far better than the bare character.
const TEX = {
  // % STARTS A COMMENT in LaTeX. Emitted bare it silently swallows the rest
  // of the line when rendered, so "20% = 1/4" showed as just "20".
  '%': '\\%', '$': '\\$', '#': '\\#', '&': '\\&',
  '≠': '\\neq ', '≤': '\\le ', '≥': '\\ge ', '±': '\\pm ', '∓': '\\mp ',
  '×': '\\times ', '÷': '\\div ', '·': '\\cdot ', '∗': '\\ast ',
  '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ',
  '⊃': '\\supset ', '⊇': '\\supseteq ', '∪': '\\cup ', '∩': '\\cap ',
  '∅': '\\emptyset ', '∞': '\\infty ', '∴': '\\therefore ', '∵': '\\because ',
  '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ',
  '⇒': '\\Rightarrow ', '⇐': '\\Leftarrow ', '⇔': '\\Leftrightarrow ',
  '∼': '\\sim ', '≈': '\\approx ', '≡': '\\equiv ', '∝': '\\propto ',
  '∠': '\\angle ', '°': '^{\\circ}', '∥': '\\parallel ', '⊥': '\\perp ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '√': '\\sqrt ',
  '∧': '\\land ', '∨': '\\lor ', '¬': '\\lnot ', '∀': '\\forall ', '∃': '\\exists ',
  '≅': '\\cong ', '∆': '\\Delta ', '∂': '\\partial ', '′': "'", '″': "''",
};

const text = fs.readFileSync(src, 'utf8');
const line = /^\s*-\s*"((?:[^"\\]|\\.)+)"\s*:\s*\[t:\s*"([^"]*)"\]/;

const map = new Map();          // cells -> { char, tex }
const collisions = [];
let considered = 0;

for (const raw of text.split('\n')) {
  const m = line.exec(raw);
  if (!m) continue;
  const ch = m[1].replace(/\\"/g, '"');
  // Strip MathCAT's mode letters (N numeric, L letter, C capital, G Greek,
  // W/w whitespace, o/c open/close) — keep only the actual braille cells.
  // MODE LETTERS are not decoration — they stand for an indicator that must
  // physically precede the cells: G = Greek (⠨), C = capital (⠠), N = numeric
  // (⠼), L = English-letter, 1 = grade-1, t/c/o/b = typeform and open/close.
  //
  // Stripping them INVENTS a symbol that does not exist. UEB writes χ as "GL⠯",
  // so a naive strip produced a bare ⠯ → χ — but bare ⠯ is the "and"
  // contraction, which is why "II and V" was being read as "II χ V". A table
  // entry is only safe when its braille is complete on its own.
  // (W/w merely mark required surrounding spaces, which we do not store.)
  // Only the mode letters that change WHAT THE SYMBOL IS are disqualifying:
  // G = Greek (⠨ must precede), C = capital (⠠), N = numeric (⠼). UEB spells
  // those indicators out in the braille, so the cells alone are a different
  // symbol. The rest (L letter-indicator, 1 grade-1, t/c/o/b typeform and
  // open/close variants) are contextual — the cells still identify the symbol,
  // and rejecting those as well cut the table from 225 entries to 101 and made
  // UEB markedly worse.
  if (/[GCN]/.test(m[2])) continue;
  const cells = [...m[2]].filter(isCell).join('');
  if (!cells || ch.length !== 1 || SKIP_CHARS.has(ch)) continue;
  // A one-cell entry that collides with a letter is never a safe fallback: the
  // parser meets that cell as an ordinary variable far more often.
  if (cells.length === 1 && LETTER_CELLS.has(cells)) continue;
  considered++;
  if (map.has(cells)) { collisions.push([cells, map.get(cells).char, ch]); continue; }
  map.set(cells, { char: ch, tex: TEX[ch] || ch });
}

const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);
const out = `// GENERATED — do not edit by hand. Regenerate with:
//   node connector/tools/build-symbols.mjs <MathCAT Rules/Braille/UEB/unicode.yaml>
//
// Braille → symbol table for UEB Technical, inverted from MathCAT's
// Rules/Braille/UEB/unicode.yaml (MIT © Neil Soiffer / DAISY Consortium),
// used here under the MIT licence with thanks. MathCAT maps character → braille;
// this is the reverse direction, which is what a reader needs and which no
// project publishes.
//
// Structure (fractions, scripts, roots, numbers, letters) is NOT here — the
// parser handles that. This is the last-resort lookup for standalone symbols,
// longest match first.
//
// ${entries.length} symbols.

export const UEB_SYMBOLS = [
${entries.map(([cells, v]) =>
  `  [${JSON.stringify(cells)}, ${JSON.stringify(v.tex)}],   // ${v.char}`).join('\n')}
];
`;

const dest = path.resolve(__dirname, '../ueb-symbols.mjs');
fs.writeFileSync(dest, out);
console.log(`considered ${considered} entries → wrote ${entries.length} symbols to ${path.basename(dest)}`);
if (collisions.length) {
  console.log(`\n${collisions.length} cell collisions (kept the first):`);
  for (const [c, kept, dropped] of collisions.slice(0, 12)) console.log(`   ${c}  kept ${kept}  dropped ${dropped}`);
}
