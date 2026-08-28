/* ===========================================================================
 * UEB (Technical) maths braille -> LaTeX — core-subset converter
 * ---------------------------------------------------------------------------
 * Input:  a string of Unicode braille cells (U+2800–U+28FF). ASCII spaces and
 *         U+2800 blanks are both treated as spaces.
 * Output: { latex, warnings }.
 *
 * Sibling of ../nemeth-to-latex.js, for UEB Technical instead of Nemeth.
 * There is no library that back-translates UEB maths into structure (MathCAT
 * and liblouis only go the other way), so this is a hand-written parser — but
 * every symbol below was derived EMPIRICALLY from MathCAT's own UEB output
 * (MathML -> UEB), not from memory, and is round-trip tested against it
 * (see tools/ueb-roundtrip.js).
 *
 * Grade-1 indicators (⠰ alone, ⠰⠰ word) are mode markers, not content: they
 * are skipped unless they introduce a script/root/fraction.
 *
 * LIMITATIONS (see bottom of file).
 * ======================================================================== */

import { UEB_SYMBOLS } from './ueb-symbols.mjs';

const D = (s) => String.fromCodePoint(
  0x2800 + [...s].reduce((a, c) => a | (1 << (Number(c) - 1)), 0));

// Prefix cells
const G1     = D('56');     // ⠰ grade-1 symbol indicator
const PRE5   = D('5');      // ⠐ common arithmetic-operator prefix
const PRE4   = D('4');      // ⠈ comparison prefix
const PRE456 = D('456');    // ⠸ "under/over" prefix (≥ ≤)
const GREEKI = D('46');     // ⠨ greek indicator (also 1st cell of ⠨⠌ fraction line)

// Structure
const NUM    = D('3456');   // ⠼ numeric indicator
const SUP    = D('35');     // ⠔ superscript (after ⠰)
const SUB    = D('26');     // ⠢ subscript  (after ⠰)
const SQRT_O = D('146');    // ⠩ radical open (after ⠰)
const SQRT_C = D('346');    // ⠬ radical close
const FRAC_O = D('12356');  // ⠷ general-fraction open (after ⠰)
const FRAC_C = D('23456');  // ⠾ general-fraction close
const FRAC_L = D('34');     // ⠌ fraction line — simple numeric, and 2nd cell of ⠨⠌
const DECPT  = D('256');    // ⠲ decimal point
const CAP    = D('6');      // ⠠ capital sign
const COMMA  = D('2');      // ⠂ comma (thousands separator inside numeric mode)
const GRP_O  = D('126');    // ⠣ grouping open  (bare: scope of a script)
const GRP_C  = D('345');    // ⠜ grouping close
const TERM   = D('3');      // ⠄ 2nd cell of the grade-1 passage terminator ⠰⠄
const PCT    = D('356');    // ⠴ 2nd cell of percent ⠨⠴
const MODC   = D('156');    // ⠱ modifier root (bar) — see MODIFIERS
const DOTC   = D('256');    // ⠲ modifier root (dot)
const VJUX   = D('56') + D('12456');   // ⠰⠻ vertical juxtaposition → binomial
const SHAPE  = D('1246');   // ⠫ shape indicator (GTM §14), closed by ⠱

// Grouping symbols that are NOT the ⠐⠣…⠐⠜ round pair. GTM §7: the bracket type
// is carried by the prefix, so these are plain print symbols.
const BRACKETS = {
  [GREEKI + GRP_O]: '[',   [GREEKI + GRP_C]: ']',    // ⠨⠣ ⠨⠜
  [PRE456 + GRP_O]: '\\{', [PRE456 + GRP_C]: '\\}',  // ⠸⠣ ⠸⠜
};

// GTM §12: a modifier FOLLOWS the item it decorates, and the item is either the
// preceding symbol or a ⠣…⠜ group. Longest match first. Getting this wrong is
// not a quiet failure — the symbol table was reading a bare ⠱ as Greek η, so
// x̄ came out as "xη" with no warning at all.
const MODIFIERS = [
  [D('6') + D('45') + MODC, (x) => `\\underset{\\rightarrow}{${x}}`], // ⠠⠘⠱ arrow under
  [D('45') + MODC,          (x) => `\\vec{${x}}`],                    // ⠘⠱ arrow over
  [D('6')  + MODC,          (x) => `\\underline{${x}}`],              // ⠠⠱ bar under
  [D('5')  + MODC,          (x) => `\\hat{${x}}`],                    // ⠐⠱ hat
  [D('45') + DOTC,          (x) => `\\dot{${x}}`],                    // ⠘⠲ dot over
  [D('6') + D('456') + MODC, (x) => `\\underset{\\sim}{${x}}`],       // ⠠⠸⠱ tilde under
  [D('456') + MODC,         (x) => `\\tilde{${x}}`],                  // ⠸⠱ tilde over
  [D('4') + MODC,           (x) => `\\cancel{${x}}`],                 // ⠈⠱ line through (GTM 4.1.6)
  [MODC,                    (x) => `\\bar{${x}}`],                    // ⠱  bar over
];

// Typeform (bold/italic/underline/script) is PRESENTATION, not content: prefix
// ⠘/⠨/⠸/⠈ followed by a level cell (symbol/word/passage/terminator). Skipped —
// the digits and letters are what the reader needs.
const TYPEFORM_PREFIX = new Set([D('45'), D('46'), D('456'), D('4')]);
const TYPEFORM_LEVEL  = new Set([D('2'), D('23'), D('2356'), D('3')]);
const TF_SYMBOL = D('2'), TF_WORD = D('23'), TF_PASSAGE = D('2356'), TF_TERM = D('3');

// Which typeforms carry MEANING in maths, and so must not be dropped.
// Only the two the forward translator actually emits are listed; the others stay
// skipped rather than guessed at.
//   ⠈  GTM 11.6 — the number sets ℝ ℤ ℚ ℕ ℂ are written this way
//   ⠘  GTM 15.6 — how a vector is told from a scalar
const TYPEFORM_TEX = { [D('4')]: '\\mathscr', [D('45')]: '\\mathbf' };

// UEB has ONE script typeform, so ⠈⠆ is what \mathbb, \mathscr and \mathfrak all
// translate to — the braille cannot tell them apart and both readings re-braille
// identically. A single capital from the number-set letters is overwhelmingly
// the set in school maths, so that is the reading shown; anything else stays
// script. This is a presentation choice between indistinguishable inputs, not a
// guess at lost content.
const NUMBER_SETS = new Set(['R', 'Z', 'Q', 'N', 'C']);

// Second cells after a prefix
const OPS5 = { [D('235')]: '+', [D('36')]: '-', [D('236')]: '\\times ',
               [D('34')]: '\\div ', [D('2356')]: '=', [D('126')]: '(', [D('345')]: ')' };
const OPS4 = { [D('126')]: '<', [D('345')]: '>', [D('156')]: '\\neq ' };
const OPS456 = { [D('235')]: '\\pm ', [D('36')]: '\\mp ' };   // ⠸⠖ / ⠸⠤
const OPS456_4 = { [D('126')]: '\\le ', [D('345')]: '\\ge ' };

// Letters a–z (UEB = standard braille letters)
const LETTERS = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((ch, i) => {
  const pat = ['1','12','14','145','15','124','1245','125','24','245','13','123','134',
               '1345','135','1234','12345','1235','234','2345','136','1236','2456',
               '1346','13456','1356'][i];
  LETTERS[D(pat)] = ch;
});
// Digits: after ⠼, a–j mean 1–0.
const DIGIT_OF = { a:'1', b:'2', c:'3', d:'4', e:'5', f:'6', g:'7', h:'8', i:'9', j:'0' };

// Function names. UEB has no special convention for operator names, so these are
// just letters — which means a dictionary is the only way to recover them.
// Two wrinkles, both verified against MathCAT's own output:
//   • In grade 2 the name may be CONTRACTED: "sin" is ⠎⠔ (s + the "in"
//     contraction), not ⠎⠊⠝ — and ⠔ is also the superscript indicator.
//   • The same expression can be spelled either way depending on context
//     (sin(x) → ⠎⠔, but y=2 sin x → ⠎⠊⠝).
// To avoid turning s² (⠎⠔⠼⠃) into "sin 2", a match only counts when what
// follows is an argument: a space, an opening bracket/grouping, or end of input.
const L = (word) => word.split('').map((ch) => {
  const pat = { a:'1',b:'12',c:'14',d:'145',e:'15',f:'124',g:'1245',h:'125',i:'24',j:'245',
                k:'13',l:'123',m:'134',n:'1345',o:'135',p:'1234',q:'12345',r:'1235',s:'234',
                t:'2345',u:'136',v:'1236',w:'2456',x:'1346',y:'13456',z:'1356' }[ch];
  return D(pat);
}).join('');

