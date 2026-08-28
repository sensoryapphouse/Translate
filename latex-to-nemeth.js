'use strict';
/* ===========================================================================
 * LaTeX -> Nemeth (6-dot braille)  —  core-subset converter
 * ---------------------------------------------------------------------------
 * Input:  a LaTeX math string (no $-delimiters needed), e.g. "\\frac{1}{2}".
 * Output: { braille, warnings }  where braille is a Unicode braille string.
 *
 * This is the inverse of nemeth-to-latex.js and shares the same cell table
 * (dot patterns from liblouis `nemethdefs.cti`). It follows the same Nemeth
 * conventions the decoder expects: comparison signs (= < >) are SPACED;
 * operation signs (+ - × ·) are not; the numeric indicator ⠼ is emitted at
 * the start of a number except directly after a "context opener" (fraction
 * pieces, script or radical indicators). See LIMITATIONS at the bottom.
 * ======================================================================== */

const { convert, dots } = require('./nemeth-to-latex'); // reuse dots() + decoder

// --- cells (same as the decoder) -------------------------------------------
const SPACE  = dots('');
const NUM    = dots('3456');   // ⠼ numeric indicator
const CAP    = dots('6');      // ⠠ capital
const GREEK  = dots('46');     // ⠨ greek / decimal point / '=' 1st cell
const SUP    = dots('45');     // ⠘
const SUB    = dots('56');     // ⠰
const BASE   = dots('5');      // ⠐
const FOPEN  = dots('1456');   // ⠹
const FLINE  = dots('34');     // ⠌
const FCLOSE = dots('3456');   // ⠼
const ROPEN  = dots('345');    // ⠜
const RCLOSE = dots('12456');  // ⠻
const LPAREN = dots('12356');  // ⠷
const RPAREN = dots('23456');  // ⠾
// Directly after any of these, a numeral needs no numeric indicator.
const OPENERS = new Set([FOPEN, FLINE, SUP, SUB, ROPEN]);

const DIGIT_CELL = {
  '0':dots('356'),'1':dots('2'),'2':dots('23'),'3':dots('25'),'4':dots('256'),
  '5':dots('26'),'6':dots('235'),'7':dots('2356'),'8':dots('236'),'9':dots('35'),
};
const LETTER_CELL = {};
for (const [ltr, d] of [
  ['a','1'],['b','12'],['c','14'],['d','145'],['e','15'],['f','124'],['g','1245'],
  ['h','125'],['i','24'],['j','245'],['k','13'],['l','123'],['m','134'],['n','1345'],
  ['o','135'],['p','1234'],['q','12345'],['r','1235'],['s','234'],['t','2345'],
  ['u','136'],['v','1236'],['w','2456'],['x','1346'],['y','13456'],['z','1356'],
]) LETTER_CELL[ltr] = dots(d);

// greek command name -> { cell, cap }
const GREEK_CMD = {};
for (const [name, d] of [
  ['alpha','1'],['beta','12'],['gamma','1245'],['delta','145'],['epsilon','15'],
  ['varepsilon','15'],['zeta','1356'],['eta','156'],['theta','1456'],['iota','24'],
  ['kappa','13'],['lambda','123'],['mu','134'],['nu','1345'],['xi','1346'],
  ['omicron','135'],['pi','1234'],['rho','1235'],['sigma','234'],['tau','2345'],
  ['upsilon','136'],['phi','124'],['chi','12346'],['psi','13456'],['omega','2456'],
]) {
  GREEK_CMD[name] = { cell: dots(d), cap: false };
  GREEK_CMD[name[0].toUpperCase() + name.slice(1)] = { cell: dots(d), cap: true };
}

// --- tokenizer --------------------------------------------------------------
function tokenize(src) {
  const t = [];
  for (let i = 0; i < src.length; ) {
    const ch = src[i];
    if (ch === '\\') {
      let j = i + 1, name = '';
      while (j < src.length && /[a-zA-Z]/.test(src[j])) name += src[j++];
      if (name === '') { name = src[j] || ''; j++; }      // escaped symbol e.g. \{
      t.push({ type: 'cmd', value: name }); i = j;
    } else if (ch === '{') { t.push({ type: 'lb' }); i++; }
    else if (ch === '}')   { t.push({ type: 'rb' }); i++; }
    else if (ch === '^')   { t.push({ type: 'sup' }); i++; }
    else if (ch === '_')   { t.push({ type: 'sub' }); i++; }
    else if (/\s/.test(ch)){ t.push({ type: 'sp' }); i++; }
    else { t.push({ type: 'ch', value: ch }); i++; }
  }
  return t;
}

