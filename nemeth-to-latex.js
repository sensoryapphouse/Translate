'use strict';
/* ===========================================================================
 * Nemeth (6-dot braille) -> LaTeX  —  core-subset converter
 * ---------------------------------------------------------------------------
 * Input:  a string of Unicode braille cells (U+2800–U+28FF). Dots 7/8 are
 *         masked off, so 8-dot input is accepted but treated as 6-dot.
 * Output: { latex, warnings }.
 *
 * Dot patterns are taken from liblouis `nemethdefs.cti` (LGPL) and the Nemeth
 * Code spec. Because Nemeth is context-sensitive, several cells are ambiguous;
 * this converter resolves relations (= < >) by SPACING, exactly as the code
 * itself does. See the LIMITATIONS block at the bottom of this file.
 * ======================================================================== */

// Build a Unicode braille cell from a dot string: dots('3456') -> '⠼'.
function dots(s) {
  let code = 0x2800;
  for (const ch of s) code |= 1 << (Number(ch) - 1);
  return String.fromCodePoint(code);
}
// Reverse: cell -> dot string (for diagnostics).
function toDots(cell) {
  const cp = cell.codePointAt(0) - 0x2800;
  let s = '';
  for (let d = 1; d <= 6; d++) if (cp & (1 << (d - 1))) s += d;
  return s || 'blank';
}

// --- Structural / indicator cells ------------------------------------------
const SPACE  = dots('');       // ⠀ blank cell (spaces normalise to this)
const ROWSEP = '\\x00';       // matrix row separator (8-dot cells, see convert)
const NUM    = dots('3456');   // ⠼ numeric indicator (== fraction-close cell)
const CAP    = dots('6');      // ⠠ capital indicator
const GREEK  = dots('46');     // ⠨ greek indicator (also '=' 1st cell / decimal pt)
const SUP    = dots('45');     // ⠘ superscript
const SUB    = dots('56');     // ⠰ subscript (also English-letter sign)
const BASE   = dots('5');      // ⠐ baseline indicator
const FOPEN  = dots('1456');   // ⠹ fraction open
const FLINE  = dots('34');     // ⠌ fraction line
const FCLOSE = dots('3456');   // ⠼ fraction close (identical cell to NUM)
const ROPEN  = dots('345');    // ⠜ radical (square-root) open
const RCLOSE = dots('12456');  // ⠻ radical close (termination)
const LPAREN = dots('12356');  // ⠷ (
const RPAREN = dots('23456');  // ⠾ )
const BOLDI  = dots('456');    // ⠸ boldface indicator (1st cell of ⠸⠰)
const SCRIPTI = dots('4');     // ⠈ script indicator   (1st cell of ⠈⠰)

// Typeform indicator + English-letter sign. Bold letters are vectors and
// double-struck ones are ℤ/ℕ/ℝ, so these carry meaning, not styling.
// The indicator on its own, for when a typeform applies to a number.
const TYPEFORM_PREFIX = {};

const TYPEFORMS = [
  { cells: [BOLDI,   SUB], tex: '\\mathbf' },   // ⠸⠰
  { cells: [GREEK,   SUB], tex: '\\mathbb' },   // ⠨⠰
  { cells: [SCRIPTI, SUB], tex: '\\mathscr' },  // ⠈⠰
];
for (const t of TYPEFORMS) TYPEFORM_PREFIX[t.cells[0]] = t.tex;

// PUNCTUATION INDICATOR (Nemeth §37). In mathematical context ordinary
// punctuation is preceded by ⠸ — the same cell as the boldface indicator, told
// apart by what follows it. MathCAT marks these with a "P" mode letter, which
// is exactly why they are absent from the generated symbol table: the cells
// alone are not the whole symbol. Missing this one rule was the largest single
// group of unread Nemeth in the corpus (":" by itself was 26 cases).
const PUNCT = {
  [dots('256')]: '.',   // ⠲
  [dots('2')]:   ',',   // ⠂
  [dots('25')]:  ':',   // ⠒
  [dots('23')]:  ';',   // ⠆
  [dots('236')]: '?',   // ⠦
  [dots('235')]: '!',   // ⠖
  [dots('3')]:   "'",   // ⠄
  [dots('36')]:  '-',   // ⠤
  [dots('356')]: '"',   // ⠴
};

// CHEMICAL BONDS (BANA Chemical Notation §2). A bond is ⠸ + sign + ⠻ — the
// terminator is what distinguishes it from the punctuation and typeform uses of
// ⠸. These are the `then` branch of MathCAT's "@data-chemical-bond" test, i.e.
// exactly the branch the symbol-table generator discards (it keeps `else`), so
// they can only be handled here.
const CHEM_BOND = {
  [dots('25')]:     '-',          // ⠸⠒⠻ single bond
  [dots('2356')]:   '=',          // ⠸⠶⠻ double bond
  [dots('123456')]: '\\equiv ',   // ⠸⠿⠻ triple bond
};

// ARROWS are COMPOSED, not listed: ⠫ then an optional shaft of ⠒ cells, then a
// barb naming the direction. Chemistry uses them constantly for reactions, and
// a flat symbol table can only ever cover the handful of shaft lengths somebody
// happened to tabulate — which is why ⠫⠕ worked but ⠫⠒⠕ did not.
const SHAFT = dots('25');          // ⠒
const ARROW_BARB = {
  [dots('135')]: 'right',          // ⠕
  [dots('246')]: 'left',           // ⠪
  [dots('126')]: 'up',             // ⠣
  [dots('146')]: 'down',           // ⠩
};
const ARROW_TEX = {
  right: '\\to ', left: '\\leftarrow ', up: '\\uparrow ', down: '\\downarrow ',
};
// Genuine cross-dialect ambiguities surfaced to the teacher (same channel the
// UEB parser uses). Filled during a convert() run, drained at return.
const AMBIG = [];

// Read one arrow starting at a ⠫. Returns {dir, end} or null — null simply means
// this ⠫ is a shape indicator instead, and the caller falls through.
function readArrow(S, i) {
  // §152–§156 arrows in full: [left barb]? [shafts]* [right/up/down barb]?
  // — at least one barb. The shaft may be the DOUBLE line ⠶ (⟹ ⟸ ⟺, which
  // read as "777o" before) as well as the single ⠒, and a LEADING ⠪ barb
  // makes the two-headed forms (⟷) that a trailing-barb-only reader broke
  // into "\leftarrow 3o".
  let j = i + 1, n = 0, dbl = false;
  let barbL = false, curvedL = false, curvedR = false;
  if (S[j] === dots('246')) { barbL = true; j++; }
  else if (S[j] === dots('16')) { barbL = true; curvedL = true; j++; }
  while (S[j] === SHAFT || S[j] === dots('2356')) {
    if (S[j] === dots('2356')) dbl = true;
    j++; n++;
  }
  let dirR = ARROW_BARB[S[j]];
  let harpoon = false;
  if (S[j] === dots('16')) { dirR = 'right'; curvedR = true; }   // §13.3 curved barb
  // §156: a HARPOON barb is ⠈ + the direction cell (upper barb) — ⠒⠒⠈⠕ is ⇀.
  if (!dirR && S[j] === dots('4') && ARROW_BARB[S[j + 1]] === 'right') {
    dirR = 'right'; harpoon = true; j++;
  }
  if (!barbL && !dirR) return null;
  if (dirR) { j++; while (S[j] === SHAFT || S[j] === dots('2356')) { j++; n++; } }
  let dir, tex;
  if (barbL && dirR === 'right') { dir = 'both'; tex = dbl ? '\\Leftrightarrow ' : (n >= 3 ? '\\longleftrightarrow ' : '\\leftrightarrow '); }
  else if (barbL && !dirR)       { dir = 'left'; tex = dbl ? (n >= 3 ? '\\Longleftarrow ' : '\\Leftarrow ') : (n >= 3 ? '\\longleftarrow ' : '\\leftarrow '); }
  if (curvedL || curvedR) {
    dir = barbL && dirR ? 'both' : (dirR || 'left');
    tex = '\\frown ';                       // curved-barb arrow: the ARC form
    return { dir, end: dirR ? j + 1 : j, n, tex, curved: true };
  }
  if (!dir)                       { dir = dirR;  tex = harpoon ? '\\rightharpoonup '
                                              : dbl && dirR === 'right' ? (n >= 3 ? '\\implies ' : '\\Rightarrow ')
                                              : (n >= 3 && dirR === 'right' ? '\\longrightarrow ' : ARROW_TEX[dirR]); }
  return { dir, end: j, n, tex };
}

// --- Digits (Nemeth "dropped"/lower numerals) ------------------------------
const DIGITS = {
  [dots('2')]:'1',  [dots('23')]:'2',  [dots('25')]:'3',   [dots('256')]:'4',
  [dots('26')]:'5', [dots('235')]:'6', [dots('2356')]:'7', [dots('236')]:'8',
  [dots('35')]:'9', [dots('356')]:'0',
};

// --- Latin letters a–z -----------------------------------------------------
const LETTERS = {};
for (const [ltr, d] of [
  ['a','1'],['b','12'],['c','14'],['d','145'],['e','15'],['f','124'],['g','1245'],
  ['h','125'],['i','24'],['j','245'],['k','13'],['l','123'],['m','134'],['n','1345'],
  ['o','135'],['p','1234'],['q','12345'],['r','1235'],['s','234'],['t','2345'],
  ['u','136'],['v','1236'],['w','2456'],['x','1346'],['y','13456'],['z','1356'],
]) LETTERS[dots(d)] = ltr;

// --- Greek (after the ⠨ indicator; capital adds a ⠠) ------------------------
// Cells reuse the Latin letter shapes, so this map is only consulted right
// after a GREEK indicator has been consumed.
const GREEK_NAME = {};
for (const [name, d] of [
  ['alpha','1'],['beta','12'],['gamma','1245'],['delta','145'],['epsilon','15'],
  ['zeta','1356'],['eta','156'],['theta','1456'],['iota','24'],['kappa','13'],
  ['lambda','123'],['mu','134'],['nu','1345'],['xi','1346'],['omicron','135'],
  ['pi','1234'],['rho','1235'],['sigma','234'],['tau','2345'],['upsilon','136'],
  ['phi','124'],['chi','12346'],['psi','13456'],['omega','2456'],
]) GREEK_NAME[dots(d)] = name;
// LaTeX has no \omicron (lowercase o); capital Greek only has commands for some.
const GREEK_LOWER_TEX = (n) => (n === 'omicron' ? 'o' : '\\' + n);
const GREEK_CAP_TEX = {
  gamma:'\\Gamma', delta:'\\Delta', theta:'\\Theta', lambda:'\\Lambda', xi:'\\Xi',
  pi:'\\Pi', sigma:'\\Sigma', upsilon:'\\Upsilon', phi:'\\Phi', psi:'\\Psi', omega:'\\Omega',
  // remaining capitals render as the Latin equivalent
  alpha:'A', beta:'B', epsilon:'E', zeta:'Z', eta:'H', iota:'I', kappa:'K',
  mu:'M', nu:'N', omicron:'O', rho:'P', tau:'T', chi:'X',
};

// FUNCTION NAMES. Nemeth spells them out as ordinary letters with no marker, so
// only a dictionary can recover them — exactly as in UEB. Left as letters they
// come out italic (sin x reading as s times i times n times x), which is wrong
// typographically and re-brailles differently.
//
// A match only counts when what FOLLOWS looks like an argument, so a genuine
// product of variables is not swallowed.
const CELL_OF = {};
for (const [cell, ltr] of Object.entries(LETTERS)) CELL_OF[ltr] = cell;
const FUNCTIONS = [
  'arcsin', 'arccos', 'arctan', 'sinh', 'cosh', 'tanh',
  'sin', 'cos', 'tan', 'sec', 'csc', 'cot',
  'log', 'ln', 'exp', 'lim', 'max', 'min', 'det', 'gcd',
].map((w) => ({ cells: [...w].map((ch) => CELL_OF[ch]), tex: '\\' + w }))
 .filter((f) => f.cells.every(Boolean))
 .sort((a, b) => b.cells.length - a.cells.length);   // longest first

