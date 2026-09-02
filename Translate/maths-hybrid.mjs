// TWO READERS, ONE ANSWER - the decision the app ships.
//
// Each maths line is read twice: by the older reader (V1: ueb-maths-to-latex.mjs,
// nemeth-to-latex.js) and the newer one (V2: ueb-rules.mjs, nemeth-rules.mjs).
// The newer answer is used when it is clean and says the same thing as the
// older; otherwise the older answer is used and the disagreement is REMEMBERED
// on it (`uncertain`, `v2_latex`, `v2_error`) so the row can say so.
//
// This lived inside translate.mjs until 2026-09-02. The audit found the quality
// gate scoring the older readers alone while the app showed this decision, so
// the decision moved here, DOM-free, where tools/lib/readers.mjs can score it
// (MATHS_IMPL=hybrid is the instruments' default). The module owns nothing
// else: no rendering, no speech, no state.
//
// Nemeth V1 is a classic script that defines a global (NemethToLatex); the app
// loads it with a <script> tag, and a Node tool sets globalThis.NemethToLatex
// from require() before calling nemethHybrid.
import { uebMathsToLatex } from './ueb-maths-to-latex.mjs';
import { uebMathsToLatexV2 } from './ueb-rules.mjs';
import { nemethMathsToLatexV2 } from './nemeth-rules.mjs';

// The same words on both sides before comparing (2026-09-02): the UEB hybrid
// compared byte for byte while the Nemeth one stripped spacing, so 52 of UEB's
// 94 corpus "disagreements" were one space against two. Sizing, phantoms and
// spacing carry no reading; the comparison ignores them for both codes.
export const normalizeLatex = (l) => l
  ? String(l).replace(/\\phantom\{\}/g, '').replace(/\\left|\\right/g, '').replace(/\s+/g, '')
  : '';

// A NOTE IS ONLY WORTH SHOWING IF THE MATHS DIFFERS (PB, 2026-09-02: "only show
// when the two readings differ in a way that changes the maths"). The adoption
// rule above is strict on purpose - the newer reading is used only when it
// matches the older exactly - but the NOTE is a different question, and a
// reader who is shown two lines that say the same thing learns nothing from it.
//
// PB's example: one reader gave an upright A and the other an italic A, and the
// note showed both, identical to any reader who does not know that upright A
// means "this is a unit or an operator, not a variable". Font is presentation.
// So for the note, and only for the note, these are stripped:
//   \mathrm \text \textrm \mathit \operatorname   upright-vs-italic wrappers
//   \, \; \: \! \quad \qquad                     spacing
//   braces around a single token                    grouping
// \mathbf is NOT stripped: in this material a bold letter is a vector, and a
// vector is not the same thing as the scalar of the same name.
const styleBlind = (l) => {
  let t = String(l || '');
  for (let pass = 0; pass < 4; pass++) {
    const was = t;
    t = t.replace(/\\(?:mathrm|textrm|text|mathit|operatorname)\s*\{([^{}]*)\}/g, '$1');
    if (t === was) break;
  }
  // A BOLD NUMBER IS THAT NUMBER. \mathbf on a LETTER is kept, because a bold
  // letter is a vector and a vector is not the scalar of the same name; on
  // digits it is a typeface and nothing more.
  t = t.replace(/\\mathbf\s*\{([0-9.,\s]+)\}/g, '$1');
  // THE SAME BASE WITH BOTH SCRIPTS IS THE SAME MATHS, whichever was written
  // first: x squared sub k and x sub k squared are one expression, and which
  // order a reader emits is a habit, not a reading.
  t = t.replace(/\^(\{[^{}]*\}|\S)_(\{[^{}]*\}|\S)/g, '_$2^$1');
  return normalizeLatex(
    t.replace(/\\(?:quad|qquad)/g, ' ')
     .replace(/\\[,;:!]/g, ' ')
     .replace(/\{([^{}])\}/g, '$1'));
};

// True when the two readings are the same maths, however they are spelt.
export const sameMaths = (a, b) => styleBlind(a) === styleBlind(b);

// A reader that THROWS is a reader that has failed, and the audit found the
// two catches here were the only uncommented empty ones in the file - a crash
// in V2 was indistinguishable from V2 simply agreeing, which is how a reader
// that crashed on every matrix shipped for a month. Now it is said, and the
// row that shows the older answer knows it is standing in.
const v2Failed = (r1, code, e) => {
  console.warn(`[translate] ${code} reader (V2) threw; showing the older reader's answer:`, e && e.message);
  r1.uncertain = true;
  r1.v2_error = (e && e.message) || String(e);
};

export const uebHybrid = (s) => {
  const r1 = uebMathsToLatex(s);
  let r2 = null;
  try {
    r2 = uebMathsToLatexV2(s);
  } catch (e) { v2Failed(r1, 'UEB', e); }

  if (r2 && (!r2.badCells || r2.badCells.length === 0)) {
    if (normalizeLatex(r2.latex) === normalizeLatex(r1.latex)) {
      return r2; // high confidence
    } else if (!sameMaths(r1.latex, r2.latex)) {
      r1.uncertain = true;
      r1.v2_latex = r2.latex;
    }
    // ...and when they differ only in how they are SET - upright against
    // italic, a thin space - the older reading is still shown, quietly.
  }
  return r1;
};

export const nemethV1Available = () => !!globalThis.NemethToLatex;

// The app wraps a Nemeth line in the code switch indicators (dots 456-146 on,
// 456-156 off); the older reader wants them as spaces.
const cell = (d) => String.fromCodePoint(0x2800 + [...String(d)].reduce((m, x) => m | (1 << (Number(x) - 1)), 0));
const SWITCH_ON = cell(456) + cell(146);
const SWITCH_OFF = cell(456) + cell(156);
const padNemethSwitches = (str) => str.split(SWITCH_ON).join('  ').split(SWITCH_OFF).join('  ');

export const nemethHybrid = (s) => {
  if (!globalThis.NemethToLatex) return null;
  let r1;
  try {
    r1 = globalThis.NemethToLatex.convert(padNemethSwitches(s));
  } catch (e) {
    r1 = { latex: null, spans: [] };
  }

  let r2 = null;
  try {
    r2 = nemethMathsToLatexV2(s);
  } catch (e) { v2Failed(r1, 'Nemeth', e); }

  if (r2 && (!r2.badCells || r2.badCells.length === 0)) {
    const r2LatexClean = normalizeLatex(r2.latex);
    const r1LatexClean = normalizeLatex(r1.latex);
    if (r2LatexClean === r1LatexClean || r1.latex === null) {
      return r2;
    } else if (!sameMaths(r1.latex, r2.latex)) {
      r1.uncertain = true;
      r1.v2_latex = r2.latex;
    }
  }

  if (r1.latex === null) {
    throw new Error('Syntax Error');
  }

  return r1;
};