const isDigitTok = (tok) => tok && tok.type === 'ch' && /[0-9]/.test(tok.value);

function pushRel(out, cells) {                 // spaced comparison sign
  if (out.length && out[out.length - 1] !== SPACE) out.push(SPACE);
  for (const c of cells) out.push(c);
  out.push(SPACE);
}

// --- parser / emitter -------------------------------------------------------
function convertLatex(latex) {
  const t = tokenize(latex);
  const st = { i: 0 };
  const out = [];
  const warnings = [];
  emitSeq(t, st, out, warnings, false);

  // collapse runs of blank cells and trim them from the ends
  const cleaned = [];
  for (const c of out) {
    if (c === SPACE && (cleaned.length === 0 || cleaned[cleaned.length - 1] === SPACE)) continue;
    cleaned.push(c);
  }
  while (cleaned.length && cleaned[cleaned.length - 1] === SPACE) cleaned.pop();
  return { braille: cleaned.join(''), warnings };
}

function emitSeq(t, st, out, warnings, stopAtRb) {
  while (st.i < t.length) {
    if (stopAtRb && t[st.i].type === 'rb') break;
    emitAtom(t, st, out, warnings);
    // postfix superscripts / subscripts bind to the atom just emitted
    while (st.i < t.length && (t[st.i].type === 'sup' || t[st.i].type === 'sub')) {
      out.push(t[st.i].type === 'sup' ? SUP : SUB); st.i++;
      emitGroup(t, st, out, warnings);
      out.push(BASE);
    }
  }
}

function emitGroup(t, st, out, warnings) {     // a {group} or a single atom
  if (t[st.i] && t[st.i].type === 'lb') {
    st.i++;
    emitSeq(t, st, out, warnings, true);
    if (t[st.i] && t[st.i].type === 'rb') st.i++;
  } else {
    emitAtom(t, st, out, warnings);
  }
}

function emitAtom(t, st, out, warnings) {
  const tok = t[st.i];
  if (!tok) return;

  if (tok.type === 'sp') { out.push(SPACE); st.i++; return; }

  if (tok.type === 'lb') { emitGroup(t, st, out, warnings); return; }

  if (tok.type === 'cmd') { emitCmd(t, st, out, warnings); return; }

  // tok.type === 'ch'
  const ch = tok.value;

  if (/[0-9]/.test(ch)) {                       // number run
    if (!OPENERS.has(out[out.length - 1])) out.push(NUM);
    while (st.i < t.length) {
      const x = t[st.i];
      if (isDigitTok(x)) { out.push(DIGIT_CELL[x.value]); st.i++; }
      else if (x && x.type === 'ch' && x.value === '.' && isDigitTok(t[st.i + 1])) {
        out.push(GREEK); st.i++;               // decimal point ⠨
      } else break;
    }
    return;
  }

  if (/[a-zA-Z]/.test(ch)) {                    // variable
    st.i++;
    const lower = ch.toLowerCase();
    if (ch !== lower) out.push(CAP);
    out.push(LETTER_CELL[lower]);
    return;
  }

  st.i++;
  switch (ch) {
    case '+': out.push(dots('346')); return;
    case '-': out.push(dots('36')); return;
    case '=': pushRel(out, [GREEK, dots('13')]); return;
    case '<': pushRel(out, [BASE, dots('13')]); return;
    case '>': pushRel(out, [GREEK, dots('2')]); return;
    case '(': out.push(LPAREN); return;
    case ')': out.push(RPAREN); return;
    case '.': out.push(GREEK); return;          // stray decimal point
    default: warnings.push(`unhandled character ${JSON.stringify(ch)}`); return;
  }
}

