// Generate nemeth-symbol-table.js from MathCAT's Nemeth symbol tables.
//
// Sibling of build-symbols.mjs (which does the same job for UEB). Kept separate
// rather than merged, because the two differ in ways that matter:
//
//  • Nemeth spreads its symbols over TWO files — Rules/Braille/Nemeth/
//    unicode.yaml (the core) and unicode-full.yaml (the long tail). The core
//    wins on conflict.
//  • Several core entries are CONTEXT-DEPENDENT and written as a test/then/else
//    block rather than a one-liner — "=" is one of them, which is why a
//    one-liner-only reader misses the single most common sign in mathematics.
//    We take the `else` branch, i.e. the general case, and ignore the special
//    one (`then` is typically a chemical bond).
//
// Source: daisy/MathCAT (MIT © Neil Soiffer / DAISY Consortium). MathCAT maps
// character → braille; we invert it, which is the direction a reader needs.
//
// Run: node connector/tools/build-nemeth-symbols.mjs <unicode.yaml> [unicode-full.yaml]

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const srcs = process.argv.slice(2).filter((p) => fs.existsSync(p));
if (!srcs.length) {
  console.error('usage: node build-nemeth-symbols.mjs <Nemeth unicode.yaml> [unicode-full.yaml]');
  process.exit(1);
}

const isCell = (ch) => ch >= '⠀' && ch <= '⣿';

// Characters the PARSER handles structurally, or that are letters/digits. A flat
// lookup for these would shadow real structure — this is the guard that keeps
// the table a last resort rather than a competing interpretation.
const SKIP_CHARS = new Set([
  ...'abcdefghijklmnopqrstuvwxyzABCDEFGHIJKLMNOPQRSTUVWXYZ0123456789',
  '(', ')', '/', '.', ',', '-', '+', '=', '^', '_', ' ', '"', "'",
  // Root glyphs are STRUCTURE (⠣ index ⠜ … ⠻), not standalone symbols. As table
  // entries they matched first, emitted ∛, and threw the radicand away.
  '∛', '∜', '√',
]);

// The 26 letter cells. A ONE-CELL entry equal to any of these is never a safe
// fallback, whatever character MathCAT maps it to: the parser will meet that
// cell as an ordinary variable far more often than as a symbol. This guard
// caught ⠙→ⅆ, ⠑→ⅇ and ⠊→ⅈ (the letters d, e and i) — each of which would have
// corrupted variables silently, with no warning to show for it.
const LETTER_CELLS = new Set(
  ['1','12','14','145','15','124','1245','125','24','245','13','123','134',
   '1345','135','1234','12345','1235','234','2345','136','1236','2456',
   '1346','13456','1356']
    .map((p) => String.fromCodePoint(0x2800 + [...p].reduce((a, d) => a | (1 << (Number(d) - 1)), 0))));

// Cells the parser owns outright. Nemeth reuses cells heavily across contexts,
// so a table entry for one of these is not a helpful fallback — it is a bug
// waiting to happen. (UEB taught us this: its table mapped ⠱ to Greek η, and
// x̄ silently became "xη".)
const RESERVED = new Set([
  '⠼',  // numeric indicator
  '⠘',  // superscript
  '⠰',  // subscript / English-letter indicator
  '⠐',  // baseline
  '⠹', '⠌', '⠻',  // fraction open / line / close
  '⠣', '⠜',        // radical open / close
  '⠠',             // capital indicator
]);

