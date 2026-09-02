// UEB Technical, read as the STANDARD states it.
//
// The existing converter (ueb-maths-to-latex.mjs) grew rule by rule from test
// failures. It works — 99% readable on school maths — but it has two faults that
// no amount of further patching removes:
//
//   • PRECEDENCE IS POSITIONAL. A rule's priority is where it happens to sit in
//     a 600-line function. Three precedence bugs shipped in one session that
//     way: ⠸⠒ read as a colon rather than a chemical bond, ⠫⠪ as a left arrow
//     rather than an angle, ⠐⠅⠱ as "<" followed by a bar rather than ≤.
//   • RULES ARE NOT TRACEABLE TO THE STANDARD. GTM 7.1 defines the scope of a
//     script in EIGHT ordered clauses; we had implemented five, and neither 924
//     authentic corpus cases nor 481 generated school expressions ever revealed
//     it. Nothing could tell us which clause was missing, because nothing
//     recorded which clauses existed.
//
// So here precedence is DATA — an ordered list — and every rule carries the
// section of the Guidelines for Technical Material it comes from. Coverage
// against the standard becomes a question you can answer by reading the list.
//
// What is deliberately kept from the old design: TOLERANCE. Unknown cells become
// an `unreadable` node and reading continues. MathCAT's own grammar-based
// back-translator returns nothing at all on a parse error, which is why it reads
// only 6% of UEB; for a child typing live that behaviour is useless.

import { UEB_SYMBOLS } from './ueb-symbols.mjs';
import {
  Seq, Num, Ident, Op, Sym, Space, Frac, Root, Group, Attached, Unreadable,
  render, badCells,
} from './mathnode.mjs';

const D = (s) => String.fromCodePoint(
  0x2800 + [...String(s)].reduce((a, c) => a | (1 << (Number(c) - 1)), 0));

// ---- cells (GTM section 1, and the symbol lists throughout) ----------------
const C = {
  G1: D('56'), G1W: D('56') + D('56'),
  NUM: D('3456'),
  SUP: D('35'), SUB: D('26'),
  OVER: D('46') + D('35'), UNDER: D('46') + D('26'),   // ⠨⠔ ⠨⠢ directly over/under
  GRP_O: D('126'), GRP_C: D('345'),                    // ⠣ ⠜ braille grouping
  RND_O: D('5') + D('126'), RND_C: D('5') + D('345'),  // ⠐⠣ ⠐⠜
  SQR_O: D('46') + D('126'), SQR_C: D('46') + D('345'), // ⠨⠣ ⠨⠜
  CRL_O: D('456') + D('126'), CRL_C: D('456') + D('345'), // ⠸⠣ ⠸⠜
  FRAC_O: D('12356'), FRAC_C: D('23456'), FRAC_L: D('46') + D('34'),
  SIMPLE_L: D('34'),
  ROOT_O: D('146'), ROOT_C: D('346'),
  CAP: D('6'), CAPW: D('6') + D('6'),
  DECPT: D('256'), COMMA: D('2'),
  SPACE: '⠀',
  SHAPE: D('1246'), ARROW: D('156'),
  MOD_BAR: D('156'),
  GREEKI: D('46'),
};

const LETTERS = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((ch, i) => {
  LETTERS[D(['1', '12', '14', '145', '15', '124', '1245', '125', '24', '245', '13', '123',
             '134', '1345', '135', '1234', '12345', '1235', '234', '2345', '136', '1236',
             '2456', '1346', '13456', '1356'][i])] = ch;
});
const DIGIT_OF = { a: '1', b: '2', c: '3', d: '4', e: '5', f: '6', g: '7', h: '8', i: '9', j: '0' };

