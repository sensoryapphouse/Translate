import {
  Seq, Num, Ident, Op, Sym, Space, Frac, Root, Group, Attached, Unreadable, ChemBond, Table,
  render, badCells,
} from './mathnode.mjs';

const D = (s) => String.fromCodePoint(
  0x2800 + [...String(s)].reduce((a, c) => a | (1 << (Number(c) - 1)), 0));

const C = {
  SPACE: '⠀',
  NUM: D('3456'),   // ⠼ (also FCLOSE)
  CAP: D('6'),      // ⠠
  GREEK: D('46'),   // ⠨
  SUP: D('45'),     // ⠘
  SUB: D('56'),     // ⠰
  BASE: D('5'),     // ⠐
  FOPEN: D('1456'), // ⠹
  FLINE: D('34'),   // ⠌
  FCLOSE: D('3456'),// ⠼
  ROPEN: D('345'),  // ⠜
  RCLOSE: D('12456'), // ⠻
  PUNCT: D('456'),  // ⠸ (punctuation / bold)
  MOD_ABOVE: D('126'), // ⠣ modified above
  MOD_BELOW: D('146'), // ⠩ modified below
  LPAREN: D('12356'), // ⠷
  RPAREN: D('23456'), // ⠾
  ROWSEP: '\\x00',     // 8-dot matrix row separator (MathCAT ⣍)
};

const CHEM_BOND = {
  [D('25')]: '-',       // ⠒ single bond
  [D('2356')]: '=',     // ⠶ double bond
  [D('123456')]: '\\equiv ', // ⠿ triple bond
};

const PUNCT_MAP = {
  [D('256')]: '.',   // ⠲
  [D('2')]:   ',',   // ⠂
  [D('25')]:  ':',   // ⠒
  [D('23')]:  ';',   // ⠆
  [D('236')]: '?',   // ⠦
  [D('235')]: '!',   // ⠖
  [D('3')]:   "'",   // ⠄
  [D('36')]:  '-',   // ⠤
  [D('356')]: '"',   // ⠴
};

const TYPEFORM_TEX = {
  [C.PUNCT + C.SUB]: '\\mathbf', // ⠸⠰
  [C.GREEK + C.SUB]: '\\mathbb', // ⠨⠰
  [D('4') + C.SUB]: '\\mathscr', // ⠈⠰
};

const DROPPED_VALS = { '⠂':'1', '⠆':'2', '⠒':'3', '⠲':'4', '⠢':'5', '⠖':'6', '⠶':'7', '⠦':'8', '⠔':'9', '⠴':'0' };
const LETTERS = {};
const CELL_OF = {};
'abcdefghijklmnopqrstuvwxyz'.split('').forEach((ch, i) => {
  const d = D(['1', '12', '14', '145', '15', '124', '1245', '125', '24', '245', '13', '123',
             '134', '1345', '135', '1234', '12345', '1235', '234', '2345', '136', '1236',
             '2456', '1346', '13456', '1356'][i]);
  LETTERS[d] = ch;
  CELL_OF[ch] = d;
});

const GREEK_NAME = {};
'alpha beta gamma delta epsilon zeta eta theta iota kappa lambda mu nu xi omicron pi rho sigma tau upsilon phi chi psi omega'.split(' ').forEach((n, i) => {
  const ds = ['1', '12', '1245', '145', '15', '1356', '156', '1456', '24', '13', '123', '134', '1345', '1346', '135', '1234', '1235', '234', '2345', '136', '124', '12346', '13456', '2456'];
  GREEK_NAME[D(ds[i])] = n;
});
// A LATEX COMMAND MUST NOT RUN INTO THE NEXT LETTER (2026-09-02): \pi followed
// by r emitted "\pir", which Temml reads as an unknown command - the GCSE
// circle-area row printed nothing recognisable. Commands end with a space;
// plain letters (omicron is a Roman o) do not need one.
const GREEK_LOWER_TEX = (n) => (n === 'omicron' ? 'o' : '\\' + n + ' ');
const GREEK_CAP_TEX = {
  gamma:'\\Gamma ', delta:'\\Delta ', theta:'\\Theta ', lambda:'\\Lambda ', xi:'\\Xi ',
  pi:'\\Pi ', sigma:'\\Sigma ', upsilon:'\\Upsilon ', phi:'\\Phi ', psi:'\\Psi ', omega:'\\Omega ',
  alpha:'A', beta:'B', epsilon:'E', zeta:'Z', eta:'H', iota:'I', kappa:'K',
  mu:'M', nu:'N', omicron:'O', rho:'P', tau:'T', chi:'X',
};

const FUNCTIONS = [
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'gcd',
].map((w) => ({ cells: [...w].map((ch) => CELL_OF[ch]).join(''), tex: '\\' + w }))
 .sort((a, b) => b.cells.length - a.cells.length);

const SHAFT = D('25');
const ARROW_BARB = {
  [D('135')]: 'right', [D('246')]: 'left', [D('126')]: 'up', [D('146')]: 'down'
};
export const ARROW_TEX = { right: '\\to ', left: '\\leftarrow ', up: '\\uparrow ', down: '\\downarrow ' };

