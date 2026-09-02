/* Plain-English names for the Nemeth indicators, for Translate's status bar.
 *
 * The cells below are taken from the constant block at the top of
 * ../nemeth-to-latex.js (which in turn cites liblouis `nemethdefs.cti` and the
 * Nemeth Code spec). They are listed here rather than imported because that file
 * is a shared CommonJS module that only exports `convert`; keep the two in step
 * if its constants ever change.
 */

// THE PARSER'S OWN TABLES ARE THE NAMES (2026-09-02, the audit). This file
// named 27 of the 142 sequences the parser reads, so the status bar said
// "unknown" for the times dot, the factorial, the answer blank and every arrow
// - all of which the parser reads perfectly well. Rather than copy that list a
// third time, the tables are imported and turned into names below: whatever the
// parser learns, the status bar can say.
import { OPS, SHAPES, BRACKETS } from './nemeth-rules.mjs';

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

    // A TWO-CELL SIGN BEFORE ITS FIRST CELL (2026-09-02). "therefore" is dots 6
    // then dots 16, and the capital-sign branch below claimed the dot 6 first,
    // so it was named "capital sign, times". Multi-cell signs from the parser's
    // own tables are matched here; single cells still go through the curated
    // list below, which has the better names for them.
    {
      const multi = tableNameAt(cells, i, 2);
      if (multi) { out.push({ cells: multi.cells, name: multi.name }); i += multi.len; continue; }
    }

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
    
    // WHAT THE PARSER WOULD MAKE OF IT. Built from OPS, SHAPES and BRACKETS, so
    // a sign the reader gains is a sign the status bar can name the same day.
    {
      const hit = tableNameAt(cells, i);
      if (hit) { out.push({ cells: hit.cells, name: hit.name }); i += hit.len; continue; }
    }

    out.push({ cells: c, name: 'unknown' });
    i++;
  }
  return out;
}

// LaTeX to English, for the signs the parser's tables carry. Anything without an
// entry is named by its own symbol rather than by its command, which is still
// far better than "unknown" - and a missing entry here can never invent a
// meaning, because the table it came from is what the reader itself uses.
const TEX_WORD = {
  '+': 'plus', '-': 'minus', '=': 'equals', '<': 'less than', '>': 'greater than',
  '/': 'fraction line (diagonal)', "'": 'prime', ', ': 'comma',
  '\\pm ': 'plus or minus', '\\mp ': 'minus or plus', '\\times ': 'times',
  '\\cdot ': 'times (dot)', '\\div ': 'divided by', '\\neq ': 'not equal to',
  '\\int ': 'integral sign', '!': 'factorial', '\\square ': 'answer blank (omission)',
  '\\in ': 'is in (element of)', '\\ast ': 'star', '\\setminus ': 'set difference',
  '\\sim ': 'tilde (is similar to)', '\\equiv ': 'is identical to',
  '\\therefore ': 'therefore', '\\ldots ': 'and so on (ellipsis)',
  '\\angle ': 'angle', '\\triangle ': 'triangle', '\\square': 'square',
  '\\circ ': 'degrees', '(': 'open bracket', ')': 'close bracket',
  '[': 'open square bracket', ']': 'close square bracket',
  '\\{': 'open brace', '\\}': 'close brace',
  '|': 'vertical bar (as in |x|, absolute value)',
  '\\|': 'double vertical bar (norm)',
};
const wordFor = (tex) => TEX_WORD[tex]
  || TEX_WORD[String(tex).trim()]
  || (/^[^\\]$/.test(String(tex).trim()) ? `the sign ${String(tex).trim()}` : null);

function tableNameAt(cells, i, minCells = 1) {
  const at = (n) => cells.slice(i, i + n).join('');
  const tries = [];
  for (const op of OPS) tries.push([op.cells, op.tex]);
  for (const b of BRACKETS) tries.push([b.cells, b.tex]);
  // A SHAPE IS WRITTEN WITH ITS INDICATOR (dots 1246 first), which is why the
  // bare shape cell was named while the indicator before it said "unknown".
  const SHAPE_IND = D('1246');
  for (const [cell, tex] of Object.entries(SHAPES)) tries.push([SHAPE_IND + cell, tex]);
  // longest first, so a two-cell sign is never read as its first cell
  tries.sort((a, b) => [...b[0]].length - [...a[0]].length);
  for (const [seq, tex] of tries) {
    const n = [...seq].length;
    if (n < minCells || at(n) !== seq) continue;
    const word = wordFor(tex);
    if (word) return { cells: seq, name: word, len: n };
  }
  return null;
}
