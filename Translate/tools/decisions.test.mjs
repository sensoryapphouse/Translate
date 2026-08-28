// PRECEDENCE DECISIONS — the cases where two rules both want the same cells.
//
// Why this file exists. Both converters are one long function in which a rule's
// priority IS its position in the source. Nothing declares that the chemical-bond
// rule must beat the punctuation rule, or that the symbol table must lose to the
// root-index rule. So a rule inserted in the wrong place does not fail loudly —
// it moves an aggregate percentage by a point or two, which is easy to miss and
// easy to explain away.
//
// That has already gone wrong more than once:
//   • the arrow rule was placed BEFORE the symbol table and overrode the
//     authority's own spellings: ⠫⠪ is ∠, an ANGLE, and became a left arrow;
//   • ⠠ before a fraction delimiter fell through to the "lone ⠠ is a comma"
//     fallback and injected commas into every nested fraction;
//   • the UEB symbol table shadowed structure, turning ⠣⠒⠜…⠻ into a bare ∛.
//
// Each case below therefore records a DECISION, not just an expectation, and
// names the rule it would beat. A misplaced rule now fails by name.
//
// Run: node connector/tools/decisions.test.mjs

import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';
import { uebMathsToLatexV2 } from '../ueb-rules.mjs';
import { nemethMathsToLatexV2 } from '../nemeth-rules.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert: nemeth } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));

// [braille, expected LaTeX (normalised), why this is the decision]
// `expected: null` means "must WARN" — an honest gap, not a confident guess.
const UEB = [
  ['⠰⠰⠎⠔⠣⠐⠤⠼⠁⠜', 's^{-1}',
   '⠣ is the script-scope opener, NOT a bracket — so it must not qualify as a function argument, or "6 m s⁻¹" reads as "6 m sin −1"'],
  ['⠯', '\\text{ and }',
   'bare ⠯ IS the "and" contraction — and that is now MEASURED, not feared: ' +
   'MathCAT itself emits bare ⠯ for the word "and" inside Pr(A and B) ' +
   '(GTM 9.7). The original pin (warn, map nothing) guarded against inventing ' +
   'χ, but χ arrives as ⠨⠯ and the Greek branch consumes the ⠨ first — the ' +
   'two never collide. Updated 2026-07-23 with the probe as evidence.'],
  ['⠨⠯', '\\chi', 'with the Greek indicator it IS chi'],
  ['⠭⠱', '\\bar{x}',
   'the modifier rule must beat the symbol table, which maps a bare ⠱ to Greek eta (this produced "xη")'],
  ['⠸⠣⠼⠁⠸⠜', '\\{1\\}', 'curly braces must be ESCAPED or they render as invisible LaTeX grouping'],
  ['⠨⠣⠼⠁⠨⠜', '[1]', 'square brackets'],
  ['⠐⠣⠝⠰⠻⠗⠐⠜', '\\binom{n}{r}',
   'the binomial rule must beat the plain round-bracket rule, which shares the ⠐⠣ opener'],
  ['⠼⠑⠐⠚⠚⠚', '5\\,000', 'a dot-5 before a DIGIT is the numeric space, not an operator prefix'],
];