export const BRACKETS = [
  { cells: C.LPAREN, tex: '(', o: '\\left(', c: false, env: 'pmatrix' },
  { cells: C.RPAREN, tex: ')', o: false, c: '\\right)' },
  { cells: D('46') + D('12356'), tex: '\\{', o: '\\left\\{', c: false, env: 'Bmatrix' },
  { cells: D('46') + D('23456'), tex: '\\}', o: false, c: '\\right\\}' },
  { cells: D('12356') + D('3'), tex: '[', o: '\\left[', c: false, env: 'bmatrix' },
  { cells: D('6') + D('23456'), tex: ']', o: false, c: '\\right]' },
  // THE SQUARE BRACKETS THE CORPUS USES (2026-09-02): dots 4 + the parenthesis
  // cells, 11 rows each - "[GF(625) : GF(25)]", "[x] = {y in X : y ~ x}". The
  // two entries above are a different spelling and are left alone.
  { cells: D('4') + D('12356'), tex: '[', o: '\\left[', c: false, env: 'bmatrix' },
  { cells: D('4') + D('23456'), tex: ']', o: false, c: '\\right]' },
  // A VERTICAL BAR IS ITS OWN CLOSER (2026-09-02). Listed as an opener with
  // `c: false`, the closing bar never matched: |-9| = 9 printed
  // "\left| - 9\left| = 9" - malformed LaTeX that Temml renders as a run-on,
  // and three absolute-value rows of the curriculum set read as something else.
  // `self` says the same sign closes the group; the scans below use it instead
  // of counting it as a second opening.
  { cells: D('1256') + D('1256'), tex: '\\|', o: '\\left\\|', c: '\\right\\|', self: true, env: 'Vmatrix' },
  { cells: D('1256'), tex: '|', o: '\\left|', c: '\\right|', self: true, env: 'vmatrix' },
];

export const OPS = [
  { cells: D('4') + D('16'), tex: '\\times ' },
  // ± AND ∓ ARE ONE SIGN EACH, not a plus next to a minus (2026-08-28).
  //
  // Nemeth writes ± as ⠬⠤ and ∓ as ⠤⠬ — liblouis nemethdefs.cti lines 57 and
  // 61 (`\x00B1 346-36`, `\x2213 36-346`), and our own writer emits exactly
  // those cells (latex-to-nemeth.js, `case 'pm'`). Missing here, the reader
  // took them as two operators and answered `+  - `: the quadratic formula
  // printed "−b + −√…" and spoke "plus minus". The describer already knew
  // (nemeth-symbols.mjs lists ⠬⠤ before the bare ⠬); the parser did not, so
  // one construct had two readers that disagreed.
  //
  // OPS is sorted longest-first below, which is what puts these ahead of the
  // one-cell + and - that would otherwise match first.
  { cells: D('346') + D('36'), tex: '\\pm ' },
  { cells: D('36') + D('346'), tex: '\\mp ' },
  { cells: D('346'), tex: '+' },
  { cells: D('36'), tex: '-' },
  { cells: D('16'), tex: '\\cdot ' },
  { cells: D('46') + D('2'), tex: '>' },
  { cells: D('5') + D('13'), tex: '<' },
  { cells: D('46') + D('13'), tex: '=' },
  { cells: D('456') + D('46'), tex: '\\neq ' },
  { cells: D('2346'), tex: '\\int ' },
  { cells: D('12346'), tex: '!' },          // ⠯ factorial
  { cells: D('123456'), tex: '\\square ' }, // ⠿ omission

  // SIGNS THE CORPUS ASKED FOR (2026-09-02). Each was found by bucketing the
  // 279 rows this reader could not read, then reading what the SOURCE MathML
  // of those rows has at that position - never by guessing from the dots.
  { cells: D('4') + D('15'), tex: '\\in ' },        // 10 rows: "y : Gx = y for x IN Z", "72 IN Z240"
  { cells: D('4') + D('3456'), tex: '\\ast ' },     // 21 rows: "C *", every one an asterisk
  { cells: D('456') + D('34'), tex: '/' },          // 13 rows: "f(p/q)", "10/5 = 2" - the diagonal fraction line
  { cells: D('4') + D('34'), tex: '\\setminus ' },  // "A \ B" set difference, same family as the above
  // THE TILDE, in all three places the corpus puts it: spaced as a relation
  // ("r/s ~ t/u", "x ~ y"), unspaced as a prefix ("~p"), and as the modifier
  // inside a modified expression, which gives the tilde over a letter
  // ("|X~| = 2^4"). 25 rows carried it and none could be read.
  { cells: D('4') + D('156'), tex: '\\sim ' },
  // "therefore": dots 6 + dots 16, from the corpus rows whose source is exactly
  // that sign followed by a letter. Found while listening to the fallback
  // speaker, which said "unreadable times q" for it.
  { cells: D('6') + D('16'), tex: '\\therefore ' },

].sort((a, b) => b.cells.length - a.cells.length);