// A LATEX COMMAND MUST NOT RUN INTO THE NEXT LETTER (2026-09-02): \pi followed
// by r emitted "\pir", so A = pi r squared - the GCSE circle-area row - printed
// as an unknown command. The capitals below always had the space; these did not.
const GREEK_CELL = {
  '⠁':'\\alpha ', '⠃':'\\beta ', '⠛':'\\gamma ', '⠙':'\\delta ', '⠑':'\\epsilon ',
  '⠵':'\\zeta ', '⠱':'\\eta ', '⠹':'\\theta ', '⠊':'\\iota ', '⠅':'\\kappa ',
  '⠇':'\\lambda ', '⠍':'\\mu ', '⠝':'\\nu ', '⠭':'\\xi ', '⠕':'\\omicron ',
  '⠏':'\\pi ', '⠗':'\\rho ', '⠎':'\\sigma ', '⠞':'\\tau ', '⠥':'\\upsilon ',
  '⠋':'\\phi ', '⠯':'\\chi ', '⠽':'\\psi ', '⠺':'\\omega ',
};
const GREEK_CAP_CELL = {
  '⠁':'A', '⠃':'B', '⠛':'\\Gamma ', '⠙':'\\Delta ', '⠑':'E', '⠵':'Z',
  '⠱':'H', '⠹':'\\Theta ', '⠊':'I', '⠅':'K', '⠇':'\\Lambda ', '⠍':'M',
  '⠝':'N', '⠭':'\\Xi ', '⠕':'O', '⠏':'\\Pi ', '⠗':'P', '⠎':'\\Sigma ',
  '⠞':'T', '⠥':'\\Upsilon ', '⠋':'\\Phi ', '⠯':'X', '⠽':'\\Psi ', '⠺':'\\Omega ',
};

const TYPEFORM_PREFIX = new Set([D('45'), D('46'), D('456'), D('4')]);
const TYPEFORM_LEVEL  = new Set([D('2'), D('23'), D('2356'), D('3')]);
const TYPEFORM_TEX = { [D('4')]: '\\mathscr', [D('45')]: '\\mathbf' };
const NUMBER_SETS = new Set(['R', 'Z', 'Q', 'N', 'C']);

// Longest first, so a three-cell sign is never read as a two-cell one plus a
// stray. This is the fix for the ≤ / < class of bug, applied once rather than
// rediscovered per symbol.
const SYMBOLS = [...UEB_SYMBOLS].sort((a, b) => b[0].length - a[0].length);

// GTM section 3 — signs of operation and comparison. These are PREFIXED pairs
// (⠐ for operations, ⠈ for comparisons, ⠸ for the "under/over" family) and they
// are deliberately absent from the generated symbol table, whose generator skips
// any character the parser owns structurally. Longest first: ≤ is ⠸⠈⠣, and
// matching the two-cell ⠸⠖ first would read it as ± followed by a stray.
const SIGNS = [
  [D('456') + D('4') + D('126'), '\\le ', true],
  [D('456') + D('4') + D('345'), '\\ge ', true],
  [D('5') + D('2356') + D('4') + D('156'), '\\neq ', true],
  [D('456') + D('235'), '\\pm ', false],
  [D('456') + D('36'), '\\mp ', false],
  [D('5') + D('235'), '+', false],
  [D('5') + D('36'), '-', false],
  [D('5') + D('236'), '\\times ', false],
  [D('5') + D('34'), '\\div ', false],
  [D('5') + D('2356'), '=', true],
  [D('4') + D('126'), '<', true],
  [D('4') + D('345'), '>', true],
  [D('4') + D('156'), '\\neq ', true],
].sort((a, b) => b[0].length - a[0].length);

// GTM section 9 — FUNCTION NAMES. UEB has no special sign for these: they are
// spelled as ordinary letters, so a dictionary is the only way to recover them,
// and "log" must not read as l x o x g. In grade 2 the name may be CONTRACTED —
// sin is ⠎⠔, s plus the "in" contraction — and ⠔ is also the superscript sign,
// so a match only counts when what follows could be an ARGUMENT. s² is safe
// because a real superscript carries the grade-1 indicator first (⠎⠰⠔⠼⠃).
const L = (w) => [...w].map((ch) => D({ a:'1',b:'12',c:'14',d:'145',e:'15',f:'124',g:'1245',
  h:'125',i:'24',j:'245',k:'13',l:'123',m:'134',n:'1345',o:'135',p:'1234',q:'12345',r:'1235',
  s:'234',t:'2345',u:'136',v:'1236',w:'2456',x:'1346',y:'13456',z:'1356' }[ch])).join('');