const FUNCTIONS = [
  ['arcsin', '\\arcsin'], ['arccos', '\\arccos'], ['arctan', '\\arctan'],
  ['sinh', '\\sinh'], ['cosh', '\\cosh'], ['tanh', '\\tanh'],
  ['sin', '\\sin'], ['cos', '\\cos'], ['tan', '\\tan'],
  ['sec', '\\sec'], ['csc', '\\csc'], ['cot', '\\cot'],
  ['log', '\\log'], ['ln', '\\ln'], ['exp', '\\exp'],
  ['lim', '\\lim'], ['max', '\\max'], ['min', '\\min'],
  ['det', '\\det'], ['gcd', '\\gcd'], ['mod', '\\bmod'],
].map(([w, tex]) => ({ cells: L(w), tex }))
  // plus the contracted forms MathCAT actually emits
  .concat([
    { cells: D('234') + D('35'), tex: '\\sin' },                  // ⠎⠔  s + "in"
    { cells: D('345') + D('14') + D('136') + D('56') + D('2345'), tex: '\\mathrm{argument}' }, // ar g u ment
    { cells: D('234') + D('15') + D('16'), tex: '\\mathrm{sech}' }, // s e ch
    { cells: D('14') + D('135') + D('146'), tex: '\\cosh' }, // c o sh
    { cells: D('345') + D('14') + D('14') + D('135') + D('234'), tex: '\\arccos' }, // ar c c o s
    { cells: D('12456') + D('1235') + D('135') + D('1235'), tex: '\\mathrm{error}' }, // er r o r
    { cells: D('124') + D('136') + D('1345') + D('14') + D('56') + D('1345'), tex: '\\mathrm{function}' }, // f u n c tion
    { cells: D('12456') + D('124'), tex: '\\mathrm{erf}' }, // er f
    // hyperbolics as MathCAT actually contracts them (measured 2026-07-23):
    { cells: D('234') + D('35') + D('125'), tex: '\\sinh' },      // ⠎⠔⠓ s + "in" + h
    { cells: D('14') + D('135') + D('146'), tex: '\\cosh' },      // ⠉⠕⠩ c + o + "sh"
    { cells: D('14') + D('135') + D('1456'), tex: '\\coth' },     // ⠉⠕⠹ c + o + "th"
  ])
  .sort((a, b) => b.cells.length - a.cells.length);               // longest match first

// UEB Greek: ⠨ + a cell, ⠠⠨ + a cell for the capital. Keyed by CELL, not by the
// roman letter — three of them are NOT letters at all but contraction cells, so
// a letter-keyed table silently mistranslates them:
//   θ is ⠹ ("th"), η is ⠱ ("wh"), χ is ⠯ ("and").
// We previously read ⠨⠉ as chi (there is no such thing) and never recognised
// ⠨⠹ theta — which is why "sin θ" failed. Cells below are from the DAISY
// braille-maths comparison sheet, "Unicode Other codes", UEB column.
const GREEK_CELL = {
  '⠁':'\\alpha', '⠃':'\\beta', '⠛':'\\gamma', '⠙':'\\delta', '⠑':'\\epsilon',
  '⠵':'\\zeta', '⠱':'\\eta', '⠹':'\\theta', '⠊':'\\iota', '⠅':'\\kappa',
  '⠇':'\\lambda', '⠍':'\\mu', '⠝':'\\nu', '⠭':'\\xi', '⠕':'\\omicron',
  '⠏':'\\pi', '⠗':'\\rho', '⠎':'\\sigma', '⠞':'\\tau', '⠥':'\\upsilon',
  '⠋':'\\phi', '⠯':'\\chi', '⠽':'\\psi', '⠺':'\\omega',
};
// Capitals. Where the capital Greek letter is identical to a roman one, print
// the roman letter — that is what a sighted reader sees.
const GREEK_CAP_CELL = {
  '⠁':'A', '⠃':'B', '⠛':'\\Gamma ', '⠙':'\\Delta ', '⠑':'E', '⠵':'Z',
  '⠱':'H', '⠹':'\\Theta ', '⠊':'I', '⠅':'K', '⠇':'\\Lambda ', '⠍':'M',
  '⠝':'N', '⠭':'\\Xi ', '⠕':'O', '⠏':'\\Pi ', '⠗':'P', '⠎':'\\Sigma ',
  '⠞':'T', '⠥':'\\Upsilon ', '⠋':'\\Phi ', '⠯':'X', '⠽':'\\Psi ', '⠺':'\\Omega ',
};

// UNITS ARE UPRIGHT. "42 cm" is not 42 times c times m, and a maths renderer
// italicises bare letters by default, so units came out as variables — visibly
// wrong to any teacher, and the largest single group of failures on real school
// maths. Only applied after a NUMBER (or a space following one), which is what
// distinguishes metres from the gradient m in y = mx + c.
const UNIT_WORDS = ['mm','cm','km','kg','mg','ml','kl','mol','rad','min','Hz',
                    'm','g','l','s','h','N','J','W','V','K','A'];
const UNIT_RE = /(\d\uE000*\s*\uE000*|\uE000*\s\uE000*)(mm|cm|km|kg|mg|ml|kl|mol|rad|min|Hz|m|g|l|s|h|N|J|W|V|K|A)(?!\uE000*[A-Za-z])/g;
// \text{...} spans are already prose — marking units inside them wrapped
// " mol " a second time and produced invalid nested markup.
const uprightUnits = (tex) => {
  const spans = [];
  const masked = String(tex).replace(/\\text\{[^{}]*\}/g, (m) => { spans.push(m); return '\u0001' + (spans.length - 1) + '\u0001'; });
  const marked = masked.replace(UNIT_RE, (m, pre, u) => pre + '\\mathrm{' + u + '}');
  return marked.replace(/\u0001(\d+)\u0001/g, (_, k) => spans[Number(k)]);
};