export const SHAPES = {
  [D('246')]: '\\angle ', [D('2345')]: '\\triangle ',
  [D('14')]: '\\bigcirc ', [D('256')]: '\\square ', [D('1235')]: '\\Box '
};

const UNIT_WORDS = ['mm','cm','km','kg','mg','ml','kl','mol','rad','min','Hz',
                    'm','g','l','s','h','N','J','W','V','K','A'];
// A UNIT IS SPELLED THE WAY IT IS SPELLED, CAPITALS AND ALL (2026-08-28).
//
// Nemeth writes a capital as ⠠ before the letter, so the ampere A is ⠠⠁ and
// can NEVER be the bare ⠁ that means the variable a. Lower-casing every word
// here threw that distinction away, and the quadratic formula's 2a came back
// as 2 amperes — `2\mathrm{A}` in the LaTeX, "2 A" in print and in the ear.
// The UEB parser had it right all along (ueb-maths-to-latex.mjs UNIT_RE keeps
// the case), so this also puts the two parsers back in step.
const UNIT_CELLS = UNIT_WORDS.map((w) => ({
  word: w,
  cells: [...w].map((ch) => (ch >= 'A' && ch <= 'Z'
    ? C.CAP + CELL_OF[ch.toLowerCase()]
    : CELL_OF[ch])).join(''),
})).sort((a, b) => b.cells.length - a.cells.length);