// --- Non-spaced operators (checked longest-cell-first) ----------------------
const OPS = [
  { cells: [dots('4'), dots('16')], tex: ' \\times ' }, // ⠈⠡ multiplication cross
  { cells: [dots('346')],           tex: ' + ' },       // ⠬  plus
  { cells: [dots('36')],            tex: ' - ' },        // ⠤  minus
  { cells: [dots('16')],            tex: ' \\cdot ' },   // ⠡  multiplication dot
];
// --- Relations: spaced in Nemeth; spacing disambiguates them from κ / '.' ---
const RELS = [
  { cells: [GREEK, dots('13')], tex: ' = ' }, // ⠨⠅ equals   (else Greek kappa)
  { cells: [GREEK, dots('2')],  tex: ' > ' }, // ⠨⠂ greater   (else decimal point)
  { cells: [BASE,  dots('13')], tex: ' < ' }, // ⠐⠅ less      (else baseline + k)
  // §151 ratio family — spaced comparison signs, so the relation machinery's
  // boundary tests keep the other meanings (⠐ multipurpose, ⠰ subscript):
  // spacedOnly: these two need LITERAL space cells both sides — a mere
  // boundary (RPAREN, CAP) is how (CO₃)₂'s subscript or a §177 ⠐ looks.
  { cells: [BASE, dots('2')],   tex: ' : ', spacedOnly: true }, // ⠐⠂ "is to"
  { cells: [SUB,  dots('23')],  tex: ' ∷ ', spacedOnly: true }, // ⠰⠆ "as" (proportion)
];

// Symbols that behave as IDENTIFIERS — a digit straight after one is a numeric
// subscript (ℵ₀, μ₁). Operators are deliberately absent.
const IDENT_TEX = new RegExp('^\\\\?(' + [
  'aleph', 'ell', 'hbar', 'imath', 'jmath', 'wp', 'Re', 'Im', 'partial',
  'alpha', 'beta', 'gamma', 'delta', 'epsilon', 'varepsilon', 'zeta', 'eta',
  'theta', 'vartheta', 'iota', 'kappa', 'lambda', 'mu', 'nu', 'xi', 'omicron',
  'pi', 'varpi', 'rho', 'varrho', 'sigma', 'varsigma', 'tau', 'upsilon',
  'phi', 'varphi', 'chi', 'psi', 'omega',
  'Gamma', 'Delta', 'Theta', 'Lambda', 'Xi', 'Pi', 'Sigma', 'Upsilon',
  'Phi', 'Psi', 'Omega',
].join('|') + ')\\s*$|^[A-Za-z]$');

const isSpace = (c) => c === undefined || c === SPACE;
function matchAt(S, i, cells) {
  for (let k = 0; k < cells.length; k++) if (S[i + k] !== cells[k]) return false;
  return true;
}
// A Nemeth comparison sign is spaced on BOTH sides by actual blank cells.
// (A boundary does not count — a bare relation at the very start/end of the
// input is malformed Nemeth, and this is what disambiguates ⠨⠅ from κ, etc.)
// §151 lets comparison signs be QUOTED as objects — "(<, =, >)" — so the
// opening paren and the mathematical comma count as boundaries too.
const relBoundary = (cell) => cell === undefined || cell === SPACE || cell === LPAREN ||
  cell === RPAREN || cell === CAP || cell === BOLDI;
function spaced(S, i, len) {
  // …but a sign floating with NOTHING on either side is the letter reading —
  // the pinned decision: a lone ⠨⠅ line is kappa, not '='.
  if (S[i - 1] === undefined && S[i + len] === undefined) return false;
  return relBoundary(S[i - 1]) && relBoundary(S[i + len]);
}


// UNITS ARE UPRIGHT. "42 cm" is not 42 times c times m, and a maths renderer
// italicises bare letters by default, so units came out as variables — visibly
// wrong to any teacher, and the largest single group of failures on real school
// maths. Applied only after a NUMBER, which is what distinguishes metres from
// the gradient m in y = mx + c.
// (Duplicated in connector/ueb-maths-to-latex.mjs: that file is an ES module and
// this one is a plain script loaded by <script>, so they cannot share an import.)
const UNIT_WORDS = ['mm','cm','km','kg','mg','ml','kl','mol','rad','min','Hz',
                    'm','g','l','s','h','N','J','W','V','K','A'];
const UNIT_RE = new RegExp('(\\d\\uE000*\\s*\\uE000*|\\d\\\\,|\\uE000*\\s\\uE000*)(' + UNIT_WORDS.join('|') + ')(?!\\uE000*[A-Za-z_^])', 'g');
// \text{...} spans are already prose — marking units inside them wrapped
// " mol " a second time and produced invalid nested markup.
const uprightUnits = (tex) => {
  const spans = [];
  const masked = String(tex).replace(/\\text\{[^{}]*\}/g, (m) => { spans.push(m); return '\u0001' + (spans.length - 1) + '\u0001'; });
  const marked = masked.replace(UNIT_RE, (m, pre, u) => pre + '\\mathrm{' + u + '}');
  return marked.replace(/\u0001(\d+)\u0001/g, (_, k) => spans[Number(k)]);
};

// --- Parser -----------------------------------------------------------------
function convert(input) {
  // Normalise: keep braille cells (masked to 6 dots) and collapse whitespace.
  const S = [];
  for (const ch of input) {
    if (ch === ' ' || ch === '\t' || ch === '\n') { S.push(SPACE); continue; }
    const cp = ch.codePointAt(0);
    if (cp >= 0x2800 && cp <= 0x28ff) {
      // A cell with BOTH dots 7 and 8 is not braille content: MathCAT uses it
      // as a matrix ROW SEPARATOR (⣍, dots 1348+7). Masking it to six dots
      // turned it into a phantom letter m inside every Nemeth matrix — keep it
      // as a marker instead.
      if ((cp & 0xC0) === 0xC0) { S.push(ROWSEP); continue; }
      S.push(String.fromCodePoint(0x2800 | (cp & 0x3f)));
    }
  }
  const warnings = [];
  // §62b–§64: a ⠸ prefixed to a fraction-frame cell marks the fraction
  // diagonal or complex — print slant, same structure. Dropped STATEFULLY
  // (only where a frame is open or opening) so §32's boldface ⠸ elsewhere is
  // untouched. Mixed numbers (1⠸⠹1⠌2⠸⠼, GCSE) parse as plain frames after
  // this. §105's order-of-radical ⠨ before ⠜/⠻ likewise states nesting depth
  // the structure already gives us — consumed, never guessed at.
  {
    // A frame stack, not a counter: a ⠸⠌ is only THE frame's line while that
    // frame is still waiting for one — after it, the same cells are a solidus
    // (a/b in an exponent, §68b), which the reprobe caught being eaten.
    const frames = [];
    const top = () => frames[frames.length - 1];
    for (let k = 0; k < S.length; k++) {
      if (S[k] === BOLDI) {
        const nx = S[k + 1];
        if (nx === FOPEN) { S.splice(k, 1); k--; frames.push({ complex: true, lineSeen: false, order: 0 }); k++; continue; }
        // an ORDER-k frame's line is ⠠^k⠌ — inside it a bare ⠸⠌ is the
        // SOLIDUS of an inner linear fraction (1/3 over 2/3), not the line
        if (nx === FLINE && top() && (top().order || 0) === 0 && (top().complex || !top().lineSeen)) { S.splice(k, 1); k--; continue; }
        if (nx === FCLOSE && top() && top().complex && (top().order || 0) === 0) { S.splice(k, 1); k--; continue; }
      } else if (S[k] === FOPEN) {
        let o = 0, b2 = k - 1;
        while (S[b2] === CAP) { o++; b2--; }
        frames.push({ complex: false, lineSeen: false, order: o });
      }
      else if (S[k] === FLINE) { if (top()) top().lineSeen = true; }
      else if (S[k] === FCLOSE) frames.pop();
    }
  }
  const st = { i: 0 };
  const rec = { marks: [] };
  let tex = parseSeq(S, st, new Set(), warnings, 0, rec);
  // marks → slices; a slice that is just a trailing macron merges into its
  // base (the bar postpass below must never straddle a boundary), and
  // adjacent plain-letter slices coalesce (units, words)
  let pieces = rec.marks.map((m, k) =>
    ({ c0: m.c0, c1: k + 1 < rec.marks.length ? rec.marks[k + 1].c0 : S.length,
       tex: tex.slice(m.o0, k + 1 < rec.marks.length ? rec.marks[k + 1].o0 : tex.length) }));
  for (let k = pieces.length - 1; k >= 0; k--) {
    // an iteration that emitted NOTHING (an indicator) folds into whichever
    // neighbour follows it — empty slices otherwise stack sentinels
    if (pieces[k].tex === '' && pieces.length > 1) {
      const to = k + 1 < pieces.length ? k + 1 : k - 1;
      pieces[to].c0 = Math.min(pieces[to].c0, pieces[k].c0);
      pieces[to].c1 = Math.max(pieces[to].c1, pieces[k].c1);
      pieces.splice(k, 1);
      continue;
    }
    if (k === 0) continue;
    if (/^\s*¯\s*$/.test(pieces[k].tex) ||
        (/^[A-Za-z]+$/.test(pieces[k].tex) && /^[A-Za-z]+$/.test(pieces[k - 1].tex))) {
      pieces[k - 1].tex += pieces[k].tex;
      pieces[k - 1].c1 = pieces[k].c1;
      pieces.splice(k, 1);
    }
  }
  tex = pieces.map((p) => p.tex).join('\uE000');

  // A bar (⠱) FOLLOWS what it covers, so the symbol table leaves it sitting
  // after the item as a literal macron: z̄ came out as "z¯", which renders as
  // two separate glyphs and reads as a stray character. Attach it to the
  // preceding item — a closing group, or a single letter/digit.
  // …and a trailing COMMAND is wrapped whole: \alpha¯ is \bar{\alpha}, not
  // \alph + \bar{a} (§86b — the regex used to bite one letter off the name).
  tex = tex.replace(/(\\[A-Za-z]+\{[^{}]*\}|\\[A-Za-z]+|[A-Za-z0-9])\s*¯/g, '\\bar{$1}');

  // Mixed intervals — (a, b] — pair a hard-coded \left( with a table ']',
  // and unbalanced \left/\right will not render. Structure is already in
  // the brackets themselves, so strip the sizing markers when uneven.
  if ((tex.match(/\\left(?![a-zA-Z])/g) || []).length !== (tex.match(/\\right(?![a-zA-Z])/g) || []).length) {
    tex = tex.replace(/\\left(?![a-zA-Z])|\\right(?![a-zA-Z])/g, '');
  }
  const unitised = uprightUnits(tex.replace(/\s+/g, ' ').trim());
  let finalLatex = '';
  const cuts = [];
  for (const ch of unitised) {
    if (ch === '\uE000') { cuts.push(finalLatex.length); continue; }
    if (ch === ' ' && (finalLatex === '' || finalLatex.endsWith(' '))) continue;
    finalLatex += ch;
  }
  while (finalLatex.endsWith(' ')) finalLatex = finalLatex.slice(0, -1);
  const spans = [];
  let t0 = 0;
  for (let k = 0; k < pieces.length; k++) {
    const t1 = k < cuts.length ? Math.min(cuts[k], finalLatex.length) : finalLatex.length;
    spans.push({ c0: pieces[k].c0, c1: pieces[k].c1, t0, t1: Math.max(t0, t1) });
    t0 = Math.max(t0, t1);
  }
  return { latex: finalLatex, warnings, ambiguities: AMBIG.splice(0), spans };
}

