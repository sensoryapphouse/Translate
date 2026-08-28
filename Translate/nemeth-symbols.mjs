/* Plain-English names for the Nemeth indicators, for Connector's status bar.
 *
 * The cells below are taken from the constant block at the top of
 * ../nemeth-to-latex.js (which in turn cites liblouis `nemethdefs.cti` and the
 * Nemeth Code spec). They are listed here rather than imported because that file
 * is a shared CommonJS module that only exports `convert`; keep the two in step
 * if its constants ever change.
 */

const D = (s) => String.fromCodePoint(
  0x2800 + [...s].reduce((a, c) => a | (1 << (Number(c) - 1)), 0));

const NUM    = D('3456');   // ⠼ numeric indicator — SAME cell as fraction close
const CAP    = D('6');      // ⠠ capital indicator
const GREEK  = D('46');     // ⠨ greek indicator
const SUP    = D('45');     // ⠘ superscript
const SUB    = D('56');     // ⠰ subscript
const BASE   = D('5');      // ⠐ baseline (ends a script)
const FOPEN  = D('1456');   // ⠹ fraction open
const FLINE  = D('34');     // ⠌ fraction line
const ROPEN  = D('345');    // ⠜ radical (square root) open
const RCLOSE = D('12456');  // ⠻ radical close
const LPAREN = D('12356');  // ⠷
const RPAREN = D('23456');  // ⠾

// Nemeth writes digits in the LOWER part of the cell ("dropped"), which is what
// makes them collide with ordinary punctuation in literary braille.
const DROPPED = new Set([...'⠂⠆⠒⠲⠢⠖⠶⠦⠔⠴']);

const NAMES = new Map([
  [CAP,    { name: 'capital sign', speech: 'capital' }],
  [GREEK,  { name: 'Greek letter sign', speech: 'Greek' }],
  [SUP,    { name: 'superscript (raise what follows)', speech: 'superscript' }],
  [SUB,    { name: 'subscript (lower what follows)', speech: 'subscript' }],
  [BASE,   { name: 'back to the baseline (ends the script)', speech: 'baseline' }],
  [FOPEN,  { name: 'open fraction', speech: 'open fraction' }],
  [FLINE,  { name: 'fraction line', speech: 'fraction line' }],
  [ROPEN,  { name: 'square-root sign', speech: 'square root' }],
  [RCLOSE, { name: 'end of square root', speech: 'end root' }],
  [LPAREN, { name: 'open bracket', speech: 'open bracket' }],
  [RPAREN, { name: 'close bracket', speech: 'close bracket' }],
  // ⠼ is genuinely two things in Nemeth — say so rather than guess.
  [NUM,    { name: 'number sign (or close fraction — same cell in Nemeth)', speech: 'number or close fraction' }],
  // ⠬⠤ is ONE sign, and must be listed BEFORE the bare ⠬: the describer tries
  // two cells before one, and read the quadratic formula's ± as "plus minus".
  ['⠬⠤', { name: 'plus or minus', speech: 'plus or minus' }],
  ['⠬', { name: 'plus', speech: 'plus' }],
  ['⠤', { name: 'minus', speech: 'minus' }],
  ['⠨⠅', { name: 'equals', speech: 'equals' }],
  ['⠨', { name: 'decimal point', speech: 'decimal point' }],
  ['⠂', { name: 'comma', speech: 'comma' }],
  ['⠸⠩', { name: 'open Nemeth mode', speech: 'open Nemeth' }],
  ['⠸⠱', { name: 'close Nemeth mode', speech: 'close Nemeth' }],
  // Measured against the app's own examples (2026-08-12): every "unknown" the
  // status bar showed for nemeth-maths.brf was one of these four cells, all of
  // which the live parser (nemeth-rules.mjs) already reads — ⠈⠡ at :103,
  // ⠮ at :111, ⠳/⠳⠳ at :98-99. The describer just had no names for them.
  // A ⠈ NOT followed by ⠡ stays unknown deliberately: alone it is a multi-
  // purpose prefix, and naming it would be a guess.
  ['⠈⠡', { name: 'multiplication cross (times)', speech: 'times' }],
  ['⠮', { name: 'integral sign', speech: 'integral' }],
  ['⠳⠳', { name: 'double vertical bar (norm)', speech: 'double vertical bar' }],
  ['⠳', { name: 'vertical bar (as in |x|, absolute value)', speech: 'vertical bar' }],
]);

const ALPHABET = {
  '⠁': 'a', '⠃': 'b', '⠉': 'c', '⠙': 'd', '⠑': 'e',
  '⠋': 'f', '⠛': 'g', '⠓': 'h', '⠊': 'i', '⠚': 'j',
  '⠅': 'k', '⠇': 'l', '⠍': 'm', '⠝': 'n', '⠕': 'o',
  '⠏': 'p', '⠟': 'q', '⠗': 'r', '⠎': 's', '⠞': 't',
  '⠥': 'u', '⠧': 'v', '⠺': 'w', '⠭': 'x', '⠽': 'y',
  '⠵': 'z'
};

const DROPPED_VALS = { '⠂':'1', '⠆':'2', '⠒':'3', '⠲':'4', '⠢':'5', '⠖':'6', '⠶':'7', '⠦':'8', '⠔':'9', '⠴':'0' };

export function describeNemeth(input) {
  const cells = [...String(input)];
  const out = [];
  let i = 0;
  let fractionDepth = 0;
  
  while (i < cells.length) {
    const c = cells[i];
    if (c === ' ' || c === '⠀') { i++; continue; }

    if (DROPPED.has(c)) {
      let numCells = c;
      let numStr = DROPPED_VALS[c];
      let j = 1;
      while (i + j < cells.length) {
        const n = cells[i + j];
        if (DROPPED.has(n)) {
          numCells += n;
          numStr += DROPPED_VALS[n];
          j++;
        } else {
          break;
        }
      }
      out.push({ cells: numCells, name: numStr });
      i += j;
      continue;
    }
    
    // 2-cell symbols in NAMES
    if (i + 1 < cells.length) {
      const two = c + cells[i + 1];
      if (NAMES.has(two)) {
        const val = NAMES.get(two);
        out.push({ cells: two, name: val.name, speech: val.speech });
        i += 2;
        continue;
      }
    }

    if (NAMES.has(c)) {
      let val = NAMES.get(c);
      
      if (c === FOPEN) fractionDepth++;
      
      if (c === NUM) {
        const nextCell = i + 1 < cells.length ? cells[i+1] : null;
        if (nextCell && (DROPPED.has(nextCell) || nextCell === '⠨' || nextCell === '⠠')) {
          val = { name: 'number sign', speech: 'number' };
        } else if (fractionDepth > 0) {
          val = { name: 'close fraction', speech: 'close fraction' };
          fractionDepth--;
        } else {
          val = { name: 'number sign', speech: 'number' };
        }
      }
      
      out.push({ cells: c, name: val.name, speech: val.speech });
      i++;
      continue;
    }
    
    if (ALPHABET[c]) {
      out.push({ cells: c, name: ALPHABET[c] });
      i++;
      continue;
    }
    
    out.push({ cells: c, name: 'unknown' });
    i++;
  }
  return out;
}