const FUNCTIONS = [
  ['arcsin','\\arcsin'],['arccos','\\arccos'],['arctan','\\arctan'],
  ['sinh','\\sinh'],['cosh','\\cosh'],['tanh','\\tanh'],
  ['sin','\\sin'],['cos','\\cos'],['tan','\\tan'],
  ['sec','\\sec'],['csc','\\csc'],['cot','\\cot'],
  ['log','\\log'],['ln','\\ln'],['exp','\\exp'],
  ['lim','\\lim'],['max','\\max'],['min','\\min'],
  ['det','\\det'],['gcd','\\gcd'],['mod','\\bmod'],
].map(([w, tex]) => ({ cells: L(w), tex }))
 .concat([
   { cells: D('234') + D('35'), tex: '\\sin' }, // ⠎⠔ contracted "sin"
   { cells: D('345') + D('14') + D('136') + D('56') + D('2345'), tex: '\\mathrm{argument}' }, // ar g u ment
   { cells: D('234') + D('15') + D('16'), tex: '\\mathrm{sech}' }, // s e ch
   { cells: D('14') + D('135') + D('146'), tex: '\\mathrm{cosh}' }, // c o sh
   { cells: D('345') + D('14') + D('14') + D('135') + D('234'), tex: '\\arccos' }, // ar c c o s
   { cells: D('12456') + D('1235') + D('135') + D('1235'), tex: '\\mathrm{error}' }, // er r o r
   { cells: D('124') + D('136') + D('1345') + D('14') + D('56') + D('1345'), tex: '\\mathrm{function}' }, // f u n c tion
   { cells: D('12456') + D('124'), tex: '\\mathrm{erf}' } // er f
 ])
 .sort((a, b) => b.cells.length - a.cells.length);

// GTM section 3.6 / section 1 — punctuation inside a technical passage.
const PUNCT = {
  [D('2')]: ',', [D('256')]: '.', [D('25')]: ':', [D('23')]: ';',
  [D('236')]: '?', [D('235')]: '!',
};

// Brackets, as GTM section 5 lists them. Needed here as well as in the symbol
// table because GTM 7.1 clause 6 makes a BRACKETED EXPRESSION a script item,
// which requires knowing the matching pairs.
const BRACKETS = [
  [C.RND_O, C.RND_C, '(', ')'],
  [C.SQR_O, C.SQR_C, '[', ']'],
  [C.CRL_O, C.CRL_C, '\\{', '\\}'],
];