// Parse a run of cells until a cell in `stops` (not consumed) or end.
// `depth` is the Nemeth LEVEL this call is reading at — 0 for the baseline, 1
// inside a first-level script, and so on. It is a parameter rather than a stack
// because the level indicators state a level ABSOLUTELY (§73), so a run of them
// has to be compared against where we already are.
function parseSeq(S, st, stops, warnings, depth = 0, rec = null) {
  // Where the last thing we READ AS A LETTER ended. The numeric-subscript rule
  // needs that, not "the previous cell looks like a letter": £ is ⠈⠇, whose
  // second cell is the letter l, so £2.50 was read as £ subscript 2, then 50.
  let lastLetterEnd = -1;
  // §80a: after a NESTED structure closes inside a script (a deeper script, a
  // fraction, a radical), Nemeth restates the level in force before carrying
  // on — e^{-E_a/RT} writes ⠘ again after the level-2 "a", before the fraction
  // line, to say "back at level 1". That restatement is a continuation, not a
  // new script, and only the token immediately after the nested structure can
  // be one — which is why this is a one-iteration flag and not a mode.
  let justClosedNested = false;
  let out = '';
  while (st.i < S.length) {
    // provenance: one mark per top-level iteration — cell index and output
    // offset. Consecutive marks partition the output exactly, whatever the
    // iteration emitted (PLAN constraint 5, the click-to-link groundwork).
    if (rec) rec.marks.push({ c0: st.i, o0: out.length });
    const c = S[st.i];
    const afterNested = justClosedNested;
    justClosedNested = false;
    if (stops.has(c)) {
      // ⠼ is BOTH the numeric indicator and the fraction close — the same cell.
      // A denominator that stopped at the first ⠼ ended early whenever it
      // contained a number: \frac{a}{\sin 48°} came out as \frac{a}{sin} 48°,
      // with the rest escaping the fraction entirely.
      //
      // They are told apart by what FOLLOWS: a numeric indicator introduces
      // digits, a closing sign does not. After a fraction, a number of its own
      // carries its own ⠼, so a close is never followed by a bare digit.
      // Appendix B: a spaced ⠌ directly before a relation NEGATES it (≠) —
      // inside a fraction the stop-set was breaking on it as the frac line.
      if (c === FLINE && isSpace(S[st.i - 1])) {
        for (const r of RELS) {
          if (matchAt(S, st.i + 1, r.cells)) {
            out += ' \\neq ';
            st.i += 1 + r.cells.length;
            break;
          }
        }
        if (out.endsWith('\\neq ')) continue;
      }
      const isNumericIndicator = c === FCLOSE && DIGITS[S[st.i + 1]] !== undefined;
      // (elementary raised minus is handled at the reader below)
      // §76: a ⠐ that OPENS a modified expression inside a script is content —
      // the stop set only means the bare baseline return. A_{x̃} died here.
      const opensModified = c === BASE && depth > 0 && findModified(S, st.i);
      // §177 (one of the nine multipurpose-⠐ contexts): after a LETTER at
      // script level, ⠐ + digit keeps the digit AT THE SAME LEVEL — v_{x0} is
      // ⠧⠰⠭⠐⠴, and without this the 0 was ejected to the baseline. The
      // pinned §177iii case (NUMERIC subscript, then ⠐, then a baseline
      // numeral — ⠠⠵⠦⠐⠆ stays Z₈·2) has a DIGIT before the ⠐, so the
      // letter test keeps the two rules apart.
      // The letter must be a BARE identifier at the very end — '\\circ ' also
      // ends in letters, and §165's degree sign must keep its baseline return.
      const digitContinues = c === BASE && depth > 0 &&
        DIGITS[S[st.i + 1]] !== undefined && /(^|[^A-Za-z\\])[A-Za-z]$/.test(out);
      if (digitContinues) { st.i++; continue; }
      // §79f: spaces flanking an ellipsis PRESERVE the level in force —
      // x^{1+…+1/n} was closing its exponent at the first space.
      let spaceCont = null;
      if (c === SPACE && depth > 0) {
        const T = dots('3');
        if (S[st.i + 1] === T && S[st.i + 2] === T && S[st.i + 3] === T) spaceCont = 'ellipsis';
        // §79d: a space after a FUNCTION NAME within a script is spacing, not
        // a terminator — e^{cos²x} was ejecting its x to the baseline.
        // The name may arrive backslashed with a trailing space (the dictionary
        // path emits "\cos ^{2}") or unbackslashed — match both spellings.
        else if (/(?:\\)?(?:sin|cos|tan|sec|csc|cot|log|ln|exp|lim|arcsin|arccos|arctan|sinh|cosh|tanh)(\s*[_^]\{[^{}]*\})*\s*$/.test(out)) spaceCont = 'fn';
      }
      if (spaceCont === 'ellipsis') {
        st.i += 4;
        while (S[st.i] === dots('3')) st.i++;
        if (isSpace(S[st.i])) st.i++;
        out += ' \\cdots ';
        continue;
      }
      if (spaceCont === 'fn') { st.i++; out += ' '; continue; }
      if (!isNumericIndicator && !opensModified) break;
    }
    // PUNCTUATION ENDS A SCRIPT (Nemeth §79b). Neither of these cells can be in
    // the stop SET, because both are ordinary content elsewhere and the decision
    // needs a lookahead:
    //   ⠸ + a punctuation mark   x^2.  is ⠭⠘⠆⠸⠲ — the full stop is not a power
    //   ⠠ before a space          a^2, b^2 is ⠁⠘⠆⠠⠀⠃⠘⠆ — the mathematical comma,
    //                             where ⠠ followed by a LETTER is a capital sign
    // Both were being swallowed into the script, so a teacher saw x^{2.} and
    // a^{2,} — silently, since the parser had nothing to complain about.
    if (depth > 0) {
      if (c === BOLDI && PUNCT[S[st.i + 1]] !== undefined) break;
      if (c === CAP && (st.i + 1 >= S.length || isSpace(S[st.i + 1]))) break;
    }
    // §137: ⠈⠱ BEFORE a letter or bracket is the tilde as negation — ~p,
    // ~(p ∨ r) — and the table's literal '~' is a LaTeX non-breaking space.
    if (c === SCRIPTI && S[st.i + 1] === dots('156') &&
        (LETTERS[S[st.i + 2]] !== undefined || S[st.i + 2] === LPAREN)) {
      out += '\\sim ';
      st.i += 2;
      continue;
    }
    // §137: SPACED ⠈⠱ is the relation ∼ (X ∼ N(0,1), A-level statistics).
    // The table's literal '~' is a LaTeX non-breaking space — the sign
    // vanished from every distribution statement. Unspaced stays the
    // tilde-modifier/negation family.
    if (c === SCRIPTI && S[st.i + 1] === dots('156') && isSpace(S[st.i - 1]) &&
        (isSpace(S[st.i + 2]) || S[st.i + 2] === undefined)) {
      out += ' \\sim ';
      st.i += 2;
      continue;
    }
    if (isSpace(c)) { out += ' '; st.i++; continue; }
    // 2022: ⠨ directly before an ENLARGED paren ⠠⠷/⠠⠾ is the italic typeform
    // on a system of equations — presentational. ⠨⠠ + a LETTER is capital
    // Greek (Σ, Π) and is not touched (cellmap-checked).
    if (c === GREEK && S[st.i + 1] === CAP && (S[st.i + 2] === LPAREN || S[st.i + 2] === RPAREN)) {
      st.i++;
      continue;
    }
    // A run of four or more ⠸ is a fill-in rule line, like the ⠤ blank.
    if (c === BOLDI && S[st.i + 1] === BOLDI &&
        (S[st.i + 2] === BOLDI || /—\s*$/.test(out))) {   // a PAIR only continues a ruled blank — ⠸⠸⠻ is ‡ (§130)
      while (S[st.i] === BOLDI) st.i++;
      out += ' — ';
      continue;
    }
    // 2022 keyed symbol: ⠫⠅ content ⠻ draws a KEY border round the content.
    if (c === dots('1246') && S[st.i + 1] === dots('13')) {
      let j3 = st.i + 2;
      const innerK = [];
      while (j3 < S.length && S[j3] !== RCLOSE && j3 - st.i < 20) { innerK.push(S[j3]); j3++; }
      if (S[j3] === RCLOSE) {
        out += `\\boxed{${subParse(innerK, warnings)}}`;
        st.i = j3 + 1;
        continue;
      }
    }


    // ANSWER BLANK: a run of four or more ⠤ is the fill-in line of an
    // elementary exercise (14 + ___ = 21), printed as a long dash — never a
    // chain of subtractions. (APH 3.5; the census put these beyond doubt.)
    // "= .____": decimal point straight onto a blank answer line
    if (c === GREEK && S[st.i + 1] === BASE && S[st.i + 2] === dots('36') &&
        S[st.i + 3] === dots('36') && S[st.i + 4] === dots('36')) {
      st.i += 2;
      out += '.';
      out += ' — ';
      while (S[st.i] === dots('36')) st.i++;
      continue;
    }
    if (c === BASE && S[st.i + 1] === dots('36') && S[st.i + 2] === dots('36') &&
        S[st.i + 3] === dots('36') && S[st.i + 4] === dots('36')) {
      st.i++;                                  // ⠐ prefixing a blank run
      out += ' — ';
      while (S[st.i] === dots('36')) st.i++;
      continue;
    }
    if (c === dots('36') && S[st.i + 1] === dots('36') &&
        S[st.i + 2] === dots('36') && S[st.i + 3] === dots('36')) {
      let j = st.i;
      while (S[j] === dots('36')) j++;
      out += ' — ';   // em dash, exactly as the print shows the blank
      st.i = j;
      continue;
    }
    // …and a + directly before such a blank stays a plus, out of the reach of
    // the ± longest-match below, which was pairing it with the run's first ⠤.
    if (c === dots('346') && S[st.i + 1] === dots('36') && S[st.i + 2] === dots('36') &&
        S[st.i + 3] === dots('36') && S[st.i + 4] === dots('36')) {
      out += ' + ';
      st.i++;
      continue;
    }
    // PRINT QUOTES: at a boundary, ⠦ … ⠴ with no space between is the quoted
    // item — “x”, “Δy” — not the digits 8…0 (which always follow ⠼ or sit at
    // subscript level). The code-book corpus quotes single symbols freely.
    if (c === dots('236') && (st.i === 0 || isSpace(S[st.i - 1]))) {
      let j = st.i + 1, found = -1;
      while (j < S.length && j - st.i <= 30 && !isSpace(S[j])) {
        const twoCell = S[j] === BOLDI && S[j + 1] === dots('356');
        const oneCell = S[j] === dots('356');
        const after2 = twoCell ? S[j + 2] : S[j + 1];
        if ((twoCell || oneCell) && (after2 === undefined || isSpace(after2) ||
            after2 === BOLDI || after2 === dots('256'))) { found = j; var closeLen = twoCell ? 2 : 1; break; }
        j++;
      }
      if (found > st.i + 1) {
        const LONE = { [ROPEN]: '√', [FOPEN]: '⠹', [MOD_ABOVE]: '⠣' };
        const body5 = S.slice(st.i + 1, found);
        const inner = (body5.length === 1 && LONE[body5[0]])
          ? LONE[body5[0]] : subParse(body5, warnings);
        out += `“${inner}”`;
        st.i = found + closeLen;
        continue;
      }
    }
    // 1. relations (only when spaced, per Nemeth)
    // LONGEST MATCH FIRST. The table knows signs that BEGIN with an operator or
    // relation we also know as something shorter: ≤ is ⠐⠅⠱ but ⠐⠅ alone is "<",
    // and ± is ⠬⠤ but ⠬ alone is "+". Matching the short rule first turned
    // "0 < x ≤ 10" into "0 < x k̄ 10" and the quadratic formula's ± into "+ -".
    const longer = matchSymbol(S, st.i);
    if (longer) {
      let shortest = 0;
      for (const r of RELS) if (matchAt(S, st.i, r.cells) && spaced(S, st.i, r.cells.length)) { shortest = r.cells.length; break; }
      if (!shortest) for (const op of OPS) if (matchAt(S, st.i, op.cells)) { shortest = op.cells.length; break; }
      if (shortest && longer.len > shortest) {
        out += ' ' + longer.tex + ' ';
        st.i += longer.len;
        continue;
      }
    }

    let matched = false;
    for (const r of RELS) {
      if (!matchAt(S, st.i, r.cells)) continue;
      const rl = r.cells.length;
      // §149/§177.iv licence: an unspaced-after relation counts when a ⠐ and
      // a SECOND relation follow — that is the juxtaposition spelling itself.
      const juxtaNext = S[st.i + rl] === BASE && RELS.some((r2) => matchAt(S, st.i + rl + 1, r2.cells));
      if (r.spacedOnly && !(S[st.i - 1] === SPACE && (S[st.i + rl] === SPACE || S[st.i + rl] === undefined))) continue;
      if (spaced(S, st.i, rl) || (S[st.i - 1] === SPACE && juxtaNext)) {
        st.i += r.cells.length;
        // §149 (with §177.iv): a ⠐ then another comparison JUXTAPOSES them
        // into one compound sign — ⠨⠂⠐⠐⠅ is ≷, not "> then k".
        let compound = r.tex.trim();
        while (S[st.i] === BASE) {
          let hit = null;
          for (const r2 of RELS) if (matchAt(S, st.i + 1, r2.cells)) { hit = r2; break; }
          if (!hit) break;
          compound += hit.tex.trim();
          st.i += 1 + hit.cells.length;
        }
        if (compound === '><') out += ' \\gtrless ';
        else if (compound === '<>') out += ' \\lessgtr ';
        else if (compound === r.tex.trim()) out += r.tex;
        else out += ` \\mathrel{${compound}} `;
        matched = true; break;
      }
    }
    if (matched) continue;

    // 2. non-spaced operators
    for (const op of OPS) {
      if (matchAt(S, st.i, op.cells)) { out += op.tex; st.i += op.cells.length; matched = true; break; }
    }
    if (matched) continue;

    // 3. numeric indicator — a mode marker; the digits that follow do the work
    if (c === NUM) { st.i++; continue; }

    // 3a. CHEMICAL BOND: ⠸ sign ⠻. Before the typeform and punctuation rules
    // (which also claim ⠸) and before the symbol table, which was matching
    // ⠸⠿ as \propto and leaving the ⠻ dangling.
    // §157: an arrow in BOLDFACE carries the type indicator ⠸ before ⠫.
    if (c === BOLDI && S[st.i + 1] === dots('1246')) {
      const a = readArrow(S, st.i + 1);
      if (a) { out += ' \\boldsymbol{' + a.tex.trim() + '} '; st.i = a.end; continue; }
    }
    // §37/§39: at the baseline too, ⠸ + a punctuation mark is that mark —
    // the symbol table was reading ⠸⠴ as the empty set inside x²'s.
    // Nemeth 2022 typeform families (the code book's own examples use them
    // heavily): ⠸ + letter is a BOLD letter (_C); ⠸⠨ + letter is a SCRIPT
    // letter (_. ,S); and ⠸ before a sign of operation/comparison bolds the
    // SIGN — presentational, so the plain sign is the faithful reading.
    if (c === BOLDI && S[st.i + 1] === GREEK && S[st.i + 2] === dots('13') &&
        isSpace(S[st.i - 1]) && isSpace(S[st.i + 3])) {
      out += ' = ';                                   // spaced ⠸⠨⠅ = bold equals
      st.i += 3;
      continue;
    }
    if (c === BOLDI && S[st.i + 1] === GREEK &&
        (LETTERS[S[st.i + 2]] !== undefined ||
         (S[st.i + 2] === CAP && LETTERS[S[st.i + 3]] !== undefined))) {
      const cap = S[st.i + 2] === CAP;
      const L = LETTERS[S[st.i + (cap ? 3 : 2)]];
      out += `\\mathscr{${cap ? L.toUpperCase() : L}}`;
      st.i += cap ? 4 : 3;
      lastLetterEnd = st.i;
      continue;
    }
    if (c === BOLDI && S[st.i + 1] === dots('346')) { // ⠸⠬ bold plus
      out += ' + ';
      st.i += 2;
      continue;
    }
    if (c === BOLDI && S[st.i + 1] === dots('36') && S[st.i + 2] !== dots('36')) {
      out += ' - ';                                   // ⠸⠤ bold minus (not a blank run)
      st.i += 2;
      continue;
    }
    // §24: bare ⠸ + letter is the GERMAN (Fraktur) alphabet — 𝔤 = Lie(G),
    // 𝔄α — not bold (bold letters carry ⠰: the pinned ⠸⠰⠭ vector). A SPACED
    // two-cell table symbol (⠸⠇ ≡, §141) wins first.
    if (c === BOLDI && (LETTERS[S[st.i + 1]] !== undefined ||
        (S[st.i + 1] === CAP && LETTERS[S[st.i + 2]] !== undefined))) {
      const sym = matchSymbol(S, st.i);
      const cap = S[st.i + 1] === CAP;
      if (!(sym && isSpace(S[st.i - 1]) && isSpace(S[st.i + sym.len]))) {
        const L = LETTERS[S[st.i + (cap ? 2 : 1)]];
        out += `\\mathfrak{${cap ? L.toUpperCase() : L}}`;
        st.i += cap ? 3 : 2;
        lastLetterEnd = st.i;
        continue;
      }
    }
    if (c === BOLDI && PUNCT[S[st.i + 1]] !== undefined && S[st.i + 2] !== RCLOSE &&
        st.i > 0 && !isSpace(S[st.i - 1])) {   // attached to content; a spaced ⠸⠴ stays ∅
      out += S[st.i + 1] === dots('356') ? "'" : PUNCT[S[st.i + 1]];
      st.i += 2;
      // §39: the plural-s of x²'s rides as ⠠⠰⠎ — the ⠠ is part of the
      // apostrophe's spelling here, and the ⠰ is the letter indicator.
      if (S[st.i] === CAP && S[st.i + 1] === SUB && LETTERS[S[st.i + 2]]) {
        out += LETTERS[S[st.i + 2]];
        st.i += 3;
      }
      continue;
    }
    if (c === BOLDI && CHEM_BOND[S[st.i + 1]] !== undefined && S[st.i + 2] === RCLOSE) {
      out += ' ' + CHEM_BOND[S[st.i + 1]] + ' ';
      st.i += 3;
      continue;
    }

    // 3a-ii. NTH ROOT: ⠣ index ⠜ radicand ⠻. The index precedes the radical
    // sign. The symbol table had ⠣⠒⠜ → "∛" and ⠣⠲⠜ → "∜", which emitted a
    // glyph, lost the radicand relation and left ⠻ over — the table shadowing
    // structure, which is why it is only ever a last resort.
    if (c === MOD_ABOVE) {
      let j = st.i + 1;
      let index = '';
      while (j < S.length && DIGITS[S[j]] !== undefined) { index += DIGITS[S[j]]; j++; }
      // §104's own example is ⁿ√a — the index may be a LETTER, not only digits.
      if (!index && LETTERS[S[j]] !== undefined) { index = LETTERS[S[j]]; j++; }
      // …and the SQA papers write full EXPRESSIONS there: ⠣m+n⠜p+q⠻ is
      // \sqrt[m+n]{p+q}. Scan to the ⠜ when simple forms don't fit.
      if (!(index && S[j] === ROPEN)) {
        let k2 = st.i + 1, depth4 = 0;
        while (k2 < S.length && k2 - st.i < 24) {
          if (S[k2] === MOD_ABOVE) depth4++;
          else if (S[k2] === ROPEN) { if (depth4 === 0) break; depth4--; }
          else if (isSpace(S[k2])) { k2 = -1; break; }
          k2++;
        }
        if (k2 > st.i + 1 && k2 < S.length && S[k2] === ROPEN) {
          index = subParse(S.slice(st.i + 1, k2), warnings);
          j = k2;
        }
      }
      if (index && S[j] === ROPEN) {
        st.i = j + 1;
        const body = parseSeq(S, st, new Set([RCLOSE]), warnings, depth);
        if (S[st.i] === RCLOSE) st.i++;
        else warnings.push('Unclosed radical (missing ⠻)');
        out += `\\sqrt[${index}]{${body.trim()}}`;
        continue;
      }
    }

    // 3b. TYPEFORM (Nemeth §32). An indicator pair marks the typeface of what
    // follows: ⠸⠰ bold, ⠨⠰ double-struck, ⠈⠰ script. In this corpus that is not
    // decoration — bold letters are VECTORS and double-struck ones are the
    // standard number sets (ℤ, ℕ), so dropping the face loses the meaning.
    const tf = TYPEFORMS.find((t) => matchAt(S, st.i, t.cells));
    if (tf) {
      let j = st.i + tf.cells.length;
      let cap = false;
      if (S[j] === CAP) { cap = true; j++; }
      const L = LETTERS[S[j]];
      if (L) {
        out += `${tf.tex}{${cap ? L.toUpperCase() : L}}`;
        st.i = j + 1;
        // A typeform letter is still a LETTER: bold c followed by 1 is c₁, so
        // the numeric-subscript rule must fire after it too.
        lastLetterEnd = st.i;
        continue;
      }
      // A typeform can also apply to a NUMBER — d(x, 0) with a bold zero.
      if (S[j] === NUM) {
        j++;
        let digits = '';
        while (j < S.length && DIGITS[S[j]] !== undefined) { digits += DIGITS[S[j]]; j++; }
        if (digits) { out += `${tf.tex}{${digits}}`; st.i = j; continue; }
      }
    }

    // Typeform directly before a NUMERIC indicator, with no English-letter sign
    // between: ⠸⠼⠴ is a bold zero. Narrow on purpose — ⠸ alone is overloaded,
    // so this only fires when a numeric indicator and digits actually follow.
    // §130 (probed): ⠨⠼ is the NUMBER SIGN #, never a blackboard number —
    // the typeform-on-number path is for ⠸⠼ (bold) and ⠈⠼ (script) only.
    const tfNum = c === GREEK ? undefined : TYPEFORM_PREFIX[c];
    if (tfNum && S[st.i + 1] === NUM) {
      let j = st.i + 2;
      let digits = '';
      while (j < S.length && (DIGITS[S[j]] !== undefined ||
             (S[j] === GREEK && DIGITS[S[j + 1]] !== undefined))) {
        if (S[j] === GREEK) { digits += '.'; j++; }
        digits += DIGITS[S[j]]; j++;
      }
      if (digits) { out += `${tfNum}{${digits}}`; st.i = j; continue; }
    }

    // §24b: the German (fraktur) alphabet — ⠸ + capital sign + letter.
    if (c === BOLDI && S[st.i + 1] === CAP && LETTERS[S[st.i + 2]]) {
      out += `\\mathfrak{${LETTERS[S[st.i + 2]].toUpperCase()}}`;
      st.i += 3; lastLetterEnd = st.i;
      continue;
    }
    // §23b/§23c: the ALTERNATIVE Greek forms — ⠨⠈ + letter.
    if (c === GREEK && S[st.i + 1] === SCRIPTI) {
      const VAR = { [dots('124')]: '\\varphi ', [dots('234')]: '\\varsigma ',
                    [dots('1456')]: '\\vartheta ', [dots('15')]: '\\varepsilon ' };
      if (VAR[S[st.i + 2]]) { out += VAR[S[st.i + 2]]; st.i += 3; continue; }
    }
    // §20a/§32a: sanserif — ⠠ + the double-struck pair ⠨⠰. The capital sign
    // FIRST is what distinguishes it from blackboard-bold.
    if (c === CAP && S[st.i + 1] === GREEK && S[st.i + 2] === SUB) {
      const capInner = S[st.i + 3] === CAP ? 1 : 0;
      const L2 = LETTERS[S[st.i + 3 + capInner]];
      if (L2) {
        out += `\\mathsf{${capInner ? L2.toUpperCase() : L2}}`;
        st.i += 4 + capInner; lastLetterEnd = st.i;
        continue;
      }
    }
    // §123: floor and ceiling — ⠈⠰⠷ / ⠈⠘⠷ pairs, before the table's corners.
    if (c === SCRIPTI && S[st.i + 1] === SUB && (S[st.i + 2] === LPAREN || S[st.i + 2] === RPAREN)) {
      out += S[st.i + 2] === LPAREN ? '\\lfloor ' : '\\rfloor ';
      st.i += 3; continue;
    }
    if (c === SCRIPTI && S[st.i + 1] === SUP && (S[st.i + 2] === LPAREN || S[st.i + 2] === RPAREN)) {
      out += S[st.i + 2] === LPAREN ? '\\lceil ' : '\\rceil ';
      st.i += 3; continue;
    }

    // 4. greek indicator: letter, else decimal point, else unspaced '='(kappa fallback)
    //
    // Look ahead WITHOUT consuming. The old code advanced past ⠨ and only then
    // discovered it could not use it, which made the cell unrecoverable: ⠨⠬ (⋃)
    // and ⠨⠷ ({) were sitting in the symbol table but the parser had already
    // eaten the ⠨ and warned. Anything unrecognised now falls through intact.
    if (c === GREEK) {
      // §51c: directly after an abbreviation point, unspaced ⠨⠅ is '=' —
      // this must beat the Greek-letter read or 1 l. = 1000 cc. gets a kappa.
      if (S[st.i + 1] === dots('13') && /\.\s*$/.test(out)) { out += ' = '; st.i += 2; continue; }
      // §132: ⠨⠩ is ∩ — its ∪ twin ⠨⠬ was in the table, the cap was not,
      // and \overline{\cap} lost its base entirely.
      if (S[st.i + 1] === dots('146')) { out += '\\cap '; st.i += 2; continue; }
      let j = st.i + 1;
      let cap = false;
      if (S[j] === CAP) { cap = true; j++; }
      const name = GREEK_NAME[S[j]];
      if (name) {
        st.i = j + 1;
        out += (cap ? (GREEK_CAP_TEX[name] || '\\' + name) : GREEK_LOWER_TEX(name)) + ' ';
        lastLetterEnd = st.i;                 // μ₁ is a numeric subscript too
        continue;
      }
      // Decimal point: digit before, and after it either another digit OR a
      // ⠐-modified digit — 0.7̅1̅2̅8̅ (GCSE recurring decimals, §97) carries its
      // repeated digits inside ⠐…⠣…⠻ frames, and requiring a bare digit next
      // silently dropped the point: 0.7128 rendered as 07128.
      if ((/\d$/.test(out) || S[st.i - 1] === NUM) && (DIGITS[S[st.i + 1]] || S[st.i + 1] === BASE)) { st.i++; out += '.'; continue; }
      // §177v: a LEADING decimal (.4) — ⠨ before a digit at a start or after
      // an operator/space is the point, with no digit preceding.
      // …after an OPERATOR or an opening — never after a bare space, where
      // ⠨+digit is the spaced comparison (x ≫ y read as x .1 before).
      if (DIGITS[S[st.i + 1]] !== undefined &&
          (out === '' || /[+\-=(,—$]\s*$/.test(out) || /[A-Za-z]$/.test(out) ||
           /\\(?:times|div|cdot|\$)\s*$/.test(out))) { st.i++; out += '.'; continue; }
      if (S[st.i + 1] === BASE) {
        // §177v: explicitly disambiguated decimal point followed by non-numeric
        out += '.'; st.i += 2; continue;
      }
      if (S[st.i + 1] === dots('13')) {
        // §51c: directly after an abbreviation point the unspaced ⠨⠅ is '='.
        if (/\.\s*$/.test(out)) { out += ' = '; st.i += 2; continue; }
        out += '\\kappa '; st.i += 2; continue;
      }    // unspaced ⠨⠅
      if (S[st.i + 1] === ROPEN || S[st.i + 1] === RCLOSE ||
          (S[st.i + 1] === dots('126') && S.slice(st.i + 1, st.i + 6).includes(ROPEN))) {
        st.i++; continue; // silently consume order-of-radical indicator
      }
      // else: fall through to the symbol table.
    }

    // 5. digits / letters / capitals
    if (DIGITS[c]) {
      // NUMERIC SUBSCRIPT. Nemeth writes a numeric subscript to a letter with
      // NO subscript indicator, so Z with subscript 8 is just ⠠⠵⠦ — the digit
      // follows the letter directly. Read literally that becomes "Z8", which
      // is a different expression and renders as one. Digits use the "dropped"
      // cells, distinct from letters, so this is unambiguous; a digit after ⠼
      // has a numeric indicator before it and is not affected.
      // §38 i: at the very start (or after a space) a lower cell directly
      // before the punctuation indicator is PRINT punctuation — ⠦⠸⠲ is "?."
      // and was reading as the digit 8.
      if ((st.i === 0 || isSpace(S[st.i - 1])) && S[st.i + 1] === BOLDI &&
          PUNCT[S[st.i + 2]] !== undefined && PUNCT[c] !== undefined) {
        out += PUNCT[c]; st.i++; continue;
      }
      if (lastLetterEnd === st.i) {
        // …but not every lower cell after a letter is a subscript digit.
        // §38: a SINGLE ⠲ or ⠦ after a word, followed by a space or the end,
        // is sentence punctuation — "3 gal., 2 qt." was reading as gal
        // subscript 4. A genuine numeric subscript (Z₈, xₙ₊₁) either is not
        // one of these two cells or is not followed by a boundary.
        // The boundary must be END or the math comma ⠠ — NOT a bare space,
        // because log₄(x) brailles its subscript 4 as ⠲ before a space and is
        // cell-identical to "log." there. "gal.," and a final "qt." both put
        // ⠠ or the line end after the ⠲, so the word-problem reading survives.
        const nxt = S[st.i + 1];
        // …and only after a WORD (two letters or more). A single letter is a
        // variable, and its trailing lower cell is the pinned Z₈ decision —
        // "gal." is prose, "Z⠦" is a subscript 8.
        let runLen = 0, back = st.i - 1;
        while (back >= 0 && LETTERS[S[back]]) { runLen++; back--; }
        // A space is a boundary too — "16 oz. = 1 lb." has the sign after it.
        // And a SINGLE letter straight after "<digit><space>" is a MEASUREMENT
        // abbreviation (5 c., 25 m.), not the Z₈-pinned subscript: the digit
        // context is what separates "5 c." from a bare "Z⠦".
        const measured = runLen === 1 && back >= 1 &&
          S[back] === SPACE && DIGITS[S[back - 1]] !== undefined;
        const boundary = (nxt === undefined || nxt === CAP || nxt === BOLDI ||
                          nxt === RPAREN || nxt === SUP || isSpace(nxt)) && (runLen >= 2 || measured);
        if (boundary && c === dots('256')) { out += '. '; st.i++; continue; }
        if (boundary && c === dots('236')) { out += '?'; st.i++; continue; }
        let d = '';
        while (st.i < S.length) {
          if (DIGITS[S[st.i]] !== undefined) { d += DIGITS[S[st.i]]; st.i++; continue; }
          // §79b, §77: the mathematical comma ⠠ and the decimal point ⠨
          // CONTINUE a numeric subscript when digits follow them.
          if (S[st.i] === CAP && DIGITS[S[st.i + 1]] !== undefined) { d += ','; st.i++; continue; }
          if (S[st.i] === GREEK && DIGITS[S[st.i + 1]] !== undefined) { d += '.'; st.i++; continue; }
          break;
        }
        out += `_{${d}}`;
        continue;
      }
      out += DIGITS[c]; st.i++; continue;
    }
    // FRACTION LEVEL INDICATORS (Nemeth §fractions). A nested fraction marks its
    // open/line/close with one ⠠ per level of nesting: ⠠⠹ … ⠠⠌ … ⠠⠼ for the
    // first level, ⠠⠠⠹ for the second, and so on. Our parser recovers nesting
    // from the structure itself, so the marks are redundant to us — but they
    // must be CONSUMED. Falling through, they hit the "lone ⠠ is a comma" rule
    // at the bottom and injected commas into the middle of every nested
    // fraction. Found by disagreeing with MathCAT's own back-translator.
    if (c === CAP) {
      let j = st.i;
      while (S[j] === CAP) j++;
      if (S[j] === FOPEN || S[j] === FLINE || S[j] === FCLOSE) { st.i = j; continue; }
    }

    // Capital indicator — again, only consume once a letter is confirmed, so
    // that ⠠⠿ (∞) still reaches the symbol table and a lone ⠠ can be read as
    // the comma it is (see the rule after the table).
    // §9c: the ENLARGED grouping signs ⠠⠷ … ⠠⠾ wrap a MATRIX ROW — the same
    // syntax whether rows sit side by side or one per line on a brailler.
    // Cells split on spaces; consecutive rows chain into one matrix.
    if (c === CAP && (S[st.i + 1] === LPAREN || S[st.i + 1] === dots('1256'))) {
      const openCell = S[st.i + 1];
      const closeCell2 = openCell === LPAREN ? RPAREN : dots('1256');
      const envName = openCell === LPAREN ? 'pmatrix' : 'vmatrix';
      // Only the CHAINED per-row form is decodable today (⠠⠷row⠠⠾⠠⠷row⠠⠾ —
      // which is also what row-per-line coalesces to). MathCAT's single-group
      // Nemeth linearisation carries an interior row code not yet decoded,
      // and misreading it produced a confidently wrong matrix — the one sin.
      // A single group falls through to the old reading until it is decoded.
      let j0 = st.i + 2;
      while (j0 + 1 < S.length && !(S[j0] === CAP && S[j0 + 1] === closeCell2)) j0++;
      const chained = S[j0 + 2] === CAP && S[j0 + 3] === openCell;
      const hasSep = S.slice(st.i + 2, j0).includes(ROWSEP);
      // A lone ⠠⠷…⠠⠾ that IS the whole line is a matrix row too — the
      // row-per-line form a child writes on a brailler; the app coalesces
      // consecutive ones. Mid-expression singles still fall through.
      const wholeLine = st.i === 0 && !out && j0 + 2 >= S.length;
      if (!chained && !hasSep && !wholeLine) { /* fall through */ } else {
      const rows = [];
      while (S[st.i] === CAP && S[st.i + 1] === openCell) {
        let j = st.i + 2;
        while (j + 1 < S.length && !(S[j] === CAP && S[j + 1] === closeCell2)) j++;
        if (!(S[j] === CAP && S[j + 1] === closeCell2)) { warnings.push('unclosed enlarged bracket (matrix row)'); break; }
        const inner = S.slice(st.i + 2, j);
        // one bracket group may hold several rows, split by the 8-dot ROWSEP
        // marker (MathCAT's single-group linearisation); cells split on spaces
        const slices = [[]];
        for (const cc of inner) {
          if (cc === ROWSEP) slices.push([]);
          else slices[slices.length - 1].push(cc);
        }
        for (const slice of slices) {
          const cellRuns = []; let cur = [];
          for (const cc of slice) {
            if (isSpace(cc)) { if (cur.length) { cellRuns.push(cur); cur = []; } }
            else cur.push(cc);
          }
          if (cur.length) cellRuns.push(cur);
          rows.push(cellRuns.map((cs) => subParse(cs, warnings)).join(' & '));
        }
        st.i = j + 2;
      }
      if (rows.length) { out += `\\begin{${envName}}${rows.join(' \\\\ ')}\\end{${envName}}`; continue; }
      }
    }

    // §18a, §22b: the DOUBLE capital sign capitalises the whole letter-run —
    // ⠠⠠⠧⠊⠊ is the Roman numeral VII, ⠠⠠⠉⠇ is Cl (which the Hebrew table
    // entry was shadowing). Two letters minimum: a double-cap SINGLE letter
    // is Hebrew (ℵ is ⠠⠠⠁, §18c) and stays with the symbol table.
    if (c === CAP && S[st.i + 1] === CAP && LETTERS[S[st.i + 2]] && LETTERS[S[st.i + 3]]) {
      st.i += 2;
      let w = '';
      while (st.i < S.length && LETTERS[S[st.i]]) { w += LETTERS[S[st.i]].toUpperCase(); st.i++; }
      out += w; lastLetterEnd = st.i;
      continue;
    }
    if (c === CAP && LETTERS[S[st.i + 1]]) {
      out += LETTERS[S[st.i + 1]].toUpperCase();
      st.i += 2;
      lastLetterEnd = st.i;
      continue;
    }
    // A function name, but only where an ARGUMENT follows — a space, a digit, a
    // letter, an opening bracket, or a Greek indicator.
    if (LETTERS[c]) {
      let fn = null;
      for (const f of FUNCTIONS) {
        if (!matchAt(S, st.i, f.cells)) continue;
        const after = S[st.i + f.cells.length];
        // §52: min. and sec. are ABBREVIATIONS — the period after the name
        // (bare ⠲ before ⠸/space/end) vetoes the function reading.
        if (after === dots('256') && (S[st.i + f.cells.length + 1] === BOLDI ||
            S[st.i + f.cells.length + 1] === undefined || isSpace(S[st.i + f.cells.length + 1]))) continue;
        const isArg = after === undefined || after === SPACE || after === LPAREN
                   || DIGITS[after] !== undefined || LETTERS[after] !== undefined
                   || after === NUM || after === GREEK || after === CAP
                   // §80d: the name may carry its own script — sec², log₂ —
                   // and MathCAT juxtaposes a coefficient (ksec²) unspaced.
                   || after === SUP || after === SUB;
        // …but never START a function mid-word: ,WISCONSIN⠂ and DENOMINATOR
        // both contain names. The one legitimate letter-adjacent start is the
        // juxtaposed coefficient whose name carries its own script (ksec²).
        if (LETTERS[S[st.i - 1]] !== undefined && after !== SUP && after !== SUB) continue;
        if (isArg) { fn = f; break; }
      }
      if (fn) {
        out += fn.tex + ' ';
        st.i += fn.cells.length;
        // A function name is letter-like, so a digit straight after it is a
        // numeric SUBSCRIPT: log_3 81 is ⠇⠕⠛⠒ ⠼⠦⠂, with no subscript indicator.
        // Without this the base was read as an ordinary number — "log 3 81".
        lastLetterEnd = st.i;
        if (DIGITS[S[st.i]] === undefined && S[st.i] === SPACE) st.i++;   // space belongs to the name
        continue;
      }
      out += LETTERS[c]; st.i++; lastLetterEnd = st.i; continue;
    }

    // 6. structures
    if (c === FOPEN) {
      st.i++;
      const num = parseSeq(S, st, new Set([FLINE]), warnings, depth);
      if (S[st.i] === FLINE) st.i++;
      const den = parseSeq(S, st, new Set([FCLOSE]), warnings, depth);
      if (S[st.i] === FCLOSE) st.i++;
      out += `\\frac{${num.trim()}}{${den.trim()}}`;
      justClosedNested = true;
      continue;
    }
    // §103: the radical's scope without ⠻ is the next ITEM — a parenthesised
    // group counts, so ⠜⠷x+y⠾ is √(x+y).
    if (c === ROPEN && S[st.i + 1] === LPAREN) {
      // …but only when no ⠻ terminator is coming: √((−3)²−4·2·(−5))⠻ scopes
      // to its ⠻, not to the first paren group (the quadratic formula).
      let dr = 0, scan = st.i + 1, hasTerm = false;
      while (scan < S.length && !isSpace(S[scan])) {
        if (S[scan] === ROPEN) dr++;
        else if (S[scan] === RCLOSE) { if (dr === 0) { hasTerm = true; break; } dr--; }
        scan++;
      }
      if (!hasTerm) {
      let depth5 = 0, j5 = st.i + 1;
      while (j5 < S.length) {
        if (S[j5] === LPAREN) depth5++;
        else if (S[j5] === RPAREN) { depth5--; if (!depth5) break; }
        j5++;
      }
      if (j5 < S.length) {
        const inner = subParse(S.slice(st.i + 2, j5), warnings);
        out += `\\sqrt{${inner}}`;
        st.i = j5 + 1;
        continue;
      }
      }
    }
    if (c === ROPEN) {
      st.i++;
      const inner = parseSeq(S, st, new Set([RCLOSE]), warnings, depth);
      if (S[st.i] === RCLOSE) st.i++;
      else warnings.push('Unclosed radical (missing ⠻)');   // §103b: say so
      out += `\\sqrt{${inner.trim()}}`;
      justClosedNested = true;
      continue;
    }
    // LEVEL INDICATORS (Nemeth §73, §80). A RUN of them is one token, and it
    // states the absolute level and the whole path taken to reach it — it is not
    // a relative "go one deeper" push. Read off MathCAT's own output:
    //
    //   x^{a^b}      ⠭ ⠘⠁ ⠘⠘⠃        level 2 above  = ⠘⠘
    //   x^{a_b}      ⠭ ⠘⠁ ⠘⠰⠃        level 2, up then down
    //   x_{a^b}      ⠭ ⠰⠁ ⠰⠘⠃        level 2, down then up
    //   x^{a^{b^c}}  ⠭ ⠘⠁ ⠘⠘⠃ ⠘⠘⠘⠉   level 3
    //
    // so the run's LENGTH is the level and its LAST cell is the direction.
    // Treating each cell as its own push — which is what this did — invented an
    // empty level per indicator and turned x^{a^b} into x^{a^{^{b}}}, silently.
    // Elementary RAISED MINUS: ⠘⠤⠐ + digits is a signed number (⁻13), the
    // superscript minus returning to baseline for its digits — how MathCAT
    // itself brailles "−13" in the APH elementary exercises. Without the ⠐
    // it stays an ordinary superscript (T^{-1} unaffected).
    if (c === SUP && (S[st.i + 1] === dots('36') || S[st.i + 1] === dots('346')) &&
        S[st.i + 2] === BASE && DIGITS[S[st.i + 3]] !== undefined) {
      out += S[st.i + 1] === dots('36') ? '-' : '+';
      st.i += 3;
      continue;
    }
    if (c === SUP || c === SUB) {
      let k = st.i;
      while (k < S.length && (S[k] === SUP || S[k] === SUB)) k++;
      const level = k - st.i;
      const dir = S[k - 1];

      // §80e: after a script closed AT A SPACE, the SAME indicator restated
      // before a comparison sign continues that script — ⠭⠰⠝⠀⠰⠨⠅⠀⠼⠂ is one
      // subscript n=1, not x_n followed by an empty-based _κ1.
      if (level === 1 && depth === 0 && isSpace(S[st.i - 1])) {
        const mm = out.match(/([_^])\{([^{}]*)\}\s*$/);
        const opCh = dir === SUP ? '^' : '_';
        if (mm && mm[1] === opCh) {
          let hit = null;
          for (const r of RELS) if (matchAt(S, k, r.cells)) { hit = r; break; }
          // §152: arrows ARE comparison signs — lim's restated ⠰⠫⠕ continues
          // the subscript exactly like a restated ⠰⠨⠅ does.
          if (!hit && S[k] === dots('1246')) {
            const a = readArrow(S, k);
            if (a) hit = { cells: { length: a.end - k }, tex: ' ' + a.tex };
          }
          if (hit) {
            st.i = k + hit.cells.length;
            if (isSpace(S[st.i])) st.i++;
            const cont = parseSeq(S, st, new Set([SPACE, ...stops]), warnings, level);
            out = out.slice(0, mm.index) + opCh + '{' + mm[2] + hit.tex + cont.trim() + '}';
            continue;
          }
        }
      }

      // ENGLISH-LETTER INDICATOR (Nemeth §18b, §25a, §26, §28c). A lone ⠰
      // before a SINGLE letter standing at a boundary is not a subscript —
      // there is nothing for a subscript to attach to. ⠀⠰⠍ is the unit m
      // (every spaced unit in physics was reading as an empty-base
      // subscript), ⠷⠰⠓ is "(h", ⠰⠠⠊ is Roman numeral I. Both sides are
      // checked: the subscript reading needs a base on the LEFT (x_a and T_A
      // untouched), the letter reading needs a boundary on the RIGHT (§75
      // left scripts like ⠰⠭⠐⠝ have content following, so they stay scripts).
      if (level === 1 && dir === SUB) {
        const prevEli = S[st.i - 1];
        const atBoundaryL = st.i === 0 || prevEli === undefined || isSpace(prevEli) || prevEli === LPAREN ||
          prevEli === dots('123456') ||   // after the ⠿ blank: □ m.² is a unit
          // |x| — an OPENING bar is a grouping boundary, so ⠰x inside is the
          // letter. Three-way test: parity says we are inside (odd count), and
          // a CLOSING bar must actually follow — an unpaired evaluation bar
          // (dy/dx|_{x=1}) takes a genuine subscript instead.
          (prevEli === dots('1256') &&
           S.slice(0, st.i).filter((cc) => cc === dots('1256')).length % 2 === 1 &&
           S.indexOf(dots('1256'), st.i + 1) !== -1) ||
          /\.\s*$/.test(out);   // §51/§120a: after any abbreviation point (i.e., L.C.D.)
        const capOff = S[st.i + 1] === CAP ? 1 : 0;
        const eliLetter = LETTERS[S[st.i + 1 + capOff]];
        const after = S[st.i + 2 + capOff];
        const atBoundaryR = after === undefined || isSpace(after) || after === RPAREN ||
          after === CAP || (after === BOLDI && PUNCT[S[st.i + 3 + capOff]] !== undefined);
        if (atBoundaryL && eliLetter !== undefined && atBoundaryR) { st.i += 1; continue; }
      }

      // §91: after an OPERATOR inside a script, the same indicator restated
      // before a ⠐-modified item continues the script — A_{x̃+ỹ} is one
      // subscript, not two.
      if (level === depth && depth > 0 && S[k] === BASE &&
          (S[st.i - 1] === dots('346') || S[st.i - 1] === dots('36'))) {
        st.i = k;
        continue;
      }
      // A run RESTATING the current level right after a nested structure closed
      // is §80a's continuation — consume it and carry on at this level. Without
      // this, the restated ⠘ before the fraction line in e^{-E_a/RT} broke the
      // numerator early and split the fraction across two scripts.
      if (level === depth && afterNested) { st.i = k; continue; }
      // Otherwise a run no deeper than where we already are belongs to an
      // enclosing level, not to this one. Handing it back to the caller is what
      // lets a sub and a sup on the SAME base stay on one base: x^a_b is
      // ⠭⠰⠃⠘⠁, two level-1 runs.
      if (level <= depth) break;
      // A jump past the intervening level is a real error — EXCEPT at the very
      // start of a sequence, which is Nemeth §75's LEFT script: there the base
      // follows the script instead of preceding it, so the level below is filled
      // in afterwards. ⠘⠰⠁⠘⠝⠐⠭ is a left superscript that itself carries a left
      // subscript, and warning about it accused correct braille of being wrong.
      if (level > depth + 1 && out.trim()) {
        warnings.push(`level ${level} script with no level ${depth + 1} above it, at cell ${st.i}`);
      }
      // §80b: at the baseline, a run in the SAME direction as the script that
      // just closed is a boundary marker — p^b⠘c⠐x is p^b then ^c-on-x, not
      // b^c. An empty-brace base keeps the two apart; opposite directions
      // still pair on one base (x_b^a stays a subsup).
      if (depth === 0 && afterNested) {
        const lastOp = (out.trimEnd().match(/([\^_])\{[^{}]*\}$/) || [])[1];
        if (lastOp === (dir === SUP ? '^' : '_')) out += '{}';
      }
      st.i = k;
      const script = parseSeq(S, st, new Set([BASE, SPACE, ...stops]), warnings, level);
      // §80a: ⠐ returns to the BASELINE — level 0, never "one level up". Only
      // the level-0 caller may consume it; consuming it mid-stack pulled
      // e^{x²}+1's "+1" inside the exponent.
      let closedByBase = false;
      if (S[st.i] === BASE && depth === 0) { st.i++; closedByBase = true; }
      // TEXT vs MATHS, told apart by the braille itself: a TEXT base (the H of
      // a chemical formula) carries its numeric subscript with the EXPLICIT
      // ⠰…⠐ spelling, where a maths letter takes the bare dropped digit
      // (§77). Reading it back as \text is what lets H₂O round-trip
      // byte-identically — and chemistry was the one place a child still hit
      // round-trip failures on every line.
      if (dir === SUB && level === 1 && depth === 0 &&
          /^\d+$/.test(script.trim()) && /[A-Za-z]$/.test(out)) {
        out = out.replace(/([A-Za-z]+)$/, '\\text{$1}') + `_{${script.trim()}}`;
        continue;
      }
      out += (dir === SUP ? '^' : '_') + `{${script.trim()}}`;
      justClosedNested = true;
      continue;
    }
    // MODIFIED EXPRESSION (Nemeth §77/§86): ⠐ base ⠣|⠩ modifier ⠻ — something
    // written directly ABOVE (⠣) or BELOW (⠩) the base. Which indicator means
    // which was read off the corpus rather than recalled: every <mover> case
    // uses ⠣ and every <munder> case uses ⠩.
    //
    // Both delimiters are cells the parser already uses for something else (⠐
    // is the baseline indicator, ⠻ closes a radical), so this only claims them
    // when a complete ⠐ … ⠣|⠩ … ⠻ actually lies ahead.
    if (c === BASE) {
      const m = findModified(S, st.i);
      if (m) {
        let tex = subParse(S.slice(st.i + 1, m.marks[0]), warnings);
        for (let k = 0; k < m.marks.length; k++) {
          const at = m.marks[k];
          const to = (k + 1 < m.marks.length) ? m.marks[k + 1] : m.end;
          tex = applyModifier(tex, S.slice(at + 1, to), S[at] === MOD_ABOVE, warnings);
        }
        out += tex;
        st.i = m.end + 1;
        continue;
      }
      // Before discarding it as a stray baseline: the table may know a SIGN that
      // begins with ⠐. ≤ is ⠐⠅⠱, and eating the ⠐ here left "⠅⠱" to be read as
      // the letter k with a bar over it — "0 < x k̄ 10".
      const sym = matchSymbol(S, st.i);
      if (sym && sym.len >= 3) { out += ' ' + sym.tex + ' '; st.i += sym.len; continue; }
      // §82b: ⠐ between two scripts on one base staggers them — ⠭⠘⠝⠐⠰⠁ is
      // {x^n}_a, and MathCAT round-trips exactly that spelling.
      if ((S[st.i + 1] === SUP || S[st.i + 1] === SUB) && /[\^_]\{[^{}]*\}\s*$/.test(out)) {
        out = out.replace(/(\S(?:[\^_]\{[^{}]*\})+)\s*$/, '{$1}');
      }
      st.i++; continue;                                     // stray baseline
    }
    // §90 (2022 usage throughout the code book): a bare ⠩ splitting the
    // content of one paren pair is the BINOMIAL — (n over k). Scan ahead:
    // exactly one depth-0 ⠩ before the matching ⠾, no spaces flanking it.
    if (c === LPAREN) {
      let j = st.i + 1, depth2 = 0, split = -1, okB = true;
      while (j < S.length) {
        const cc = S[j];
        if (cc === LPAREN) depth2++;
        else if (cc === RPAREN) { if (depth2 === 0) break; depth2--; }
        else if (cc === dots('146') && depth2 === 0 &&
                 S[j - 1] !== GREEK && S[j - 1] !== SCRIPTI && S[j - 1] !== BOLDI) {
          if (split >= 0) { okB = false; break; } split = j;
        }
        else if (isSpace(cc) && depth2 === 0) { okB = false; break; }
        j++;
      }
      if (okB && split > st.i + 1 && j < S.length && j > split + 1) {
        const top = subParse(S.slice(st.i + 1, split), warnings);
        const bot = subParse(S.slice(split + 1, j), warnings);
        out += `\\binom{${top}}{${bot}}`;
        st.i = j + 1;
        continue;
      }
      out += '\\left(';
      st.i++;
      continue;
    }
    if (c === RPAREN) { out += '\\right)'; st.i++; continue; }

    // §155c: ⠫⠰… is a DIAGONAL arrow — the ⠰ names the axis, the rest reads
    // as an ordinary arrow; the two-headed diagonal is ⤢.
    if (c === dots('1246') && S[st.i + 1] === SUB) {
      const ad = readArrow(S, st.i + 1);
      if (ad) { out += ad.dir === 'both' ? ' ⤢ ' : ' ⤡ '; st.i = ad.end; continue; }
    }
    // §177viii / §109: ⠫⠼ + digits is the REGULAR POLYGON by side count.
    if (c === dots('1246') && S[st.i + 1] === NUM && DIGITS[S[st.i + 2]] !== undefined) {
      let j2 = st.i + 2, nn = '';
      while (DIGITS[S[j2]] !== undefined) { nn += DIGITS[S[j2]]; j2++; }
      out += nn === '5' ? '⬠' : nn === '6' ? '⬡' : `\\text{${nn}-gon}`;
      st.i = j2;
      continue;
    }
    // ⠫⠪ + a SHAFT is a two-headed/long-left arrow — the table's ∠ entry
    // matches the same two cells and must only win when no shaft follows.
    if (c === dots('1246') && S[st.i + 1] === dots('246') &&
        (S[st.i + 2] === SHAFT || S[st.i + 2] === dots('2356'))) {
      const aa = readArrow(S, st.i);
      if (aa) { out += ' ' + aa.tex; st.i = aa.end; continue; }
    }
    // Shape + ⠨ + letter + ⠻ is the SHORT interior form — the shape carries a
    // single identifying letter: ∠R (right), △I (isosceles). (APH/SQA lists.)
    if (c === dots('1246') && S[st.i + 2] === GREEK &&
        LETTERS[S[st.i + 3]] !== undefined && S[st.i + 4] === RCLOSE) {
      const SH = { [dots('246')]: '\\angle ', [dots('2345')]: '\\triangle ',
                   [dots('14')]: '○', [dots('256')]: '□', [dots('1235')]: '▭' };
      const g = SH[S[st.i + 1]];
      const L = LETTERS[S[st.i + 3]];
      // §110: certain interior letters are VARIANT modifiers, not names —
      // r makes the RIGHT form (∟ right angle, ⊿ right triangle).
      const VARIANT = { '⠪r': '∟ ', '⠞r': '⊿ ' };
      const vKey = String.fromCodePoint(0x2800 + (S[st.i + 1].codePointAt(0) - 0x2800)) + L;
      if (g && VARIANT[vKey]) {
        out += VARIANT[vKey];
        st.i += 5;
        continue;
      }
      if (g) {
        out += g + L.toUpperCase() + ' ';
        st.i += 5;
        continue;
      }
    }
    // §111a / §9e: INTERIOR MODIFICATION — ⠫⠉ (circle) ⠸⠫ content ⠻ is the
    // circled character: ①, ⓐ. Read the content and pick the enclosed glyph.
    if (c === dots('1246') && (S[st.i + 1] === dots('14') || S[st.i + 1] === dots('256') ||
        S[st.i + 1] === dots('1235') || S[st.i + 1] === dots('246')) &&
        S[st.i + 2] === BOLDI && S[st.i + 3] === dots('1246')) {
      var interiorShape = S[st.i + 1];   // ⠉ circle | ⠲ square
      let j = st.i + 4;
      const inner = [];
      while (j < S.length && S[j] !== RCLOSE) { inner.push(S[j]); j++; }
      const body = subParse(inner, warnings).trim();
      let glyph = null;
      // §94/§150: a circle enclosing an OPERATOR is the composed sign the
      // symbol table always knew — intercepting those broke ⊘ ⊖ ⊛.
      const CIRCOP = { '/': '\\oslash ', '-': '\\ominus ', '*': '\\circledast ',
                       '+': '\\oplus ', '=': '\\circledequal ', '\\cdot': '\\odot ' };
      const bodyKey = body.replace(/\s+/g, '');
      if (CIRCOP[bodyKey]) glyph = CIRCOP[bodyKey];
      else if (/^[1-9]$/.test(body) || body === '10') glyph = String.fromCodePoint(0x2460 + Number(body) - 1);
      else if (/^[a-z]$/.test(body)) glyph = String.fromCodePoint(0x24D0 + body.charCodeAt(0) - 97);
      const boxy = interiorShape === dots('256') || interiorShape === dots('1235');
      out += interiorShape === dots('246') ? `\\angle ${body} `
           : boxy ? `\\boxed{${body}}` : (glyph ? glyph : `\\textcircled{${body}}`);
      st.i = (S[j] === RCLOSE) ? j + 1 : j;
      continue;
    }

    // FACTORIAL (Nemeth §44, §169). ⠯ is the factorial sign and nothing else
    // when it stands bare — the lookalikes all carry a prefix consumed before
    // this branch can see them (⠸⠿⠻ bond, ⠠⠿ ∞, ⠈⠿ ∃). It was silently
    // dropped, so n! rendered as n with no warning: an A-level pupil's
    // binomial work lost its factorials invisibly.
    if (c === dots('12346')) { out += '!'; st.i++; continue; }

    // ⠪ is THREE things, told apart by lookahead (§60, §78):
    //   with a ⠻ ahead before any space — CANCELLATION, the strike-through of
    //   fraction-cancelling (primary school), rendered \cancel and chaining
    //   for §60b's side-by-side strikes;
    //   at script level with no terminator — the contracted comma-space of
    //   x_{i,j} (§78);
    //   after ⠫ it is an arrow barb, consumed by the arrow reader long before
    //   this branch can see it.
    if (c === dots('246')) {
      let j = st.i + 1;
      while (j < S.length && S[j] !== RCLOSE && !isSpace(S[j]) && S[j] !== ROWSEP) j++;
      if (S[j] === RCLOSE && j > st.i + 1) {
        const inner = subParse(S.slice(st.i + 1, j), warnings);
        out += `\\cancel{${inner}}`;
        st.i = j + 1;
        continue;
      }
      if (depth > 0) { out += ', '; st.i++; continue; }
    }

    // GENERAL OMISSION (Nemeth §57; spaced form §59; in a radicand §103b).
    // ⠿ is the sign a TEACHER writes for the blank the pupil must fill — in a
    // product whose whole purpose is a teacher watching a child's work, this
    // is not an exotic symbol, it is the exercise itself. Rendered as a
    // visible box, never dropped.
    if (c === dots('123456')) { out += '\\square '; st.i++; continue; }

    // §152 (audited: "the shaft is a repeatable run, so the reader must loop"):
    // ⠫⠒⠒⠕ with exactly two SINGLE shafts is still the plain right arrow —
    // human transcribers (APH tutorial) lengthen shafts freely. MathCAT's own
    // dialect spells the DASHED arrow ⇢ the same way, so that reading is
    // offered as an alternative rather than silently chosen.
    if (c === dots('1246') && S[st.i + 1] === SHAFT && S[st.i + 2] === SHAFT &&
        S[st.i + 3] === dots('135') &&
        // …unless these four cells are the PREFIX of a longer table symbol
        // (⇥ ⇄ ⇶): exactly-four-cell matches are the ⇢-vs-→ collision, longer
        // matches are composed symbols the §152 reading must not break up.
        (() => { const m = matchSymbol(S, st.i); return !m || m.len <= 4; })()) {
      AMBIG.push({ at: st.i, len: 4, cells: '⠫⠒⠒⠕', reading: '→',
        alternatives: ['→ — a right arrow with a doubled shaft (Nemeth §152)',
                       '⇢ — the dashed right arrow, as MathCAT spells it'],
        latexes: ['\\to', '⇢'] });
      out += '\\to ';
      st.i += 4;
      continue;
    }
    // ⠳⠳ is GENUINELY ambiguous: the norm bars ‖x‖ and two adjacent single
    // bars — the nested ||a|-|b|| of absolute-value exercises — braille
    // identically (Nemeth gives no way apart; the APH exercises use nested).
    // Read as ‖ (MathCAT's round-trippable dialect) and say so to the teacher.
    if (c === dots('1256') && S[st.i + 1] === dots('1256')) {
      AMBIG.push({ at: st.i, len: 2, cells: '⠳⠳', reading: '‖',
        alternatives: ['‖ — the double bar (norm, parallel)',
                       '| | — two nested single bars, as in ||a|-|b||'],
        latexes: ['\\|', '||'] });
      out += '\\| ';
      st.i += 2;
      continue;
    }
    // Simple UNDER-BAR: after an item, ⠩⠱ is the bar directly under —
    // x̲ (the NFB statistics pages use it for sample values). The prefixed
    // forms ⠈⠩⠱ (⩟) belong to the table and are longer matches.
    if (c === MOD_BELOW && S[st.i + 1] === dots('156') &&
        /[A-Za-z0-9}\s]$/.test(out) && out.trim()) {
      const mm2 = out.match(/(\\[A-Za-z]+\{[^{}]*\}|[A-Za-z0-9])\s*$/);
      if (mm2) {
        out = out.slice(0, mm2.index) + `\\underline{${mm2[1]}}`;
        st.i += 2;
        continue;
      }
    }
    // Transcriber-defined shape ⠈⠫ + content + ⠻ → shown in white brackets,
    // visibly a defined shape (cellmap: bare pair otherwise unused).
    if (c === SCRIPTI && S[st.i + 1] === dots('1246')) {
      let j6 = st.i + 2;
      const innerT = [];
      while (j6 < S.length && S[j6] !== RCLOSE && j6 - st.i < 12) { innerT.push(S[j6]); j6++; }
      if (S[j6] === RCLOSE) {
        out += `⟦${subParse(innerT, warnings)}⟧`;
        st.i = j6 + 1;
        continue;
      }
    }
    // Bold transcriber brackets ⠸⠈⠷ … ⠸⠈⠾ read as plain brackets.
    if (c === BOLDI && S[st.i + 1] === SCRIPTI && (S[st.i + 2] === LPAREN || S[st.i + 2] === RPAREN)) {
      out += S[st.i + 2] === LPAREN ? '[' : ']';
      st.i += 3;
      continue;
    }
    // LAST RESORT: the generated Nemeth symbol table (longest match first).
    // Deliberately the final branch, so it can only rescue cells every
    // structural rule above has already declined. It must never be able to
    // shadow a fraction, script, radical or number — that is how UEB's table
    // turned x̄ into "xη".
    const sym = matchSymbol(S, st.i);
    if (sym) {
      out += sym.tex;
      st.i += sym.len;
      // ℵ and the Greek letters are IDENTIFIERS, so ℵ₀ is a numeric subscript.
      // An explicit list, NOT "looks like a command": \div and \times match
      // that shape too, and 20 ÷ 4 became 20 ÷ subscript 4.
      if (IDENT_TEX.test(sym.tex)) lastLetterEnd = st.i;
      continue;
    }

    // ARROW, composed. AFTER the symbol table on purpose: the table carries the
    // authority's own arrow spellings — ⠫⠪ is ∠ (an ANGLE, not a left arrow),
    // ⠫⠪⠶⠶ is ⇐, ⠫⠣⠒⠒⠕ is ↑ — and running this rule first overrode all of
    // them. It now only fills the gaps: the contracted shaft-less forms that
    // chemistry uses, and equilibrium pairs of any shaft length.
    if (c === dots('1246')) {
      const a = readArrow(S, st.i);
      if (a) {
        const b = readArrow(S, a.end);
        const horiz = (d) => d === 'left' || d === 'right';
        if (b && horiz(a.dir) && horiz(b.dir) && a.dir !== b.dir) {
          // §153/§155: the harpoon pair's shaft LENGTHS carry the chemistry —
          // equal lengths are equilibrium ⇌; unequal say which reaction
          // dominates (⥂ ⥃ ⥄). All four collapsed to ⇌ before.
          if (a.n === b.n) out += ' \\rightleftharpoons ';
          else if (a.dir === 'right') out += a.n > b.n ? ' ⥂ ' : ' ⥄ ';
          else out += a.n > b.n ? ' ⥃ ' : ' ⥄ ';
          st.i = b.end;
          continue;
        }
        out += ' ' + a.tex;
        st.i = a.end;
        continue;
      }
      // Not an arrow — leave it for the shape entries in the symbol table.
    }

    // ⠸ + a punctuation cell. AFTER the symbol table on purpose, so the
    // multi-cell signs that also begin with ⠸ — ≡ (⠸⠇), ∅ (⠸⠴), ⊂ (⠸⠐⠅) —
    // still win; only what the table declined is read as punctuation.
    if (c === BOLDI && PUNCT[S[st.i + 1]] !== undefined) {
      const dash = dots('36');
      if (S[st.i + 1] === dash && S[st.i + 2] === dash) { out += '—'; st.i += 3; continue; }
      out += PUNCT[S[st.i + 1]];
      st.i += 2;
      continue;
    }

    // A lone ⠠ that introduces nothing is the Nemeth COMMA — "(1001)⠠ (0111)"
    // is a list of two tuples. Last, so ⠠ + letter (capital) and ⠠⠿ (∞) both
    // get first refusal.
    // §8b: between two digits the ⠠ is the INTERIOR numeric comma — 1,2 with
    // no space. Elsewhere it is the spaced mathematical comma.
    if (c === CAP && /\d$/.test(out) && DIGITS[S[st.i + 1]] !== undefined) { out += ','; st.i++; continue; }
    if (c === CAP) { out += ', '; st.i++; continue; }

    warnings.push(`unknown cell ${toDots(c)} (${c}) at cell ${st.i}`);
    st.i++;
  }
  return out;
}