const NEMETH = [
  ['⠫⠪', '\\angle ',
   'the composed-arrow rule must run AFTER the symbol table: ⠫⠪ is an ANGLE, not a left arrow'],
  ['⠫⠪⠶⠶', '\\Leftarrow ',
   'likewise ⇐ — whose ⠶⠶ double shaft the arrow rule read as the digits 77'],
  ['⠫⠣', '\\uparrow ', 'the shaft-less arrow forms chemistry uses ARE handled, once the table has declined'],
  ['⠫⠒⠕⠫⠪⠒', '\\rightleftharpoons ', 'two opposing arrows are a chemical equilibrium'],
  ['⠠⠓⠸⠒⠻⠠⠃⠑⠸⠒⠻⠠⠓', 'H - Be - H',
   'the chemical-bond rule (⠸ sign ⠻) must beat the punctuation rule, which would read ⠸⠒ as a colon'],
  ['⠨⠷⠸⠰⠽⠸⠒⠀⠠⠛⠨⠾', '\\{\\mathbf{y}: G\\}',
   'without a ⠻ the same ⠸⠒ IS the colon — the terminator is the discriminator'],
  ['⠣⠒⠜⠭⠻', '\\sqrt[3]{x}',
   'the root-index rule must beat the symbol table, which had ⠣⠒⠜ → "∛" and threw the radicand away'],
  ['⠠⠵⠦', 'Z_{8}',
   'a digit straight after a letter is a NUMERIC SUBSCRIPT (no indicator in Nemeth); read literally it becomes "Z8"'],
  ['⠼⠆⠭', '2x',
   'but a digit after the NUMERIC INDICATOR is an ordinary number — the subscript rule must not fire here'],
  ['⠠⠞⠰⠠⠁⠘⠤⠂', 'T_{A}^{-1}',
   'a sub then a sup belong to the SAME base, so a script ends at the opposite level indicator'],
  ['⠠⠹⠹⠒⠌⠦⠼⠠⠌⠢⠠⠼', '\\frac{\\frac{3}{8}}{5}',
   'the ⠠ fraction-LEVEL marks must be consumed, or they reach the "lone ⠠ is a comma" fallback'],
  ['⠷⠂⠴⠴⠂⠾⠠⠀⠷⠴⠂⠂⠂⠾', '\\left(1001\\right), \\left(0111\\right)',
   'a lone ⠠ that introduces nothing IS the comma — the fallback is still correct where nothing else claims it'],
  ['⠸⠰⠭', '\\mathbf{x}', 'bold is a VECTOR here, not styling'],
  ['⠨⠰⠠⠵', '\\mathbb{Z}', 'double-struck is the number set'],
  ['⠵⠱', '\\bar{z}', 'a trailing macron attaches to what precedes it rather than rendering as a stray glyph'],
  // — cellmap sweep (2026-07-24): one pin per MEANING of every multi-meaning
  //   cell family the burn-down touched, enumerated via tools/cellmap.mjs so
  //   a future fix to one meaning cannot silently break a sibling. —
  ['⠳⠋⠳⠰⠁', '|f|_{a}',
   '⠳ meaning 1+2: after a CLOSING bar (even parity) ⠰ is a subscript'],
  ['⠈⠿⠳⠰⠭⠀⠳', '\\exists |x |',
   '⠳ meaning 1: inside an OPENED bar (odd parity, closer ahead) ⠰x is the letter'],
  ['⠽⠳⠰⠭⠀⠰⠨⠅⠀⠼⠂', 'y|_{x = 1}',
   '⠳ meaning 3: an UNPAIRED evaluation bar takes a genuine subscript — ' +
   'MathCAT\'s canonical spelling, restated ⠰ before the spaced = (§80e)'],
  ['⠦⠰⠭⠸⠴', '“x”',
   '⠦ meaning 1: at a boundary with a ⠸⠴ (or ⠴) closer ahead it is the print open quote'],
  ['⠼⠦⠴', '80',
   '⠦/⠴ meaning 2: after the numeric indicator they are the digits 8 and 0'],
  ['⠭⠀⠸⠇⠀⠽', 'x \\equiv y',
   '⠸ meaning: SPACED ⠸⠇ is ≡ (§141) — the spaced-table guard beats the Fraktur letter'],
  ['⠸⠛', '\\mathfrak{g}',
   '⠸ meaning: bare ⠸+letter is the GERMAN alphabet (§24), 𝔤 = Lie(G) — never bold'],
  ['⠸⠨⠠⠎', '\\mathscr{S}',
   '⠸⠨ meaning: the SCRIPT typeform'],
  ['⠼⠒⠀⠐⠂⠀⠼⠢', '3 : 5',
   '⠐⠂ meaning: LITERAL-space-flanked it is the §151 ratio "is to"'],
  ['⠷⠠⠉⠠⠕⠒⠾⠰⠆', '(CO_{3})_{2}',
   '⠰⠆ meaning: after a closing paren it is subscript 2 — only literal spaces make it the proportion sign'],
  ['⠘⠤⠐⠂⠒', '-13',
   '⠘⠤⠐ meaning: the elementary raised minus returns to baseline digits'],
  ['⠼⠲⠴⠤⠂⠴⠀⠨⠅⠀⠤⠤⠤⠤', '40-10=—',
   '⠤ meaning 3: a run of four or more is the answer BLANK, out of reach of the ± pairing'],
  ['⠙⠑⠝⠕⠍⠊⠝⠁⠞⠕⠗', 'denominator',
   'a function name never starts mid-word (min in denoMINator); the one letter-adjacent start is a SCRIPTED name'],
  ['⠅⠎⠑⠉⠘⠆⠀⠅⠭', 'k\\sec ^{2} kx',
   '…and that scripted case (ksec², §80d) must keep working'],
  ['⠨⠠⠎', '\\Sigma',
   '⠨⠠+LETTER is capital Greek — the italic-enlarged-paren skip must not reach it (cellmap sibling)'],
  ['⠫⠅⠬⠻', '\\boxed{+}',
   '⠫⠅…⠻ is the 2022 keyed symbol (cellmap: sequence otherwise unused)'],
  ['⠜⠨⠣⠒⠜⠭⠨⠻⠻', '\\sqrt{\\sqrt[3]{x}}',
   'order-⠨ also precedes a radical INDEX (⠨⠣⠒⠜) — nested indexed roots'],
  ['⠐⠠⠁⠠⠃⠣⠫⠡⠒⠒⠡⠻', '\\overset{\\frown}{AB}',
   '§13.3 curved barbs make the ARC over AB — while ⠡ alone stays the multiplication dot (cellmap sibling: x⠡y)'],
  ['⠭⠡⠽', 'x \\cdot y',
   '…that sibling, pinned'],
  ['⠫⠪⠨⠗⠻', '∟',
   '§110: interior r is the RIGHT-variant modifier — ∟, not an angle named R'],
  ['⠫⠞⠨⠊⠻', '\\triangle I',
   'other interior letters stay the named-shape reading (isosceles triangle I)'],
  ['⠫⠪⠸⠫⠼⠒⠴⠘⠨⠡⠐⠻', '\\angle 30^{\\circ}',
   'and the FULL interior form carries a measure inside the angle'],
  ['⠣⠍⠬⠝⠜⠏⠬⠟⠻', '\\sqrt[m+n]{p+q}',
   'a radical index may be a whole expression, not only a digit or letter (SQA formula sheets)'],
  // — the plus-or-minus and the unit, 2026-08-28. Both were read wrongly by the
  //   reader the APP uses (nemeth-rules.mjs) while the reader this file scores
  //   by default (nemeth-to-latex.js) had them right, so nothing here moved.
  //   Run with V2=1 to score the shipped readers instead. —
  ['⠭⠬⠤⠽', 'x \\pm y',
   '⠬⠤ is ONE sign, ± (liblouis nemethdefs.cti \\x00B1 346-36; Nemeth §134(4)) — ' +
   'the two-cell entry must beat the one-cell + and -, or the quadratic formula ' +
   'reads "-b + - √…" and speaks "plus minus"'],
  ['⠼⠆⠁', '2a',
   'a UNIT is spelled with its own capitals: the ampere is ⠠⠁, so a bare ⠁ after ' +
   'a digit is the variable a — this is the "2a became 2 amperes" case'],
  ['⠼⠢⠀⠍', '5 \\mathrm{m}',
   '…and the unit rule must still fire where a unit really is: a numeral, a space, ' +
   'then the abbreviation (the §-spacing that separates "2 m" from "2m")'],
  ['⠼⠢⠀⠠⠁', '5 \\mathrm{A}',
   '…including the capitalised one the case rule now requires'],
  ['⠫⠒⠒⠕', '\\to',
   '§152: the shaft is a REPEATABLE run, so two single shafts are still the plain right arrow — ' +
   'this must beat the symbol table, whose MathCAT-dialect entry spells the dashed ⇢ the same way ' +
   '(APH transcribers lengthen shafts freely); ⇢ is offered via the ambiguity channel, never silently chosen. ' +
   'Chained forms (⇄ ⇶) still reach the table via the next-⠫ guard. Added 2026-07-23 from the APH tier-2 set.'],
];