// ---------------------------------------------------------------------------
export function parseUeb(input) {
  const cells = [...String(input)]
    .map((c) => (c === ' ' ? C.SPACE : c))
    .filter((c) => c >= '⠀' && c <= '⣿');

  const warnings = [];
  let i = 0;

  const at = (k = 0) => cells[i + k];
  const matches = (s, p = i) => cells.slice(p, p + s.length).join('') === s;
  const dotsOf = (cell) => {
    const cp = (cell || '').codePointAt(0) - 0x2800;
    let s = '';
    for (let d = 1; d <= 6; d++) if (cp & (1 << (d - 1))) s += d;
    return s || 'blank';
  };

  // ===== GTM 7.1 — DEFINITION OF AN ITEM ===================================
  // "The scope of any of the four level change indicators … is the next item.
  //  An item is any of the following groupings if immediately after the level
  //  change indicator:"  — all EIGHT clauses, in the order the standard gives.
  function item() {
    const start = i;

    // 1. an entire number, i.e. the numeric indicator and everything in the
    //    numeric mode it establishes — "which would include fraction lines".
    if (at() === C.NUM) {
      const sym = symbolAt(i);                 // ⠼⠿ is ∞, not a number at all
      if (sym && sym.len > 1) { i += sym.len; return Sym(sym.tex, start, i - start); }
      return number();
    }
    // 2. an entire general fraction
    if (at() === C.FRAC_O || (at() === C.G1 && at(1) === C.FRAC_O)) return generalFraction();
    // 3. an entire radical expression
    if (at() === C.ROOT_O || (at() === C.G1 && at(1) === C.ROOT_O)) return radical();
    // 4. an arrow
    const arr = arrowAt(i);
    if (arr) { i = arr.end; return Sym(arr.tex, start, i - start); }
    // 5. an arbitrary shape
    const shp = shapeAt(i);
    if (shp) { i = shp.end; return Sym(shp.tex, start, i - start); }
    // 6. any expression in matching round, square or curly brackets
    const br = bracketAt(i);
    if (br) return bracket(br);
    // 7. any expression in the braille grouping indicators
    if (at() === C.GRP_O) {
      i++;
      const body = sequence(C.GRP_C);
      if (at() === C.GRP_C) i++; else warnings.push('Unclosed grouping (missing ⠜)');
      return body;
    }
    // 8. "If none of the foregoing apply, the item is simply the next
    //    individual symbol."
    return atom();
  }

  // ===== the ordered rule list ============================================
  // Each entry names the section of GTM it implements. The FIRST match wins, so
  // this list IS the precedence — visible, reorderable, and testable, rather
  // than implied by the order of statements in a long function.
  const RULES = [
    { ref: 'GTM 1',    name: 'space',            try: tryLiteralSpace },
    { ref: 'GTM 1.4',  name: 'grade-1 indicator', try: tryGrade1 },
    { ref: 'GTM 2.1',  name: 'number',            try: tryNumber },
    { ref: 'GTM 6',    name: 'general fraction',  try: tryGeneralFraction },
    { ref: 'GTM 6.1',  name: 'simple fraction',   try: null },   // handled inside number()
    { ref: 'GTM 8',    name: 'radical',           try: tryRadical },
    { ref: 'GTM 5',    name: 'bracket',           try: tryBracket },
    { ref: 'GTM 3',    name: 'operation/comparison', try: trySign },
    { ref: 'GTM 9',    name: 'function name',      try: tryFunction },
    { ref: 'GTM 7',    name: 'braille grouping',  try: tryGrouping },
    { ref: 'GTM 13',   name: 'arrow',             try: tryArrow },
    { ref: 'GTM 14',   name: 'shape',             try: tryShape },
    { ref: 'GTM 11',   name: 'typeform',          try: tryTypeform },
    { ref: 'GTM 11',   name: 'greek',             try: tryGreek },
    { ref: 'GTM 9.7',  name: 'and contraction',   try: tryAnd },
    { ref: 'GTM 11',   name: 'symbol table',      try: trySymbol },
    { ref: 'GTM 2.7',  name: 'capital word',      try: tryCapitalWord },
    { ref: 'GTM 2.7',  name: 'capital letter',    try: tryCapital },
    { ref: 'GTM 1.2',  name: 'letter',            try: tryLetter },
    { ref: 'GTM 3.6',  name: 'punctuation',       try: tryPunct },
  ];

  function tryLiteralSpace() {
    if (at() !== C.SPACE) return null;
    if (grade1 === 'word') grade1 = 'none';   // a word indicator ends with its word
    const s = i; i++; return Space(s);
  }
  // GRADE 1 SUSPENDS CONTRACTIONS, WHICH IS WHAT TELLS "sin" FROM "s SUPERSCRIPT"
  // (2026-09-02, the audit). The contracted sin is the letter s followed by the
  // "in" contraction - the same two cells as s with a superscript indicator -
  // so "6 m s^-1" read as "6 m sin -1". When a grade-1 word or passage
  // indicator has been seen, contractions are off and the cells are a script.
  // ...AND IT REACHES ONLY AS FAR AS ITS OWN KIND SAYS: one grade-1 indicator
  // covers the next symbol, two cover the word, three cover the passage until
  // the terminator. Held for the whole line instead, it silenced the contracted
  // sin in "x sin 60" - where the single indicator belonged to the x, two cells
  // and a space earlier.
  let grade1 = 'none';           // 'none' | 'word' | 'passage'
  function tryGrade1() {
    if (at() !== C.G1) return null;
    // grade-1 is a MODE marker, not content — but ⠰ also introduces a script,
    // a root and a fraction, so it is only skippable when it introduces none.
    if (at(1) === C.SUP || at(1) === C.SUB || at(1) === C.ROOT_O || at(1) === C.FRAC_O) return null;
    const s = i;
    // ⠰⠄ TERMINATES a grade-1 passage. Read as content it became a stray
    // apostrophe on the end of every passage-marked line.
    if (at(1) === D('3')) { grade1 = 'none'; i += 2; return Seq([], s, 2); }
    grade1 = (at(1) === C.G1 && at(2) === C.G1) ? 'passage' : 'word';
    i += (at(1) === C.G1) ? 2 : 1;
    return Seq([], s, i - s);
  }
  function tryNumber()          { return at() === C.NUM ? number() : null; }
  function tryGeneralFraction() {
    return (at() === C.FRAC_O || (at() === C.G1 && at(1) === C.FRAC_O)) ? generalFraction() : null;
  }
  function tryRadical() {
    return (at() === C.ROOT_O || (at() === C.G1 && at(1) === C.ROOT_O)) ? radical() : null;
  }
  function tryBracket()         { const b = bracketAt(i); return b ? bracket(b) : null; }
  function trySign() {
    for (const [str, tex, spaced] of SIGNS) {
      if (matches(str)) { const s = i; i += str.length; return Op(tex, s, str.length, spaced); }
    }
    return null;
  }
  function tryGrouping() {
    if (at() !== C.GRP_O) return null;
    const s = i; i++;
    const body = sequence(C.GRP_C);
    if (at() === C.GRP_C) i++; else warnings.push('Unclosed grouping (missing ⠜)');
    return Group(body, '', '', s, i - s);
  }
  function tryArrow()  { const a = arrowAt(i); if (!a) return null; const s = i; i = a.end; return Sym(a.tex, s, i - s); }
  function tryShape()  { const a = shapeAt(i); if (!a) return null; const s = i; i = a.end; return Sym(a.tex, s, i - s); }
  function tryTypeform() {
    if (TYPEFORM_PREFIX.has(at()) && TYPEFORM_LEVEL.has(at(1))) {
      const pfx = at();
      const s = i;
      i += 2; // skip the prefix and level cell for now
      // GTM 11 typeforms: if we have a meaning, apply it to the next atom.
      const n = atom();
      // Only wrap if it's an Ident or Num, wait, let's just use an Op or Ident wrapper.
      // For now, if we match a math-meaningful typeform (e.g. \mathscr for sets):
      if (TYPEFORM_TEX[pfx] && n.k === 'ident') {
        const tex = (pfx === D('4') && NUMBER_SETS.has(n.text.toUpperCase())) ?
            `\\mathbb{${n.text.toUpperCase()}}` : `${TYPEFORM_TEX[pfx]}{${n.text}}`;
        return Sym(tex, s, i - s);
      }
      return n; // pure presentation, skip the marker and return the item
    }
    return null;
  }
  function tryGreek() {
    if (at() === C.CAP && at(1) === C.GREEKI && GREEK_CAP_CELL[at(2)]) {
      const s = i; i += 3;
      return Sym(GREEK_CAP_CELL[at(-1)], s, 3);
    }
    if (at() === C.GREEKI && at(1) !== C.FRAC_L && GREEK_CELL[at(1)]) {
      const s = i; i += 2;
      return Sym(GREEK_CELL[at(-1)], s, 2);
    }
    return null;
  }
  function tryAnd() {
    if (at() === D('12346')) {
      const s = i; i++;
      return Sym('\\text{ and }', s, 1);
    }
    return null;
  }
  function trySymbol() { const m = symbolAt(i); if (!m) return null; const s = i; i += m.len; return Sym(m.tex, s, m.len); }
  function tryCapitalWord() {
    if (!matches(C.CAPW)) return null;
    const s = i; i += 2;
    let t = '';
    while (i < cells.length && LETTERS[at()] !== undefined) { t += LETTERS[at()].toUpperCase(); i++; }
    return t ? Ident(t, s, i - s, true) : Seq([], s, i - s);
  }
  function tryCapital() {
    if (at() !== C.CAP || LETTERS[at(1)] === undefined) return null;
    const s = i; i += 2;
    return Ident(LETTERS[cells[s + 1]].toUpperCase(), s, 2);
  }
  const CONTRACTED_SIN = D('234') + D('35');
  function tryFunction() {
    // A CAPITALISED NAME IS STILL THE NAME: "Sin 30" was read as "S^{30}",
    // because the capital indicator sat in front of every entry in the table.
    const lead = (at() === C.CAP && LETTERS[at(1)] !== undefined) ? 1 : 0;
    for (const f of FUNCTIONS) {
      const n = f.cells.length;
      if (cells.slice(i + lead, i + lead + n).join('') !== f.cells) continue;
      // in grade 1 the "in" contraction is not available, so these two cells
      // are the letter s and a superscript indicator, not the word sin
      if (grade1 !== 'none' && f.cells === CONTRACTED_SIN) continue;
      const after = cells[i + lead + n];
      const isArg = after === undefined || after === C.SPACE
        || matches(C.RND_O, i + lead + n) || after === C.GRP_O
        || after === C.SUB || after === C.SUP || after === C.NUM
        || after === D('46') || after === C.CAP || LETTERS[after] !== undefined;
      if (!isArg) continue;
      const s = i;
      i += lead + n;
      if (cells[i] === C.SPACE) i++;            // the space belongs to the name
      return Op(f.tex + ' ', s, i - s, false);
    }
    return null;
  }
  function tryPunct() {
    const t = PUNCT[at()];
    if (t === undefined) return null;
    const s = i; i++;
    return Op(t, s, 1, false);
  }
  function tryLetter() {
    const l = LETTERS[at()];
    if (l === undefined) return null;
    const s = i; i++;
    return Ident(l, s, 1);
  }

  // ---- pieces -------------------------------------------------------------
  function number() {
    const s = i;
    if (at() === C.NUM) i++;
    let t = '';
    for (;;) {
      const l = LETTERS[at()];
      if (l && DIGIT_OF[l]) { t += DIGIT_OF[l]; i++; continue; }
      if (at() === C.DECPT) { t += '.'; i++; continue; }
      if (at() === C.COMMA && DIGIT_OF[LETTERS[at(1)]]) { t += ','; i++; continue; }
      // GTM 2.1: a dot-5 before a digit is the NUMERIC SPACE, as in 5 000 000
      if (at() === D('5') && DIGIT_OF[LETTERS[at(1)]]) { t += '\\,'; i++; continue; }
      break;
    }
    // GTM 6.1: a simple numeric fraction stays inside numeric mode, which is
    // why clause 1 of 7.1 says an item "would include fraction lines".
    if (at() === C.SIMPLE_L && t) {
      i++;
      if (at() === C.NUM) i++;
      let den = '';
      for (;;) {
        const l = LETTERS[at()];
        if (l && DIGIT_OF[l]) { den += DIGIT_OF[l]; i++; continue; }
        if (at() === C.DECPT) { den += '.'; i++; continue; }
        if (at() === C.COMMA && DIGIT_OF[LETTERS[at(1)]]) { den += ','; i++; continue; }
        break;
      }
      if (den) return Frac(Num(t, s, 0), Num(den, s, 0), s, i - s);
    }
    return t ? Num(t, s, i - s) : Seq([], s, i - s);
  }

  function generalFraction() {
    const s = i;
    if (at() === C.G1) i++;
    i++;                                        // ⠷
    const num = sequence(null, (p) => matches(C.FRAC_L, p) || cells[p] === C.FRAC_C);
    if (matches(C.FRAC_L)) i += C.FRAC_L.length;
    else warnings.push('General fraction without ⠨⠌ line');
    const den = sequence(null, (p) => cells[p] === C.FRAC_C);
    if (at() === C.FRAC_C) i++; else warnings.push('Unclosed fraction (missing ⠾)');
    return Frac(num, den, s, i - s);
  }

  function radical() {
    const s = i;
    if (at() === C.G1) i++;
    i++;                                        // ⠩
    let index = null;
    if (at() === C.SUP) { i++; index = item(); }   // GTM 8.2: index is an ITEM
    const body = sequence(null, (p) => cells[p] === C.ROOT_C);
    if (at() === C.ROOT_C) i++; else warnings.push('Unclosed radical (missing ⠬)');
    return Root(body, index, s, i - s);
  }

  function bracketAt(p) {
    for (const [o, c, lo, lc] of BRACKETS) if (matches(o, p)) return { o, c, lo, lc };
    return null;
  }
  // A BINOMIAL IS A ROUND BRACKET WITH A VERTICAL JUXTAPOSITION IN IT (GTM 14.3).
  // The separator is dots 56 then 12456; the older reader has read this since
  // its precedence table was written, and the newer one turned it into
  // "(n [unreadable] r)" - so "n choose r" was unreadable AND unspeakable
  // (2026-09-02, the audit).
  const VJUX = D('56') + D('12456');
  function bracket(b) {
    const s = i;
    i += b.o.length;
    const body = sequence(null, (p) => matches(b.c, p) || matches(VJUX, p));
    if (matches(VJUX) && b.o === C.RND_O) {
      i += VJUX.length;
      const bottom = sequence(null, (p) => matches(b.c, p));
      if (matches(b.c)) i += b.c.length;
      else warnings.push(`Unclosed binomial (missing ${b.c})`);
      return Frac(body, bottom, s, i - s, { binom: true });
    }
    if (matches(b.c)) i += b.c.length;
    else warnings.push(`Unclosed bracket (missing ${b.c})`);
    return Group(body, b.lo, b.lc, s, i - s);
  }

  function symbolAt(p) {
    for (const [str, tex] of SYMBOLS) {
      if (cells.slice(p, p + str.length).join('') === str) return { tex, len: str.length, cells: str };
    }
    return null;
  }
  // GTM 13: an arrow is COMPOSED — shaft and barb — not a fixed list.
  function arrowAt(p) {
    const m = symbolAt(p);
    if (m && /arrow|←|→|↑|↓|↔|⇒|⇐|⇔/.test(m.tex) && cells[p] === C.ARROW) {
      return { tex: m.tex, end: p + m.len };
    }
    return null;
  }
  // GTM 14: a shape is ⠫ + its name, closed by an optional ⠱ terminator.
  function shapeAt(p) {
    if (cells[p] !== C.SHAPE) return null;
    const m = symbolAt(p);
    if (!m) return null;
    let end = p + m.len;
    if (cells[end] === C.MOD_BAR) end++;         // the shape terminator
    return { tex: m.tex, end };
  }

  function atom() {
    const s = i;
    
    // Support isolated modifiers (no base)
    let p = i;
    if (cells[p] === C.G1) p++;
    if (cells[p] === C.SUP || cells[p] === C.SUB || matches(C.OVER, p) || matches(C.UNDER, p)) {
      return Seq([], s, 0); // Return empty base without advancing `i`, attach() will consume the modifier
    }
    
    for (const r of RULES) {
      if (!r.try) continue;
      const n = r.try();
      if (n) return n;
    }
    // Nothing matched: record it, step over it, keep reading. This is the whole
    // of our tolerance, and it is why a half-typed line still shows something.
    warnings.push(`cell ${i + 1} (dots ${dotsOf(at())}) not recognised`);
    const bad = Unreadable([at()], s);
    i++;
    return bad;
  }

  // ---- attachment ---------------------------------------------------------
  // GTM 7 and 12. Scripts and marks FOLLOW what they attach to, so they are
  // collected onto the node just read — which is only possible because that node
  // still exists. Both a sub and a sup on one base stay on ONE node so they
  // render as a single msubsup rather than two separate scripts.
  function attach(base) {
    const parts = {};
    let any = false;
    for (;;) {
      let p = i;
      if (cells[p] === C.G1) p++;                 // a grade-1 may precede a script
      if (matches(C.OVER, p))  { i = p + C.OVER.length;  parts.over  = item(); any = true; continue; }
      if (matches(C.UNDER, p)) { i = p + C.UNDER.length; parts.under = item(); any = true; continue; }
      if (cells[p] === C.SUP)  { i = p + 1; parts.sup = item(); any = true; continue; }
      if (cells[p] === C.SUB)  { i = p + 1; parts.sub = item(); any = true; continue; }
      const mod = modifierAt(p);
      if (mod) { i = mod.end; parts.over = mod.node; any = true; continue; }
      break;
    }
    if (!any) return base;
    return Attached(base, parts, base.at, i - base.at);
  }

  // GTM 12: bars, dots and arrows over and under, written AFTER their item.
  const MODIFIERS = [
    [D('6') + D('45') + C.MOD_BAR, 'vec',  true],
    [D('45') + C.MOD_BAR,          'vec',  false],
    [D('6') + C.MOD_BAR,           'bar',  true],
    [D('5') + C.MOD_BAR,           'hat',  false],
    [D('45') + D('256'),           'dot',  false],
    [C.MOD_BAR,                    'bar',  false],
  ];
  function modifierAt(p) {
    for (const [str, accent, under] of MODIFIERS) {
      if (cells.slice(p, p + str.length).join('') === str) {
        const node = { k: 'sym', tex: accent, accent, at: p, len: str.length };
        return under ? { node: null, under: node, end: p + str.length, accent }
                     : { node, end: p + str.length, accent };
      }
    }
    return null;
  }

  // ---- driver -------------------------------------------------------------
  function sequence(stopCell, stopFn) {
    const s = i;
    const items = [];
    while (i < cells.length) {
      if (stopCell && at() === stopCell) break;
      if (stopFn && stopFn(i)) break;
      const before = i;
      const node = attach(atom());
      if (i === before) { i++; continue; }        // never spin
      items.push(node);
    }
    return Seq(items, s, i - s);
  }

  const tree = sequence(null, null);
  const r = render(tree);
  return { tree, latex: r.latex, spans: r.spans, warnings, badCells: badCells(tree) };
}

export const uebMathsToLatexV2 = (input) => {
  const r = parseUeb(input);
  return { latex: r.latex, warnings: r.warnings, badCells: r.badCells, spans: r.spans, tree: r.tree, ast: r.tree };
};