// The table is optional: if nemeth-symbol-table.js has not been loaded we carry
// on exactly as before rather than breaking. It is a plain script that publishes
// to globalThis (browser <script>) and to module.exports (Node).
function symbolTable() {
  if (symbolTable._t) return symbolTable._t;
  let t = (typeof globalThis !== 'undefined' && globalThis.NEMETH_SYMBOLS) || null;
  if (!t) {
    try { t = require('./nemeth-symbol-table.js').NEMETH_SYMBOLS; } catch (e) { t = []; }
  }
  // Longest first, so ⊆ (⠸⠐⠅⠱) wins over ⊂ (⠸⠐⠅).
  symbolTable._t = (t || []).slice().sort((a, b) => b[0].length - a[0].length);
  return symbolTable._t;
}

const MOD_ABOVE = dots('126');    // ⠣ directly-above indicator
const MOD_BELOW = dots('146');    // ⠩ directly-below indicator

// Locate a complete ⠐ … ⠣|⠩ … ⠻ starting at the ⠐ in position `i`.
// Returns {mark, end} or null. Nested modified expressions are counted so an
// inner one cannot be mistaken for this one's terminator.
// findModified recurses through every nested ⠐, which is EXPONENTIAL on runs
// of multipurpose dots — a spatial-layout segment from the NFB corpus (nine ⠐
// in a row) took 110 seconds. The result depends only on (S, i), so memoise.
const FM_CACHE = new WeakMap();
function findModified(S, i) {
  let m = FM_CACHE.get(S);
  if (!m) { m = new Map(); FM_CACHE.set(S, m); }
  if (m.has(i)) return m.get(i);
  m.set(i, null);                       // cycle guard while computing
  const res = findModifiedUncached(S, i);
  m.set(i, res);
  return res;
}
function findModifiedUncached(S, i) {
  // §80a: ⠐ directly before a fraction line or closing indicator is the
  // two-cell baseline-return spelling, never a modified-expression opener —
  // scanning past it found the NEXT lim's ⠩…⠻ and swallowed the fraction.
  if (S[i + 1] === FLINE || S[i + 1] === FCLOSE ||
      (S[i + 1] === CAP && (S[i + 2] === FLINE || S[i + 2] === FCLOSE))) return null;
  let depth = 0;
  const marks = [];
  for (let j = i + 1; j < S.length; j++) {
    // A ⠐ counts as nesting only if it truly opens a modified expression —
    // §80a's level-return ⠐ inside a script was being counted too, which
    // unbalanced the frame and detached every modifier that followed one.
    if (S[j] === BASE) {
      if (S[j + 1] !== MOD_ABOVE && S[j + 1] !== MOD_BELOW && findModified(S, j)) depth++;
      continue;
    }
    if (S[j] === RCLOSE) {
      if (depth === 0) return marks.length ? { marks, end: j } : null;
      depth--; continue;
    }
    // BOTH may be present: a sum carries its lower limit AND its upper limit in
    // one modified expression — ⠐ Σ ⠩ n=1 ⠣ 10 ⠻. Taking only the first mark
    // left the second indicator unread and the whole sum unusable.
    // ⠨⠩ is ∩ and ⠨⠣ its kin — a cell straight after the Greek prefix is
    // part of that SYMBOL, never a directly-over/under mark (§132).
    if (depth === 0 && (S[j] === MOD_ABOVE || S[j] === MOD_BELOW) && S[j - 1] !== GREEK && S[j - 1] !== BOLDI) marks.push(j);
  }
  // End of expression closes the modification implicitly — APH writes
  // ⠐Σ⠩x=0⠣5 with no ⠻ when nothing follows; MathCAT always writes the ⠻.
  // ONLY when the first mark follows the base UNSPACED: a §177 multipurpose ⠐
  // with some unrelated ⠩ beyond a space (chemistry ⠐⠬ … ⠫⠩) must stay null —
  // the un-guarded version swallowed a corpus equation whole.
  if (marks.length && depth === 0) {
    for (let j = i + 1; j < marks[0]; j++) if (isSpace(S[j])) return null;
    return { marks, end: S.length };
  }
  return null;
}