// These tests are about PRECEDENCE, not spacing: \left/\right and the spaces
// around operators render identically, so they are normalised away.
const norm = (s) => String(s || '')
  .replace(/\\left|\\right/g, '')
  .replace(/\s*([-+=<>])\s*/g, '$1')
  .replace(/\s+/g, ' ')
  .trim();

let pass = 0;
const fails = [];
// TWO GENERATIONS OF READER, AND ONLY ONE OF THEM IS SCORED BY DEFAULT.
//
// check.mjs — the one command that answers "did I break anything" — runs this
// file, tools/bench.mjs, tools/curriculum.mjs and tools/oracle.mjs, and every
// one of them reads with ueb-maths-to-latex.mjs and nemeth-to-latex.js. The
// APP reads with ueb-rules.mjs and nemeth-rules.mjs. The two disagree, and a
// disagreement is invisible to every published score.
//
//   node Translate/tools/decisions.test.mjs        the scored readers
//   V2=1 node Translate/tools/decisions.test.mjs   the readers the app ships
//
// The default is unchanged so the gate keeps its meaning; V2=1 is how you find
// out what a child actually gets. Re-derive it rather than quoting a figure.
const V2 = !!process.env.V2;
const readers = V2
  ? [['UEB', UEB, uebMathsToLatexV2], ['Nemeth', NEMETH, nemethMathsToLatexV2]]
  : [['UEB', UEB, uebMathsToLatex], ['Nemeth', NEMETH, nemeth]];

for (const [label, table, run] of readers) {
  for (const [braille, expected, why] of table) {
    let r;
    try { r = run(braille); } catch (e) { r = { latex: '', warnings: ['threw: ' + e.message] }; }
    const warned = (r.warnings || []).length > 0;
    const ok = expected === null
      ? warned                                     // must be an honest gap
      : (!warned && norm(r.latex) === norm(expected));
    if (ok) { pass++; continue; }
    fails.push({ label, braille, expected, why, got: r.latex, warn: (r.warnings || [])[0] });
  }
}

for (const f of fails) {
  console.log(`❌ ${f.label}  ${f.braille}`);
  console.log(`     expected  ${f.expected === null ? '(a warning)' : JSON.stringify(f.expected)}`);
  console.log(`     got       ${JSON.stringify(f.got)}${f.warn ? '   ⚠ ' + f.warn : ''}`);
  console.log(`     decision  ${f.why}`);
}
console.log(`\n${pass}/${UEB.length + NEMETH.length} precedence decisions hold`
  + (V2 ? '   [V2: ueb-rules.mjs + nemeth-rules.mjs, the readers the app ships]' : ''));
process.exit(fails.length ? 1 : 0);