const TEX = {
  // % STARTS A COMMENT in LaTeX. Emitted bare it silently swallows the rest
  // of the line when rendered, so "20% = 1/4" showed as just "20".
  '%': '\\%', '$': '\\$', '#': '\\#', '&': '\\&',
  '≠': '\\neq ', '≤': '\\le ', '≥': '\\ge ', '±': '\\pm ', '∓': '\\mp ',
  '×': '\\times ', '÷': '\\div ', '·': '\\cdot ', '∗': '\\ast ',
  '∈': '\\in ', '∉': '\\notin ', '⊂': '\\subset ', '⊆': '\\subseteq ',
  '⊃': '\\supset ', '⊇': '\\supseteq ', '∪': '\\cup ', '∩': '\\cap ',
  '∅': '\\emptyset ', '∞': '\\infty ', '∴': '\\therefore ', '∵': '\\because ',
  '→': '\\to ', '←': '\\leftarrow ', '↔': '\\leftrightarrow ', '↦': '\\mapsto ',
  '⇒': '\\Rightarrow ', '⇐': '\\Leftarrow ', '⇔': '\\Leftrightarrow ',
  '∼': '\\sim ', '≈': '\\approx ', '≡': '\\equiv ', '∝': '\\propto ',
  '∠': '\\angle ', '°': '\\circ ', '∥': '\\parallel ', '⊥': '\\perp ',
  '∑': '\\sum ', '∏': '\\prod ', '∫': '\\int ', '√': '\\sqrt ',
  '∧': '\\land ', '∨': '\\lor ', '¬': '\\lnot ', '∀': '\\forall ', '∃': '\\exists ',
  '≅': '\\cong ', '∆': '\\Delta ', '∂': '\\partial ', '′': "'", '″': "''",
  '∘': '\\circ ', '⋅': '\\cdot ', '∣': '|', '‖': '\\|', '∇': '\\nabla ',
  // MathCAT's core file maps these cells to the N-ARY forms (⋃ ⋂) and to the
  // division slash ∕. Between two operands the ordinary binary signs are what a
  // reader expects, and a LaTeX command renders better than a bare character.
  '⋃': '\\cup ', '⋂': '\\cap ', '∕': '/', '⋁': '\\lor ', '⋀': '\\land ',
  '⋯': '\\cdots ', '…': '\\ldots ', '⋮': '\\vdots ', '⋱': '\\ddots ',
  '≢': '\\not\\equiv ', '∤': '\\nmid ', '⊕': '\\oplus ', '⊗': '\\otimes ',
  '≺': '\\prec ', '≻': '\\succ ', '⪯': '\\preceq ', '⪰': '\\succeq ',
  'ℵ': '\\aleph ', '∎': '\\blacksquare ', '⋉': '\\ltimes ', '⋊': '\\rtimes ',
  // A bare { or } is LaTeX's INVISIBLE grouping character. Emitted literally,
  // the braces of a set vanish when rendered: {√2} showed as just √2.
  '{': '\\{', '}': '\\}', '⟨': '\\langle ', '⟩': '\\rangle ',
  'α': '\\alpha ', 'β': '\\beta ', 'γ': '\\gamma ', 'δ': '\\delta ',
  'ε': '\\epsilon ', 'ζ': '\\zeta ', 'η': '\\eta ', 'θ': '\\theta ',
  'ι': '\\iota ', 'κ': '\\kappa ', 'λ': '\\lambda ', 'μ': '\\mu ',
  'ν': '\\nu ', 'ξ': '\\xi ', 'π': '\\pi ', 'ρ': '\\rho ', 'σ': '\\sigma ',
  'τ': '\\tau ', 'υ': '\\upsilon ', 'φ': '\\phi ', 'χ': '\\chi ',
  'ψ': '\\psi ', 'ω': '\\omega ',
  'Γ': '\\Gamma ', 'Δ': '\\Delta ', 'Θ': '\\Theta ', 'Λ': '\\Lambda ',
  'Ξ': '\\Xi ', 'Π': '\\Pi ', 'Σ': '\\Sigma ', 'Φ': '\\Phi ',
  'Ψ': '\\Psi ', 'Ω': '\\Omega ',
};

const ENTRY = /^\s*-\s*"((?:[^"\\]|\\.)+)"\s*:\s*(.*)$/;

const map = new Map();          // cells -> { char, tex, src }
const collisions = [];
let considered = 0;