export function uebMathsToLatex(input) {
  // Normalise: ASCII space and U+2800 blank both mean "space".
  const cells = [...String(input)].map((c) => (c === ' ' ? '⠀' : c))
    .filter((c) => c.codePointAt(0) >= 0x2800 && c.codePointAt(0) <= 0x28ff);
  const warnings = [];
  // Genuine ambiguity is a separate channel from warnings: a warning means "I
  // could not read this"; an ambiguity means "I read it, and the braille
  // legitimately means more than one thing" (GTM 15.5: flag, never guess).
  // Kept out of `warnings` so honesty here cannot depress the clean metric.
  const ambiguities = [];
  // §16.2/§16.5: a capitals PASSAGE spans maths — HNCO + ROH → …, capitals
  // resuming after every operator until the ⠠⠄ terminator. A sticky flag,
  // because the wave-1 loop stopped at the first non-letter and everything
  // after the + came out lowercase.
  let capsPassage = false;
  const badCells = [];          // indexes of cells we could not read
  let i = 0;
  let rootDepth = 0;          // >0 while inside ⠩ … ⠬ (see the omission rule)

  const peek = (k = 0) => cells[i + k];
  // Set when a "directly over/under" indicator has been read; parseSeq applies
  // it to the preceding piece.
  let pendingMod = null;

  // GTM §7.9. On a LARGE OPERATOR (∑ ∏ ∫ lim) the limits belong above and below
  // and LaTeX already does that for _ and ^ in display mode, which is how the
  // app renders. On anything else — a letter, a bracketed group — ^ would put
  // the mark beside the base instead of over it, so x with two dots above came
  // out as x^{¨} and MN with an arrow over it as MN^{↔}.
  // NOT \b at the end: a limit already attached makes "\sum_{x=1}", and _ counts
  // as a word character, so \b failed there and the second limit was rendered
  // with \overset instead of joining the first.
  const LARGE_OP = /\\(sum|prod|int|oint|bigcup|bigcap|lim|max|min|sup|inf)(?![a-zA-Z])|[∑∏∫⋃⋂]/;
  const ACCENT = { '¨': 'ddot', '˙': 'dot', '¯': 'bar', '‾': 'bar', '^': 'hat', '~': 'tilde' };
  function modifiedExpression(base, mod, over) {
    const b = String(base).trim(), m = String(mod).trim();
    if (LARGE_OP.test(b)) return b + (over ? '^' : '_') + `{${m}}`;
    if (over && ACCENT[m] && b) return `\\${ACCENT[m]}{${b}}`;
    if (!b) return over ? `^{${m}}` : `_{${m}}`;
    return over ? `\\overset{${m}}{${b}}` : `\\underset{${m}}{${b}}`;
  }
  const isSpace = (c) => c === '⠀';

  // True if the cells at `at` are exactly `str` (which may be more than one cell).
  const matches = (str, at = i) => cells.slice(at, at + str.length).join('') === str;

  // Parse a sequence until `stop` or end. `stop` may be MORE THAN ONE CELL (the
  // binomial separator ⠰⠻ and closer ⠐⠜ both are); the test happens here, before
  // parseOne, so a multi-cell stop can't be half-consumed as a grade-1 marker.
  let topRecord = null;
  function parseSeq(stop, isTop = false) {
    // Pieces, not one string. A "directly over/under" indicator FOLLOWS what it
    // decorates, so rendering it needs the base — and a parser that has already
    // concatenated the base into a string no longer has it. Keeping the pieces
    // is the smallest change that makes the base reachable, and it is the first
    // step of building a tree rather than emitting text as we go.
    const pieces = [];
    // cell-range of each piece, recorded only for the TOP-level sequence —
    // this is the provenance that lets a braille chunk light up its part of
    // the rendered equation (PLAN constraint 5)
    const ranges = isTop ? [] : null;
    const out = () => pieces.join('');
    while (i < cells.length) {
      const c = peek();
      if (stop && matches(stop)) break;
      const c0 = i;
      const piece = parseOne(stop);
      if (piece === null) {
        // A closer the CALLER is waiting for — hand control back to it.
        if (stop) break;
        // At the top level there is no caller, so breaking here threw away the
        // whole line: one stray ⠜ (the "ar" contraction inside a word) turned
        // "Area = bh = 5.3 = 15" into an empty result. Skip the cell, flag it,
        // and keep reading — a partly-read line is far more use than nothing.
        warnings.push(`cell ${i + 1} (${dotsOf(peek())}) not recognised`);
        badCells.push(i);
        i++;
        continue;
      }
      pieces.push(piece);
      if (ranges) ranges.push([c0, i]);

      // A modifier was read; it belongs to what came BEFORE it.
      if (pendingMod) {
        const { wrap } = pendingMod;
        pendingMod = null;
        // Find the last piece with real content — the modifier's own '' and any
        // spaces sit between it and its base.
        let k = pieces.length - 1;
        while (k >= 0 && !pieces[k].trim()) k--;
        if (k >= 0) {
          pieces[k] = wrap(pieces[k].trim());
          // the modifier's cells belong to the piece it wrapped
          if (ranges) { ranges[k][1] = i; ranges[ranges.length - 1] = [i, i]; }
        } else pieces.push(wrap(''));
      }
    }
    if (isTop) topRecord = { pieces: pieces.slice(), ranges };
    return out();
  }

  // One token/atom (plus any trailing scripts).
  function parseOne(stop) {
    const c = peek();
    if (c === undefined) return null;

    if (isSpace(c)) { i++; return ' '; }

    // COMPOSITE SYMBOLS FIRST (GTM 14.3, 3, 12). Four-cell-and-longer table
    // entries can never be reassembled once a structural branch has bitten:
    // the capital-Greek branch ate the front of ~ (equal-by-definition) and
    // orphaned its juxtaposition cell; the grouping branch did the same to the
    // over-def equals; the comparison branch decomposed the negated relations
    // into "<" plus a stray. The len >= 4 guard is what keeps the old
    // shadowing bugs dead: no 2-3-cell structural prefix (the cube-root cells,
    // the bar modifier) can be stolen back by the table.
    {
      const early = matchSymbolAt(i);
      // …but never an entry with the shape indicator ⠫ in it: shapes are a
      // GRAMMAR (opener + body + terminator, GTM 14), and matching a flat
      // table prefix of one broke seven shape rules at the wave-1 reprobe.
      // The shape branch owns everything ⠫ touches.
      if (early && early.len >= 4 && !early.cells.includes(SHAPE)) {
        i += early.len; return early.tex;
      }
    }

    // MathCAT's unknown-character note: when it has no UEB cells for a symbol
    // (⋯, ϕ) it emits ⠄⠸⠡ + the codepoint spelled out ("x0022ef") + ⠄. The
    // note literally states the codepoint, so decoding it is exact — found by
    // the external formula-sheet benchmark, where \cdots and \phi hit this.
    if (c === TERM && peek(1) === PRE456 && peek(2) === D('16')) {
      // find the closing ⠄; between them only letters and the ⠼/⠰ mode marks
      let j = i + 3, ok = j < cells.length;
      while (j < cells.length && cells[j] !== TERM && j - i < 24) {
        const ch = cells[j];
        if (ch === NUM || ch === G1 || LETTERS[ch] !== undefined) { j++; continue; }
        ok = false; break;
      }
      if (ok && cells[j] === TERM) {
        // digits arrive as their a–j letter forms after ⠼ — undo those
        // ⠰ is the grade-1 SYMBOL indicator: it governs the next symbol
        // only, after which numeric mode resumes. Treating it as a persistent
        // mode meant every cell after the first letter of the codepoint was
        // read as a letter, so a hex value with a letter before a digit
        // decoded to the wrong character entirely — U+03B1 α came back as
        // U+03BA κ, a silent substitution rather than a refusal. The test
        // file did not expose it because its only letter is the last digit.
        let hex = '', mode = null, g1Once = false;
        for (let k = i + 3; k < j; k++) {
          const ch = cells[k];
          if (ch === NUM) { mode = 'num'; g1Once = false; continue; }
          if (ch === G1) { g1Once = true; continue; }
          const L = LETTERS[ch];
          hex += (!g1Once && mode === 'num' && DIGIT_OF[L] !== undefined) ? DIGIT_OF[L] : L;
          g1Once = false;
        }
        if (/^x[0-9a-f]+$/i.test(hex)) {
          const cp = parseInt(hex.slice(1), 16);
          const KNOWN = { 0x22ef: '\\cdots ', 0x2026: '\\ldots ', 0x22ee: '\\vdots ',
                          0x3d5: '\\phi ', 0x3c6: '\\varphi ', 0x22c5: '\\cdot ',
                          // Integrals by Unicode name, checked rather than
                          // assumed: \iiint is U+222D TRIPLE INTEGRAL. The
                          // map previously gave it as U+2A0B, which is
                          // SUMMATION WITH INTEGRAL — a different character —
                          // so a triple integral could never match and fell
                          // through to the bare-character path.
                          0x222b: '\\int ', 0x222c: '\\iint ',
                          0x222d: '\\iiint ', 0x2a0c: '\\iiiint ',
                          // The rest of the ordinary maths repertoire. Without
                          // these every passed-through symbol became \text{X}
                          // with a transcriber note — visible and safe, but
                          // upright and wrongly spaced for an operator. Each
                          // codepoint was checked against its Unicode name
                          // rather than recalled, which is how \iiint was
                          // found pointing at SUMMATION WITH INTEGRAL. The
                          // same check caught √ U+221A: it is \surd, the bare
                          // radical, not \sqrt, which requires an argument.
                          0x3b1: '\\alpha ', 0x3b2: '\\beta ', 0x3b3: '\\gamma ',
                          0x3b4: '\\delta ', 0x3b5: '\\varepsilon ', 0x3b6: '\\zeta ',
                          0x3b7: '\\eta ', 0x3b8: '\\theta ', 0x3b9: '\\iota ',
                          0x3ba: '\\kappa ', 0x3bb: '\\lambda ', 0x3bc: '\\mu ',
                          0x3bd: '\\nu ', 0x3be: '\\xi ', 0x3c0: '\\pi ', 0x3c1: '\\rho ',
                          0x3c3: '\\sigma ', 0x3c4: '\\tau ', 0x3c5: '\\upsilon ',
                          0x3c7: '\\chi ', 0x3c8: '\\psi ', 0x3c9: '\\omega ',
                          0x393: '\\Gamma ', 0x394: '\\Delta ', 0x398: '\\Theta ',
                          0x39b: '\\Lambda ', 0x39e: '\\Xi ', 0x3a0: '\\Pi ',
                          0x3a3: '\\Sigma ', 0x3a6: '\\Phi ', 0x3a8: '\\Psi ',
                          0x3a9: '\\Omega ', 0x2211: '\\sum ', 0x220f: '\\prod ',
                          0x221a: '\\surd ', 0x221e: '\\infty ', 0x2202: '\\partial ',
                          0x2207: '\\nabla ', 0xb1: '\\pm ', 0x2213: '\\mp ',
                          0xd7: '\\times ', 0xf7: '\\div ', 0x2218: '\\circ ',
                          0x222e: '\\oint ', 0x2260: '\\neq ', 0x2264: '\\leq ',
                          0x2265: '\\geq ', 0x2248: '\\approx ', 0x2261: '\\equiv ',
                          0x221d: '\\propto ', 0x2208: '\\in ', 0x2209: '\\notin ',
                          0x2282: '\\subset ', 0x2283: '\\supset ', 0x2286: '\\subseteq ',
                          0x2287: '\\supseteq ', 0x222a: '\\cup ', 0x2229: '\\cap ',
                          0x2192: '\\to ', 0x2190: '\\leftarrow ',
                          0x2194: '\\leftrightarrow ', 0x21d2: '\\Rightarrow ',
                          0x21d0: '\\Leftarrow ', 0x21d4: '\\Leftrightarrow ',
                          0x21a6: '\\mapsto ', 0x2200: '\\forall ', 0x2203: '\\exists ',
                          0x2205: '\\emptyset ', 0x2220: '\\angle ', 0x22a5: '\\perp ',
                          0x2225: '\\parallel ', 0x2135: '\\aleph ' };
          i = j + 1;
          if (KNOWN[cp]) return KNOWN[cp];
          // `warn` was never declared here. In the browser the page's
          // <div id="warn"> becomes a global of that name, so this resolved
          // to the element and threw "warn is not a function" — turning an
          // unknown character into a crash that lost the whole line.
          warnings.push(`transcriber note for U+${cp.toString(16).toUpperCase()} — shown as the bare character`);
          return `\\text{${String.fromCodePoint(cp)}}`;
        }
      }
    }

    // Grade-1 indicators: ⠰⠰ (word) then ⠰ (symbol). Skip unless they
    // introduce a script / root / fraction.
    if (c === G1) {
      const n1 = peek(1);
      if (n1 === G1) {                 // ⠰⠰ word indicator
        if (peek(2) === SQRT_O) { i += 2; return parseRoot(); }
        i += 2; return '';
      }
      if (n1 === SUP)    { i += 2; return applyScript('^'); }
      if (n1 === SUB)    { i += 2; return applyScript('_'); }
      if (n1 === SQRT_O) { i += 1; return parseRoot(); }
      if (n1 === FRAC_O) { i += 2; return parseGeneralFraction(); }
      if (n1 === TERM)   { i += 2; return ''; }   // ⠰⠄ ends a grade-1 passage
      i++; return '';                  // plain grade-1 marker
    }

    // Capital Greek: ⠠⠨ + letter. Σ/Π followed by a limit indicator are the
    // n-ary operators, which is how MathCAT writes sum and product.
    if (c === CAP && peek(1) === GREEKI && GREEK_CAP_CELL[peek(2)]) {
      const cell = peek(2);
      i += 3;
      const nary = { '⠎': '\\sum ', '⠏': '\\prod ' }[cell];
      if (nary && peek() === GREEKI && (peek(1) === SUB || peek(1) === SUP)) return nary;
      return GREEK_CAP_CELL[cell];
    }

    // ⠨⠢ / ⠨⠔ = "directly under" / "directly over" (GTM §7.9). For an n-ary
    // operator these are its limits, which is exactly a subscript/superscript.
    if (c === GREEKI && (peek(1) === SUB || peek(1) === SUP)) {
      const over = peek(1) === SUP;
      i += 2;
      const mod = parseScriptOperand();
      pendingMod = { wrap: (base) => modifiedExpression(base, mod, over) };
      return '';
    }

    // TYPEFORM. These used to be skipped as "presentation, not content", which
    // silently turned ℝ into R and a vector v into a scalar v — the teacher saw
    // a plausible expression with no sign anything had been dropped. GTM 11.6
    // and 15.6 make both meaning-bearing.
    if (TYPEFORM_PREFIX.has(c) && TYPEFORM_LEVEL.has(peek(1))) {
      const cmd = TYPEFORM_TEX[c];
      const level = peek(1);
      i += 2;
      if (!cmd || level === TF_TERM) return '';   // untranslated form, or a stray terminator
      // The typeform applies to the WORD — letters, digits and the indicators
      // that qualify them. It stops at anything else, which is why ⠈⠆⠠⠗⠔⠼⠃ is
      // a typeformed R carrying an ordinary superscript 2, not a typeformed R².
      const inWord = () => {
        const n = peek();
        return n !== undefined && !isSpace(n) && n !== stop &&
          // UEB digits ARE the letters a–j, so LETTERS covers them once ⠼ has
          // opened numeric mode; there is no separate digit table.
          (LETTERS[n] !== undefined || n === CAP || n === G1 || n === NUM);
      };
      let body = '';
      while (inWord()) {
        if (TYPEFORM_PREFIX.has(peek()) && peek(1) === TF_TERM) { i += 2; break; }
        const before = i;
        const piece = parseOne(stop);
        if (piece === null || i === before) break;
        body += piece;
        // A symbol-level form covers one symbol — but the indicators before it
        // parse to nothing, so "one symbol" means the first piece with content.
        if (level === TF_SYMBOL && piece.trim()) break;
      }
      body = body.trim();
      if (!body) return '';
      // script lowercase l IS ℓ — the character \ell exists for exactly this
      // (litre, pendulum length), and MathCAT round-trips it as ⠈⠆⠇.
      if (cmd === '\\mathscr' && body === 'l') return '\\ell ';
      const tex = (cmd === '\\mathscr' && NUMBER_SETS.has(body)) ? '\\mathbb' : cmd;
      return `${tex}{${body}}`;
    }

    // ⠣ … ⠜ as a general group (not only inside a script): it is the "item" a
    // modifier decorates, e.g. ⠣x+y⠜⠠⠱ = underline(x+y).
    if (c === GRP_O) {
      i++;
      const body = parseSeq(GRP_C);
      if (peek() === GRP_C) i++; else warnings.push('Unclosed grouping (missing ⠜)');
      // A group whose body is ONLY letters and spaces is \text — that is how
      // MathCAT wraps unit runs (" mol dm"), and preserving the spacing is
      // what lets them round-trip. A single word stays on the maths path
      // (uprightUnits owns it); anything with structure is a modifier scope.
      if (/^[A-Za-z ]+$/.test(body) && body.trim().includes(' ')) {
        return `\\text{${body}}`;
      }
      return withModifier(body.trim());
    }

    // Function names, before scripts/letters so ⠎⠔ reads as "sin" rather than
    // s-superscript. Only when an argument follows (see FUNCTIONS comment).
    const fn = matchFunction();
    if (fn) return fn;

    // BARE indicators. The grade-1 prefix ⠰ is only needed to *enter* grade-1
    // mode; once inside a technical passage MathCAT emits these on their own, so
    // requiring ⠰ (as we first did) broke a² + b² = c², indices, roots and more.
    if (c === SUP)    { i++; return applyScript('^'); }
    if (c === SUB)    { i++; return applyScript('_'); }
    if (c === SQRT_O) { return parseRoot(); }          // parseRoot consumes ⠩
    if (c === FRAC_O) { i++; return parseGeneralFraction(); }

    // ⠠⠠⠠ = capitals PASSAGE (UEB 8.5, GTM 16.2): capitals continue across
    // spaces until the terminator ⠠⠄. Chemistry runs on this — HNCO + ROH — and
    // the word branch below used to eat two of the three ⠠ and let the third
    // capitalise one letter, silently wrecking every formula after the first.
    if (c === CAP && peek(1) === CAP && peek(2) === CAP) {
      capsPassage = true;
      i += 3;
      return '';
    }
    if (capsPassage && c === CAP && peek(1) === TERM) {
      capsPassage = false;
      i += 2;
      return '';
    }
    // ⠠⠠ = capital WORD indicator: every letter up to the next non-letter is a
    // capital. Without this, "II" (Roman two) read as "Ii".
    if (c === CAP && peek(1) === CAP) {
      i += 2;
      let s = '';
      while (i < cells.length) {
        if (LETTERS[peek()] !== undefined) { s += LETTERS[peek()].toUpperCase(); i++; continue; }
        // ⠠⠠⠨⠙⠓ is ΔH: the capital-word indicator capitalises the Greek letter
        // too, and dropping it here read every enthalpy as lowercase δh.
        if (peek() === GREEKI && GREEK_CAP_CELL[peek(1)]) { s += GREEK_CAP_CELL[peek(1)]; i += 2; continue; }
        break;
      }
      // ⠠⠄ — or MathCAT's short form, a bare ⠄ — after a capital word is its
      // TERMINATOR (UEB 8.5.5), not an apostrophe: ⠠⠠⠃⠁⠄⠉⠕⠎ is "BA cos", and
      // reading the ⠄ as ' gave physics "BA′cosθ". Nothing genuine is lost:
      // prime in UEB maths is ⠶, never ⠄.
      if (peek() === CAP && peek(1) === TERM) i += 2;
      else if (peek() === TERM) i += 1;
      return s;
    }

    // GTM 9.7–9.8 — Pr, Re, Im are IRRECOVERABLY ambiguous with products of
    // variables (the standard's own admission). With an argument following,
    // the function reading is rendered and BOTH are offered to the teacher —
    // and unlike the vertical bar, these two readings LOOK different (upright
    // function vs italic product), so the panel shows them rendered.
    if (c === CAP && LETTERS[peek(1)] && LETTERS[peek(2)]) {
      const two = LETTERS[peek(1)].toUpperCase() + LETTERS[peek(2)];
      const FN2 = { Pr: '\\Pr ', Re: '\\operatorname{Re}', Im: '\\operatorname{Im}' };
      if (FN2[two]) {
        const after = peek(3);
        const argFollows = (after === PRE5 && peek(4) === GRP_O) || after === GRP_O;
        if (argFollows) {
          ambiguities.push({
            at: i, len: 3, cells: cells.slice(i, i + 3).join(''), reading: two,
            alternatives: [two + ' — the function', two[0] + '·' + two[1] + ' — a product of two variables'],
            latexes: [FN2[two].trim() + '(x)', two[0] + ' ' + two[1] + '(x)'],
          });
          i += 3; return FN2[two];
        }
      }
    }

    // GTM 9.1: a CAPITALISED function name (Sin 30) — the capital sign then a
    // dictionary hit reads as the upright function, capital kept.
    if (c === CAP && LETTERS[peek(1)]) {
      for (const f of FUNCTIONS) {
        if (cells.slice(i + 1, i + 1 + f.cells.length).join('') !== f.cells) continue;
        const after = cells[i + 1 + f.cells.length];
        if (after === undefined || isSpace(after) || after === NUM || after === PRE5 || after === CAP) {
          i += 1 + f.cells.length;
          const name = f.tex.replace(/^\\/, '');
          return `\\operatorname{${name[0].toUpperCase()}${name.slice(1)}}`;
        }
      }
    }
    // Capital sign: ⠠ before a letter.
    if (c === CAP) {
      const l = LETTERS[peek(1)];
      if (l) { i += 2; return withModifier(l.toUpperCase()); }
      // Not a capital at all, then. ⠠ opens a family of MULTI-CELL SYMBOLS the
      // table already knows — ⠠⠤ dash, ⠠⠡ ∴, ⠠⠴ ⠠⠶ — and this branch used to
      // swallow the ⠠ and return '' so none of them could ever match (GTM
      // 11.3, 6.5.4, 2.10). Table first; silence never.
      const sym = matchSymbolAt(i);
      if (sym && sym.len >= 2) { i += sym.len; return sym.tex; }
      // ⠠ + bracket is an ENLARGED grouping sign (GTM 15.1–15.3): a MATRIX
      // ROW. The ⠠ prefix is the braille's own disambiguator from a plain
      // bracketed product, and the row syntax is identical whether the child
      // writes rows side by side (MathCAT's linearisation) or one per line on
      // a brailler — so consecutive rows here chain into one matrix, and the
      // app can coalesce row-per-line the same way. Cells split on spaces.
      // ⠐⠣ round → pmatrix, ⠨⠣ square → bmatrix, ⠸⠳ bar → vmatrix
      // (determinants: opener and closer are the same cells, so the close
      // check inside a row and the open check after it alternate naturally).
      {
        const kindCell = peek(1);
        const det = kindCell === PRE456 && peek(2) === D('1256');
        const bra = (kindCell === PRE5 || kindCell === GREEKI) && peek(2) === GRP_O;
        if (det || bra) {
          const env = det ? 'vmatrix' : (kindCell === GREEKI ? 'bmatrix' : 'pmatrix');
          const closeCell = det ? D('1256') : GRP_C;
          const rows = [];
          while (peek() === CAP && peek(1) === kindCell && peek(2) === (det ? D('1256') : GRP_O)) {
            i += 3;
            const rowCells = [''];
            while (i < cells.length) {
              if (peek() === CAP && peek(1) === kindCell && peek(2) === closeCell) { i += 3; break; }
              const piece = parseOne(stop);
              if (piece === null) break;
              if (piece === ' ') { if (rowCells[rowCells.length - 1] !== '') rowCells.push(''); continue; }
              rowCells[rowCells.length - 1] += piece;
            }
            rows.push(rowCells.filter((x) => x !== '').join(' & '));
          }
          if (rows.length) return `\\begin{${env}}${rows.join(' \\\\ ')}\\end{${env}}`;
        }
      }
      warnings.push(`stray capital sign at cell ${i}`);
      i++; return '';
    }

    // GTM 15.7 — PIECEWISE / grouped equations. The enlarged curly brace has
    // NO closing partner; MathCAT linearises "repeated at the start of each
    // braille line" as ⠠ fences: one after ⠸⠣, a ⠠⠠ pair between rows, one
    // before the passage terminator. A child's f(x) = {0 if x<0… is A-level
    // bread and butter and used to come out as \{0 x<0 X^{2}… with stray-cap
    // warnings. Within a row, the first top-level space splits value from
    // condition. Known limit, accepted: a capital WORD inside a row shares
    // the ⠠⠠ spelling with the row fence.
    if (c === PRE456 && peek(1) === GRP_O && peek(2) === CAP) {
      i += 3;
      const rows = [];
      let cur = '';
      const flush = () => {
        const t = cur.trim();
        if (t) { const sp = t.indexOf(' '); rows.push(sp < 0 ? t : t.slice(0, sp) + ' & ' + t.slice(sp + 1)); }
        cur = '';
      };
      while (i < cells.length) {
        if (peek() === CAP && peek(1) === CAP) { flush(); i += 2; continue; }
        if (peek() === CAP && (peek(1) === undefined || (peek(1) === G1 && peek(2) === TERM))) { i += 1; break; }
        const piece = parseOne(stop);
        if (piece === null) break;
        cur += piece;
      }
      flush();
      if (rows.length) return `\\begin{cases}${rows.join(' \\\\ ')}\\end{cases}`;
      return '\\{';
    }

    // GTM 16.7 / UEB 16 LINE MODE: ⠐⠒ opens a drawn horizontal line — bond
    // diagrams and number lines. Inside it, runs of ⠒ are the line (rendered
    // as bond dashes), ⠳+direction is an arrow continuous with the line, and
    // ⠄ ends the mode. A run of ⠒ with nothing ON the line stays the dot-run.
    if (c === PRE5 && peek(1) === D('25')) {
      let j = i + 2, itemsOnLine = false;
      while (j < cells.length && !isSpace(cells[j]) && cells[j] !== TERM) {
        if (cells[j] !== D('25')) { itemsOnLine = true; }
        j++;
      }
      if (!itemsOnLine) {
        i++;
        while (peek() === D('25')) i++;
        return '\\cdots ';
      }
      i += 2;
      while (peek() === D('25')) i++;   // the opener's ⠒ begins the first dash run
      let seg = '—';
      while (i < cells.length) {
        if (peek() === TERM) { i++; break; }
        if (isSpace(peek())) break;
        if (peek() === D('25')) { while (peek() === D('25')) i++; seg += '—'; continue; }
        // UEB 16.2.3: arrow mode NESTS inside line mode — ⠳ opens mid-line,
        // reads to its closing direction cell, and line mode resumes after.
        // The GTM 13 arrow branch in parseOne already does exactly this.
        // ⠺ is a vertical line CROSSING the horizontal (a bond crossing, a
        // number-line tick) — sourced from the GTM 16.7 inventory row.
        if (peek() === D('2456')) { i++; seg += '\\mid '; continue; }
        const cellHere = peek();
        const known = cellHere === D('1256') || cellHere === CAP || cellHere === NUM ||
                      LETTERS[cellHere] !== undefined;
        if (!known) warnings.push('line mode: cell beyond the sourced inventory — diagram may need spatial reading');
        const piece = parseOne(stop);
        if (piece === null) break;
        seg += piece;
      }
      return seg;
    }
    // GTM 16.6: the crossed and open electron dots of chemistry.
    if (c === GREEKI && peek(1) === PRE5 && peek(2) === D('236')) { i += 3; return '\\times '; }
    if (c === GREEKI && peek(1) === PRE5 && peek(2) === D('356')) { i += 3; return '\\circ '; }

    // GTM 16 bonds: double ⠨⠠⠤, triple ⠸⠠⠤, dotted ⠨⠐⠲.
    if (c === GREEKI && peek(1) === CAP && peek(2) === D('36')) { i += 3; return '='; }
    if (c === PRE456 && peek(1) === CAP && peek(2) === D('36')) { i += 3; return '\\equiv '; }
    if (c === GREEKI && peek(1) === PRE5 && peek(2) === DECPT) { i += 3; return '\\cdot '; }
    // GTM 16.5 / 1.7.5: ⠐⠐⠿ marks a DISPLAYED block — a mode marker, no glyph.
    if (c === PRE5 && peek(1) === PRE5 && peek(2) === D('123456')) { i += 3; return ''; }

    // UEB 6.4.1: a ⠲ between a letter and the numeric indicator is an
    // ABBREVIATION POINT — K.545, No.16 — not the dot modifier.
    if (c === DECPT && i > 0 && LETTERS[cells[i - 1]] !== undefined && peek(1) === NUM) {
      i++; return '.';
    }
    // GTM 9.7: the AND contraction ⠯ stands for the word inside probability
    // notation — Pr(A and B).
    if (c === D('12346')) { i++; return '\\text{ and }'; }

    // Multi-cell operators — longest first (maximal munch on prefix+root pairs).
    // ≠ is FOUR cells, ⠐⠶⠈⠱ ("=" followed by ⠈⠱). Matching it before ⠐⠶ is what
    // stops it decomposing into "=" + "\neq".
    if (c === PRE5 && peek(1) === D('2356') && peek(2) === PRE4 && peek(3) === D('156')) {
      i += 4; return '\\neq ';
    }
    // Absolute value ⠸⠳. GTM §11.4: one print symbol has ONE braille equivalent —
    // the bar is absolute value, conditional probability AND "such that", and the
    // code deliberately does not distinguish them. So emit the PRINT SYMBOL and
    // let the reader interpret it; inventing \left|…\right| would be a guess.
    if (c === PRE456 && peek(1) === D('1256')) {
      // GTM 1.3: this one bar serves absolute value, "such that" and
      // conditional probability, and braille deliberately does not say which.
      // Emit the print bar and RECORD the choice for the teacher (GTM 15.5).
      ambiguities.push({ at: i, len: 2, cells: '⠸⠳', reading: '|',
        alternatives: ['absolute value |x|', 'such that (set-builder)', 'given (conditional probability)'] });
      i += 2; return '|';
    }
    if (c === PRE456 && peek(1) === PRE4 && OPS456_4[peek(2)]) {
      const op = OPS456_4[peek(2)]; i += 3; return op;
    }
    if (c === PRE456 && OPS456[peek(1)] !== undefined) {      // ± ∓
      const op = OPS456[peek(1)]; i += 2; return op;
    }
    if (c === GREEKI && peek(1) === PCT) { i += 2; return '\\%'; }

    // Square brackets ⠨⠣⠨⠜ and curly braces ⠸⠣⠸⠜. Must come BEFORE the Greek
    // and ± blocks, both of which share these prefixes.
    const brk = BRACKETS[c + peek(1)];
    if (brk) { i += 2; return brk; }

    // ⠸⠌ diagonal slash — the LINEAR fraction of GTM §6.3/§6.4 ("2/3" written
    // across, not stacked). Distinct from ⠌, which stacks a numeric fraction.
    if (c === PRE456 && peek(1) === FRAC_L) { i += 2; return '/'; }
    if (c === GREEKI && peek(1) === D('36')) { i += 2; return '\\_'; }   // ⠨⠤ low line
    // Binomial coefficient (GTM §14.3): ⠐⠣ top ⠰⠻ bottom ⠐⠜ — round brackets
    // with the two terms stacked. Detected by looking ahead for a ⠰⠻ at the
    // SAME bracket depth, so an ordinary "(a, b)" is untouched.
    if (c === PRE5 && peek(1) === GRP_O && findVjux() >= 0) {
      i += 2;
      const top = parseSeq(VJUX);
      if (matches(VJUX)) i += VJUX.length;
      const bottom = parseSeq(PRE5 + GRP_C);
      if (matches(PRE5 + GRP_C)) i += 2;
      else warnings.push('Unclosed binomial (missing ⠐⠜)');
      return `\\binom{${top.trim()}}{${bottom.trim()}}`;
    }
    if (c === PRE5 && OPS5[peek(1)] !== undefined) { const op = OPS5[peek(1)]; i += 2; return op; }
    // ⠈⠣ / ⠈⠜ are BOTH the comparison signs < > (GTM 3) and the angle
    // brackets (GTM 5) — told apart, as the code itself does it, by SPACING:
    // comparison signs stand clear of their operands, brackets hug content.
    // A-level vectors write inner products with these.
    if (c === PRE4 && (peek(1) === GRP_O || peek(1) === GRP_C)) {
      const close = peek(1) === GRP_C;
      const spacedL = i === 0 || isSpace(cells[i - 1]);
      const spacedR = i + 2 >= cells.length || isSpace(cells[i + 2]);
      i += 2;
      if (spacedL && spacedR) return close ? '> ' : '< ';
      return close ? '\\rangle ' : '\\langle ';
    }
    if (c === PRE4 && OPS4[peek(1)] !== undefined) { const op = OPS4[peek(1)]; i += 2; return op; }

    // Greek: ⠨ + letter (but ⠨⠌ is the general-fraction line).
    // ⠨ is a shared prefix — it also begins ∩ (⠨⠦), ∪ (⠨⠖), ∑ (⠨⠠⠎) and more.
    // So only claim it when a LETTER follows; otherwise fall through and let the
    // symbol table match the full sequence. Consuming ⠨ here and warning was
    // swallowing a dozen set/operator symbols.
    if (c === GREEKI && peek(1) !== FRAC_L && GREEK_CELL[peek(1)]) {
      // Trailing space matters: "\pi" + "r" would otherwise concatenate into the
      // unknown command "\pir" (seen in A = πr²).
      // In a capitals passage the Greek letter is capital too (ΔG = ΔH − TΔS):
      // same rule as the ⠠⠠ cap-word branch, found by the external formula set.
      const g = (capsPassage && GREEK_CAP_CELL[peek(1)]) || GREEK_CELL[peek(1)];
      i += 2; return withModifier(g + ' ');
    }

    // GTM §3.6: an OMISSION (something the pupil must fill in) is written as the
    // bare ⠬. That is the same cell as the radical close, so it only means
    // "omission" when no radical is actually open — e.g. 9/12 = 3/⬚.
    if (c === SQRT_C && rootDepth === 0) { i++; return '\\square '; }

    if (c === SQRT_C || c === FRAC_C || c === GRP_C) return null;   // handled by callers

    // Numbers.
    // ⠼ opens SYMBOLS as well as numbers (GTM 11): ⠼⠿ is infinity, ⠼⠇ is
    // parallel, ⠼⠤ is perpendicular. Entering numeric mode unconditionally
    // made all three unreachable — an A-level limit could not write its
    // infinity. Only a pair whose second cell is NOT a digit letter can match,
    // so ⠼⠁⠃ stays the number 12.
    // UEB 6.9: the NUMERIC PASSAGE ⠼⠼ … ⠼⠄ — every a–j inside is a digit,
    // across spaces and operators, until the terminator.
    if (c === NUM && peek(1) === NUM) {
      i += 2;
      let outP = '';
      while (i < cells.length) {
        if (peek() === NUM && peek(1) === TERM) { i += 2; break; }
        const l = LETTERS[peek()];
        if (l !== undefined && DIGIT_OF[l] !== undefined) { outP += DIGIT_OF[l]; i++; continue; }
        const piece = parseOne(stop);
        if (piece === null) break;
        outP += piece;
      }
      return outP;
    }
    // UEB 6.8.1 / GTM 4.1: a ⠼ before a SPACE continues an interrupted
    // numeral — the space partitions, the indicator keeps numeric mode open.
    if (c === NUM && isSpace(peek(1)) && (LETTERS[peek(2)] !== undefined || peek(2) === DECPT)) {
      i += 2;
      return withModifier(parseNumber());
    }
    if (c === NUM) {
      const sym = matchSymbolAt(i);
      if (sym && sym.len === 2 && DIGIT_OF[LETTERS[peek(1)]] === undefined) {
        i += 2; return sym.tex;
      }
      i++; return withModifier(parseNumber());
    }

    // Bare letter (identifier), possibly decorated.
    if (LETTERS[c] !== undefined) {
      // GTM 16.2 / grade 2: inside a letter run MathCAT contracts — mgh is
      // ⠍⠣ (m + the gh groupsign), "red" ends in ⠫ (ed), "copper" in ⠻ (er).
      // Only groupsigns with NO valid reading directly after a letter are
      // accepted (each of these warned before), and letters after a
      // contraction fold in. ⠱ (wh) stays the bar, ⠜ (ar) the close,
      // ⠬ (ing) the radical close — those have real meanings there.
      let word = LETTERS[c]; i++;
      const upWord = capsPassage;
      const CONTR = { [GRP_O]: 'gh', [SHAPE]: 'ed', [D('12456')]: 'er' };
      while (CONTR[peek()] !== undefined &&
             (peek(1) === undefined || isSpace(peek(1)) || LETTERS[peek(1)] !== undefined ||
              CONTR[peek(1)] !== undefined || peek(1) === PRE5 || peek(1) === GRP_C || peek(1) === FRAC_C)) {
        word += CONTR[peek()]; i++;
        while (LETTERS[peek()] !== undefined) { word += LETTERS[peek()]; i++; }
      }
      return withModifier(upWord ? word.toUpperCase() : word);
    }

    // A comma OUTSIDE numeric mode is just punctuation ("I, V, X", "f(x, y)").
    // parseNumber consumes its own as a thousands separator.
    if (c === COMMA) { i++; return ','; }

    // Last resort: the generated UEB symbol table (longest match first). This
    // runs AFTER all structural handling, so it can only rescue cells we would
    // otherwise have rejected — it can never shadow a fraction/script/root.
    const hit = matchSymbolAt(i);
    if (hit) {
      i += hit.len;
      // GTM §14: a shape is CLOSED by ⠱ (the shape terminator).
      if (hit.cells.includes(SHAPE) && peek() === MODC) i++;
      return hit.tex;
    }
    for (const [cellsStr, tex] of UEB_SYMBOLS) {
      if (false && matches(cellsStr)) {
        i += cellsStr.length;
        // GTM §14: a shape is CLOSED by ⠱ (the shape terminator). That cell is
        // also the bar-over modifier and Greek η, and reading it as η is why
        // "4-sided shape" came out as "▫η" — clean parse, wrong answer.
        if (cellsStr.includes(SHAPE) && peek() === MODC) i++;
        return tex;
      }
    }

    warnings.push(`cell ${i + 1} (${dotsOf(c)}) not recognised`);
    badCells.push(i);
    i++;
    return '';
  }

  // Longest match from the generated symbol table at a given position.
  function matchSymbolAt(at) {
    for (const [cellsStr, tex] of UEB_SYMBOLS) {
      if (cells.slice(at, at + cellsStr.length).join('') === cellsStr) {
        return { cells: cellsStr, tex, len: cellsStr.length };
      }
    }
    return null;
  }

  // Longest-match a function name at the cursor. Returns the LaTeX (with a
  // trailing space, so "\sin"+"x" can't concatenate into "\sinx"), or null.
  function matchFunction() {
    for (const f of FUNCTIONS) {
      const n = f.cells.length;
      if (cells.slice(i, i + n).join('') !== f.cells) continue;
      // What follows must look like an argument, otherwise these are just
      // letters (or a superscript: ⠎⠔⠼⠃ is s², not "sin 2").
      const after = cells[i + n];
      // GTM 16.4: in an electron shell (1s², 2p⁶) the letter before the name
      // is a DIGIT — a digit-letter run rooted at the numeric indicator ⠼. So
      // ⠼⠁⠎⠔ is 1s^…, never "1 sin"; but ⠊⠎⠔ in i·sin stays sin, because
      // the i, though a digit-letter shape, has no ⠼ behind it.
      if (n === 2 && i > 0) {
        let k = i - 1;
        while (k >= 0 && LETTERS[cells[k]] !== undefined &&
               DIGIT_OF[LETTERS[cells[k]]] !== undefined) k--;
        if (k < i - 1 && k >= 0 && cells[k] === NUM) continue;
      }
      const isArg = after === undefined || after === '⠀'
        || (after === PRE5 && (cells[i + n + 1] === D('126')))   // ⠐⠣  open bracket
        // NOT ⠣ on its own: that is the SCRIPT-SCOPE opener (GTM §7), not a
        // bracket. Treating it as an argument read "6 m s⁻¹" — metres per
        // second — as "6 m sin −1". Round brackets are ⠐⠣, handled above.
        // A script may follow the name: log₁₀, lim_{n}, tan². Safe because the
        // contracted ⠎⠔ ("sin") already swallowed its ⠔, so s² is unaffected.
        || after === SUB || after === SUP
        // ⠨ = a Greek argument (sin θ) or a limit indicator (lim under/over).
        || after === GREEKI
        || after === CAP                                        // sin A
        // A NUMBER may follow: "sin 30" is ⠎⠔⠼⠉⠚. This does not swallow s²,
        // because a real superscript carries the grade-1 indicator first —
        // MathCAT writes s² as ⠎⠰⠔⠼⠃, so ⠎⠔ never matches there.
        || after === NUM
        // …or a bare variable: "sin x" is ⠎⠔⠭. Same reasoning — s^x carries the
        // grade-1 indicator (⠎⠰⠔⠭), so the two stay distinct.
        || LETTERS[after] !== undefined;
      if (!isArg) continue;
      i += n;
      if (cells[i] === '⠀') i++;          // the space belongs to the function
      return f.tex + ' ';
    }
    return null;
  }

  // GTM §1.2.2: numeric mode continues only through a CLOSED list of symbols —
  // digits a–j, the decimal point, the comma (thousands separator), and the
  // simple-fraction line. "A space or any symbol not listed here terminates
  // numeric mode", so anything else ends the number rather than being absorbed.
  // If a modifier follows, wrap the atom in it. A grade-1 indicator may sit
  // between the item and its modifier (⠭⠰⠘⠱), so skip one if present.
  function withModifier(atom) {
    let j = i;
    if (cells[j] === G1) j++;
    for (const [cellsStr, wrap] of MODIFIERS) {
      if (cells.slice(j, j + cellsStr.length).join('') === cellsStr) {
        i = j + cellsStr.length;
        return wrap(atom);
      }
    }
    return atom;
  }

  // Index of a ⠰⠻ binomial separator at the same bracket depth as the ⠐⠣ at `i`,
  // or -1. Depth-tracked so "(a, (b ⠰⠻ c))" doesn't claim the inner one.
  function findVjux() {
    let depth = 0;
    for (let j = i + 2; j < cells.length; j++) {
      if (matches(PRE5 + GRP_O, j)) { depth++; j++; continue; }
      if (matches(PRE5 + GRP_C, j)) { if (depth === 0) return -1; depth--; j++; continue; }
      if (depth === 0 && matches(VJUX, j)) return j;
    }
    return -1;
  }

  // A digit follows a bare dot-5? That is the NUMERIC SPACE ("5 000"), not the
  // operator prefix — ⠐ only prefixes non-digits (⠐⠶ =, ⠐⠖ +, …).
  const isNumericSpace = () => peek() === PRE5 && DIGIT_OF[LETTERS[peek(1)]] !== undefined;

  function parseNumber() {
    let s = '';
    while (i < cells.length) {
      const c = peek();
      const l = LETTERS[c];
      if (l && DIGIT_OF[l]) { s += DIGIT_OF[l]; i++; continue; }
      if (c === DECPT) { s += '.'; i++; continue; }
      if (c === COMMA) { s += ','; i++; continue; }
      if (isNumericSpace()) { s += '\\,'; i++; continue; }
      break;                       // terminates numeric mode
    }
    // Simple numeric fraction: digits ⠌ digits
    if (peek() === FRAC_L) {
      i++;
      let den = '';
      if (peek() === NUM) i++;
      while (i < cells.length) {
        const l = LETTERS[peek()];
        if (l && DIGIT_OF[l]) { den += DIGIT_OF[l]; i++; continue; }
        if (peek() === DECPT) { den += '.'; i++; continue; }
        if (peek() === COMMA) { den += ','; i++; continue; }   // 7/2,000
        if (isNumericSpace()) { den += '\\,'; i++; continue; }
        break;
      }
      return `\\frac{${s}}{${den}}`;
    }
    return s;
  }

  // Superscript/subscript apply to the next atom.
  function applyScript(kind) {
    const atom = parseScriptOperand();
    return `${kind}{${atom}}`;
  }
  // GTM §7.1: a script applies to the next ITEM, which the standard defines
  // exhaustively. We implement those clauses in order rather than inferring the
  // scope, which is what we used to do and what the LIMITATIONS block admitted
  // was our weakest point. The final clause is why x⠔⠼⠃y is x²y and not x^(2y).
  function parseScriptOperand() {
    const c = peek();

    // (g) anything within braille grouping indicators ⠣ … ⠜
    if (c === GRP_O) {
      i++;
      const body = parseSeq(GRP_C);
      if (peek() === GRP_C) i++; else warnings.push('Unclosed grouping (missing ⠜)');
      return body.trim();
    }
    // (f) GTM 7.1 clause 6 — "any expression enclosed in matching pairs of ROUND
    // PARENTHESES, SQUARE BRACKETS OR CURLY BRACES". We had only round, so
    // x^[a+b] took the bracket alone as the item and let the rest escape:
    //     x^[a+b]  ->  x^{[}a+b]
    //     x^{a+b}  ->  x^{\{}a+b\}
    // Found by reading the rule, not by any of 1405 test cases.
    for (const [openA, openB, closeA, closeB, lo, lc] of [
      [PRE5,   D('126'), PRE5,   D('345'), '(',    ')'],
      [GREEKI, D('126'), GREEKI, D('345'), '[',    ']'],
      [PRE456, D('126'), PRE456, D('345'), '\\{', '\\}'],
    ]) {
      if (c !== openA || peek(1) !== openB) continue;
      i += 2;
      let body = '';
      // NESTING counts: x^{(a+(b))} closes at the MATCHING pair, not the
      // first one — the flat scan let the tail escape the script.
      let depth6 = 0;
      while (i < cells.length) {
        if (peek() === openA && peek(1) === openB) depth6++;
        else if (peek() === closeA && peek(1) === closeB) {
          if (depth6 === 0) break;
          depth6--;
        }
        const piece = parseOne(null);
        if (piece === null) break;
        body += piece;
      }
      if (peek() === closeA && peek(1) === closeB) i += 2;
      else warnings.push('Unclosed bracket in script');
      return lo + body.trim() + lc;
    }
    // (d) GTM 7.1 clause 4 — an ARROW, and (e) clause 5 — an arbitrary SHAPE.
    // Both are single items, so x with an arrow above it is one thing, not an
    // unreadable cell. Previously: x^→ gave "x^{}o" plus a warning.
    if (c === D('1256') || c === SHAPE) {   // ⠳ arrow prefix, ⠫ shape indicator
      const sym = matchSymbolAt(i);
      if (sym) {
        i += sym.len;
        if (sym.cells.includes(SHAPE) && peek() === MODC) i++;   // shape terminator
        return sym.tex;
      }
    }

    // (a) an entire number in numeric mode — but ⠼ also introduces symbols that
    // are not digits at all: S_∞ is ⠠⠎⠢⠼⠿, and reading only digits gave S with
    // an empty subscript.
    if (c === NUM) {
      // ⠼ also BEGINS symbols that are not numbers — ∞ is ⠼⠿, so S_∞ is
      // ⠠⠎⠢⠼⠿ and reading digits only gave S with an empty subscript. The table
      // entry covers both cells, so it must be tried before ⠼ is consumed.
      const sym = matchSymbolAt(i);
      if (sym && sym.len > 1) { i += sym.len; return sym.tex; }
      i++;
      return parseNumber();
    }
    // (b) an entire general fraction, (c) an entire radical — with or without ⠰
    if (c === G1 && peek(1) === FRAC_O) { i += 2; return parseGeneralFraction(); }
    if (c === FRAC_O) { i += 1; return parseGeneralFraction(); }
    if (c === G1 && peek(1) === SQRT_O) { i += 1; return parseRoot(); }
    if (c === SQRT_O) { return parseRoot(); }
    // (h) otherwise the next individual symbol
    const l = LETTERS[c];
    if (l !== undefined) { i++; return l; }
    const piece = parseOne(null);
    return piece === null ? '' : piece;
  }

  // ⠰⠩ … ⠬   (with optional ⠔ index for nth roots)
  function parseRoot() {
    i++;                                  // consume ⠩
    rootDepth++;
    let index = '';
    if (peek() === SUP) {                 // ⠔ → root index follows
      i++;
      // The index is a script OPERAND, not necessarily a number: ⠩⠔⠣mn⠜xy⠬ is
      // the mn-th root of xy. Reading digits only dropped the index entirely and
      // silently folded it into the radicand.
      index = parseScriptOperand().trim();
    }
    let body = parseSeq(SQRT_C);
    // GTM 3.6 note: an empty radicand whose close is doubled is the omission
    // form — ⠩⠬⠬ is the square root of a BLANK the pupil must fill, √□.
    if (!body.trim() && peek() === SQRT_C && peek(1) === SQRT_C) { i++; body = '\\square '; }
    rootDepth--;
    if (peek() === SQRT_C) i++; else warnings.push('Unclosed radical (missing ⠬)');
    return withModifier(index ? `\\sqrt[${index}]{${body}}` : `\\sqrt{${body}}`);
  }

  // ⠰⠷ numerator ⠨⠌ denominator ⠾
  function parseGeneralFraction() {
    let num = '';
    while (i < cells.length && !(peek() === GREEKI && peek(1) === FRAC_L) && peek() !== FRAC_C) {
      const piece = parseOne(null);
      if (piece === null) break;
      num += piece;
    }
    let den = '';
    if (peek() === GREEKI && peek(1) === FRAC_L) {
      i += 2;
      den = parseSeq(FRAC_C);
    } else {
      warnings.push('General fraction without ⠨⠌ line');
    }
    if (peek() === FRAC_C) i++; else warnings.push('Unclosed fraction (missing ⠾)');
    return `\\frac{${num.trim()}}{${den.trim()}}`;
  }

  parseSeq(null, true);
  // Join with sentinels at piece boundaries, run the SAME pipeline, then strip
  // the sentinels into offsets — provenance without touching the output: the
  // stripped result is byte-identical to the old single-string path.
  const SENT = '\uE000';
  // adjacent plain-letter pieces coalesce (a word or unit is ONE chunk —
  // sentinels inside "km" defeated the unit regex and the click granularity
  // nobody wants is per-letter anyway)
  if (topRecord) {
    const P = topRecord.pieces, R = topRecord.ranges;
    for (let k2 = P.length - 1; k2 >= 0; k2--) {
      if (P[k2] === '' && P.length > 1) {
        const to = k2 + 1 < P.length ? k2 + 1 : k2 - 1;
        R[to] = [Math.min(R[to][0], R[k2][0]), Math.max(R[to][1], R[k2][1])];
        P.splice(k2, 1); R.splice(k2, 1);
        continue;
      }
      if (k2 === 0) continue;
      if (/^[A-Za-z]+$/.test(P[k2]) && /^[A-Za-z]+$/.test(P[k2 - 1])) {
        P[k2 - 1] += P[k2]; R[k2 - 1][1] = R[k2][1];
        P.splice(k2, 1); R.splice(k2, 1);
      }
    }
  }
  const joined = topRecord ? topRecord.pieces.join(SENT) : '';
  const collapsed = joined.replace(/\s+/g, ' ').trim();
  const latex = collapsed;
  // GTM 16.2 / the owner's ambiguity design: ⠢ between letters is BOTH the
  // subscript indicator and the EN contraction — nitrob⠢z⠢e is nitrobenzene
  // or nitrob-sub-z…, both regenerate the same cells, and they LOOK different,
  // so the panel shows the two readings and the teacher picks. The maths
  // reading stays primary; the word is offered whenever two or more letter
  // segments join into one.
  {
    const L = LETTERS;
    let k = 0;
    while (k < cells.length) {
      if (L[cells[k]] === undefined || (k > 0 && cells[k - 1] === G1)) { k++; continue; }
      let j = k, segs = 0, word = '';
      while (j < cells.length) {
        if (L[cells[j]] !== undefined) { word += L[cells[j]]; j++; continue; }
        if (cells[j] === SUB && L[cells[j + 1]] !== undefined) { word += 'en'; segs++; j++; continue; }
        break;
      }
      if (segs >= 1 && word.length >= 6) {
        const mathBits = [];
        let seg = '';
        for (let t = k; t < j; t++) {
          if (cells[t] === SUB) { mathBits.push(seg); seg = ''; continue; }
          seg += L[cells[t]];
        }
        mathBits.push(seg);
        const mathTex = mathBits.reduce((acc, b, ix) => ix ? acc + '_{' + b[0] + '}' + b.slice(1) : b, '');
        ambiguities.push({ at: k, len: j - k, cells: cells.slice(k, j).join(''),
          reading: 'letters with subscripts',
          alternatives: ['\\text{' + word + '} — a word (⠢ as the EN contraction)',
                         mathTex + ' — letters with subscripts'],
          latexes: ['\\text{' + word + '}', mathTex] });
      }
      k = Math.max(j, k + 1);
    }
  }
  // uprightUnits runs on the sentineled string (its regex tolerates \uE000),
  // then one walk strips sentinels: canonical latex + span offsets into it.
  const unitised = uprightUnits(latex);
  let finalLatex = '';
  const cuts = [];
  for (const ch of unitised) {
    if (ch === '\uE000') { cuts.push(finalLatex.length); continue; }
    // sentinel removal can abut two spaces, and sentinels block the earlier
    // trim at the string edges — re-apply both here
    if (ch === ' ' && (finalLatex === '' || finalLatex.endsWith(' '))) continue;
    finalLatex += ch;
  }
  while (finalLatex.endsWith(' ')) finalLatex = finalLatex.slice(0, -1);
  for (let k3 = 0; k3 < cuts.length; k3++) cuts[k3] = Math.min(cuts[k3], finalLatex.length);
  const spans = [];
  if (topRecord && topRecord.ranges) {
    let t0 = 0;
    for (let k2 = 0; k2 < topRecord.ranges.length; k2++) {
      const t1 = k2 < cuts.length ? cuts[k2] : finalLatex.length;
      spans.push({ c0: topRecord.ranges[k2][0], c1: topRecord.ranges[k2][1], t0, t1: Math.max(t0, t1) });
      t0 = Math.max(t0, t1);
    }
  }
  return { latex: finalLatex, warnings, badCells, ambiguities, spans };
}