export function parseNemeth(input) {
  const cells = [...String(input)]
    .map((c) => {
      if (c === ' ') return C.SPACE;
      const cp = c.codePointAt(0);
      if (cp >= 0x2800 && cp <= 0x28ff) {
        if ((cp & 0xC0) === 0xC0) return C.ROWSEP;
        return String.fromCodePoint(0x2800 | (cp & 0x3f));
      }
      return c;
    })
    .filter((c) => c === C.ROWSEP || (c >= '⠀' && c <= '⣿'));

  const warnings = [];
  let i = 0;
  // HOW DEEP IN SUPERSCRIPTS/SUBSCRIPTS THE PARSER IS (2026-09-02). Nemeth §78
  // writes the comma inside a script as ⠪ (dots 246), the cell that at the
  // baseline opens a cancellation; tryCancellation needs to know which level it
  // is on to tell the two apart. It asked a variable called `depth` that was
  // never declared, so every ⠪ without a closing ⠻ - six corpus cases and a
  // third of random input - threw a ReferenceError out of a parser whose whole
  // design is that bad input becomes an `unreadable` node, never an exception.
  let scriptDepth = 0;
  // Where the last NUMBER ended (index just past its final cell). tryUnit asks
  // this rather than asking whether the cell before the space LOOKS like a
  // digit: Nemeth's dropped digits share their cells with punctuation and with
  // the tails of two-cell symbols, so ⠸⠒ (the colon of "f: A → B") ends in a
  // ⠒ that is not a 3, and reading the raw cell turned that set A into amperes.
  let lastNumEnd = -1;

  const at = (k = 0) => cells[i + k];
  const matches = (s, p = i) => cells.slice(p, p + s.length).join('') === s;

  function item() {
    return atom();
  }

  const RELS = [
    { cells: C.GREEK + D('13'), tex: '=' },
    { cells: C.GREEK + D('2'), tex: '>' },
    { cells: C.BASE + D('13'), tex: '<' },
    // SPACING DECIDES THIS ONE. Spaced, dots-456 + dots-123 is the identity
    // sign; unspaced, the same two cells are a Fraktur l - the pair the
    // verifier's comparator is careful to keep apart. tryRelation only fires
    // when both sides are boundaries, which is exactly the distinction.
    { cells: D('456') + D('123'), tex: '\\equiv ' },
  ];

  const RULES = [
    { ref: 'Space', name: 'space', try: trySpace },
    { ref: 'Fraction', name: 'fraction', try: tryFraction },
    { ref: 'Radical', name: 'radical', try: tryRadical },
    { ref: 'Relation', name: 'relation', try: tryRelation },
    { ref: 'ChemBond', name: 'chembond', try: tryChemBond },
    { ref: 'Punctuation', name: 'punctuation', try: tryPunctuation },
    { ref: 'CommaEllipsis', name: 'comma_ellipsis', try: tryCommaEllipsis },
    { ref: 'Cancellation', name: 'cancellation', try: tryCancellation },
    { ref: 'ModifiedExpression', name: 'modified_expression', try: tryModifiedExpression },
    { ref: 'Typeform', name: 'typeform', try: tryTypeform },
    { ref: 'Number', name: 'number', try: tryNumber },
    { ref: 'Function', name: 'function', try: tryFunction },
    { ref: 'Decimal', name: 'decimal', try: tryDecimal },
    { ref: 'Greek', name: 'greek', try: tryGreek },
    { ref: 'Unit', name: 'unit', try: tryUnit },
    { ref: 'Letter', name: 'letter', try: tryLetter },
    { ref: 'Arrow', name: 'arrow', try: tryArrow },
    { ref: 'Shape', name: 'shape', try: tryShape },
    { ref: 'Symbol', name: 'symbol', try: trySymbol },
    { ref: 'Bracket', name: 'bracket', try: tryBracket },
    { ref: 'NemethSwitch', name: 'nemeth_switch', try: tryNemethSwitch },
  ];

  function trySpace() {
    if (at() !== C.SPACE) return null;
    const s = i; i++; return Space(s);
  }

  // THE COMMA AND THE ELLIPSIS - the two commonest cells this reader could not
  // read (2026-09-02). Bucketed over the corpus, 279 of 755 rows failed for an
  // unrecognised cell, and dot 6 (87 rows) and runs of dot 3 (46) led the list.
  //
  // The meanings are the corpus's own, not a guess: every row where dot 6 was
  // unread carries a comma at that position in its source MathML - "(A, b)",
  // "A = 00, B = 01" - and dot 6 followed by a SPACE is how Nemeth writes it.
  // Dot 6 is also the capital indicator, which is why this rule fires only
  // when a space or the end of the line follows: a capital is followed by its
  // letter. Three dots-3 in a row is the ellipsis, again from the source:
  // "(x1, ..., xn)", "A = 00, B = 01, ..., Z = 25".
  function tryCommaEllipsis() {
    if (at() === C.CAP && (at(1) === C.SPACE || at(1) === undefined)) {
      const s = i; i += 1;
      return Op(', ', s, 1, false);
    }
    if (at() === D('3') && at(1) === D('3') && at(2) === D('3')) {
      const s = i; i += 3;
      return Op('\\ldots ', s, 3, false);
    }
    // A PRIME IS A BARE DOT 3, and two of them a double prime - the corpus rows
    // that could not be read here carry "A'", "g''" and "x * '" in their source.
    // Three in a row is the ellipsis above, which is why that is tested first.
    if (at() === D('3')) {
      const s = i; let n = 0;
      while (at() === D('3') && n < 2) { i++; n++; }
      return Op("'".repeat(n), s, n, false);
    }
    return null;
  }

  function tryNemethSwitch() {
    if (at() === D('456') && at(1) === D('146')) {
      const s = i; i += 2;
      const node = Sym('\\phantom{}', s, 2);
      node.name = 'open nemeth';
      return node;
    }
    if (at() === D('456') && at(1) === D('156')) {
      const s = i; i += 2;
      const node = Sym('\\phantom{}', s, 2);
      node.name = 'close nemeth';
      return node;
    }
    return null;
  }

  function tryNumber() {
    let s = i;
    let text = '';
    
    if (at() === C.NUM) {
      i++;
    } else if (at() === D('46') && i + 1 < cells.length && DROPPED_VALS[at(1)]) {
      // starts with decimal point
    } else if (!DROPPED_VALS[at()]) {
      return null;
    }
    
    while (i < cells.length) {
      if (DROPPED_VALS[at()]) {
        text += DROPPED_VALS[at()];
        i++;
      } else if (at() === D('46') && i + 1 < cells.length && DROPPED_VALS[at(1)]) {
        text += '.';
        i++;
      } else if (at() === D('6') && i + 1 < cells.length && DROPPED_VALS[at(1)]) {
        text += ',';
        i++;
      } else {
        break;
      }
    }
    if (!text) return null;
    lastNumEnd = i;
    return Num(text, s, i - s);
  }

  function tryDecimal() {
    if (at() === D('46')) {
      if (at(1) === C.BASE) {
        const s = i;
        i += 2;
        return Num('.', s, 2);
      }
      // If it's just ⠨ and not followed by a greek letter, assume decimal.
      // But we must check it's not a greek letter first.
      // Wait, tryDecimal is BEFORE tryGreek in RULES. So we check if it's greek!
      let cap = false;
      if (at(1) === C.CAP) cap = true;
      if (!GREEK_NAME[at(cap ? 2 : 1)]) {
        const s = i;
        i += 1;
        return Num('.', s, 1);
      }
    }
    return null;
  }

  function tryFunction() {
    for (const f of FUNCTIONS) {
      if (matches(f.cells)) {
        const after = at(f.cells.length);
        const isArg = after === undefined || after === C.SPACE || after === C.LPAREN || after === C.NUM || LETTERS[after] !== undefined || after === C.GREEK || after === C.SUP || after === C.SUB;
        if (isArg) {
          const s = i; i += f.cells.length;
          if (at() === C.SPACE) i++; // space after function is swallowed
          return Op(f.tex + ' ', s, i - s, false);
        }
      }
    }
    return null;
  }

  function tryGreek() {
    if (at() !== C.GREEK) return null;
    let s = i;
    let cap = false;
    if (at(1) === C.CAP) { cap = true; }
    const ltr = GREEK_NAME[at(cap ? 2 : 1)];
    if (!ltr) {
      // Could be ⠨⠅ which is the `=` relation, handled by tryRelation earlier.
      // But if it reaches here and it's not a greek letter, it's unreadable.
      return null;
    }
    i += cap ? 3 : 2;
    const tex = cap ? GREEK_CAP_TEX[ltr] : GREEK_LOWER_TEX(ltr);
    return Ident(tex + ' ', s, i - s);
  }

  function tryUnit() {
    for (const u of UNIT_CELLS) {
      if (matches(u.cells)) {
        // A NUMERAL, THEN A SPACE, THEN THE UNIT - all three (2026-08-28).
        //
        // Nemeth separates an abbreviation from the numeral it measures. The
        // rule corpus states it for the angstrom ("the space that precedes it,
        // as in '1 Å', is REQUIRED by the abbreviation-spacing rule" -
        // tools/rules/areas/17-nemeth-*.json), and §138a keeps operation signs
        // spaced beside abbreviations for the same reason. So "2 m" is two
        // metres and "2m" is two times m.
        //
        // Both halves used to be OPTIONAL: a space alone was taken as evidence
        // ("assume spaced unit") and so was a digit alone. Over the 755-case
        // MathCAT Nemeth corpus that fired 23 times and was wrong 23 times -
        // "r ≡ s (mod n)" read s as seconds and n as newtons, "a - bi" read a
        // as amperes, "(g∘f)(x)" read g as grams. A letter standing next to a
        // space is the commonest thing in mathematics; it is not evidence.
        const prevIsSpace = i > 0 && cells[i - 1] === C.SPACE;
        const isAfterNum = prevIsSpace && lastNumEnd === i - 1;
        
        if (isAfterNum) {
          const after = at(u.cells.length);
          const hasSuffix = LETTERS[after] !== undefined || after === C.SUB || after === C.SUP;
          if (!hasSuffix) {
            const s = i; i += u.cells.length;
            return Sym(`\\mathrm{${u.word}}`, s, i - s);
          }
        }
      }
    }
    return null;
  }

  function tryLetter() {
    // ALL CAPITALS: dots 6 twice capitalises the WORD that follows, not one
    // letter (10 corpus rows, every one of them "GF(p^n)" and its kin). The
    // run ends where the letters do.
    if (at() === C.CAP && at(1) === C.CAP && LETTERS[at(2)] !== undefined) {
      const s = i; i += 2;
      let word = '';
      while (LETTERS[at()] !== undefined) { word += LETTERS[at()].toUpperCase(); i++; }
      return Ident(word, s, i - s);
    }
    if (at() === C.CAP && LETTERS[at(1)] !== undefined) {
      const s = i; i += 2;
      return Ident(LETTERS[at(-1)].toUpperCase(), s, 2);
    }
    const c = at();
    if (LETTERS[c] !== undefined) {
      const s = i; i++; return Ident(LETTERS[c], s, 1);
    }
    return null;
  }

  function tryFraction() {
    let pfx = '';
    let startIdx = 0;
    if (at() === C.CAP) { pfx = C.CAP; startIdx = 1; }
    else if (at() === C.PUNCT) { pfx = C.PUNCT; startIdx = 1; }

    if (at(startIdx) !== C.FOPEN) return null;
    
    const s = i;
    i += startIdx + 1;
    const numItems = [];
    while (i < cells.length) {
      if (pfx ? (at() === pfx && (at(1) === C.FLINE || at(1) === C.FCLOSE)) : (at() === C.FLINE || at() === C.FCLOSE)) break;
      numItems.push(item());
    }
    const num = Seq(numItems, s + startIdx + 1, i - (s + startIdx + 1));
    
    const isLine = pfx ? (at() === pfx && at(1) === C.FLINE) : (at() === C.FLINE);
    if (!isLine) {
      warnings.push('Unclosed fraction (missing fraction line)');
      return Frac(num, Seq([], i, 0), s, i - s);
    }
    i += pfx ? 2 : 1;
    
    const denStart = i;
    const denItems = [];
    while (i < cells.length) {
      if (pfx ? (at() === pfx && at(1) === C.FCLOSE) : (at() === C.FCLOSE)) break;
      denItems.push(item());
    }
    const den = Seq(denItems, denStart, i - denStart);
    
    const isClose = pfx ? (at() === pfx && at(1) === C.FCLOSE) : (at() === C.FCLOSE);
    if (isClose) {
      i += pfx ? 2 : 1;
    } else {
      warnings.push('Unclosed fraction (missing fraction close)');
    }
    return Frac(num, den, s, i - s);
  }

  function tryRadical() {
    if (at() === C.ROPEN) {
      const s = i; i++;
      const items = [];
      while (i < cells.length && at() !== C.RCLOSE) {
        items.push(item());
      }
      const body = Seq(items, s + 1, i - (s + 1));
      if (at() === C.RCLOSE) {
        i++;
      } else {
        warnings.push('Unclosed radical (missing ⠻)');
      }
      return Root(body, null, s, i - s);
    }
    
    // Radical with index: ⠣ index ⠜ radicand ⠻
    if (at() === C.MOD_ABOVE) { // ⠣
      const s = i; i++;
      const indexItems = [];
      while (i < cells.length && at() !== C.ROPEN) {
        indexItems.push(item());
      }
      const indexSeq = Seq(indexItems, s + 1, i - (s + 1));
      
      if (at() !== C.ROPEN) {
        warnings.push('Unclosed radical index (missing ⠜)');
        return Root(Seq([], i, 0), indexSeq, s, i - s);
      }
      i++; // skip ⠜
      
      const radicandItems = [];
      const radStart = i;
      while (i < cells.length && at() !== C.RCLOSE) {
        radicandItems.push(item());
      }
      const radicandSeq = Seq(radicandItems, radStart, i - radStart);
      
      if (at() === C.RCLOSE) {
        i++;
      } else {
        warnings.push('Unclosed radical (missing ⠻)');
      }
      return Root(radicandSeq, indexSeq, s, i - s);
    }
    
    return null;
  }

  function trySymbol() {
    for (const op of OPS) {
      if (matches(op.cells)) {
        const s = i; i += op.cells.length;
        return Op(op.tex, s, op.cells.length, true);
      }
    }
    return null;
  }

  function tryArrow() {
    if (at() !== D('1246')) return null; // ⠫ shape indicator
    let j = i + 1, n = 0, dbl = false, barbL = false, curvedL = false, curvedR = false;
    if (cells[j] === D('246')) { barbL = true; j++; }
    else if (cells[j] === D('16')) { barbL = true; curvedL = true; j++; }
    while (cells[j] === SHAFT || cells[j] === D('2356')) {
      if (cells[j] === D('2356')) dbl = true;
      j++; n++;
    }
    let dirR = ARROW_BARB[cells[j]];
    let harpoon = false;
    if (cells[j] === D('16')) { dirR = 'right'; curvedR = true; }
    if (!dirR && cells[j] === D('4') && ARROW_BARB[cells[j + 1]] === 'right') {
      dirR = 'right'; harpoon = true; j++;
    }
    if (!barbL && !dirR) return null;
    if (dirR) {
      j++;
      while (cells[j] === SHAFT || cells[j] === D('2356')) { j++; n++; }
    }
    
    let dir, tex;
    if (barbL && dirR === 'right') { tex = dbl ? '\\Leftrightarrow ' : (n >= 3 ? '\\longleftrightarrow ' : '\\leftrightarrow '); }
    else if (barbL && !dirR) { tex = dbl ? (n >= 3 ? '\\Longleftarrow ' : '\\Leftarrow ') : (n >= 3 ? '\\longleftarrow ' : '\\leftarrow '); }
    else if (curvedL || curvedR) { tex = '\\frown '; }
    else {
      tex = harpoon ? '\\rightharpoonup ' : dbl && dirR === 'right' ? (n >= 3 ? '\\implies ' : '\\Rightarrow ')
                                          : (n >= 3 && dirR === 'right' ? '\\longrightarrow ' : ARROW_TEX[dirR]);
    }
    
    const s = i; i = j;
    return Op(tex, s, i - s, true);
  }

  function tryShape() {
    if (at() !== D('1246')) return null; // ⠫
    const g = SHAPES[at(1)];
    if (g) {
      const s = i;
      i += 2;
      return Op(g, s, 2, false);
    }
    return null;
  }

  // ENLARGED GROUPING SIGNS (Nemeth §126, 2026-09-02): a matrix or a tall
  // expression is enclosed in brackets written with dot 6 in front - ⠠⠷ … ⠠⠾.
  // The dot 6 is part of the sign. It used to reach the "cell not recognised"
  // fallback, so every matrix printed with a stray □ in front of it and an
  // amber warning under it.
  const enlargedAt = (p) => cells[p] === C.CAP && BRACKETS.some((b) => matches(b.cells, p + 1)) ? 1 : 0;

  function tryBracket() {
    const lead = enlargedAt(i);
    for (const b of BRACKETS) {
      if (matches(b.cells, i + lead)) {
        if (b.o) {
          // Open bracket: parse until we find the closing bracket
          let j = i + lead + b.cells.length;
          let depth2 = 0;
          let hasRowSep = false;
          let foundClose = false;
          while (j < cells.length) {
            const cc = cells[j];
            if (cc === C.ROWSEP) hasRowSep = true;
            
            // Check for nested brackets to ensure we find the matching close
            let matchedAny = false;
            const lead2 = enlargedAt(j);
            for (const b2 of BRACKETS) {
              if (matches(b2.cells, j + lead2)) {
                if (b2.self) {
                  // the same sign again: it closes THIS group when it is the
                  // sign we opened with, and is content otherwise
                  if (b2 === b && depth2 === 0) { foundClose = true; j += lead2 + b2.cells.length; break; }
                } else if (b2.o) depth2++;
                else if (b2.c) {
                  if (depth2 === 0) {
                    foundClose = true;
                    j += lead2 + b2.cells.length;
                    break;
                  }
                  depth2--;
                }
                if (foundClose) break;
                j += lead2 + b2.cells.length;
                matchedAny = true;
                break;
              }
            }
            if (foundClose) break;
            if (!matchedAny) j++;
          }
          
          if (foundClose) {
            const s = i;
            i += lead + b.cells.length; // skip open bracket (and its dot 6)
            
            let closeTex = false;
            const innerItems = [];
            while (i < j) {
              // stop right before the closing bracket
              let isClose = false;
              const leadC = enlargedAt(i);
              for (const b2 of BRACKETS) {
                if (b2.self && b2 !== b) continue;          // a different bar inside is content
                if (b2.c && matches(b2.cells, i + leadC)) { isClose = true; closeTex = b2.c; break; }
              }
              if (isClose) break;
              // A row separator is where one matrix row ends. It is structure,
              // not an unread cell, so it is placed directly - the splitter below
              // looks for exactly this node - and raises no warning.
              if (at() === C.ROWSEP) { innerItems.push(Unreadable([C.ROWSEP], i)); i++; continue; }
              innerItems.push(item());
            }
            const cLen = j - i;
            i += cLen; // skip close bracket
            
            // A ROW SEPARATOR MAKES IT A TABLE. The separator is matched by no
            // rule, so it arrives as an Unreadable node carrying that one cell,
            // and the rows split cleanly on those. (Twelve lines of first-draft
            // reasoning and an empty loop stood here until 2026-09-02 - the
            // author thinking aloud about how to do exactly this, left in place
            // beside the code that does it.)
            if (hasRowSep) {
              const rows = [];
              let curRow = [];
              let curCell = [];
              for (const n of innerItems) {
                if (n.k === 'unreadable' && n.cells[0] === C.ROWSEP) {
                  if (curCell.length > 0) curRow.push(Seq(curCell, curCell[0].at, n.at - curCell[0].at));
                  if (curRow.length > 0) rows.push(curRow);
                  curRow = [];
                  curCell = [];
                } else if (n.k === 'space') {
                  if (curCell.length > 0) curRow.push(Seq(curCell, curCell[0].at, n.at - curCell[0].at));
                  curCell = [];
                } else {
                  curCell.push(n);
                }
              }
              if (curCell.length > 0) curRow.push(Seq(curCell, curCell[0].at, j - curCell[0].at));
              if (curRow.length > 0) rows.push(curRow);
              
              return Table(rows, b.env || 'pmatrix', s, j - s);
            }
            
            return Group(Seq(innerItems, s + b.cells.length, j - s - b.cells.length - cLen), b.o, closeTex, s, j - s);
          } else {
            // UNMATCHED: the BARE sign, never \left / \right (2026-09-02).
            // A \left with no \right is invalid LaTeX - Temml gives up on the
            // whole line - and 25 corpus rows emitted one, mostly a lone
            // vertical bar the writer never closed. The bare glyph is what the
            // cell says and it stands on its own.
            const s = i; i += lead + b.cells.length;
            return Op(b.tex, s, b.cells.length, false);
          }
        } else {
          // Unmatched close bracket: the bare sign, for the same reason
          const s = i; i += lead + b.cells.length;
          return Op(b.tex, s, b.cells.length, false);
        }
      }
    }
    return null;
  }

  function tryPunctuation() {
    if (at() !== C.PUNCT) return null;
    if (PUNCT_MAP[at(1)]) {
      const s = i; i += 2;
      return Op(PUNCT_MAP[at(-1)], s, 2, false);
    }
    return null;
  }

  function tryTypeform() {
    const pfx = at() + at(1);
    if (TYPEFORM_TEX[pfx]) {
      const tex = TYPEFORM_TEX[pfx];
      const s = i; i += 2; // skip prefix
      const n = atom();
      if (n && n.k === 'ident') {
        return Sym(`${tex}{${n.text}}`, s, i - s);
      }
      return n; // fallback
    }
    return null;
  }

  const relBoundary = (cell) => cell === undefined || cell === C.SPACE || cell === C.LPAREN ||
    cell === C.RPAREN || cell === C.CAP || cell === C.PUNCT;
  function spaced(p, len) {
    return relBoundary(cells[p - 1]) && relBoundary(cells[p + len]);
  }

  function tryRelation() {
    let pfx = '';
    let startIdx = 0;
    if (at() === C.FLINE) {
      pfx = C.FLINE;
      startIdx = 1;
    }
    for (const r of RELS) {
      if (matches(r.cells, i + startIdx)) {
        if (spaced(i, r.cells.length + startIdx)) {
          const s = i; i += r.cells.length + startIdx;
          let tex = r.tex;
          if (pfx) {
            if (r.tex === '=') tex = '\\neq ';
            else tex = '\\not ' + r.tex;
          }
          return Op(tex, s, r.cells.length + startIdx, true);
        }
      }
    }
    return null;
  }

  function tryPunctuation() {
    if (at() !== C.PUNCT) return null;
    if (PUNCT_MAP[at(1)]) {
      const s = i; i += 2;
      return Op(PUNCT_MAP[at(1)], s, 2, false);
    }
    return null;
  }

  function tryTypeform() {
    const pfx = at() + at(1);
    if (TYPEFORM_TEX[pfx]) {
      const tex = TYPEFORM_TEX[pfx];
      const s = i; i += 2; // skip prefix
      const n = atom();
      if (n && n.k === 'ident') {
        return Sym(`${tex}{${n.text}}`, s, i - s);
      }
      return n; // fallback
    }
    return null;
  }

  function tryCancellation() {
    if (at() === D('246')) { // ⠪
      // Lookahead for ⠻ without encountering space or rowsep
      let j = i + 1;
      let foundEnd = false;
      while (j < cells.length) {
        if (cells[j] === C.RCLOSE) { foundEnd = true; break; }
        if (cells[j] === C.SPACE) break; // abort, it's not a cancellation
        j++;
      }
      if (foundEnd) {
        const s = i; i++;
        const innerItems = [];
        while (i < j) innerItems.push(item());
        i++; // consume ⠻
        const innerSeq = Seq(innerItems, s + 1, j - (s + 1));
        return Group(innerSeq, '\\cancel{', '}', s, i - s);
      }
      
      // No closing ⠻. Inside a script this cell IS the comma (Nemeth §78: "x
      // sub i comma j" is written ⠭⠰⠊⠪⠚); at the baseline it is nothing this
      // rule knows, and returning null lets it fall through to the other rules
      // and, failing those, to an honest `unreadable` node.
      if (scriptDepth > 0) {
        const s = i; i++;
        return Op(', ', s, 1, true);
      }
    }
    return null;
  }

  function tryChemBond() {
    if (at() === C.PUNCT) {
      const b = CHEM_BOND[at(1)];
      if (b && at(2) === C.RCLOSE) {
        const s = i; i += 3;
        return ChemBond(b, s, 3);
      }
    }
    return null;
  }

  function tryModifiedExpression() {
    // ⠐ base ⠣|⠩ modifier ⠻
    if (at() !== C.BASE) return null;
    // We need to look ahead to ensure it's a complete modified expression
    // before committing to consuming the ⠐ as a modifier start rather than a baseline return.
    let j = i + 1;
    let foundMod = false;
    let modIsAbove = false;
    while (j < cells.length) {
      if (cells[j] === C.MOD_ABOVE || cells[j] === C.MOD_BELOW) {
        foundMod = true;
        modIsAbove = cells[j] === C.MOD_ABOVE;
        break;
      }
      if (cells[j] === C.SPACE || cells[j] === C.BASE) break; // abort lookahead
      j++;
    }
    
    if (foundMod) {
      let k = j + 1;
      let foundEnd = false;
      while (k < cells.length) {
        if (cells[k] === C.RCLOSE) { foundEnd = true; break; }
        k++;
      }
      if (foundEnd) {
        const s = i; i++; // skip ⠐
        const baseItems = [];
        while (i < j) baseItems.push(item());
        const baseSeq = Seq(baseItems, s + 1, j - (s + 1));
        
        i++; // skip mod indicator
        const modItems = [];
        while (i < k) modItems.push(item());
        const modSeq = Seq(modItems, j + 1, k - (j + 1));
        
        i++; // skip ⠻
        
        const attach = modIsAbove ? { over: modSeq } : { under: modSeq };
        return Attached(baseSeq, attach, s, i - s);
      }
    }
    return null; // not a modified expression; let modifierAt consume the BASE if it's a return.
  }

  function modifierAt() {
    let sup = null, sub = null;
    let s = i;
    while (at() === C.SUP || at() === C.SUB) {
      const isSup = at() === C.SUP;
      i++;
      const items = [];
      // Nemeth scripts continue until a baseline, space, punctuation, or another level change.
      scriptDepth++;
      try {
        while (i < cells.length && at() !== C.BASE && at() !== C.SPACE && at() !== C.PUNCT && at() !== C.SUP && at() !== C.SUB) {
          items.push(item());
        }
      } finally { scriptDepth--; }
      const seq = Seq(items, s + 1, i - (s + 1));
      if (isSup) sup = seq; else sub = seq;
      
      // If we hit a baseline indicator, consume it and we are back to base level.
      if (at() === C.BASE) {
        i++;
        break; // A baseline indicator explicitly terminates the script block for this base.
      }
    }
    return (sup || sub) ? { sup, sub } : null;
  }

  function atom() {
    const s = i;
    
    // Support isolated modifiers (e.g. clicking on just the superscript chunk)
    if (at() === C.SUP || at() === C.SUB) {
      const emptyBase = Seq([], s, 0);
      const m = modifierAt();
      if (m) {
        return Attached(emptyBase, m, s, i - s);
      }
    }

    let n = null;
    for (const rule of RULES) {
      if (!rule.try) continue;
      n = rule.try();
      if (n) break;
    }
    
    if (!n) {
      const c = at();
      warnings.push(`cell ${i + 1} not recognised`);
      i++;
      n = Unreadable([c], s);
    }
    
    const m = modifierAt();
    if (m) {
      return Attached(n, m, s, i - s);
    }
    return n;
  }

  function sequence(untilFn) {
    const items = [];
    const start = i;
    while (i < cells.length) {
      if (untilFn && untilFn()) break;
      items.push(item());
    }
    return Seq(items, start, i - start);
  }

  const ast = sequence();
  return { ast, warnings };
}

export function nemethMathsToLatexV2(input) {
  const parsed = parseNemeth(input);
  const out = render(parsed.ast);
  out.warnings = parsed.warnings;
  out.badCells = badCells(parsed.ast);
  out.ast = parsed.ast;
  return out;
}