// Parse a detached run of cells (a base or a modifier) on its own.
function subParse(cells, warnings) {
  return parseSeq(cells, { i: 0 }, new Set(), warnings).trim();
}

// Nemeth writes the modifier as a symbol; LaTeX wants an accent command, which
// renders far better than stacking the raw character. Anything we do not have a
// dedicated accent for falls back to \overset/\underset, which is still correct.
const BIG_OP = /\\(sum|prod|int|oint|bigcup|bigcap|lim|max|min)(?![a-zA-Z])|[∑∏∫⋃⋂]/;

// A capital sigma WITH LIMITS is a summation, not the Greek letter — Nemeth
// writes both as ⠨⠠⠎ and only the limits tell them apart. Likewise a bare
// "lim"/"max" is the operator, and LaTeX sets those upright with limits below.
function asLargeOperator(base) {
  const b = String(base).trim();
  if (/^\\Sigma$/.test(b)) return '\\sum ';
  if (/^\\Pi$/.test(b)) return '\\prod ';
  if (/^(lim|max|min|sup|inf|det|gcd|limsup|liminf)$/.test(b)) return '\\' + b + ' ';
  return null;
}

function applyModifier(base, modCells, above, warnings) {
  // §95/§98: the base of a modified comparison arrives DETACHED, so the
  // spacing that normally separates '=' from kappa is gone — a bare kappa
  // base under a mark is the comparison sign (≟, ≗ family).
  if (/^\\kappa\s*$/.test(base)) base = '=';
  const raw = modCells.join('');
  const BAR = dots('156');                       // ⠱
  const TILDE = dots('4') + dots('156');         // ⠈⠱
  const HAT = dots('4') + dots('146');           // ⠈⠩
  // §118: a bar on lim IS varlimsup / varliminf, a single named symbol.
  if (raw === BAR && /\\?lim$/.test(base.trim()))
    return above ? `\\varlimsup` : `\\varliminf`;
  if (raw === BAR)   return above ? `\\bar{${base}}` : `\\underline{${base}}`;
  // §121: a grouping sign in the mark slot is a horizontal brace/bracket.
  if (raw === GREEK + LPAREN || raw === GREEK + RPAREN)
    return above ? `\\overbrace{${base}}` : `\\underbrace{${base}}`;
  if (raw === SCRIPTI + LPAREN || raw === SCRIPTI + RPAREN)
    return above ? `\\overbracket{${base}}` : `\\underbracket{${base}}`;
  if (raw === TILDE) return above ? `\\tilde{${base}}` : `\\underset{\\sim}{${base}}`;
  if (raw === HAT)   return above ? `\\hat{${base}}` : `\\underset{\\wedge}{${base}}`;
  // §99 dot and double dot (velocity/acceleration in A-level mechanics),
  // §161 the caret written ⠸⠣, and §96 an ARROW as modifier makes a vector.
  const DOT = dots('16');
  if (raw === DOT)       return above ? `\\dot{${base}}` : `\\underset{\\cdot}{${base}}`;
  if (raw === DOT + DOT) return `\\ddot{${base}}`;
  if (raw === dots('456') + dots('126')) return `\\hat{${base}}`;
  const arr = readArrow(modCells, 0);
  if (arr && arr.end === modCells.length) {
    // \vec is for letter bases; an arrow over a SIGN (→ over =) is overset.
    if (arr.dir === 'right') return above
      ? (/^\\?[A-Za-z]+$/.test(base.trim()) ? `\\vec{${base}}` : `\\overset{\\to}{${base}}`)
      : `\\underset{\\rightarrow}{${base}}`;
    return above ? `\\overset{${arr.tex.trim()}}{${base}}` : `\\underset{${arr.tex.trim()}}{${base}}`;
  }
  const mod = subParse(modCells, warnings);
  if (!mod) return base;
  // On ∑ ∏ ∫ lim these marks ARE the limits, and _ / ^ put them above and below
  // in display mode, which is how the app renders.
  const big = asLargeOperator(base);
  if (big) return big + (above ? '^' : '_') + `{${mod}}`;
  if (BIG_OP.test(base)) return base + (above ? '^' : '_') + `{${mod}}`;
  return above ? `\\overset{${mod}}{${base}}` : `\\underset{${mod}}{${base}}`;
}