for (const [rank, src] of srcs.entries()) {
  const lines = fs.readFileSync(src, 'utf8').split('\n');
  const starts = lines.map((l, i) => (ENTRY.test(l) ? i : -1)).filter((i) => i >= 0);

  starts.forEach((start, n) => {
    const m = ENTRY.exec(lines[start]);
    const ch = m[1].replace(/\\"/g, '"');
    let raw = null;

    const inline = /^\[t:\s*"([^"]*)"\]/.exec(m[2].trim());
    if (inline) {
      raw = inline[1];
    } else {
      // Context-dependent entry: read only as far as the NEXT entry, or we
      // swallow the following symbols (that mistake cut the table from 99 to 53).
      const end = n + 1 < starts.length ? starts[n + 1] : lines.length;
      const block = lines.slice(start + 1, end).join('\n');
      const pick = /else:\s*\[t:\s*"([^"]*)"\]/.exec(block)
                || /then:\s*\[t:\s*"([^"]*)"\]/.exec(block);
      if (pick) raw = pick[1];
    }
    if (raw === null) return;

    // MathCAT's MODE LETTERS are not decoration — they stand for an indicator
    // that must physically precede the cells: G = Greek (⠨), C = capital (⠠),
    // N = numeric (⠼), L = English-letter, P = punctuation, S/B/I = script /
    // bold / italic typeform.
    //
    // Stripping them and keeping the bare cells INVENTS a symbol that does not
    // exist. "α" is written GL⠁, so stripping gave a bare ⠁ → α; the capital
    // "Α" is GCL⠁, which gave ⠁ → Α and won on ordering. The letter a is also
    // ⠁. That single mistake would have turned every "a" in every equation
    // into a capital Alpha — the ⠱→η bug again, but 204 times over.
    //
    // So: a table entry is only safe when its braille is COMPLETE on its own.
    // Anything mode-dependent belongs to the parser, not to a flat lookup.
    // (W/w merely mark required surrounding spaces, which we do not store.)
    if ([...raw].some((ch) => !isCell(ch) && ch !== 'W' && ch !== 'w')) return;
    const cells = [...raw].filter(isCell).join('');
    if (!cells || ch.length !== 1 || SKIP_CHARS.has(ch)) return;
    if (cells.length === 1 && (RESERVED.has(cells) || LETTER_CELLS.has(cells))) return;
    considered++;

    if (map.has(cells)) {
      // The core file is listed first and wins; only report a genuine clash.
      if (map.get(cells).char !== ch) collisions.push([cells, map.get(cells).char, ch, rank]);
      return;
    }
    map.set(cells, { char: ch, tex: TEX[ch] || ch });
  });
}

// Longest match first, so ⊆ (⠸⠐⠅⠱) is found before ⊂ (⠸⠐⠅).
const entries = [...map.entries()].sort((a, b) => b[0].length - a[0].length);

const out = `/* GENERATED — do not edit by hand. Regenerate with:
 *   node connector/tools/build-nemeth-symbols.mjs \\
 *        <MathCAT Rules/Braille/Nemeth/unicode.yaml> <…/unicode-full.yaml>
 *
 * Braille → symbol table for the Nemeth code, inverted from MathCAT's Nemeth
 * unicode.yaml + unicode-full.yaml (MIT © Neil Soiffer / DAISY Consortium),
 * used here under the MIT licence with thanks. MathCAT maps character →
 * braille; this is the reverse, which is what a reader needs and which no
 * project publishes.
 *
 * Structure (fractions, scripts, radicals, numbers, letters) is NOT here — the
 * parser handles that, and cells it owns are excluded on purpose. This is the
 * LAST-RESORT lookup for standalone symbols, longest match first.
 *
 * ${entries.length} symbols.
 *
 * Loaded as a plain <script> in the browser and via require() in Node, so it
 * publishes to both globalThis and module.exports.
 */
(function (root) {
  'use strict';
  var NEMETH_SYMBOLS = [
${entries.map(([cells, v]) =>
  `    [${JSON.stringify(cells)}, ${JSON.stringify(v.tex)}],   // ${v.char}`).join('\n')}
  ];
  root.NEMETH_SYMBOLS = NEMETH_SYMBOLS;
  if (typeof module === 'object' && module && module.exports) module.exports = { NEMETH_SYMBOLS: NEMETH_SYMBOLS };
})(typeof globalThis !== 'undefined' ? globalThis : this);
`;

const dest = path.resolve(__dirname, '../../nemeth-symbol-table.js');
fs.writeFileSync(dest, out);
console.log(`considered ${considered} entries → wrote ${entries.length} symbols to ${path.basename(dest)}`);
if (collisions.length) {
  console.log(`\n${collisions.length} cell collisions (kept the first / core file):`);
  for (const [c, kept, dropped] of collisions.slice(0, 15)) console.log(`   ${c}  kept ${kept}  dropped ${dropped}`);
}