/* Plain-English names for the UEB maths indicators, for the status bar. Built
 * from the SAME constants the parser above uses, so an explanation can never
 * drift from what the converter actually did. Plain letters and digits are
 * skipped — only the constructs worth explaining are named. */
const OPNAME5 = { '+': 'plus', '-': 'minus', '\\times ': 'times', '\\div ': 'divided by',
                  '=': 'equals', '(': 'open bracket', ')': 'close bracket' };
const OPNAME4 = { '<': 'less than', '>': 'greater than' };
const OPNAME456 = { '\\le ': 'less than or equal to', '\\ge ': 'greater than or equal to' };
// ⠸⠖ and ⠸⠤. The parser has always read these (OPS456); only the describer had
// no name for them, so ± was announced as two unnamed cells.
const OPNAME456_2 = { '\\pm ': 'plus or minus', '\\mp ': 'minus or plus' };
// ⠨⠣ ⠨⠜ ⠸⠣ ⠸⠜ — the bracket type rides on the prefix (GTM §7).
const BRACKET_NAME = { '[': 'open square bracket', ']': 'close square bracket',
                       '\\{': 'open curly bracket', '\\}': 'close curly bracket' };

export function describeUebMaths(input) {
  const cells = [...String(input)].map((c) => (c === ' ' ? '⠀' : c))
    .filter((c) => c.codePointAt(0) >= 0x2800 && c.codePointAt(0) <= 0x28ff);
  const out = [];
  // THE NUMBER SIGN GOVERNS THE WHOLE SIMPLE FRACTION (UEB). In ⠼⠁⠌⠃ the ⠃ is
  // the digit 2, not the letter b - the numeric indicator carries across the
  // fraction line. The run used to stop at that line, so the denominator was
  // named "letter b": a child deleting the 2 heard "delete b", and cursoring
  // onto it said the same (reported 2026-08-28). The PARSER always had this
  // right - the print pane draws a half - so only the naming was wrong.
  let numericHolds = false;      // a numeric run is still in force
  const add = (cs, name) => out.push({ cells: cs, name });
  let i = 0;
  const at = (k) => cells[i + k];
  while (i < cells.length) {
    const c = at(0);
    // A numeric run reaches exactly ONE token past itself, and only a fraction
    // line may pass it further. Clearing here makes that true by construction:
    // when the flag was left for each branch to reset, every branch that forgot
    // (operators, brackets, the grade-1 indicator) let it run on, and then every
    // a-j letter after a number was read as a digit - "4ac" came back as
    // "4", "1", "3". Measured on the quadratic formula.
    const carriedNumeric = numericHolds;
    numericHolds = false;
    if (c === '⠀') { i++; continue; }
    if (c === G1 && at(1) === G1 && at(2) === SQRT_O) { add(c + at(1) + at(2), 'square-root sign'); i += 3; continue; }
    if (c === G1 && at(1) === G1)     { add(c + at(1), 'grade-1 mode'); i += 2; continue; }
    if (c === G1 && at(1) === SUP)    { add(c + at(1), 'superscript (raise what follows)'); i += 2; continue; }
    if (c === G1 && at(1) === SUB)    { add(c + at(1), 'subscript (lower what follows)'); i += 2; continue; }
    if (c === G1 && at(1) === SQRT_O) { add(c + at(1), 'square-root sign'); i += 2; continue; }
    if (c === G1 && at(1) === FRAC_O) { add(c + at(1), 'open fraction'); i += 2; continue; }
    if (c === PRE456 && at(1) === PRE4 && OPS456_4[at(2)]) { add(c + at(1) + at(2), OPNAME456[OPS456_4[at(2)]]); i += 3; continue; }
    if (c === PRE5 && OPS5[at(1)] !== undefined) { add(c + at(1), OPNAME5[OPS5[at(1)]]); i += 2; continue; }
    if (c === PRE4 && OPS4[at(1)] !== undefined) { add(c + at(1), OPNAME4[OPS4[at(1)]]); i += 2; continue; }
    if (c === PRE456 && OPS456[at(1)] !== undefined) { add(c + at(1), OPNAME456_2[OPS456[at(1)]]); i += 2; continue; }
    if (BRACKETS[c + at(1)] !== undefined) { add(c + at(1), BRACKET_NAME[BRACKETS[c + at(1)]]); i += 2; continue; }
    if (c === G1 && at(1) === TERM) { add(c + at(1), 'end of the grade-1 passage'); i += 2; continue; }
    if (c === GREEKI && at(1) === FRAC_L) { add(c + at(1), 'fraction line'); i += 2; continue; }
    if (c === GREEKI && at(1) && GREEK_CELL[at(1)]) { add(c + at(1), 'Greek letter ' + GREEK_CELL[at(1)].replace(/^\\/, '')); i += 2; continue; }
    if (c === GREEKI) { add(c, 'Greek letter sign'); i++; continue; }
    if (c === SQRT_C) { add(c, 'end of square root'); i++; continue; }
    // THE OPENERS, BARE. Their closers were named on their own all along, while
    // these were only named after a ⠰ - so a formula that opens a fraction or a
    // root without one had its opening cell reported as dots.
    if (c === SQRT_O) { add(c, 'square-root sign'); i++; continue; }
    if (c === FRAC_O) { add(c, 'open fraction'); i++; continue; }
    if (c === SUP)    { add(c, 'superscript (raise what follows)'); i++; continue; }
    if (c === SUB)    { add(c, 'subscript (lower what follows)'); i++; continue; }
    if (c === GRP_O)  { add(c, 'open group'); i++; continue; }
    if (c === GRP_C)  { add(c, 'close group'); i++; continue; }
    if (c === FRAC_C) { add(c, 'close fraction'); i++; continue; }
    if (c === FRAC_L) {
      add(c, 'fraction line (simple numeric fraction)');
      numericHolds = carriedNumeric;     // the denominator is still under the number sign
      i++; continue;
    }
    
    if (c === NUM) {
      let numCells = c, numStr = '', j = 1;
      while (i + j < cells.length) {
        let n = at(j), L = LETTERS[n];
        if (L && DIGIT_OF[L] !== undefined) { numCells += n; numStr += DIGIT_OF[L]; j++; }
        else if (n === DECPT || n === COMMA) { numCells += n; numStr += (n === DECPT ? '.' : ','); j++; }
        else break;
      }
      add(numCells, numStr || 'number sign (no digits)');
      numericHolds = !!numStr;      // digits seen: the run may resume after a fraction line
      i += j;
      continue;
    }
    
    if (c === DECPT)  { add(c, 'decimal point'); i++; continue; }
    if (c === G1)     { add(c, 'grade-1 indicator (read literally, not as a contraction)'); i++; continue; }

    let L = LETTERS[c];
    if (L !== undefined && carriedNumeric && DIGIT_OF[L] !== undefined) {
      // The denominator of a simple numeric fraction: still under the number
      // sign that opened the numerator.
      let dCells = c, dStr = DIGIT_OF[L], j = 1;
      while (i + j < cells.length) {
        const n = at(j), L2 = LETTERS[n];
        if (L2 !== undefined && DIGIT_OF[L2] !== undefined) { dCells += n; dStr += DIGIT_OF[L2]; j++; }
        else break;
      }
      add(dCells, dStr);
      i += j;
      continue;
    }
    if (L !== undefined) {
      let lCells = c, lStr = L, j = 1;
      while (i + j < cells.length) {
        let n = at(j), L2 = LETTERS[n];
        if (L2 !== undefined) { lCells += n; lStr += L2; j++; }
        else break;
      }
      add(lCells, lStr.length === 1 ? `letter ${lStr}` : `letters ${lStr}`);
      i += j;
      continue;
    }

    add(c, dotsOf(c));
    i++;
  }
  return out;
}