// S is an ARRAY of single cells (convert() masks dots 7/8 as it builds it), so
// this compares cell by cell rather than with startsWith.
function matchSymbol(S, i) {
  for (const [cells, tex] of symbolTable()) {
    const n = cells.length;
    if (i + n > S.length) continue;
    let hit = true;
    for (let k = 0; k < n; k++) if (S[i + k] !== cells[k]) { hit = false; break; }
    if (hit) return { tex: tex, len: n };
  }
  return null;
}

/* Dual-mode export. The browser loads this file as a plain <script>, where
 * `module` is not defined — it only worked because a dependency happened to
 * define one. Guarding it means the file no longer depends on that accident. */
if (typeof module === 'object' && module && module.exports) {
  module.exports = { convert, dots };
}
if (typeof globalThis !== 'undefined') {
  globalThis.convert = convert;
  globalThis.dots = dots;
}

/* ===========================================================================
 * LIMITATIONS (v1, deliberate scope)
 *  • Relations = < > are recognised ONLY when surrounded by spaces (the Nemeth
 *    rule). Unspaced, ⠨⠅ becomes κ and ⠨⠂ becomes a decimal point — as designed.
 *  • Handles: numbers (+ decimal), Latin variables, capitals, lowercase &
 *    common capital Greek, + − × · = < >, simple fractions, super/subscripts
 *    (with baseline), square-root radicals, ( ).
 *  • APPROXIMATION: the several chemical equilibrium arrows (⇌ ⥂ ⥃ ⥄) differ
 *    only in shaft lengths, which say which direction is favoured. We emit
 *    \rightleftharpoons for all of them, so that distinction is lost. It is a
 *    real loss, deliberately taken, and it is why chemistry scores ~48% on the
 *    content check despite parsing 100% cleanly.
 *  • NOT handled: matrices, integrals/limits/sums with limits, multi-radical
 *    indices, nested-fraction level indicators, function names (sin/cos/log),
 *    brackets/braces beyond ( ), punctuation, the English-letter indicator
 *    (⠰ is read as subscript). These are extension points, not dead ends.
 * ======================================================================== */