function emitCmd(t, st, out, warnings) {
  const name = t[st.i].value; st.i++;
  if (GREEK_CMD[name]) {
    const g = GREEK_CMD[name];
    out.push(GREEK);
    if (g.cap) out.push(CAP);
    out.push(g.cell);
    return;
  }
  switch (name) {
    case 'frac':
      out.push(FOPEN);  emitGroup(t, st, out, warnings);
      out.push(FLINE);  emitGroup(t, st, out, warnings);
      out.push(FCLOSE); return;
    case 'sqrt':
      if (t[st.i] && t[st.i].type === 'ch' && t[st.i].value === '[') {   // ignore radical index
        while (st.i < t.length && !(t[st.i].type === 'ch' && t[st.i].value === ']')) st.i++;
        if (st.i < t.length) st.i++;
        warnings.push('radical index dropped (\\sqrt[n]{})');
      }
      out.push(ROPEN); emitGroup(t, st, out, warnings); out.push(RCLOSE); return;
    case 'times': out.push(dots('4'), dots('16')); return;   // ⠈⠡
    case 'cdot':  out.push(dots('16')); return;              // ⠡
    case 'pm':    out.push(dots('346'), dots('36')); return; // ⠬⠤
    case 'left': case 'right': case ',': case '!': case ';': case ' ': return; // spacing/no-ops
    default: warnings.push(`unsupported command \\${name}`); return;
  }
}

module.exports = { convertLatex };

/* ===========================================================================
 * LIMITATIONS (v1, matches the decoder's scope)
 *  • Handles: numbers (+ decimals), Latin variables, capitals, lower/upper
 *    Greek, + − × · ± = < >, \frac, \sqrt (index dropped), ^ _ scripts, ( ).
 *  • A baseline indicator ⠐ is always emitted after a script (safe/explicit).
 *  • NOT handled: matrices, \int/\sum/\lim with limits, function names,
 *    \left/\right delimiters other than ( ), brackets/braces, punctuation.
 * ======================================================================== */

// --- Self-test (run: `node latex-to-nemeth.js`) -----------------------------
if (require.main === module) {
  const toDots = (s) => [...s].map(c =>
    c === SPACE ? '·' :
    ('[' + ([1,2,3,4,5,6].filter(d => (c.codePointAt(0) - 0x2800) & (1 << (d - 1))).join('') || '0') + ']')
  ).join('');

  // (a) exact-braille checks on canonical Nemeth forms
  const exact = [
    ['\\frac{1}{2}', FOPEN + dots('2') + FLINE + dots('23') + FCLOSE],
    ['x^{2}',        dots('1346') + SUP + dots('23') + BASE],
    ['3.14',         NUM + dots('25') + GREEK + dots('2') + dots('256')],
    ['\\alpha',      GREEK + dots('1')],
    ['\\Gamma',      GREEK + CAP + dots('1245')],
  ];
  let pass = 0;
  console.log('— exact Nemeth output —');
  for (const [latex, want] of exact) {
    const { braille } = convertLatex(latex);
    const ok = braille === want;
    if (ok) pass++;
    console.log(`${ok ? '✅' : '❌'} ${latex.padEnd(14)} → ${braille}   ${toDots(braille)}`);
    if (!ok) console.log(`     expected ${want}  ${toDots(want)}`);
  }

  // (b) round-trip consistency: decode(encode(x)) must be idempotent
  console.log('\n— round-trip (LaTeX → Nemeth → LaTeX, then again) —');
  const inputs = [
    'x^{2} + 3', 'H_{2}O', '\\frac{x + 1}{2}', '\\sqrt{2}',
    'a + b = c', '2 < 3', '\\alpha + \\beta', 'x_{i}', '\\frac{1}{2}',
  ];
  let rt = 0;
  for (const inp of inputs) {
    const b1 = convertLatex(inp).braille;
    const l1 = convert(b1).latex;                 // canonical decoded form
    const l2 = convert(convertLatex(l1).braille).latex;
    const ok = l1 === l2;
    if (ok) rt++;
    console.log(`${ok ? '✅' : '❌'} ${inp.padEnd(16)} → ${b1}  → "${l1}"`);
    if (!ok) console.log(`     not idempotent: "${l1}" vs "${l2}"`);
  }

  console.log(`\nexact ${pass}/${exact.length}, round-trip ${rt}/${inputs.length}`);
  process.exit(pass === exact.length && rt === inputs.length ? 0 : 1);
}
