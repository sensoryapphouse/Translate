// WHAT THE WHOLE-FILE MODE DETECTOR SAYS, AND WHAT IT MUST NEVER SAY.
//
// classifyDoc runs on every BRF load and its confident calls RE-MODE the whole
// document (the caller clears lineModes), so a wrong call rewrites how a child's
// work is read. This harness pins the calls over the shipped corpus and over the
// shapes a load can actually take.
//
// It exists because of a real miss: a line of text with a Nemeth sum in the
// middle of it counted as a fully switched line, so a ONE-LINE document of that
// shape scored 1.0 and the whole file was called Nemeth. The rule is now that
// the switches must COVER the line, and the cases below hold both directions of
// that rule apart — a genuinely switch-wrapped file must still be called.
//
// EVERY CELL HERE IS BUILT, NOT TYPED: the BRF strings go through the engine's
// own brfToUnicodeBraille, so a mistyped cell cannot quietly turn a test into a
// test of something else.
//
// Run:  node test-mode-detect.mjs        (from Translate/)
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'node:url';
import { classifyDoc } from './mode-detect.mjs';
import { uebMathsToLatexV2 } from './ueb-rules.mjs';
import { brfToUnicodeBraille } from '../engine/brf-ascii.mjs';

const B = (ascii) => brfToUnicodeBraille(ascii.toUpperCase());

// PATHS FROM THIS FILE, NOT FROM THE SHELL'S CURRENT DIRECTORY (2026-09-02).
// The examples were read as './examples', so the suite ran only when started
// from Translate/ and died with ENOENT anywhere else - which is why it was
// never in the battery, though a wrong call here re-modes a child's document.
const HERE = path.dirname(fileURLToPath(import.meta.url));

// The detector needs a back-translator to score "does this line read as words".
// liblouis is a wasm/browser dependency, so this stands in with the plain letter
// mapping, derived from the engine's table rather than written out: enough to
// tell prose from maths, which is all the vote asks. Calls that turn on subtle
// contraction reading are therefore NOT pinned here — the shipped rows below are
// compared against the app's own live behaviour, not against this stub's taste.
const LETTERS = Object.fromEntries(
  [...'ABCDEFGHIJKLMNOPQRSTUVWXYZ'].map((ch) => [B(ch), ch.toLowerCase()]));
const backTranslate = (w) => [...w].map((c) => LETTERS[c] ?? '').join('');
const opts = { parseUeb: uebMathsToLatexV2, backTranslate };
const call = (lines) => classifyDoc(lines, opts).call;

// The Nemeth switch signs, as the BRF export writes them: _% … _:
const NEM_OPEN = B('_%'), NEM_CLOSE = B('_:');
const BLANK = String.fromCodePoint(0x2800);
const TEXT = B('THE CAT SAT ON THE MAT');
const NEM = B('#2+3 .K #5');
const wrapped = (inner) => `${NEM_OPEN}${BLANK}${inner}${BLANK}${NEM_CLOSE}`;

console.log('built cells: open=%s close=%s blank=%s',
  [...NEM_OPEN].map((c) => c.codePointAt(0).toString(16)).join('+'),
  [...NEM_CLOSE].map((c) => c.codePointAt(0).toString(16)).join('+'),
  BLANK.codePointAt(0).toString(16));
console.log('sample wrapped line:', JSON.stringify(wrapped(NEM)));

let failures = 0;
const check = (name, got, want) => {
  const ok = want instanceof RegExp ? want.test(got) : got === want;
  if (!ok) failures++;
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${got}${ok ? '' : ` (wanted ${want})`}`);
};

// ---- the shapes a load can take -------------------------------------------
console.log('\n-- line shapes --');
// The miss this harness was written for: ONE line, text either side of a sum.
check('one mixed line is not a Nemeth file',
  call([`${TEXT} ${wrapped(NEM)} ${TEXT}`]), 'abstain');
check('several mixed lines are not a Nemeth file',
  call(Array(6).fill(`${TEXT} ${wrapped(NEM)} ${TEXT}`)), 'abstain');
// The case the rule exists to keep: this app's own BRF export of Nemeth lines.
check('switch-wrapped lines ARE a Nemeth file',
  call(Array(6).fill(wrapped(NEM))), 'nemeth');
check('one switch-wrapped line is a Nemeth file',
  call([wrapped(NEM)]), 'nemeth');
check('wrapped lines with blanks between them are a Nemeth file',
  call([wrapped(NEM), '', wrapped(NEM), '', wrapped(NEM)]), 'nemeth');
// A mixed line among wrapped ones must not drag the file either way: the
// wrapped lines carry their own switches, so nothing needs declaring.
check('one mixed line among wrapped ones does not force the call',
  call([...Array(5).fill(wrapped(NEM)), `${TEXT} ${wrapped(NEM)} ${TEXT}`]), 'abstain');
check('plain prose is text', call([TEXT, TEXT, TEXT, TEXT]), 'text');
check('nothing at all abstains', call(['', '   ']), 'abstain');

// ---- the evidence the app leans on to SPEAK --------------------------------
// A file it cannot call is not silently opened as text any more: above a third
// of lines looking like maths, Translate says so and changes nothing. That
// threshold lives in translate.mjs, but it can only work if the verdict keeps
// carrying the numbers - so pin their presence here.
const cellRange = new RegExp(`[${String.fromCodePoint(0x2800)}-${String.fromCodePoint(0x28FF)}]`, 'u');
console.log('\n-- the verdict carries its evidence --');
{
  // Switch-wrapped lines are excluded from the vote (they declare themselves),
  // so a mixed-evidence file has to be built from lines that DO vote: real UEB
  // maths, which carries no switch signs, against real prose.
  const uebRaw = fs.readFileSync(path.join(HERE, 'examples', 'ueb-maths.brf'), 'utf8');
  const uebLines = (cellRange.test(uebRaw) ? uebRaw : brfToUnicodeBraille(uebRaw.toUpperCase()))
    .split('\n').filter((l) => l.trim()).slice(0, 5);
  const v = classifyDoc([...uebLines, TEXT, TEXT, TEXT, TEXT, TEXT], opts);
  check('a half-and-half file is not called either way', v.call, 'abstain');
  check('and says why', v.why || '', /evidence|signature|thin/);
  check('and carries the share, so the app can decide whether to mention it',
    String(typeof v.f === 'number'), 'true');
  console.log(`     (share of lines voting maths: ${v.f === undefined ? 'n/a' : v.f.toFixed(2)})`);
}

// ---- the shipped corpus ----------------------------------------------------
// Reported, and pinned only where this stub back-translator is a fair witness.
// A row that moves here is a real change of behaviour on a file we ship.
const PINNED = {
  'nemeth-maths.brf': 'nemeth',     // its lines ARE switch-wrapped, so it is declared
};
console.log('\n-- shipped examples --');
const dir = path.join(HERE, 'examples');
for (const f of fs.readdirSync(dir).filter((n) => n.endsWith('.brf')).sort()) {
  const raw = fs.readFileSync(path.join(dir, f), 'utf8');
  const lines = (cellRange.test(raw) ? raw : brfToUnicodeBraille(raw.toUpperCase())).split('\n');
  const got = call(lines);
  if (PINNED[f]) check(f, got, PINNED[f]);
  else console.log(`     ${f}: ${got}`);
}

console.log(failures ? `\n${failures} FAILED` : '\nall passed');
process.exit(failures ? 1 : 0);