// --- Self-test (run: `node nemeth-to-latex.js`) -----------------------------
if (require.main === module) {
  const b = dots; // alias
  const SP = SPACE;
  const cases = [
    ['x squared',        b('1346') + SUP + b('23'),                              'x^{2}'],
    ['x^2 + 3',          b('1346') + SUP + b('23') + BASE + b('346') + NUM + b('25'), 'x^{2} + 3'],
    ['H_2 O',            CAP + b('125') + SUB + b('23') + BASE + CAP + b('135'), '\\text{H}_{2}O' /* explicit ⠰…⠐ spelling = TEXT base; round-trips byte-identically where H_{2}O did not */],
    ['x sub i',          b('1346') + SUB + b('24'),                              'x_{i}'],
    ['fraction 1/2',     FOPEN + b('2') + FLINE + b('23') + FCLOSE,              '\\frac{1}{2}'],
    ['(x+1)/2',          FOPEN + LPAREN + b('1346') + b('346') + NUM + b('2') + RPAREN + FLINE + b('23') + FCLOSE,
                                                          '\\frac{\\left(x + 1\\right)}{2}'],
    ['sqrt 2',           ROPEN + b('23') + RCLOSE,                               '\\sqrt{2}'],
    ['decimal 3.14',     NUM + b('25') + GREEK + b('2') + b('256'),              '3.14'],
    ['a + b = c',        b('1') + b('346') + b('12') + SP + GREEK + b('13') + SP + b('14'), 'a + b = c'],
    ['alpha',            GREEK + b('1'),                                         '\\alpha'],
    ['kappa (unspaced)', GREEK + b('13'),                                        '\\kappa'],
    ['2 < 3',            NUM + b('23') + SP + BASE + b('13') + SP + NUM + b('25'), '2 < 3'],
  ];

  let pass = 0;
  for (const [name, inp, want] of cases) {
    const { latex, warnings } = convert(inp);
    const ok = latex === want;
    if (ok) pass++;
    console.log(`${ok ? '✅' : '❌'} ${name.padEnd(18)} → ${JSON.stringify(latex)}`);
    if (!ok) console.log(`     expected ${JSON.stringify(want)}`);
    if (warnings.length) console.log('     warnings:', warnings.join('; '));
  }
  console.log(`\n${pass}/${cases.length} passed`);
  process.exit(pass === cases.length ? 0 : 1);
}