// A CELL WE CANNOT NAME SAYS SO. This used to return a bare digit string -
// "12356" for dots 1-2-3-5-6 - which any reader of these entries is entitled to
// mistake for a numeral, and one did: the cursor's number branch tests a name
// against /^[\d.,]+$/, matched the dot list, and announced a single digit of it.
// So an unrecognised bracket was spoken as "1" and ± as "4". Spelling it out
// cannot be confused with a number by anything, and matches how the literary
// describer has always said the same thing.
function dotsOf(cell) {
  const cp = cell.codePointAt(0) - 0x2800;
  const dots = [];
  for (let d = 1; d <= 6; d++) if (cp & (1 << (d - 1))) dots.push(d);
  return dots.length ? 'dots ' + dots.join(' ') : 'blank';
}

/* ---------------------------------------------------------------------------
 * LIMITATIONS
 *  - Core subset: numbers (incl. decimals), letters, Greek, + − × ÷ =, < > ≤ ≥,
 *    parentheses, super/subscripts, simple and general fractions, square and
 *    nth roots.
 *  - Script scope is the immediately-following atom (number run or single
 *    letter). Braced/parenthesised script bodies are not fully handled.
 *  - No functions (sin/cos/log), matrices, integrals, sums, vectors, or
 *    multi-line constructs.
 *  - Capital-letter, typeform (bold/italic) and shape indicators are ignored.
 *  - UEB is context-sensitive; unusual grade-1 placements may mis-parse. Any
 *    cell we can't place is reported in `warnings` rather than silently dropped.
 * ------------------------------------------------------------------------ */
