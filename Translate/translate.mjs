// Connector — six-key braille in (left pane), text or maths out (right pane).
//
// Why only ONE checkbox:
//   • Nemeth is a DIFFERENT code and it announces itself — a Nemeth passage
//     inside UEB is wrapped in ⠸⠩ … ⠸⠱ (BANA "Nemeth within UEB"), and Nemeth
//     digits are "dropped" (lower cells) where UEB uses ⠼ + a–j. So Nemeth is
//     DETECTED, not asked for.
//   • UEB maths is the SAME code as UEB text, so nothing marks it reliably —
//     that one needs the user to say so, hence the "UEB Maths" checkbox.
//
// Words are translated one at a time so each braille word maps 1:1 to a text
// word; that exact mapping is what makes click-to-link between the panes work.

import * as louis from '/engine/louis-browser.mjs';
// #261: the SAME syllable rules BrlDuet uses, synced by sync-engine.sh rather
// than re-derived here. Where a hyphen falls inside a sung word is a decision
// this app must not make differently from the one a child reads.
import { brfToUnicodeBraille, unicodeBrailleToBrf } from '/engine/brf-ascii.mjs';
import { uebMathsToLatex, describeUebMaths } from '/Translate/ueb-maths-to-latex.mjs';
import { uebMathsToLatexV2 } from '/Translate/ueb-rules.mjs';
import { nemethMathsToLatexV2 } from '/Translate/nemeth-rules.mjs';
import { describeNemeth } from '/Translate/nemeth-symbols.mjs';
import { speakAst } from '/Translate/math-speech.mjs?v=2';
import { startVerifier, suggestRepairs, verifyLine, speakLatex } from '/Translate/verify.mjs';
import { buildDocx, mathmlToOmml } from '/Translate/docx.mjs';
import { classifyDoc } from '/Translate/mode-detect.mjs';
// HOW MUCH MATHS BEFORE WE MENTION IT. The detector needs 95% agreement to
// change anything by itself; this is the much lower bar for merely SAYING that
// a file might be maths. A third of the lines is enough to be worth a sentence
// and far too little to act on.
const MATHS_HINT_SHARE = 1 / 3;
import { CODES } from '/Translate/braille-codes.mjs';
import { writeEbraille, readEbraille, looksLikeEbraille } from '/Translate/ebraille.mjs';

// THE BRAILLE CODES ON OFFER (PB, 2026-08-09), chosen the same way voices are:
// the current language first, the country's likely second, everything else one
// click away behind "… more".
//
// The list is GENERATED from the tables that actually ship (see
// tools/gen-braille-codes.mjs) — 142 codes across 112 languages. It began as ten
// entries typed by hand and PB asked where Welsh was; it had been there all
// along. A hand-written list answers "no" for every language its author forgot,
// and goes stale the moment liblouis is updated.
//
// Only 6 of the 142 travel in the service worker. The rest need the network the
// first time they are chosen, and the picker says so rather than failing quietly
// offline.
// THE FALLBACK IS THE DEFAULT, NOT THE FIRST (2026-08-19). CODES is
// alphabetical, so CODES[0] is Afrikaans grade 1 — an UNSHIPPED code. An
// unknown id therefore silently retargeted every table lookup at a code whose
// tables were never loaded: bt() threw per word, the print pane sat empty, and
// the boot check could not see anything wrong because it resolved the id
// through this same fallback. Unknown now means the app's own default.
const DEFAULT_CODE = 'en-ueb-g2';
const codeById = (id) => CODES.find((c) => c.id === id)
  || CODES.find((c) => c.id === DEFAULT_CODE) || CODES[0];

// Intl gives the language name in the USER's language — a French user reads
// "gallois", not "Welsh" — and needs no name table to maintain.
const LANG_NAMES = (() => {
  try { return new Intl.DisplayNames([navigator.language || 'en'], { type: 'language' }); }
  catch { return null; }
})();
const codeLabel = (c) => {
  let name = c.lang;
  try { name = (LANG_NAMES && LANG_NAMES.of(c.lang)) || c.lang; } catch { /* keep the code */ }
  return c.grade ? `${name} — ${c.grade}` : name;
};

// The two English tables stay named, because they are not only "the current
// code": G2 is what the app writes titles in, and G1 is the COMPARISON used to
// name a single cell aloud and to spot a mode mismatch. Those two jobs are
// about English braille specifically, not about the user's chosen code.
const T_UEB_G2 = '/tables/unicode.dis,/tables/en-ueb-g2.ctb';
const T_UEB_G1 = '/tables/unicode.dis,/tables/en-ueb-g1.ctb';   // uncontracted, for comparison

// The code the USER picked, used for reading their braille back into words.
const T_TEXT = () => codeById(settings.brailleCode).table;

// THE UNCONTRACTED SIBLING of the user's code, when it has one. Used only to
// line cells up with letters for a word that was SPELT OUT where a contraction
// existed: the contracted table cannot reproduce those cells, so without this
// the colour pairing quietly switched itself off for exactly the words a
// learner most needs it for. Derived from the code list rather than hardwired,
// so it follows whatever code is in use.
const uncontractedSibling = (id = settings.brailleCode) => {
  const code = codeById(id);
  if (!code) return null;
  if (/grade 1|uncontracted/i.test(code.grade || '')) return null;   // already uncontracted
  const sib = CODES.find((c) => c.lang === code.lang && c.id !== code.id
                             && /grade 1|uncontracted/i.test(c.grade || ''));
  return sib ? sib.table : null;
};

// LIBLOUIS SAYS "I CANNOT READ THIS CELL" IN ITS OWN NOTATION: a dot list
// wrapped in backslash and slash, like \5/ or \456/. That is a diagnostic for
// a transcriber reading a log, and it was reaching the child as if it were
// print - the text pane showed "\5/ \456/ \5/", and Word exports carried the
// same (feedback, 2026-08-19). Every reading goes through bt(), so the notation
// is turned back into what it actually means here: one cell we cannot put a
// letter to. A question mark says that to a nine-year-old; the dots are still
// on the braille side, unaltered, for anyone who wants to look.
const LOUIS_ESCAPE = /\\\d+\//g;
const UNREADABLE = '?';

const uebHybrid = (s) => {
  const r1 = uebMathsToLatex(s);
  let r2 = null;
  try {
    r2 = uebMathsToLatexV2(s);
  } catch (e) {}

  if (r2 && (!r2.badCells || r2.badCells.length === 0)) {
    if (r2.latex === r1.latex) {
      return r2; // high confidence
    } else {
      r1.uncertain = true;
      r1.v2_latex = r2.latex;
    }
  }
  return r1;
};

const nemethHybrid = (s) => {
  if (!globalThis.NemethToLatex) return null;
  const padNemethSwitches = (str) => str.split('⠸⠩').join('  ').split('⠸⠱').join('  ');
  let r1;
  try {
    r1 = globalThis.NemethToLatex.convert(padNemethSwitches(s));
  } catch (e) {
    r1 = { latex: null, spans: [] };
  }

  let r2 = null;
  try {
    r2 = nemethMathsToLatexV2(s);
  } catch (e) {}

  if (r2 && (!r2.badCells || r2.badCells.length === 0)) {
    const normalizeLatex = (l) => l ? l.replace(/\\phantom\{\}/g, '').replace(/\s+/g, '') : '';
    const r2LatexClean = normalizeLatex(r2.latex);
    const r1LatexClean = normalizeLatex(r1.latex);
    if (r2LatexClean === r1LatexClean || r1.latex === null) {
      return r2;
    } else {
      r1.uncertain = true;
      r1.v2_latex = r2.latex;
    }
  }

  if (r1.latex === null) {
    throw new Error('Syntax Error');
  }

  return r1;
};

const SK_DOT = { KeyF: 0x01, KeyD: 0x02, KeyS: 0x04, KeyJ: 0x08, KeyK: 0x10, KeyL: 0x20 };
const cell = (dots) => String.fromCodePoint(0x2800 + (dots & 0x3f));

// ---- Nemeth detection ----
const NEM_OPEN = '⠸⠩', NEM_CLOSE = '⠸⠱';

// Nemeth cannot be reliably guessed from the cells: it shares essentially its
// whole repertoire with English braille. Its "dropped" digits ⠂⠆⠒⠲⠢⠖⠶⠦⠔⠴ are
// the ordinary comma / semicolon / colon / full stop / question mark / quotes,
// ⠹ (fraction open) is the contraction "this", ⠜ ⠻ are "ar" and "er", and the
// letters are identical. That is exactly why BANA requires the explicit
// ⠸⠩ … ⠸⠱ switch indicators.
//
// So we DON'T guess. Nemeth is used when the user ticks the box, or when the
// Pad Nemeth switches with double spaces so the string length matches the raw braille,
// preserving exact character indices for click-to-link spans.

// UEB MATHS IS MARKED OUT OF BAND, NOT IN THE CELLS (PB, 2026-08-11).
//
// The first attempt wrote the grade 1 passage indicator and its terminator into
// the document. They are real UEB signs, but they were still wrong here: UEB
// maths IS UEB, so there is no mode to switch into and nothing on the page needs
// to say there is. The braille for x+1 is the same cells whether the app reads
// it as maths or as words — so the only thing the mark changed was the app's
// own interpretation, and it did that by putting cells in the writer's braille
// that the writer never typed.
//
// Nemeth is the opposite case and keeps its signs: ⠸⠩ and ⠸⠱ genuinely belong
// on the page, because Nemeth really is a different code and a reader must be
// told where it starts.
//
// So a UEB maths run is a RANGE over buf, held here. It costs one thing worth
// stating plainly: BRF export cannot record it, because BRF has no way to say
// it — but nothing is lost from the braille itself, which is identical either
// way. eBraille can carry it in the enriched layer, which is where per-line
// modes already live.
let mathSpans = [];              // [{ from, to, closed }] — UEB only, buf coords
let prevBuf = '';

// WHERE A RUN ENDS DEPENDS ON WHETHER IT IS FINISHED. While the expression is
// still being written the run has no right-hand edge yet — its `to` tracks the
// caret, so the caret AT `to` is still inside it, or the mode would flip to
// text between two keystrokes of the same sum. Once Ctrl+M closes it, that same
// position is the far side of the run: the toggle's own words are "landing to
// the RIGHT of the run". Counting it as inside is why the Maths box stayed
// ticked after Ctrl+M for UEB maths (feedback, 2026-08-19) — the caret had
// left, and every reader of this function was told it had not.
const spanAt = (pos) => mathSpans.find((sp) =>
  pos >= sp.from && (sp.closed ? pos < sp.to : pos <= sp.to));

// Ranges must follow every edit, and edits arrive from six different places —
// typing, backspace, the field's own input handler, load, paste. Rather than
// ask each of them to remember, the shift is DERIVED from what changed: the
// common prefix and suffix of the old and new buffers give the edit point and
// its size exactly, wherever it came from.
function syncSpans() {
  if (buf === prevBuf) return;
  let p = 0;
  while (p < buf.length && p < prevBuf.length && buf[p] === prevBuf[p]) p += 1;
  let t = 0;
  while (t < buf.length - p && t < prevBuf.length - p
         && buf[buf.length - 1 - t] === prevBuf[prevBuf.length - 1 - t]) t += 1;
  const removed = prevBuf.length - p - t;
  const added = buf.length - p - t;
  const delta = added - removed;
  for (const sp of mathSpans) {
    const end = p + removed;
    // GROWTH IS TESTED FIRST, and it has to be. A run that has just been opened
    // is empty — from and to are the same index — so "insert at the end of the
    // span" and "insert before the span" describe the very same position, and
    // whichever is asked first wins. Asked the other way round the run never
    // grew: it slid along in front of the maths and swallowed the next word.
    //
    // Growth applies only while the run is OPEN. Once the writer has pressed the
    // key again and stepped out, that same position is outside it, and a word
    // typed there must not be pulled back in.
    if (p === sp.to && !sp.closed && removed === 0 && delta > 0) { sp.to += delta; }
    else if (end <= sp.from) { sp.from += delta; sp.to += delta; }
    else if (p >= sp.to) { /* wholly after the run — nothing to do */ }
    else { sp.to += delta; if (p < sp.from) sp.from = p; }
    if (sp.from < 0) sp.from = 0;
    if (sp.to < sp.from) sp.to = sp.from;
  }
  mathSpans = mathSpans.filter((sp) => sp.to > sp.from || !sp.closed);
  prevBuf = buf;
}

// ONLY NEMETH HAS A SWITCH THE APP MAY CLAIM (PB, 2026-08-11).
//
// A switch sign has to be RESERVED — it must mean "the code changes here" and
// nothing else — or reading it changes the meaning of documents that merely
// contain it. Nemeth qualifies: its opening and closing indicators mean exactly
// that and nothing else.
//
// UEB has no such sign, and the earlier build claiming one was not a small
// mistake. The candidates it used are the grade 1 passage indicator and its
// terminator, which are ordinary UEB that occurs in ordinary maths — this
// repository's own examples/ueb-maths.brf contains each of them TWICE. Reading
// them as switches cuts that file into four wrongly-moded pieces. So the table
// below holds Nemeth only, and inline UEB is carried out of band, above.
const SWITCHES = [
  { sign: NEM_OPEN, mode: 'nem' },
  { sign: NEM_CLOSE, mode: 'txt' },
];

// MODE IS A POINT IN THE DOCUMENT, NOT A PROPERTY OF A LINE (PB, 2026-08-11).
//
// Ctrl+M used to re-mode the whole line, so switching to maths halfway through
// a sentence reinterpreted the words already written. It now marks the SWITCH
// where the caret is, and this splits a line at those marks. 'base' means "no
// mark applies here" and resolves to the line's own mode, so a document with no
// switches behaves exactly as it did.
//
// The carry crosses line ends on purpose: an opened passage stays open until it
// is closed, which is how the indicators work on paper.
function segmentsOf(raw, carry, lineStart = 0) {
  // A UEB span cuts the line exactly like a Nemeth sign does, except that it
  // consumes no cells — which is the whole point of holding it out of band.
  const cuts = new Map();
  for (const sp of mathSpans) {
    const a = sp.from - lineStart, b = sp.to - lineStart;
    if (b < 0 || a > raw.length) continue;
    if (a >= 0 && a <= raw.length) cuts.set(a, { mode: 'ueb', skip: 0 });
    if (b >= 0 && b <= raw.length && b !== a) cuts.set(b, { mode: 'txt', skip: 0 });
  }
  const segs = [];
  let mode = carry, start = 0, i = 0;
  const push = (end) => { if (end > start) segs.push({ mode, text: raw.slice(start, end), from: start, to: end }); };
  while (i < raw.length) {
    const cut = cuts.get(i);
    if (cut) { push(i); mode = cut.mode; start = i; }
    const hit = SWITCHES.find((sw) => raw.startsWith(sw.sign, i));
    if (hit) { push(i); mode = hit.mode; i += hit.sign.length; start = i; continue; }
    i += 1;
  }
  const endCut = cuts.get(raw.length);
  if (endCut) { push(raw.length); mode = endCut.mode; start = raw.length; }
  push(raw.length);
  if (!segs.length) segs.push({ mode, text: '', from: 0, to: 0 });
  return { segs, carry: mode };
}

// WHICH MODE IS IN FORCE WHERE THE CARET IS. Derived by replaying the switches
// from the top of the document rather than remembered, because the caret can be
// put anywhere — by an arrow key, a click, or a braille display's routing key —
// and a remembered flag would be wrong the moment it moved.
function modeAtPos(pos) {
  if (spanAt(pos)) return 'ueb';
  let carry = 'base', offset = 0;
  for (const line of buf.slice(0, pos).split('\n')) {
    carry = segmentsOf(line, carry, offset).carry;
    offset += line.length + 1;
  }
  return carry === 'base' ? currentMode() : carry;
}
function modeAtCaret() { return modeAtPos(caret); }

// WHICH MODE WROTE THE WORD THAT JUST FINISHED. The speech paths asked the
// whole-document maths boxes, and those are OFF for a document whose maths is
// an inline UEB span - the shape Ctrl+M produces and the shape a user sent in.
// So finishing a word inside an equation spoke its LITERARY back-translation,
// "of−b±shbin2−4acing2awith'", while the pane beside it drew the formula
// perfectly: the display had been fixed and the speech had not. The word's own
// position knows what wrote it; the boxes only know what the whole document
// claims. Falls back to the boxes when the position has no opinion.
function modeOfFinished(finished) {
  if (finished) {
    const at = buf.lastIndexOf(finished, Math.max(0, caret - 1));
    if (at >= 0) {
      const m = modeAtPos(at);
      if (m === 'nem' || m === 'ueb' || m === 'mus') return m;
    }
  }
  return nemethOn() ? 'nem' : uebMathsOn() ? 'ueb' : null;
}

// THE MATHS CHECKBOX MIRRORS THE CARET (PB, 2026-08-12). It used to SET the
// mode for lines typed from now on; now it only ever REPORTS modeAtCaret(),
// called from render() (every edit) and onFieldSelection() (every caret
// move), so it is always telling the truth about where the caret actually
// is — never a stale intention left over from the last click.
function syncMathsCheckbox() {
  const at = modeAtCaret();
  $('mathsMode').checked = (at === 'ueb' || at === 'nem');
}

const hasNemethSwitch = (s) => s.includes(NEM_OPEN) || s.includes(NEM_CLOSE);
const stripNemethSwitches = (s) => s.split(NEM_OPEN).join('').split(NEM_CLOSE).join('').trim();

// ---- state ----
let buf = '';
// THE CARET IS AN INDEX INTO buf (PB, 2026-08-09). Until now input only ever
// appended, so "where the writing is" and "the end" were the same thing and
// neither needed naming. They are different now: everything that MUTATES buf
// has to say what happens to the caret, and everything that REPLACES buf has to
// reset it, or the caret ends up pointing past the text it belongs to.
let caret = 0;
const clampCaret = () => { caret = Math.max(0, Math.min(caret, buf.length)); };
let chord = 0;
const held = new Set();
// The selection a chord began over, so the finished cell can replace it — see
// the note at the chord's first keydown.
let chordSel = null;
// A CHORD CAN WEDGE (user report, 2026-08-19). A cell commits on keyup only
// when every held key has been released — so ONE lost keyup (Cmd+Tab
// mid-chord, Mission Control, the file picker or a confirm() opening while a
// key is down; Safari loses keyups readily) leaves its code in `held`
// forever, and no cell ever commits again. The app looks healthy and the
// keys look dead; only Clear, Load or toggling six-key happened to recover.
// abandonChord() is the security around that: it runs on every signal that
// the GESTURE was abandoned — the window losing focus, the tab going hidden,
// a modifier pressed mid-chord, Escape — and costs at most the one chord in
// flight. Deliberately NO timers: a child chording slowly, with motor
// difficulties, must never have a held chord snatched away mid-press.
function abandonChord() {
  if (!held.size && !chord) return;
  held.clear();
  chord = 0;
  chordSel = null;
  render();
}
window.addEventListener('blur', abandonChord);
document.addEventListener('visibilitychange', () => { if (document.hidden) abandonChord(); });
let ready = false;
let bootError = '';
// word key ("line:word") → its braille cells, so a click in either pane can be explained
const wordBraille = new Map();
// music run key ("m<line>") → its parsed model, so a clicked note can be explained
// #150: the warnings box's last render, split so an instrument change can
// recompute just the range-warning lines and redraw the box WITHOUT calling
// render() — see refreshRangeWarnings() and the instrument picker's own
// change listener, below, for why a full render() is wrong there.
let lastBaseWarnings = [];
let lastSwapHint = '';

const $ = (id) => document.getElementById(id);
const uebMathsOn = () => $('uebMaths').checked;
const nemethOn   = () => $('nemethMaths').checked;
const currentMode = () => (uebMathsOn() ? 'ueb' : nemethOn() ? 'nem' : 'text');

// THE MODE STICKS TO THE LINE, not the document. Each line remembers the mode
// it was typed under, so a child can write prose, toggle (Ctrl+I or the
// checkboxes), write an equation, and toggle back — a mixed document, rendered
// line by line with the right engine. The mode is display metadata only: the
// braille pane and saved BRF stay pure braille. The explicit Nemeth switch
// ⠸⠩…⠸⠱ inside any line still wins over the line's mode — it is unambiguous.
let lineModes = [];
// After a LOAD (or Clear), the next mode choice applies to the WHOLE
// document — the load-then-tick workflow predates per-line modes and must
// keep working. The moment the user types, modes go back to sticking to
// lines, so hand-typed mixed documents are untouched.
let modeAppliesToAll = true;
function syncLineModes(count) {
  while (lineModes.length < count) lineModes.push(currentMode());
  if (lineModes.length > count) lineModes.length = count;
  if (count) lineModes[count - 1] = currentMode();   // the line being typed follows the toggle
}

// ---- settings ----
const SKEY = 'connector.settings';
const settings = Object.assign(
  { voiceURI: '', speakWord: false, speakSentence: false,
    // DEFAULTS ON: it names what the app has always said out loud, and a new
    // setting must not change what an existing user hears. It exists so a
    // screen-reader user can switch off the reading their reader already does.
    speakCursor: true,
    mathsCode: 'nem', showAscii: false, sixKey: true, speakLetter: false,
    brailleCode: 'en-ueb-g2', focusDark: false, speechOutput: 'voice',
    statusScale: 1 },
  // NEVER TRUST THE STORE (2026-08-19). This parse runs at module evaluation,
  // so a corrupt value — a write cut short by a crash, a school's disk full,
  // an extension misbehaving — used to throw HERE and kill the entire module:
  // the page rendered, every handler was dead, and it stayed dead on every
  // later launch until someone cleared the browser's storage by hand.
  // Measured before the guard: SyntaxError at this line, chord produces
  // nothing, no message anywhere. Corrupt settings now mean DEFAULT settings,
  // and the store is rewritten clean at the next save.
  (() => { try { return JSON.parse(localStorage.getItem(SKEY) || '{}'); }
           catch { console.warn('[translate] settings were corrupt; using defaults'); return {}; } })()
);
const saveSettings = () => localStorage.setItem(SKEY, JSON.stringify(settings));


// ---- speech ----
const speechOk = typeof globalThis.speechSynthesis !== 'undefined'
              && typeof globalThis.SpeechSynthesisUtterance !== 'undefined';
let voices = [];

// WHICH VOICES TO OFFER (PB, 2026-08-09). A machine may carry sixty voices in
// thirty languages; a child needs the handful that can read their own words.
// So the list is the CURRENT LANGUAGE — any English locale offers every English
// voice, not just the exact regional match — plus a second language where the
// country makes one genuinely likely:
//   United States  →  English, then Spanish
//   Canada         →  English, then French
// Anything else stays one keystroke away behind "… more voices", which appends
// the rest rather than replacing the list, so nothing is ever unreachable.
const PAIRED = { US: 'es', CA: 'fr' };
// Same countries, stated separately: a change to one list should not
// silently change the other.
const PAIRED_BRAILLE = { US: 'es', CA: 'fr' };

// macOS ships a handful of NOVELTY voices alongside its ordinary ones —
// Albert, Zarvox and friends — that read badly for a child following text
// and would otherwise crowd out the real voices in the picker. Names here
// are lower-cased leading word(s); a real voice's name often carries a
// suffix, e.g. "Albert (English (US))", so matching is prefix-at-a-word-
// boundary, not equality.
const NOVELTY_VOICES = new Set([
  'albert', 'bad news', 'bahh', 'bells', 'boing', 'bubbles', 'cellos',
  'deranged', 'fred', 'good news', 'hysterical', 'jester', 'junior', 'kathy',
  'organ', 'pipe organ', 'ralph', 'superstar', 'trinoids', 'whisper',
  'wobble', 'zarvox',
]);
function isNoveltyVoice(v) {
  const name = (v.name || '').toLowerCase();
  for (const n of NOVELTY_VOICES) {
    // The character right after the matched prefix must not continue a word
    // (undefined at an exact-length match is fine too), or "albertine" would
    // wrongly match "albert".
    if (name.startsWith(n) && !/[a-z0-9]/.test(name[n.length] || '')) return true;
  }
  return false;
}

let voicesExpanded = false;
// NOVELTY VOICES GET THEIR OWN ESCAPE HATCH (PB, 2026-08-19), separate from
// the ordinary "… more voices" one. They used to fall into `rest` along with
// merely-wrong-locale voices, so a curious click on "more voices" dropped a
// child straight into Zarvox and Whisper. Now `rest` is ordinary voices only
// and `novelty` is its own bucket, each behind its own flag, so a user can
// reach either — or both — independently.
let noveltyExpanded = false;

function relevantVoices(all) {
  const loc = (navigator.language || 'en').split('-');
  const lang = (loc[0] || 'en').toLowerCase();
  const region = (loc[1] || '').toUpperCase();
  const also = PAIRED[region];
  const rank = (v) => {
    const vl = (v.lang || '').split(/[-_]/)[0].toLowerCase();
    if (vl === lang) return 0;
    if (also && vl === also) return 1;
    return 2;
  };
  // Novelty voices are split off FIRST, whatever their rank, into their own
  // bucket — never `keep`, never `rest`. `ordinary` is everything else, which
  // locale-ranking then splits exactly as before.
  const novelty = all.filter(isNoveltyVoice);
  const ordinary = all.filter((v) => !isNoveltyVoice(v));
  const isKept = (v) => rank(v) < 2;
  const keep = ordinary.filter(isKept);
  // If the locale matches nothing installed, showing an EMPTY picker would be
  // worse than showing everything — so fall back to the full ORDINARY list
  // rather than leaving a child with no voice at all. Novelty voices stay
  // behind their own hatch even then: `keep`+`rest`+`novelty` partitions
  // `all` exactly once each, fallback or not.
  return { keep: keep.length ? keep : ordinary,
           rest: keep.length ? ordinary.filter((v) => !isKept(v)) : [],
           novelty,
           sort: (a, b) => rank(a) - rank(b) || a.name.localeCompare(b.name) };
}

// The SAME shape as the voice picker, deliberately: current language, the
// country's likely second, then everything else behind "… more". A user who has
// learned one of these lists has learned both.
let codesExpanded = false;

function loadBrailleCodes() {
  const sel = $('brailleCodeSel');
  if (!sel) return;
  const loc = (navigator.language || 'en').split('-');
  const lang = (loc[0] || 'en').toLowerCase();
  const also = PAIRED_BRAILLE[(loc[1] || '').toUpperCase()];
  const rank = (c) => (c.lang === lang ? 0 : (also && c.lang === also) ? 1 : 2);

  const near = CODES.filter((c) => rank(c) < 2);
  // THE CODE IN USE IS ALWAYS AN OPTION (2026-08-19). The collapsed list holds
  // only the locale's codes, so a chosen code from behind "… more" was absent
  // from it: the picker came up BLANK on the next launch, showing no code at
  // all while the app translated with one. (And the value-restore below reads
  // as falsy on a blank select, which is one step from silently re-pointing the
  // preference at the first code in the list.) Whatever is in use is included.
  const inUse = CODES.find((c) => c.id === settings.brailleCode);
  const base = codesExpanded || !near.length ? CODES
             : (inUse && !near.includes(inUse) ? [...near, inUse] : near);
  const shownCodes = base.slice().sort((a, b) => rank(a) - rank(b));
  const rest = CODES.length - shownCodes.length;

  sel.innerHTML = '';
  for (const c of shownCodes) {
    // A code whose table is not precached needs the network the first time.
    // Saying so in the option beats a translation that silently stops working
    // on a train.
    const label = codeLabel(c);
    sel.appendChild(new Option(c.shipped ? label : `${label} (needs internet first time)`, c.id));
  }
  if (!codesExpanded && rest > 0) sel.appendChild(new Option(`… more codes (${rest})`, '__more__'));
  sel.value = settings.brailleCode;
  // Heal to the DEFAULT (which the in-use logic above guarantees is an
  // option), and SAVE — healing only the session left the garbage in storage
  // to re-trip every later launch.
  if (!sel.value) {
    const bad = settings.brailleCode;
    settings.brailleCode = DEFAULT_CODE;
    saveSettings();
    // Says what happened: a healed setting that changes which code the child
    // is writing in must not change it silently. (This guard, not the boot
    // check, is the one that actually fires — it runs at UI setup, first.)
    const sb = $('statusBar');
    if (sb) sb.innerHTML = `<span class="sb-hint">${escMsg(`The saved braille code (${bad}) is not recognised, so English grade 2 is being used.`)}</span>`;
    // Rebuild rather than assign: the option list above was computed from the
    // OLD id, and on a non-English locale the default is not in the collapsed
    // list until the in-use logic re-runs with the healed setting. One level
    // of recursion, terminating because the default certainly exists.
    loadBrailleCodes();
  }
}

function loadVoices() {
  if (!speechOk) return;
  voices = speechSynthesis.getVoices() || [];
  const sel = $('voiceSel');
  sel.innerHTML = '';
  if (!voices.length) {
    sel.appendChild(new Option('(no voices available)', ''));
    return;
  }
  const { keep, rest, novelty, sort } = relevantVoices(voices);
  // Each hatch adds its own bucket independently — expanding one must never
  // hide or reveal the other, so "both expanded" has to equal `voices`
  // exactly (checked live, see the commit message).
  const shown = keep.slice();
  if (voicesExpanded) shown.push(...rest);
  if (noveltyExpanded) shown.push(...novelty);
  const shownVoices = shown.sort(sort);
  shownVoices.forEach((v) => {
    const o = new Option(`${v.name} - ${v.lang}${v.default ? ' (default)' : ''}`, v.voiceURI);
    sel.appendChild(o);
  });
  // Each escape hatch only appears when there is something behind IT, and
  // stays offered even after the OTHER one is expanded.
  if (!voicesExpanded && rest.length) {
    sel.appendChild(new Option(`… more voices (${rest.length})`, '__more__'));
  }
  if (!noveltyExpanded && novelty.length) {
    sel.appendChild(new Option(`… novelty voices (${novelty.length})`, '__novelty__'));
  }
  if (settings.voiceURI && voices.some((v) => v.voiceURI === settings.voiceURI)) {
    sel.value = settings.voiceURI;
  } else {
    const def = voices.find((v) => v.default) || voices.find((v) => /^en/i.test(v.lang)) || voices[0];
    if (def) { sel.value = def.voiceURI; settings.voiceURI = def.voiceURI; }
  }
}

// Stop any speech immediately (barge-in): the moment the user starts brailling
// again, whatever is being spoken is cut off.
// SPEECH HAS TO BE RATIONED, NOT FIRED AT WILL (PB, 2026-08-11).
//
// PB: Chrome's speech works for a while, then dies until the browser is
// restarted. Measured while typing four cells and a space: 16 cancel() calls
// for 5 utterances, five of them inside the SAME MILLISECOND, every speak()
// sandwiched between a cancel and a resume in one tick. Thirty-one call sites
// each spoke directly, and each speak() cancelled whatever came before, so a
// single keystroke could fire the letter, the finished word and the sentence,
// three cancels and three speaks, in a few microseconds.
//
// Chrome does not survive that. The documented failure (crbug 374263394, and
// the Chrome 130 reports) is exactly what PB describes: speechSynthesis.speaking
// stays true while pending and paused are false, nothing starts, nothing errors,
// and only a restart clears it.
//
// Four things are done about it here, each answering a documented fault:
//
//  1. ONE REQUEST AT A TIME. Every call supersedes the last through a sequence
//     number rather than by cancelling it. Requests that never got to speak just
//     stop being relevant — no cancel is issued for them at all.
//  2. A GAP BETWEEN CANCEL AND SPEAK. Cancelling and speaking in the same tick
//     is the documented race; the utterance is queued a beat later instead, and
//     cancel is only called when something is actually speaking or pending.
//  3. THE UTTERANCE IS HELD. Chrome may garbage-collect an utterance while it is
//     still playing, taking its onend/onerror with it, which leaves this code
//     believing speech is still in flight for ever.
//  4. A STALL IS NOTICED AND RECOVERED. If nothing has started shortly after
//     speak(), the engine is wedged: clear it and try once more, once. That is
//     the difference between one lost phrase and a dead voice until restart.
//
// The keepalive is separate: Chrome cuts remote voices off around 15 seconds
// (crbug 41346274) unless resume() is called periodically. It runs only while
// speech is actually in progress, and stops the moment it ends — the old code
// called resume() once per utterance, which does nothing for a long one and
// adds another API call to the storm for a short one.
const SPEAK_START_DELAY = 40;      // ms; keeps cancel and speak out of one tick
const SPEAK_STALL_CHECK = 400;     // ms; nothing started by now means wedged
const SPEAK_KEEPALIVE = 10000;     // ms; under Chrome's ~15s cut-off
let speechSeq = 0;                 // the only request that still matters
let speechTimer = null;
let speechKeepAlive = null;
let heldUtterance = null;          // see (3): held against garbage collection

function clearSpeechTimers() {
  if (speechTimer) { clearTimeout(speechTimer); speechTimer = null; }
  if (speechKeepAlive) { clearInterval(speechKeepAlive); speechKeepAlive = null; }
}

// A WORD OF PURE LETTERS IS A WORD, not an expression (PB, 2026-08-19). The
// maths describers supply the test rather than a guess: their entries for
// plain letters come from the ALPHABET table and are single alphabetic names,
// while every real sign and every dropped digit carries something else. Used
// by BOTH the click explanation and the word speech, so the two cannot drift —
// they disagreed before, and typing "cat" in maths mode spoke "c a t".
function justLetters(parts) {
  return !!(parts && parts.length
    && parts.every((p) => /^[a-z]$/i.test(String(p.name || ''))));
}

// ---- a contraction was available and was not used ----
// PB, 2026-08-19: on Space in grade 2, a small ding when the word could have
// been contracted and was not. This is a NUDGE, never a correction: liblouis
// gives ONE valid spelling, and braille has legitimate alternatives — proper
// names, contractions that may not bridge a syllable boundary, forms the rules
// forbid in context — so a shorter available spelling does not make the
// child's writing wrong. It earns a sound, not a message, and never a mark.
//
// GRADE-AGNOSTIC BY CONSTRUCTION. The test asks the CURRENT code's own table
// to re-translate what the child wrote and compares cell counts. Under an
// uncontracted code that round trip is the identity, so the count can never
// come out shorter and the ding cannot fire — no need to ask which grade is
// selected, and it stays correct for any of the 142 codes.
// Returns the shorter spelling if one exists, '' otherwise — the cells
// themselves, so the status bar can SHOW the child what was available rather
// than merely asserting that something was.
//
// Memoised: this is asked once per word per render, and a render happens on
// every cell typed. Two liblouis round trips per word per keystroke would be
// felt on a long document. The cache is keyed by the cells alone and cleared
// when the braille code changes, since the code is what decides which
// contractions exist at all.
const missedCache = new Map();
// Returns null, or WHERE the contraction applies:
//   cells  the shorter spelling, to show in the bar
//   t0,t1  the range within the TYPED cells that could be replaced
//   c0,c1  the same span expressed in the PRINT letters
//
// Only the affected part is wanted, not the whole word (PB, 2026-08-19): in
// "brother" written out in full it is the middle three cells that could become
// ⠮, and underlining the whole word would point at the wrong thing.
//
// The range comes from a prefix/suffix diff between what was typed and what
// the code would have written — the same shape of comparison syncField uses to
// find an edit. Carrying that range across to the print letters is liblouis's
// own work: translatePos reports, for each output cell, the input character it
// came from, so the first differing cell names the first affected letter.
function missedInfo(brailleWord) {
  if (!ready || !brailleWord || !brailleWord.trim()) return null;
  const hit = missedCache.get(brailleWord);
  if (hit !== undefined) return hit;
  let info = null;
  const text = bt(brailleWord);
  // A word we could not fully read has no advice to offer: part of it has no
  // letters at all, so "you could have written this in fewer cells" would be
  // measuring against something we do not actually understand.
  if (text && !text.includes(UNREADABLE) && /[a-z]/i.test(text)) {
    try {
      const res = louis.translatePos(text, T_TEXT());
      const forward = res && res.braille ? res.braille.replace(/\s/g, '') : '';
      const typed = [...brailleWord], fwd = [...forward];
      if (fwd.length && fwd.length < typed.length) {
        let p = 0;
        while (p < fwd.length && p < typed.length && fwd[p] === typed[p]) p++;
        let sfx = 0;
        while (sfx < fwd.length - p && sfx < typed.length - p
               && fwd[fwd.length - 1 - sfx] === typed[typed.length - 1 - sfx]) sfx++;
        const f0 = p, f1 = fwd.length - sfx;
        const pos = res.inputPos || [];
        const c0 = pos[f0] !== undefined ? pos[f0] : 0;
        const c1 = f1 < pos.length && pos[f1] !== undefined ? pos[f1] : text.length;
        info = { cells: forward, t0: p, t1: typed.length - sfx,
                 c0: Math.min(c0, text.length), c1: Math.min(Math.max(c1, c0 + 1), text.length) };
      }
    } catch { /* an untranslatable word simply has no advice to give */ }
  }
  missedCache.set(brailleWord, info);
  return info;
}
const contractionFor = (w) => (missedInfo(w) || {}).cells || '';
const missedContraction = (w) => !!contractionFor(w);

// A short, quiet two-tone ding. Built from an oscillator rather than an audio
// file so it costs nothing to cache and cannot fail offline. Deliberately soft
// and brief: it sits under the word speech that follows it, and a child who
// mis-hears it has lost nothing.
let dingCtx = null;
function ding() {
  if (settings.speechOutput === 'off') return;   // "off" means the app is silent
  try {
    dingCtx = dingCtx || new (globalThis.AudioContext || globalThis.webkitAudioContext)();
    if (dingCtx.state === 'suspended') dingCtx.resume();
    const t = dingCtx.currentTime;
    const gain = dingCtx.createGain();
    gain.gain.setValueAtTime(0.0001, t);
    gain.gain.exponentialRampToValueAtTime(0.06, t + 0.012);
    gain.gain.exponentialRampToValueAtTime(0.0001, t + 0.22);
    gain.connect(dingCtx.destination);
    const osc = dingCtx.createOscillator();
    osc.type = 'sine';
    osc.frequency.setValueAtTime(880, t);
    osc.frequency.setValueAtTime(1174, t + 0.09);   // a small rise, not an alarm
    osc.connect(gain);
    osc.start(t);
    osc.stop(t + 0.24);
  } catch { /* audio is a courtesy; never let it break typing */ }
}

function stopSpeech() {
  if (!speechOk) return;
  speechSeq += 1;                  // anything in flight is now irrelevant
  clearSpeechTimers();
  heldUtterance = null;
  // CANCEL ONLY IF THERE IS SOMETHING TO CANCEL. This is called on EVERY braille
  // keydown — "any braille key interrupts speech" — so a six-dot chord asked the
  // engine to cancel six times before a single word had been spoken, and a
  // sentence of chords fired dozens. That is the storm that wedges Chrome, and
  // no amount of care inside speak() could have fixed it, because most of the
  // calls never came from speak() at all.
  //
  // Clearing the sequence number and the timers above is enough on its own to
  // stop a pending phrase: it is local bookkeeping and costs the engine nothing.
  // The API is only touched when the engine really is busy.
  if (speechSynthesis.speaking || speechSynthesis.pending) {
    try { speechSynthesis.cancel(); } catch { /* */ }
  }
}

// WHAT TO CALL A SINGLE CELL. Back-translate it on its own: in grade 1 that is
// the letter the child meant. When it yields nothing sayable — a contraction
// out of context, a capital or number prefix, a sign — fall back to the DOT
// NUMBERS, which are always true of the cell and are how a braille teacher
// names it aloud anyway. Never say the raw Unicode character: a speech engine
// reads it as "braille pattern dots one four", or as nothing at all.
// NAME THE CELL BY WHAT IT SPELLS, NOT BY ITS DOTS (PB, 2026-08-19: "dots 3
// and 4 are going to be ST almost everywhere, so can we say S T rather than
// the dots?"). Dot numbers are a last resort — true, but they leave the child
// to do the lookup the app could have done.
//
// A cell has TWO possible readings and only one of them is safe to say while
// typing. Standing alone many cells are WORDSIGNS — ⠌ alone is "still", ⠡ is
// "child", ⠩ is "shall" — and that is precisely the expansion a writer has not
// committed to yet. As a GROUPSIGN inside a word the same cell is fixed: ⠌ is
// "st" wherever it appears. So the question is asked in a context that forces
// the groupsign reading — the cell placed between two letters, the letters
// then stripped — which is the engine's own answer rather than a table this
// app would have to maintain per code. Measured across the UEB contractions:
// ⠌ st, ⠡ ch, ⠩ sh, ⠻ er, ⠪ ow, ⠜ ar, ⠫ ed, ⠳ ou, ⠬ ing, ⠮ the, ⠾ with,
// while ⠭ correctly stays the letter x.
//
// EVERY groupsign is SPELLED — "s t", "i n g", "t h e" (PB, 2026-08-19, having
// typed "thing": the th was right but the ing, spoken as a word, was not).
// Spelling is what makes it a report about CELLS rather than about meaning: a
// spoken "ing" is easily heard as part of the text being written, and a spoken
// "the" is indistinguishable from the word the child may or may not have meant.
// Letters cannot be mistaken for either. It is also one rule instead of two,
// which is one less thing for a learner to notice.
const cellNameCache = new Map();
function describeCell(ch) {
  if (ch === ' ' || ch === '⠀') return 'space';
  if (ch === '\n') return 'new line';
  const key = ch + '|' + settings.brailleCode;
  const hit = cellNameCache.get(key);
  if (hit !== undefined) return hit;
  let out = '';
  try {
    const t = louis.backTranslate(ch, T_UEB_G1);
    if (t && /^[A-Za-z0-9]$/.test(t.trim())) out = t.trim();
  } catch { /* fall through */ }
  if (!out) {
    try {
      // ⠁ is the wrapper; if it does not come back as "a" the code does not
      // work that way and the answer is discarded rather than guessed at.
      const whole = louis.backTranslate('⠁' + ch + '⠁', T_TEXT()).trim();
      if (whole.length > 2 && whole.startsWith('a') && whole.endsWith('a')) {
        const mid = whole.slice(1, -1);
        if (/^[a-z]{1,5}$/i.test(mid)) out = [...mid].join(' ');
      }
    } catch { /* fall through */ }
  }
  if (!out && PUNCT_NAMES.has(ch)) out = PUNCT_NAMES.get(ch);
  if (!out) {
    const code = ch.codePointAt(0) - 0x2800;
    const dots = [1, 2, 3, 4, 5, 6, 7, 8].filter((d) => code & (1 << (d - 1)));
    out = dots.length ? 'dots ' + dots.join(' ') : 'blank';
  }
  cellNameCache.set(key, out);
  return out;
}

// SPEECH ROUTER (PB, 2026-08-12). Every app utterance already flows through
// this one function, which is what makes it the single place to decide WHICH
// channel hears it, per settings.speechOutput:
//   'off'    - silence. Returns before anything below runs, including the
//              cancel/keepalive/sequence machinery below - a display with
//              app speech turned off must never be interrupted by it either.
//              This is also the fix for delete being announced with app
//              speech "off": there was no such setting before, so nothing
//              gated it - now everything, delete included, is gated here.
//   'reader' - hand the text to the user's OWN screen reader instead, via
//              #announce (aria-live="polite", role="status"). textContent is
//              REPLACED, never appended - a same-value assignment still tears
//              down and rebuilds the text node, which is what makes a
//              repeated identical announcement retrigger. speechSynthesis is
//              never touched: no cancel, no utterance, no keepalive timer.
//   'voice'  - the app's own speech, exactly as before this setting existed.
//
// Cancel first so a new utterance can never overlap the previous one.
function speak(text) {
  if (settings.speechOutput === 'off') return;
  if (settings.speechOutput === 'reader') {
    if (text && text.trim()) $('announce').textContent = text;
    return;
  }
  if (!speechOk || !text || !text.trim()) return;
  const mine = ++speechSeq;
  // A BURST COSTS ONE CANCEL, NOT ONE EACH. A keystroke can ask for the letter,
  // then the finished word, then the sentence, within a few microseconds. If a
  // request is already waiting to start, nothing has been handed to the engine
  // yet, so this one simply replaces it — no second cancel, no second timer.
  // Measured while typing four cells: four cancels inside two milliseconds
  // became one.
  const alreadyWaiting = !!speechTimer;
  clearSpeechTimers();
  // Only cancel if there is something to cancel. A request that has not started
  // is dropped by the sequence number instead.
  if (!alreadyWaiting && (speechSynthesis.speaking || speechSynthesis.pending)) {
    try { speechSynthesis.cancel(); } catch { /* */ }
  }
  speechTimer = setTimeout(() => {
    speechTimer = null;
    if (mine !== speechSeq) return;            // superseded while waiting
    startUtterance(text, mine, true);
  }, SPEAK_START_DELAY);
}

function startUtterance(text, mine, mayRetry) {
  const u = new SpeechSynthesisUtterance(text);
  const v = voices.find((x) => x.voiceURI === settings.voiceURI);
  if (v) { u.voice = v; u.lang = v.lang; }

  let started = false;
  u.onstart = () => {
    started = true;
    if (speechKeepAlive) clearInterval(speechKeepAlive);
    speechKeepAlive = setInterval(() => {
      if (mine !== speechSeq || !speechSynthesis.speaking) {
        clearInterval(speechKeepAlive); speechKeepAlive = null; return;
      }
      try { speechSynthesis.resume(); } catch { /* */ }
    }, SPEAK_KEEPALIVE);
  };
  const finished = () => {
    if (speechKeepAlive) { clearInterval(speechKeepAlive); speechKeepAlive = null; }
    if (heldUtterance === u) heldUtterance = null;
  };
  u.onend = finished;
  u.onerror = finished;               // a superseded utterance reports 'canceled'

  heldUtterance = u;
  try { speechSynthesis.speak(u); } catch { return; }

  if (!mayRetry) return;
  setTimeout(() => {
    if (mine !== speechSeq || started) return;
    // Nothing started: the engine is wedged in the documented way. Clear it and
    // make ONE more attempt — retrying for ever would be the storm again.
    try { speechSynthesis.cancel(); } catch { /* */ }
    setTimeout(() => { if (mine === speechSeq) startUtterance(text, mine, false); }, SPEAK_START_DELAY);
  }, SPEAK_STALL_CHECK);
}

// The sentence that has just been completed (last chunk ending in . ? !).
function lastSentence(text) {
  const t = text.replace(/\s+/g, ' ').trim();
  if (!t) return '';
  const parts = t.match(/[^.!?]+[.!?]["')\]]*/g);
  return parts && parts.length ? parts[parts.length - 1].trim() : t;
}
const endsSentence = (s) => /[.!?]["')\]]*$/.test(s.trim());

// ---- translation helpers ----
const bt = (brailleWord) => {
  if (!ready || !brailleWord.trim()) return '';
  try { return louis.backTranslate(brailleWord, T_TEXT()).replace(LOUIS_ESCAPE, UNREADABLE).trim(); }
  catch { return ''; }
};

// Split the buffer into lines of words, marking the word still being brailled.
function model(src) {
  let carry = 'base', offset = 0;
  return src.split('\n').map((line, i, arr) => {
    const isLast = i === arr.length - 1;
    const toks = line.split(' ');
    // A trailing non-empty token on the final line is still being brailled.
    let pending = '';
    if (isLast && toks.length && toks[toks.length - 1] !== '') pending = toks.pop();
    const seg = segmentsOf(line, carry, offset);
    carry = seg.carry;
    offset += line.length + 1;                 // +1 for the newline that split ate
    return { words: toks.filter((t) => t !== ''), pending, raw: line, segs: seg.segs };
  });
}

// Plain text of every completed word (used for sentence assembly).
function allText(lines) {
  return lines.map((l) => l.words.map(bt).join(' ')).join('\n');
}

// ---- rendering ----
// The braille pane can DRAW its cells as ASCII (PB, 2026-08-09) — the same
// cells, shown the way a BRF file spells them. Only the drawing changes: the
// buffer, the word keys, the click-to-explain and everything downstream still
// hold braille, so nothing else in the app needs to know about this setting.
const shown = (cells) => settings.showAscii ? unicodeBrailleToBrf(cells) : cells;

function wordSpan(text, key, cls, brl) {
  const s = document.createElement('span');
  s.className = cls;
  if (key) s.dataset.w = key;
  const shownText = shown(text);
  // A CONTRACTION WAS THERE AND WAS NOT USED (PB, 2026-08-19): mark only the
  // part it would have replaced. UNDERLINE ONLY — it is painted rather than
  // measured, so it cannot move a glyph and cannot disturb the braille pane's
  // alignment with the transparent field above it, the constraint that rules
  // out padding, borders and display changes here. Splitting the text into
  // spans is safe for the same reason: under word-break:break-all a break may
  // fall anywhere already, so the break opportunities do not change.
  // CONTRACTIONS ARE A TEXT IDEA, so the underline is opt-in: a caller passes
  // the cells only for a word it knows is prose. Maths cells passed here got
  // measured against the literary table and a whole equation came back
  // underlined as "you could have contracted this" (feedback, 2026-08-19) -
  // advice that means nothing about a fraction.
  const info = brl ? missedInfo(brl) : null;
  if (info) {
    // The braille pane is handed the CELLS as its text (text === brl), the
    // print pane the letters; each needs its own end of the mapping.
    const [from, to] = (text === brl) ? [info.t0, info.t1] : [info.c0, info.c1];
    const chars = [...shownText];
    if (from < to && to <= chars.length) {
      const mid = document.createElement('span');
      mid.className = 'missed';
      mid.textContent = chars.slice(from, to).join('');
      if (from) s.appendChild(document.createTextNode(chars.slice(0, from).join('')));
      s.appendChild(mid);
      if (to < chars.length) s.appendChild(document.createTextNode(chars.slice(to).join('')));
      return s;
    }
  }
  s.textContent = shownText;
  return s;
}

// DRAW A BRAILLE LINE FROM THE PARSER'S WORD GROUPS.
//
// The groups are a PROVENANCE map ordered by LaTeX position — each LaTeX
// fragment paired with the cells that produced it — and NOT a tiling of the
// cells. Where a construct encloses a leaf, its cell range CONTAINS the leaf's:
// a superscript's opening and baseline indicators genuinely belong to the whole
// construct, so "a" is cells 3..4 while "a squared" is cells 3..7.
//
// Drawing every group in full therefore drew the enclosed cells TWICE and put
// braille on screen that the document does not contain — the worst kind of
// fault this app can have, since a child cannot see that it happened. It also
// shifted every position after it, which is why clicks landed on the wrong cell
// and got worse along a line.
//
// CLAMPING each group's start to what has already been drawn emits every cell
// exactly once. It is lossless: measured across the Nemeth example the overlaps
// are 11 nested, 0 partial, 0 gaps, and even a partial overlap would only
// attribute the shared cells to the earlier group rather than lose them. The
// KEY keeps the group's own range, so the bw-<line>-<c0>-<c1> match into the
// maths pane is untouched.
function drawGroupedLine(bLine, i, text, wordGroups, raw) {
  bLine.innerHTML = '';
  // `text` is the TRIMMED line. The trimmed whitespace is still part of the
  // document, so it is drawn back around the groups — otherwise an indented or
  // trailing-space line can never match the buffer.
  const lead = raw.slice(0, raw.length - raw.trimStart().length);
  const tail = raw.slice(raw.trimEnd().length);
  // Gaps go through shown() exactly as words do, or ASCII display mode would
  // draw the words as BRF and the spaces between them as Unicode braille.
  // THE TINT IS A BACKGROUND ON AN INLINE WRAPPER, and it has to be: this pane
   // sits under a transparent textarea whose caret must stay between the right
   // cells, so anything with padding, a border or a display change is ruled out
   // (the same constraint the missed-contraction underline works within). An
   // inline span with only a background paints without moving a glyph.
  const run = document.createElement('span');
  run.className = 'brl-maths';
  const gap = (t) => { if (t) run.appendChild(document.createTextNode(shown(t))); };

  if (lead) bLine.appendChild(document.createTextNode(shown(lead)));
  bLine.appendChild(run);
  let lastEnd = 0;
  for (const g of wordGroups) {
    const from = Math.max(g.c0, lastEnd);
    if (from >= g.c1) continue;                       // wholly inside an earlier group
    if (g.c0 > lastEnd) gap(text.slice(lastEnd, g.c0));
    // No cells handed over: this line IS maths (see wordSpan).
    run.appendChild(wordSpan(text.slice(from, g.c1), `${i}:${g.c0}:${g.c1}`, 'word'));
    lastEnd = g.c1;
  }
  if (lastEnd < text.length) gap(text.slice(lastEnd));
  gap(tail);
  // The word still being typed is NOT appended here. It is already inside
  // `text` — which is the whole line trimmed — and appending it again drew it
  // twice on every keystroke: one cell typed showed as two, three showed as six.
}

function render() {
  syncSpans();
  const src = buf + (chord ? cell(chord) : '');
  const lines = model(src);
  syncLineModes(lines.length);
  const baseModeOf = (i) => lineModes[i] || currentMode();
  // 'base' means no switch mark is in force here, so the line's own mode wins —
  // which is what keeps a document without a single switch rendering exactly as
  // it always did.
  const resolveMode = (m, i) => (m === 'base' ? baseModeOf(i) : m);
  const modeOf = (i) => {
    const ln = lines[i];
    if (!ln || !ln.segs || !ln.segs.length) return baseModeOf(i);
    return resolveMode(ln.segs[0].mode, i);
  };
  const ueb = uebMathsOn(), nem = nemethOn();
  const bEl = $('braille'), out = $('out'), warnEl = $('warn');
  bEl.textContent = ''; out.textContent = '';
  wordBraille.clear();
  $('outHead').textContent = ueb ? 'Maths — UEB' : nem ? 'Maths — Nemeth' : 'Text';
  const warnings = [];

  if (bootError) { out.textContent = '⚠ ' + bootError; warnEl.hidden = true; return; }

  // ROW-PER-LINE MATRICES (GTM 15 / Nemeth §9c): on a brailler a child writes
  // one enlarged-bracket row per line, the same row syntax the parsers already
  // chain when rows sit side by side. Two or more consecutive FINISHED lines
  // that are each exactly one row coalesce into a single matrix in the maths
  // pane; the braille pane keeps them line-by-line exactly as typed. The line
  // still being typed never joins a group, so nothing jumps mid-word.
  const rowRe = ueb ? /^⠠[⠐⠨⠸][⠣⠳].*⠠[⠐⠨⠸][⠜⠳]$/u : /^⠠⠷.*⠠⠾$/u;
  const groups = new Map(); const skipIdx = new Set();
  // LINE CONTINUATION (GTM 1.4.3 / Nemeth §12): a finished line ending with
  // the continuation mark - ⠐ in UEB, or ⠤ with the next line resuming ⠼ in
  // Nemeth - JOINS the next finished line in the maths pane. The braille
  // pane keeps the lines exactly as typed, like the matrix coalescer.
  {
    for (let i = 0; i + 1 < lines.length; i++) {
      if (skipIdx.has(i) || lines[i].pending || modeOf(i) === 'text') continue;
      let joined = groups.get(i) || lines[i].raw.trim();
      let j = i + 1;
      while (j < lines.length && !lines[j].pending && modeOf(j) === modeOf(i)) {
        const nxt = lines[j].raw.trim();
        const cont = modeOf(i) === 'ueb'
          ? (joined.endsWith('⠐') && !joined.endsWith('⠐⠐') && nxt)
          : (joined.endsWith('⠤') && nxt.startsWith('⠼'));
        if (!cont) break;
        joined = ueb ? joined.slice(0, -1) + nxt : joined.slice(0, -1) + nxt.slice(1);
        skipIdx.add(j);
        j++;
      }
      if (j > i + 1) groups.set(i, joined);
    }
  }
  {
    const rowOf = (k) => {
      const l = lines[k];
      if (!l || l.pending || modeOf(k) === 'text') return null;
      const t = l.raw.trim();
      const re = modeOf(k) === 'ueb' ? /^⠠[⠐⠨⠸][⠣⠳].*⠠[⠐⠨⠸][⠜⠳]$/u : /^⠠⠷.*⠠⠾$/u;
      return re.test(t) ? t : null;
    };
    for (let i = 0; i < lines.length; ) {
      if (rowOf(i) !== null) {
        let j = i + 1;
        while (rowOf(j) !== null && modeOf(j) === modeOf(i)) j++;
        if (j - i >= 2) {
          groups.set(i, lines.slice(i, j).map((_, k) => rowOf(i + k)).join(''));
          for (let k = i + 1; k < j; k++) skipIdx.add(k);
        }
        i = j;
      } else i++;
    }
  }

  {
    // CONSECUTIVE MUSIC LINES ARE ONE PIECE: braille music is written over
    // several lines (a heading, then body lines); the reader re-joins them
    // and the stave renders on the run's first line.
    for (let i = 0; i < lines.length; ) {
      if (!skipIdx.has(i) && !lines[i].pending && modeOf(i) === 'mus' && lines[i].raw.trim()) {
        let j = i + 1;
        while (j < lines.length && !lines[j].pending && !skipIdx.has(j)
               && modeOf(j) === 'mus' && lines[j].raw.trim()) j++;
        if (j - i >= 2) {
          groups.set(i, lines.slice(i, j).map((l) => l.raw).join('\n'));
          for (let k = i + 1; k < j; k++) skipIdx.add(k);
        }
        i = j;
      } else i++;
    }
  }

  // Parse each music run once: the BRAILLE pane needs the note↔cell map to
  // draw clickable spans, and the music pane needs the same model to engrave.

  lines.forEach((ln, i) => {
    // --- left pane: braille, word by word ---
    const bLine = document.createElement('div');
    bLine.className = 'line';
    if ((ln.segs || []).length > 1) {
      // MIXED LINE: the same word keys as the text pane builds, so clicking a
      // word in either pane still lights its partner. The switch signs
      // themselves are drawn but are not words — they are apparatus.
      let lastEnd = 0;
      ln.segs.forEach((sg, si) => {
        if (sg.from > lastEnd) {
          const mark = document.createElement('span');
          mark.className = 'switch-sign';
          mark.textContent = shown(ln.raw.slice(lastEnd, sg.from));
          bLine.appendChild(mark);
        }
        // A space goes BETWEEN tokens, never after each one. Appending after
        // every token added a space the segment did not have — once per segment,
        // so a mixed line drew two cells more than the document held. The index
        // `wi` still counts split() positions, empties included, because the text
        // pane mints the matching key the same way.
        const toks = sg.text.split(' ');
        // The segment says whether these cells are prose or maths, and only
        // prose gets the contraction underline. Maths also gets the tint, in a
        // wrapper so the spaces INSIDE the run are tinted too - tinting only
        // the words would draw the run as stripes.
        const prose = sg.mode !== 'nem' && sg.mode !== 'ueb' && sg.mode !== 'mus';
        let host = bLine;
        if (!prose) { host = document.createElement('span'); host.className = 'brl-maths'; bLine.appendChild(host); }
        toks.forEach((w, wi) => {
          if (wi > 0) host.appendChild(document.createTextNode(shown(' ')));
          if (w) {
            const key = `${i}:s${si}:${wi}`;
            wordBraille.set(key, w);
            host.appendChild(wordSpan(w, key, 'word', prose ? w : undefined));
          }
        });
        lastEnd = sg.to;
      });
      if (lastEnd < ln.raw.length) {
        const mark = document.createElement('span');
        mark.className = 'switch-sign';
        mark.textContent = shown(ln.raw.slice(lastEnd));
        bLine.appendChild(mark);
      }
    } else {
      // WHITESPACE IS PART OF THE DOCUMENT, so the line is walked rather than
      // rebuilt from its words. Emitting each word followed by a space appended
      // one the line did not have — the drawn line was a cell longer than the
      // buffer — and could not reproduce any other spacing, because ln.words
      // comes from split(' ') and has thrown the gaps away.
      let j = 0, k = 0;
      const raw = ln.raw;
      let host = bLine;
      // A WHOLE-LINE MATHS LINE reaches here whenever its parse produced no
      // word groups to draw from - which is how two lines of the UEB maths
      // example still came back wearing "you could have contracted this".
      // The line's own mode settles it, the same question the print side asks
      // one block further down.
      const lineIsProse = !['nem', 'ueb', 'mus'].includes(modeOf(i));
      if (!lineIsProse) { host = document.createElement('span'); host.className = 'brl-maths'; bLine.appendChild(host); }
      while (k < raw.length) {
        let e = k;
        if (raw[k] === ' ') {
          while (e < raw.length && raw[e] === ' ') e += 1;
          host.appendChild(document.createTextNode(shown(raw.slice(k, e))));
        } else {
          while (e < raw.length && raw[e] !== ' ') e += 1;
          const w = raw.slice(k, e);
          // The word still being brailled keeps its own styling and no key, as
          // before: it is the last run of the last line.
          if (ln.pending && e === raw.length && w === ln.pending) {
            host.appendChild(wordSpan(w, '', 'pending'));
          } else {
            wordBraille.set(`${i}:${j}`, w);
            host.appendChild(wordSpan(w, `${i}:${j}`, 'word', lineIsProse ? w : undefined));
            j += 1;
          }
        }
        k = e;
      }
    }
    bEl.appendChild(bLine);

    // --- right pane ---
    if (skipIdx.has(i)) return;                  // absorbed into a matrix above
    const full = groups.get(i) || ln.raw.trim();
    const lm = modeOf(i);

    // A LINE THAT CHANGES MODE PART-WAY renders piece by piece: the words
    // before the switch stay words, and only what follows it is read as maths.
    // This is the whole point of marking the switch at the caret — the sentence
    // already written must not be reinterpreted underneath the writer.
    if ((ln.segs || []).length > 1 && !groups.has(i)) {
      const tLine = document.createElement('div');
      tLine.className = 'line';
      ln.segs.forEach((sg, si) => {
        const m = resolveMode(sg.mode, i);
        const expr = sg.text.trim();
        if (!expr) return;
        if (m === 'nem' || m === 'ueb') {
          const conv = m === 'nem'
            ? (globalThis.NemethToLatex ? (x) => nemethHybrid(x) : null)
            : (ln.pending ? uebMathsToLatex : uebHybrid);
          if (conv) {
            const r = mathRow(expr, conv, warnings, `${i}.${si}`);
            r.dataset.code = m === 'nem' ? 'Nemeth' : 'UEB';
            r.classList.add('inline-math');
            if (ln.pending) r.dataset.typing = '1';
            tLine.appendChild(r);
            // A word right after the closing sign would otherwise touch the
            // expression: "x+1ok". The margin alone is not a word space.
            tLine.appendChild(document.createTextNode(' '));
            return;
          }
        }
        // Reached either because the segment IS prose, or because its maths
        // could not be converted at all. Only the first deserves contraction
        // advice - cells we failed to read as maths are not thereby prose.
        const prose = m !== 'nem' && m !== 'ueb' && m !== 'mus';
        sg.text.split(' ').forEach((w, wi) => {
          if (!w) return;
          tLine.appendChild(wordSpan(bt(w), `${i}:s${si}:${wi}`, 'word', prose ? w : undefined));
          tLine.appendChild(document.createTextNode(' '));
        });
      });
      out.appendChild(tLine);
      return;
    }

    if (lm === 'ueb') {
      // LINE MODE (UEB 16 / GTM 16.7): a finished ⠐⠒ row with content on the
      // line — ticks ⠺, nested ⠳ arrows, atoms — is a DRAWN line: a number
      // line or a bond diagram. It renders as a picture, with the row below
      // as tick labels when it is numbers-only. Two stacked line rows are a
      // 2-D structural diagram, which stays as typed with a visible flag.
      if (full && !ln.pending && isLineRow(full)) {
        const nIdx = i + 1;
        const nxt = lines[nIdx];
        const nFull = nxt && !nxt.pending && !skipIdx.has(nIdx)
          ? (groups.get(nIdx) || nxt.raw.trim()) : '';
        if (nFull && isLineRow(nFull)) {
          warnings.push('structural diagram (stacked line-mode rows) - shown as typed, not drawn');
        } else {
          // columns are the coordinate system, so the UNtrimmed rows go in
          const lbl = nFull && isLabelRow(nFull) ? nxt.raw : null;
          if (lbl) skipIdx.add(nIdx);
          const holder = document.createElement('div');
          holder.className = 'line';
          holder.appendChild(numberLineSVG(groups.get(i) || ln.raw, lbl));
          out.appendChild(holder);
          return;
        }
      }
      if (full) {
        let conv = uebMathsToLatex;
        if (!ln.pending) {
          conv = uebHybrid;
        }
        const r = mathRow(full, conv, warnings, i);
        r.dataset.code = 'UEB';
        if (ln.pending) r.dataset.typing = '1';
        out.appendChild(r);
        if (r.wordGroups && !groups.has(i)) drawGroupedLine(bLine, i, full, r.wordGroups, ln.raw);
      } else out.appendChild(document.createElement('div')).className = 'line';
      return;
    }
    // Nemeth when the line's mode says so, or when the braille carries the
    // explicit ⠸⠩ switch (unambiguous, so safe to honour in any mode).
    if (lm === 'nem' || hasNemethSwitch(full)) {
      const conv = globalThis.NemethToLatex ? (s) => nemethHybrid(s) : null;
      const expr = groups.get(i) || full;
      if (conv && expr) {
        const r = mathRow(expr, conv, warnings, i);
        r.dataset.code = 'Nemeth';
        if (ln.pending) r.dataset.typing = '1';
        out.appendChild(r);
        if (r.wordGroups && !groups.has(i)) drawGroupedLine(bLine, i, expr, r.wordGroups, ln.raw);
      }
      return;
    }
    const tLine = document.createElement('div');
    tLine.className = 'line';
    if (!ready) tLine.textContent = '…';
    else {
      // Only finished words appear here. The word still being brailled is
      // deliberately NOT shown: a half-formed word back-translates to
      // something misleading, and nothing has to be "un-shown" on the next key.
      ln.words.forEach((w, j) => {
        tLine.appendChild(wordSpan(bt(w), `${i}:${j}`, 'word', w));
        tLine.appendChild(document.createTextNode(' '));
      });
    }
    out.appendChild(tLine);
  });

  // #150: RANGE, against the chosen instrument's usual range (mirrors
  // BrlDuet's renderRead(), brlduet.mjs ~338-341 — instruments.rangeWarnings
  // against the model's own `events`, which carry letter/octave/alter). Split
  // out from `warnings` into a cached pair so an instrument change later can
  // redraw just this box (refreshRangeWarnings()) without re-running any of
  // the above and destroying every engraved stave and its play buttons.
  // THE PANE MUST SHOW THE DOCUMENT, AND NOTHING ELSE.
  //
  // Every line drawn in the braille pane has to equal the line it came from, as
  // the pane spells it. This is the app's core promise: a child reading the pane
  // with a braille display, or a helper reading it over their shoulder, is
  // entitled to see exactly what was written and nothing more.
  //
  // It is checked rather than assumed because three separate routes had been
  // quietly breaking it, none of them announced: the maths rebuild drew nested
  // word groups twice, the plain path appended a space no line had, and the word
  // still being typed was drawn on top of a line that already contained it. Each
  // showed cells that were never written, and the only symptom a user could see
  // was that clicking landed on the wrong cell.
  //
  // It compares against `src`, not `buf`, because src is what this render was
  // asked to draw — buf plus the chord in progress.
  const faultStart = warnings.length;      // marks where THIS check's own pushes begin
  const drawnLines = [...bEl.children].map((el) => el.textContent);
  const wantLines = src.split('\n').map((l) => shown(l));
  for (let li = 0; li < Math.max(drawnLines.length, wantLines.length); li += 1) {
    const got = drawnLines[li], want = wantLines[li];
    if (got === want) continue;
    if (got === undefined || want === undefined) {
      warnings.push(`display fault: the braille pane drew ${drawnLines.length} lines for a document of ${wantLines.length} - please report this`);
      break;
    }
    warnings.push(`display fault on line ${li + 1}: the braille pane is showing ${got.length} cells for ${want.length} in the document - what is drawn there cannot be trusted, please report this`);
  }
  // MIRRORED STRAIGHT TO ASSISTIVE TECH, BYPASSING speak() ENTIRELY: a display
  // fault is the one announcement settings.speechOutput must never be able to
  // silence, since 'off' silencing the one warning that says "what you are
  // reading cannot be trusted" would be exactly backwards. #announceAssert is
  // aria-live="assertive"/role="alert", unlike the router's own #announce.
  if (warnings.length > faultStart) {
    $('announceAssert').textContent = warnings.slice(faultStart).join('\n');
  }

  const swap = wrongCodeHint(lines, ueb, nem);
  lastBaseWarnings = warnings.slice();
  lastSwapHint = swap;
  if (warnings.length) {
    warnEl.hidden = false;
    warnEl.textContent = (swap ? swap + '\n\n' : '') + warnings.join('\n');
  } else { warnEl.hidden = true; }

  offerRepairs(out, 'UEB');       // each row carries dataset.code; the argument
  offerVerify(out, 'UEB');        // is only the fallback for rows without one

  // WHICH LINE, THEN WHICH COLUMN — not a flat offset. Subtracting the newlines
  // to get one number cannot distinguish "end of line 0" from "start of line 1":
  // they are the same figure, and Enter therefore left the caret on the line it
  // had just departed. The line index and the column within it are two facts and
  // have to stay two.
  syncField();
  fitBrailleLine();
  syncMathsCheckbox();
}

// A CARET IN THE BRAILLE PANE (PB, 2026-08-09; the right pane's was removed
// same day, on PB's word).
//
// The braille pane is not a text field — input arrives as six-key chords — so
// there is no browser caret, and nothing marked where the writing had reached
// for a sighted helper watching over a child's shoulder.
//
// ONLY THE LEFT PANE HAS ONE, and on reflection that is the right shape rather
// than a concession: the left pane is where the writing HAPPENS, and the right
// is a rendering of it. A caret there would imply you could type into the
// output, which you cannot.
//
// FOR NOW IT IS ALWAYS AT THE END, which is where the writing always is: input
// only ever appends. When a caret can be MOVED, this is the function that
// learns about position, and the rest of render() need not change.
//
// It is aria-hidden and contains no text. A screen reader announcing "caret" on
// every re-render would be noise on top of the speech this app already gives,
// and a braille display would waste cells on a decoration. The blink is
// suppressed under prefers-reduced-motion, in CSS.
// DRAWING IT WHERE IT ACTUALLY IS. The pane is built of word spans and text
// nodes, so the caret cannot simply be appended any more — it has to be placed
// at a character offset that may fall inside a word. Walking the pane's TEXT
// NODES is what makes that possible without the line builder knowing anything
// about carets: count characters until the offset is reached, then split that
// node. One caveat handled here: when ASCII display is on, what is DRAWN is one
// character per cell as well, so the offsets still line up.
// FORTY CELLS TO A LINE (PB, 2026-08-09).
//
// A braille page line is 40 cells. Until now the pane simply filled the window,
// so a "line" here matched no real braille line at any size — useless for
// judging how work will emboss. The pane now SCALES ITS FONT so that exactly 40
// cells span the available width.
//
// AND WHEN THAT FONT WOULD BE TOO SMALL TO READ, the layout changes rather than
// the font shrinking further: the panes stack one above the other, which hands
// the braille the full window width and buys back several points of size.
// Reading the braille matters more than seeing both panes side by side.
//
// The cell-to-font ratio is MEASURED from the font in use, not assumed. APHfont
// and the fallback stack are different widths, so a hardcoded ratio would be
// right for one machine and wrong for the next — and would silently drift the
// moment the font changed.
// THE FACE HAS TO FOLLOW THE MODE, not just the characters.
//
// APHfont is ASCII-MAPPED — its 0x20-0x7E glyphs are braille cell shapes — so
// drawing BRF ASCII in it renders dots again and the display setting appears to
// do nothing at all. ASCII mode therefore switches BOTH layers to a plain
// monospace face.
//
// Re-measuring afterwards is not optional: cellRatio is measured FROM THE LIVE
// FONT, and the two faces have different advance widths, so a stale ratio would
// fit the wrong number of cells to the line and mis-size the pane.
function applyBrailleFont() {
  document.body.classList.toggle('ascii-braille', !!settings.showAscii);
  measureCellRatio();
  fitBrailleLine();
}

const CELLS_PER_LINE = 40;
const MIN_BRAILLE_PX = 20;      // below this the six dots stop being separable
// MAX_BRAILLE_PX (PB, 2026-08-18): a wide window otherwise grew the braille
// without limit ("enlarging when resizing the window" — user report). Capped
// at the app's own original fixed size — index.html's #braille/#brlInput
// both default to font-size:30px before this function ever runs a single
// time, so 30 is not a new number, it is where the app already started.
// Above the cap the line simply stops growing: still exactly 40 cells, just
// with margin to spare on the right.
const MAX_BRAILLE_PX = 30;
// A little reserved width (PB, same decision: "leave a bit of space ... to
// stop any overflow") so the 40th cell is never flush against the pane's
// edge, at the cap or below it. Folded into the FIT below rather than added
// as real padding, so the number that sizes the font is the same number the
// line wraps against — the two cannot disagree.
const BRAILLE_RIGHT_INSET_PX = 10;
// THE PRINT PANE FOLLOWS THE BRAILLE SIZE (PB, 2026-08-18): #out was a fixed
// 17px while the braille pane ranged 20-40+px, so print read much smaller
// than braille at almost every width. PRINT_RATIO is chosen to land on
// today's exact sizes at the cap: 30 * 0.6 = 18, within the ~17-19px this
// app used to be fixed at, and MATH_RATIO carries #out math the same way
// #out math already related to #out (22/17, today's own fixed pair) so the
// two print sizes keep scaling together rather than one drifting loose.
const PRINT_RATIO = 0.6;
const MATH_RATIO = 22 / 17;
const PRINT_MIN_PX = 15;        // never let print get harder to read than this
let cellRatio = 0.75;           // replaced by measurement once fonts are ready

function measureCellRatio() {
  const pane = $('braille');
  if (!pane) return;
  const c = document.createElement('canvas').getContext('2d');
  c.font = `100px ${getComputedStyle(pane).fontFamily}`;
  const w = c.measureText('⠿').width;
  if (w > 0) cellRatio = w / 100;
}

function fitBrailleLine() {
  const pane = $('braille');
  const body = pane && pane.closest('.pane-body');
  const panes = document.querySelector('.panes');
  if (!pane || !body || !panes) return;

  const usable = () => {
    const cs = getComputedStyle(body);
    return body.clientWidth - parseFloat(cs.paddingLeft) - parseFloat(cs.paddingRight);
  };
  const sizeFor = (w) => w / (CELLS_PER_LINE * cellRatio);

  // Try side by side first — it is the better layout when it can be afforded.
  // This decision is unchanged by MAX_BRAILLE_PX/BRAILLE_RIGHT_INSET_PX below:
  // it still measures the pane's full usable width, exactly as it did before
  // either existed, so the stacking floor keeps triggering at the same width.
  panes.classList.remove('stacked');
  let px = sizeFor(usable());
  if (px < MIN_BRAILLE_PX) {
    // Reading clientWidth after the class change forces the reflow, so the
    // second measurement is of the stacked layout and not the old one.
    panes.classList.add('stacked');
    px = sizeFor(usable());
  }
  // Re-fit against a slightly narrower width for the inset, THEN cap. Both
  // only ever pull the size DOWN from what "fits exactly" (sizeFor is
  // monotonic in width, and usable() - BRAILLE_RIGHT_INSET_PX < usable()),
  // so neither can undo the stacking decision above or push the size below
  // MIN_BRAILLE_PX.
  const insetPx = sizeFor(usable() - BRAILLE_RIGHT_INSET_PX);
  const brailleSize = Math.min(MAX_BRAILLE_PX, Math.max(MIN_BRAILLE_PX, Math.floor(insetPx)));
  const size = brailleSize + 'px';
  // Below the cap, 40 cells at brailleSize already come close to filling
  // usable() (that is how brailleSize was chosen) — pinning the box here
  // changes nothing there. ABOVE the cap it is what makes "still exactly 40
  // cells, with margin" literally true: a capped size no longer needs the
  // pane's full width, and left unconstrained the box would happily wrap
  // MORE than 40 of the now-smaller-than-necessary cells onto the row
  // instead of leaving the spare width as margin (caught by measuring: at
  // 1280px, capped to 30px, an unconstrained box fit 45 cells before this).
  // Capped at the TRUE usable() (no inset) as a floor-only safety net: at
  // MIN_BRAILLE_PX the size can be clamped UP past what genuinely fits (an
  // ultra-narrow window, already a pre-existing edge of the floor, unrelated
  // to this change), and pinning to a width the pane doesn't have would
  // overflow it instead of the graceful "fewer than 40 cells wrap" the
  // unpinned box always did there — caught the same way, measured at 480px.
  const lineWidth = Math.min(usable(), Math.ceil(CELLS_PER_LINE * cellRatio * brailleSize)) + 'px';
  pane.style.fontSize = size;
  pane.style.width = lineWidth;
  // The overlay pair must be the same size to the pixel, or the native caret
  // sits between the wrong cells. One variable, written to both.
  const ta = $('brlInput');
  if (ta) { ta.style.fontSize = size; ta.style.width = lineWidth; syncField(); }

  // Print follows braille from the SAME number, so the two panes can't drift
  // apart — see PRINT_RATIO/MATH_RATIO above. #out's own font-size is set
  // directly (it is one element, always present); #out math goes through a
  // custom property because the translator creates fresh math nodes on every
  // render, and a plain inline style set here would miss all of those.
  const printSize = Math.max(PRINT_MIN_PX, Math.round(brailleSize * PRINT_RATIO));
  const outEl = $('out');
  if (outEl) outEl.style.fontSize = printSize + 'px';
  document.documentElement.style.setProperty('--print-math-size', Math.round(printSize * MATH_RATIO) + 'px');
}

// THE TEXTAREA IS A PROJECTION OF buf (PB, 2026-08-09).
//
// buf stays the single truth. The field holds exactly what the overlay DRAWS —
// shown(buf) — so one character in the field is one cell on screen in BOTH
// display modes, and an index means the same thing in the field, in buf and in
// the overlay. Holding raw cells while drawing ASCII would desynchronise the
// two the moment that setting changed.
//
// .value is written only when it actually differs, because writing it
// unconditionally on every render would fight the user's own selection.
function syncField() {
  const ta = $('brlInput'), pane = $('braille');
  if (!ta) return;
  // A programmatic write moves the selection, which fires selectionchange. That
  // is not the user navigating, so it must not be announced.
  suppressCaretSpeech = true;
  setTimeout(() => { suppressCaretSpeech = false; }, 0);
  const want = shown(buf);
  // INCREMENTAL, NEVER WHOLESALE (PB, 2026-08-12). `ta.value = want` replaces
  // the field's entire content, and assistive technology believes it: every
  // keystroke read as a brand-new document is why VoiceOver re-read the
  // braille from the start on each cell. Replacing only the differing middle
  // via setRangeText presents the same edit a keyboard would have made — one
  // small range — so a screen reader tracks it like typing. The common prefix
  // and suffix are found by scan; the suffix scan stops at the prefix boundary
  // so overlapping repeats ("aaa" -> "aa") cannot double-count.
  // AN EDITING COMMAND, NOT A SCRIPT ASSIGNMENT (PB's VoiceOver testing,
  // 2026-08-19). Minimal ranges were not enough: setRangeText is a script
  // WRITE, and VoiceOver responds to it by reading the field's line back, cell
  // by cell as dot numbers — with its own typing echo for characters AND words
  // switched off, so this was ours, not its. Isolated in a four-way control
  // page: a bare textarea is silent while the same field edited by
  // setRangeText speaks the line, and split further, the EDIT is the trigger
  // (a programmatic caret move alone is silent).
  //
  // execCommand('insertText') asks the browser to perform the edit the way it
  // performs typing, so assistive technology sees an ordinary user edit — and
  // undo history survives, which setRangeText also destroyed. Deprecated but
  // universally implemented, and the only API that inserts AS a user;
  // beforeinput/native insertion are quiet for the same reason but cannot
  // serve chords, which have no native edit to let through.
  //
  // It fires `input`, which onFieldInput listens for, so the write is fenced:
  // without the fence the handler would re-read the field, re-derive buf and
  // re-enter syncField on every cell.
  const have = ta.value;
  if (have !== want) {
    let p = 0;
    const maxP = Math.min(have.length, want.length);
    while (p < maxP && have.charCodeAt(p) === want.charCodeAt(p)) p++;
    let hEnd = have.length, wEnd = want.length;
    while (hEnd > p && wEnd > p && have.charCodeAt(hEnd - 1) === want.charCodeAt(wEnd - 1)) { hEnd--; wEnd--; }
    const replacement = want.slice(p, wEnd);
    applyingSync = true;
    try {
      const focused = document.activeElement === ta;
      if (!focused) {
        // execCommand only edits the focused element. A background write (a
        // load, a mode change while a button has focus) has no caret to move
        // and no screen-reader cursor to disturb, so the plain write is right.
        ta.setRangeText(replacement, p, hEnd, 'preserve');
      } else {
        ta.setSelectionRange(p, hEnd);            // select exactly what changes
        if (replacement) document.execCommand('insertText', false, replacement);
        else document.execCommand('delete');      // a pure deletion (backspace)
        if (ta.value !== want) {                  // any engine that declines it
          ta.setRangeText(replacement, p, hEnd, 'preserve');
        }
      }
    } finally { applyingSync = false; }
  }
  const pos = Math.max(0, Math.min(caret, want.length));
  if (ta.selectionStart !== pos || ta.selectionEnd !== pos) ta.setSelectionRange(pos, pos);
  // THE FIELD MUST FILL THE PANE, not just the text.
  //
  // Sized to the RENDER alone it came out one line tall inside an empty pane:
  // the only place a click could land was the strip where cells already were,
  // and the caret could never be put below the last line. A text field is the
  // whole writing surface — an empty document must still be a page you can
  // click into anywhere. So it takes whichever is larger, the drawn text or the
  // pane itself, and keeps growing past the pane once the document is longer.
  // CSS DOES THIS NOW, NOT JAVASCRIPT (2026-08-19). This used to write
  // ta.style.height on every render, which meant the FOCUSED element's geometry
  // changed every time the document grew a line — measured, thirteen distinct
  // heights across twelve newlines, 25px apart, and again mid-typing whenever a
  // line soft-wrapped. A geometry change on the focused field is what made
  // VoiceOver re-read the whole pane, and only sometimes: exactly at line
  // boundaries, which is the "not consistently" in the report. The field is now
  // pinned top:0;bottom:0 inside #brlStack (see index.html), so the browser
  // keeps it the height of the render with no style write at all — same
  // geometry, measured identical at 450px and 600px as the document grew.
}

// THE FIELD IS AN INPUT SURFACE, NOT ONLY A CARET (PB, 2026-08-09).
//
// Six-key typing preventDefaults its keys, so it never reaches here. Everything
// ELSE the field can receive does: a braille display typing in its own forwarding
// mode, dictation, a paste, an undo, and every keystroke when six-key input is
// switched OFF in settings. Without this handler those edits would change what
// the field holds while buf stayed as it was — the field and the document
// disagreeing, which is precisely the failure a real field was adopted to end.
//
// The conversion is the LOADER'S, not a new one: whatever is not already a
// braille cell goes through brfToUnicodeBraille, the same BRF ASCII table a .brf
// file is read with. So a QWERTY keyboard and a display's ASCII mode both land
// real cells. Print text pasted from a word processor is a DIFFERENT job —
// translation, not transliteration — and is not this handler's.
// A SPACE IS A SPACE, not a cell. buf uses the ASCII space as its word
// separator — model()'s splitter is line.split(' ') — so passing one through the
// BRF table (where it maps to U+2800, the blank CELL) would mean no word ever
// finished and the text pane stayed empty with the braille looking perfect.
const CELL = /[\u2800-\u28FF\n ]/;
function toCells(s) {
  let out = '';
  for (const ch of s) {
    if (CELL.test(ch)) { out += ch; continue; }
    const c = brfToUnicodeBraille(ch.toUpperCase());
    if (c && CELL.test(c)) out += c;          // unmappable characters are dropped
  }
  return out;
}

// ---- native editing: the browser makes the edit, we say what it meant ----
// ONLY S D F J K L ARE OURS (PB, 2026-08-19, and the six-key handover doc §7:
// "implement Braille chording, not a replacement text editor"). Space, Enter,
// Backspace and Delete used to be intercepted and spliced into buf by hand.
// Letting the browser make them instead buys three things at once:
//   - assistive technology sees REAL user edits, which is the same signal that
//     made the braille display track and stopped VoiceOver re-reading the line
//     (55e63ca) — three fewer programmatic writes per word;
//   - selections are consumed correctly, because that is what a native edit
//     does, which the app never did (it was blind to selectionEnd);
//   - undo keeps working, for the same reason.
// What is lost is the state those handlers read BEFORE the edit — the token
// being finished, the cell about to go — so beforeinput captures it and the
// speech happens after onFieldInput has reconciled the buffer.
let pendingEdit = null;
// CAPTURED FROM THE KEYDOWN, not from beforeinput. beforeinput would be the
// tidier hook, but it is not uniformly delivered — measured here, an
// execCommand edit fires `input` and no `beforeinput` at all — and a capture
// that silently never runs is worse than a slightly earlier one. keydown is
// delivered everywhere, already knows the intent, and can be exercised in a
// test. Returns false when the key would do nothing, so the caller can answer
// immediately rather than waiting for an edit that will not come.
function captureNativeEdit(code, ta) {
  const s = ta.selectionStart, en = ta.selectionEnd;
  const hadSelection = en > s;
  if (code === 'Space' || code === 'Enter') {
    // Up to the caret: the separator is about to be inserted THERE.
    pendingEdit = { kind: 'sep', finished: trailingToken(buf.slice(0, s)) };
    return true;
  }
  if (code === 'Backspace') {
    if (hadSelection) { pendingEdit = { kind: 'del', gone: buf.slice(s, en), many: true }; return true; }
    if (s === 0) { pendingEdit = null; return false; }        // nothing behind the caret
    // THE MODE IS RECORDED WITH THE CELL, not looked up afterwards. By the time
    // the announcement is made the cell is gone and the caret sits on the
    // run's edge, where "inside the maths" has no honest answer. Here the
    // document still holds it, so the question is exact.
    pendingEdit = { kind: 'del', gone: buf[s - 1], name: describeCellInContext(s - 1) };
    return true;
  }
  if (code === 'Delete') {
    if (hadSelection) { pendingEdit = { kind: 'del', gone: buf.slice(s, en), many: true }; return true; }
    // "end" is feedback on a delete keypress, so it answers to the same setting
    // as the deletion it stands in for. Ungated, it was the one thing still
    // speaking with every switch off (measured, 2026-08-20).
    if (s >= buf.length) { pendingEdit = null; if (settings.speakLetter) speak('end'); return false; }
    pendingEdit = { kind: 'del', gone: buf[s], name: describeCellInContext(s) };
    return true;
  }
  pendingEdit = null;
  return false;
}
// Runs AFTER onFieldInput has brought buf and the caret into step with the
// field, so everything it says is about the document as it now stands.
function afterNativeEdit(p) {
  if (!p || p.kind === 'none') return;
  // DELETING A CELL IS THE SAME FUNCTION AS WRITING ONE (PB, 2026-08-20), so
  // it answers to the same setting: one cell changes under the child's hands
  // and the app names it, whether the key added it or took it away. A separate
  // switch for deletion was a switch nobody would ever set differently.
  //
  // (There was a `kind: 'atEnd'` branch here that read as the gate for "end".
  // Nothing has ever SET that kind - captureNativeEdit says "end" itself and
  // returns false - so it guarded nothing while looking like it guarded
  // something, and the real site went on speaking with every switch off. The
  // gate now lives where the speech does.)
  if (p.kind === 'del') {
    // EXCEPT WHEN A LOT GOES AT ONCE. "deleted 5 cells" is not an echo, it is
    // notice that a chunk of the document has gone - the one deletion that is
    // dangerous to lose quietly - so it speaks whatever the echo setting says.
    if (p.many) { speak('deleted ' + [...p.gone].length + ' cells'); return; }
    if (settings.speakLetter) speak('delete ' + (p.name || describeCell(p.gone)));
    return;
  }
  // A separator finished whatever word came before it.
  //
  // THE SWITCH SIGNS ARE APPARATUS, NOT PART OF THE WORD (2026-08-24). Ctrl+M
  // writes ⠸⠩⠸⠱ with the caret between them and no spaces, so the FIRST word
  // of every Nemeth run carries the opening sign - and the speech refused any
  // token containing one, as apparatus. The result: a child wrote a sum inside
  // a Nemeth run, pressed space, and heard nothing at all. Strip the signs and
  // read what is left; their presence is itself the answer to which code it is.
  const rawFinished = p.finished;
  if (!rawFinished || !rawFinished.trim()) return;
  const hadSwitch = hasNemethSwitch(rawFinished);
  const finished = hadSwitch ? stripNemethSwitches(rawFinished) : rawFinished;
  if (!finished.trim()) return;              // the token was only apparatus
  const fMode = hadSwitch ? 'nem' : modeOfFinished(rawFinished);
  const finishedIsWord = justLetters(
    (fMode === 'nem' || hasNemethSwitch(finished)) ? describeNemeth(finished)
                                                   : describeUebMaths(finished));
  if (speechOk && (settings.speakWord || settings.speakSentence)
      && fMode && !finishedIsWord) {
    const textToSpeak = settings.speakSentence ? buf.split('\n').pop() : finished;
    const asNem = fMode === 'nem' || hasNemethSwitch(textToSpeak);
    const asUeb = !asNem && fMode === 'ueb';
    const parseRes = asUeb ? uebMathsToLatexV2(textToSpeak) : nemethMathsToLatexV2(textToSpeak);
    const speechText = speakMaths(parseRes,
      asUeb ? describeUebMaths(textToSpeak) : describeNemeth(textToSpeak));
    if (speechText) speak(speechText);
    return;
  }
  // The nudge goes BEFORE the word, so the two do not collide.
  if (missedContraction(finished)) ding();
  maybeSpeak(finished, finishedIsWord);
}

function onFieldInput() {
  const ta = $('brlInput');
  if (!ta) return;
  // OUR OWN WRITE IS NOT THE USER TYPING. syncField now edits through
  // execCommand so assistive technology sees a real edit, and a real edit fires
  // `input`. Unfenced, this handler would re-derive buf from the field we just
  // wrote and re-enter syncField on every cell.
  if (applyingSync) return;
  // ANY EDIT PINS MODES TO LINES, not just a chord. The chord path already did
  // this, but text can reach the field without one - a braille display's own
  // keyboard, a paste, BRF ASCII typed with six-key off - and the flag stayed
  // set from the load. Whole-document maths would then be one click away long
  // after the child had started writing, and that click would sweep their
  // work. The flag means "nothing has been written since this arrived", so any
  // writing ends it.
  modeAppliesToAll = false;
  // Convert the PREFIX separately: dropping an unmappable character shortens the
  // text, so a caret carried over as a raw offset would land in the wrong place.
  caret = toCells(ta.value.slice(0, ta.selectionStart)).length;
  buf = toCells(ta.value);
  suppressCaretSpeech = true;
  render();
  if (pendingEdit) { const p = pendingEdit; pendingEdit = null; afterNativeEdit(p); }
}

// PASTE IS THE "DIFFERENT JOB" THE COMMENT ABOVE toCells() PROMISED (PB,
// 2026-08-19; flagged there on 2026-08-09 as "not this handler's"). toCells()
// treats any BRF-ASCII character as a keystroke — exactly right for six-key
// or QWERTY entry, wrong for a clipboard paste: every letter A-Z has its own
// BRF-ASCII cell, so print text pasted from a word processor transliterates
// WHOLE under toCells(), with nothing to tell "hello world" apart from real
// braille typed on a display. So this path never calls brfToUnicodeBraille.
// A pasted character only counts as braille if it ALREADY is one; a plain
// space or newline is kept too (holding real cells apart), but earns nothing
// on its own — a paste of pure print text (which is mostly letters and a
// handful of spaces) must still come out as "not braille", not "1 mapped".
const BRAILLE_CELL = /[⠀-⣿]/;
function pasteToCells(s) {
  const hasBraille = [...s].some((ch) => BRAILLE_CELL.test(ch));
  if (!hasBraille) return { cells: '', ignored: 0, hasBraille: false };
  let cells = '', ignored = 0;
  for (const ch of s) { if (CELL.test(ch)) cells += ch; else ignored += 1; }
  return { cells, ignored, hasBraille: true };
}

// THE CARET FOLLOWS THE FIELD, never the reverse. Every native movement —
// arrows, Home/End, a click, a braille display routing key, a screen reader
// moving its cursor — arrives here as one event.
function onFieldSelection() {
  const ta = $('brlInput');
  if (!ta || document.activeElement !== ta) return;
  const pos = ta.selectionStart;
  if (pos === caret) return;
  // Decided BEFORE caret updates: did this move land on a different line?
  const movedLine = lineIndexOf(pos) !== lineIndexOf(caret);
  caret = pos;
  // Checked here, ahead of the pointer-suppression return below, because that
  // guard only silences the SPEECH explanation for a click already answered
  // by the pointer handler — the caret (and so which mode it is in) has
  // genuinely moved either way, and a click landing on a word is the most
  // common way the caret moves by mouse at all.
  syncMathsCheckbox();
  // A POINTER HAS ALREADY ANSWERED, so do not answer again from the caret.
  //
  // Chrome dispatches selectionchange ASYNCHRONOUSLY, so a click arrives in this
  // order: mousedown moves the caret, the click handler names the cell under the
  // pointer, and only THEN does selectionchange run — overwriting the pointer's
  // answer with the caret's. That is why hit-testing the click appeared to do
  // nothing at all: it was working, and being undone a moment later.
  //
  // The caret still moves, because it must. Only the explanation is left alone.
  if (performance.now() - pointerExplainedAt < POINTER_WINS_MS) return;
  // A VERTICAL MOVE ANSWERS WITH THE LINE (PB, 2026-08-12). Arrowing up or
  // down is how a child surveys the document, and the cell under the caret
  // says nothing about where they landed. The status bar still follows the
  // word (explainAtCaret first); the line is spoken LAST so it is what wins
  // the barge-in — explainWord speaks too on maths words, and the later
  // utterance replaces the earlier.
  if (movedLine) {
    explainAtCaret();
    if (speechOk && !suppressCaretSpeech && settings.speakCursor) sayCurrentLine(true);
    return;
  }
  // WITHIN a line, the answer is the CELL, said in its word's context — and
  // said LAST, after the status-bar explanation, because explainWord speaks
  // too on maths words and the later utterance is the one that survives the
  // barge-in. Before this reordering, stepping through an equation spoke the
  // whole term over every cell.
  explainAtCaret();
  // The cell under the cursor, and the line when the cursor changes line: the
  // reading a screen reader duplicates as you arrow about, and so the one a
  // user of one can switch off here.
  if (speechOk && !suppressCaretSpeech && settings.speakCursor) {
    speak(describeCellInContext(pos));
  }
}

// A CELL MEANS WHAT ITS WORD MAKES IT MEAN (PB, 2026-08-12). ⠲ is "4" after a
// number sign and a full stop at the end of a sentence; ⠔ is "in" mid-word;
// half of ⠈⠡ means nothing alone. So the cell-by-cell caret speech asks the
// WORD first: the maths describers already carry number-sign state and
// two-cell signs, and for text liblouis's own alignment (alignWord — the same
// mapping the colour chips draw) says which characters each cell produced.
// Only when neither can answer does it fall back to describeCell's letter,
// then honest dot numbers.
const PUNCT_NAMES = new Map([
  ['⠲', 'full stop'], ['⠂', 'comma'], ['⠆', 'semicolon'], ['⠒', 'colon'],
  ['⠖', 'exclamation mark'], ['⠄', 'apostrophe'], ['⠤', 'hyphen'],
  ['⠦', 'question mark or opening quote'], ['⠴', 'closing quote'],
]);
// A DELETED CELL IS NAMED WHILE IT IS STILL THERE (feedback, 2026-08-28: "the
// deletion self-voicing is incorrect for UEB maths", and the same for Nemeth).
// Every deletion used the LITERARY namer, so inside a sum the signs were read
// as letters: deleting a plus said "delete i n g", deleting a fraction line
// said "delete s t". Measured, both codes.
//
// The name is taken at CAPTURE time, by describeCellInContext - the same
// function the cursor uses, which reads a cell inside its word and in its own
// code. Afterwards would be too late twice over: the cell is gone, and the
// caret is left on the run's edge where "is this maths?" has no honest answer.
// Context is what UEB needs in particular, where a digit and a letter are the
// same cell and only the number sign before it tells them apart.

function describeCellInContext(pos) {
  const ch = buf[pos];
  if (ch === undefined) return 'end';
  if (ch === ' ' || ch === '⠀') return 'space';
  if (ch === '\n') return 'new line';
  let ws = pos; while (ws > 0 && buf[ws - 1] !== ' ' && buf[ws - 1] !== '\n') ws--;
  let we = pos; while (we < buf.length && buf[we] !== ' ' && buf[we] !== '\n') we++;
  const word = buf.slice(ws, we);
  const off = pos - ws;
  const li = lineIndexOf(pos);
  const mode = lineModes[li] || currentMode();
  // THE SWITCH IS ON THE LINE, NOT NECESSARILY ON THE WORD (user file,
  // 2026-08-21). hasNemethSwitch only sees the word under the cursor, and in
  // "⠸⠩⠼⠒⠬⠆ ⠨⠅ ⠼⠢⠸⠱" - a Nemeth sum written into a TEXT line, which is what
  // Ctrl+M produces - the opening sign sits on the first word and the closing
  // one on the last. The equals in the middle carries neither, so this read as
  // text and the literary reader answered, correctly for text: ⠨ is the Greek
  // prefix and ⠅ is k, so ⠨⠅ is kappa. A child cursoring onto the equals sign
  // of "3+2 = 5" heard "kappa" - reported, entirely reasonably, as "cap a".
  // modeAtPos replays the switches from the top of the document, which is the
  // same question the Maths checkbox already asks about the caret.
  const here = modeAtPos(pos);
  const asNem = here === 'nem' || mode === 'nem' || hasNemethSwitch(word);
  const asUeb = !asNem && (here === 'ueb' || mode === 'ueb' || !!spanAt(pos));
  if (asNem || asUeb) {
    // Walk the describer's entries, which tile the word's cells in order.
    const entries = (asNem ? describeNemeth : describeUebMaths)(word);
    let at = 0;
    for (const en of entries) {
      const cellsArr = [...en.cells];
      if (off >= at && off < at + cellsArr.length) {
        const within = off - at;
        // A run of digits speaks the ONE digit under the caret: name holds one
        // character per cell in a Nemeth dropped-number run.
        if (asNem && cellsArr.length > 1 && /^[\d.,]+$/.test(en.name)
            && en.name.length === cellsArr.length) return en.name[within];
        // A UEB number entry USUALLY leads with the number sign, then one digit
        // (or . ,) per cell - but not always: the denominator of a simple
        // numeric fraction is digits carried across the fraction line by the
        // number sign that opened the numerator, with no sign of its own. So
        // ask the entry whether it starts with one rather than assuming, or
        // the first digit of a denominator answers "number sign".
        // The entry must BE a number, not merely look like one. A cell the
        // describer could not name once came back as its dot list, which is
        // all digits, so this branch read it as a numeral and spoke one digit.
        if (asUeb && /^[\d.,]+$/.test(en.name) && en.name.length <= cellsArr.length + 1) {
          const leadsWithNumSign = cellsArr[0] === String.fromCodePoint(0x283C);
          if (!leadsWithNumSign) return en.name[within] || en.name;
          return within === 0 ? 'number sign' : (en.name[within - 1] || en.name);
        }
        // A letter run names just the letter under the caret.
        const m = /^letters? (.+)$/.exec(en.name);
        if (m && m[1].length === cellsArr.length) return m[1][within];
        // Multi-cell signs (times, superscript, open fraction…) mean nothing
        // half at a time: both cells answer with the whole sign.
        return en.speech || en.name;
      }
      at += cellsArr.length;
    }
    // fall through: a cell the describer skipped
  } else {
    const text = bt(word);
    const segs = text ? alignWord(word, text) : null;
    if (segs) {
      let at = 0;
      for (const sg of segs) {
        const n = [...sg.cells].length;
        if (off >= at && off < at + n) {
          const said = sg.chars.trim();
          // A bare "." or "," is near-silence to a speech engine: single
          // punctuation answers with its name instead.
          if (said.length === 1 && PUNCT_NAMES.has(ch)) return PUNCT_NAMES.get(ch);
          if (said) return said;                 // "in" for ⠔, "C" for ⠠⠉, "4" for a digit
          break;
        }
        at += n;
      }
    }
    if (PUNCT_NAMES.has(ch)) return PUNCT_NAMES.get(ch);
  }
  return describeCell(ch);
}

// TYPING NAMES THE CELL; CURSORING NAMES IT IN CONTEXT (PB, 2026-08-19).
// While a word is still being written its contraction is not settled: ⠞ alone
// back-translates to "that", because it IS the wordsign for it, so echoing the
// word told a child they had written something they had not chosen yet. What
// they have certainly written is the letter. The word is spoken at the SPACE,
// when it is finished and the reading is fixed — which is exactly where word
// speech already lives.
//
// Maths keeps its context, because a maths cell does not depend on a word
// being finished to mean what it means: a number sign is a number sign the
// moment it is written, and ⠲ after one is the digit 4 whatever follows.
function describeTypedCell(pos) {
  const ch = buf[pos];
  if (ch === undefined) return 'end';
  if (ch === ' ' || ch === '⠀') return 'space';
  if (ch === '\n') return 'new line';
  const li = lineIndexOf(pos);
  const mode = lineModes[li] || currentMode();
  let ws = pos; while (ws > 0 && buf[ws - 1] !== ' ' && buf[ws - 1] !== '\n') ws--;
  let we = pos; while (we < buf.length && buf[we] !== ' ' && buf[we] !== '\n') we++;
  const here = modeAtPos(pos);
  const isMaths = here === 'nem' || here === 'ueb' || mode === 'nem' || mode === 'ueb'
               || hasNemethSwitch(buf.slice(ws, we)) || !!spanAt(pos);
  return isMaths ? describeCellInContext(pos) : describeCell(ch);
}

// Line arithmetic over buf, shared by the caret's line-change detection and
// term movement. lastIndexOf on the buffer, not the field: they hold the same
// indices by construction (one character per cell in both display modes).
function lineIndexOf(pos) {
  let n = 0;
  for (let i = 0; i < pos && i < buf.length; i++) if (buf[i] === '\n') n++;
  return n;
}
function lineStartOf(pos) { return buf.lastIndexOf('\n', pos - 1) + 1; }

// ---- Ctrl/Alt + Left/Right: move the caret by MATHEMATICAL TERM ----
// The terms are the row's own click anchors (row.wordGroups, the balanced
// groups mathRow built), so movement, highlight and speech all agree on what
// a term is. Clicking the anchor is reused as the announcement: it drives the
// exact explain-and-speak path a pointer click does. Returns false on lines
// that are not rendered maths, so the arrows keep their native word movement
// everywhere else. Both modifiers are accepted because macOS reserves
// Ctrl+Arrow for Mission Control — Mac users get Option+Arrow.
function mathsRowForLine(li) {
  for (const row of $('out').querySelectorAll('.mathrow')) {
    const el = row.querySelector('[class*="bw-"]');
    const m = el && /(?:^|\s)bw-(\d+)-/.exec(el.getAttribute('class') || '');
    if (m && Number(m[1]) === li) return row;
  }
  return null;
}
function moveByMathsTerm(dir) {
  const li = lineIndexOf(caret);
  const row = mathsRowForLine(li);
  const groups = row && row.wordGroups;
  if (!groups || !groups.length) return false;
  const start = lineStartOf(caret);
  // Whitespace-only groups exist so every cell has an anchor, but they are
  // not TERMS — stepping onto a space would announce nothing and feel like
  // the key did nothing.
  const terms = groups.filter((g) => g.c1 > g.c0 && buf.slice(start + g.c0, start + g.c1).trim());
  if (!terms.length) return false;
  const col = caret - start;
  let idx = -1;                                  // last term starting at or left of the caret
  for (let i = 0; i < terms.length; i++) if (terms[i].c0 <= col) idx = i;
  const next = Math.max(0, Math.min(terms.length - 1, idx + dir));
  const g = terms[next];
  const ta = $('brlInput');
  caret = Math.min(start + g.c0, buf.length);
  suppressCaretSpeech = true;
  setTimeout(() => { suppressCaretSpeech = false; }, 0);
  if (ta) ta.setSelectionRange(caret, caret);
  // Announce THE TERM, not the row: explainWord given exactly the term's
  // cells highlights and speaks that term (an anchor .click() would hand the
  // whole line to the describers — that is what a pointer click does today).
  pointerExplainedAt = performance.now();        // the selectionchange to come must not clobber this
  const key = `${li}:${g.c0}:${g.c1}`;
  linkWord(key);
  explainWord(buf.slice(start + g.c0, start + g.c1), key, { silent: !settings.speakCursor });
  return true;
}
// How long a pointer's answer outranks the caret's. Long enough to outlast the
// asynchronous selectionchange that follows the same click, short enough that
// the next keypress is served normally.
const POINTER_WINS_MS = 300;
let pointerExplainedAt = 0;
// Typing already speaks the letter; without this the caret move it causes would
// speak a second time and the two would collide.
let suppressCaretSpeech = false;
// True only while syncField is applying its own edit — see the fence in
// onFieldInput. Declared beside suppressCaretSpeech because both exist for the
// same reason: telling the app's own writes apart from the user's.
let applyingSync = false;

// EXPLAIN FROM THE CARET, not only from a click. A click needs a mouse; a caret
// position works from the keyboard and from a display routing key, so this puts
// the feature within reach of the people the app is for. It hit-tests the
// character offset against the overlay spans that already carry the word keys —
// no second index to keep in step.
function explainAtCaret() {
  const pane = $('braille');
  if (!pane) return;

  // THE LINE COMES FROM buf, NEVER FROM THE RENDER. Walking the drawn text and
  // counting characters drifts, because the maths branch REBUILDS its braille
  // line from the TRIMMED expression — so a rendered line can be shorter than
  // the buffer line it came from, and the error accumulates down the document.
  // It showed up as clicking the last line explaining the line before. buf is
  // the truth and its newlines are exact.
  const before = buf.slice(0, caret);
  const lineIdx = (before.match(/\n/g) || []).length;
  const col = caret - (before.lastIndexOf('\n') + 1);
  const lineEl = pane.children[lineIdx];
  if (!lineEl) return;

  // Within the line, allow for that same trim: the first drawn cell may be the
  // raw line's third character.
  const rawLine = (buf.split('\n')[lineIdx] || '');
  const lead = rawLine.length - rawLine.replace(/^\s+/, '').length;
  const target = Math.max(0, col - lead);

  const explain = (w) => {
    // explainWord takes (BRAILLE, key). Passing the key as the braille left it
    // parsing "0:3" as an expression, so it explained nothing and — since the
    // maths speech hangs off that parse — said nothing either.
    const key = w.dataset.w;
    linkWord(key);
    explainWord(wordBraille.get(key) || toCells(w.textContent), key, { silent: !settings.speakCursor });
  };

  let seen = 0;
  const groups = []; // every word group on the line, in order, as {w, start, end}
  const walker = document.createTreeWalker(lineEl, NodeFilter.SHOW_TEXT);
  let node;
  while ((node = walker.nextNode())) {
    const len = node.nodeValue.length;
    const w = node.parentElement && node.parentElement.closest('.word');
    if (w && w.dataset.w) {
      // Half-open: the caret sits BEFORE a character, so a boundary belongs to the
      // word that follows it, not the one that ends there.
      if (target >= seen && target < seen + len) { explain(w); return; }
      groups.push({ w, start: seen, end: seen + len });
    }
    seen += len;
  }
  // No group covers this column — resolve to the NEAREST group by column
  // distance, not always the line's last one. A caret past the last cell of
  // the line still lands on the last word (nothing sits beyond it, so it IS
  // nearest); a caret in the line's leading indent now lands on the FIRST
  // word instead of the line's last one.
  let nearest = null, bestDist = Infinity;
  for (const g of groups) {
    const dist = target < g.start ? g.start - target : target - g.end + 1;
    if (dist < bestDist) { bestDist = dist; nearest = g.w; }
  }
  if (nearest) explain(nearest);
}

// When maths braille will not read, by far the commonest cause is that it is in
// the OTHER code — a Nemeth file opened with "UEB Maths" ticked produces a wall
// of unreadable-cell messages, every one of them true and none of them useful.
// So before showing that wall, try the other converter: if it reads the same
// braille cleanly, say which box to tick.
function wrongCodeHint(lines, ueb, nem) {
  if (!ueb && !nem) return '';
  const other = ueb
    ? { name: 'Nemeth', run: (s) => (globalThis.NemethToLatex ? nemethHybrid(s) : null) }
    : { name: 'UEB Maths', run: (s) => uebHybrid(s) };

  let mine = 0, theirs = 0, n = 0;
  for (const ln of lines) {
    const raw = ln.raw.trim();
    if (!raw) continue;
    n++;
    const a = ueb ? safeConv(() => uebHybrid(raw))
                  : safeConv(() => (globalThis.NemethToLatex ? nemethHybrid(raw) : null));
    const b = safeConv(() => other.run(raw));
    if (a) mine++;
    if (b) theirs++;
  }
  // Only worth saying when the other code is clearly better, not marginally so.
  if (!n || theirs < n * 0.6 || theirs <= mine) return '';
  return `This looks like ${other.name} braille - ${theirs} of ${n} lines read cleanly as ${other.name}, `
       + `but only ${mine} as ${ueb ? 'UEB Maths' : 'Nemeth'}. `
       + `Tick “${other.name}” at the top of the window.`;
}

const safeConv = (fn) => {
  try { const r = fn(); return !!(r && (r.latex || '').trim() && !(r.warnings || []).length); }
  catch { return false; }
};

// For a line we could NOT read, try to work out what was meant: one added or
// removed cell that makes the line read cleanly AND reproduce itself when
// translated back to braille. Only ever shown under a line that already carries
// a warning, so it can add information but never contradict a good reading.
//
// Two rules keep it from being a nuisance, both learnt the hard way:
//
//  • NEVER advise on the line being typed. A half-written expression is
//    "broken" by definition — of course the fraction has no closing sign yet —
//    so advising there is premature and constant.
//  • The whole display is rebuilt on EVERY keystroke, and the suggestion
//    arrives asynchronously, so a freshly computed one was being wiped by the
//    next render: it flashed up and vanished mid-word. Results are cached by
//    expression and re-attached synchronously while the display is being built,
//    so a suggestion appears once and then stays put.
const repairCache = new Map();          // "CODE\nbraille" -> suggestions
let repairTimer = 0;

function offerRepairs(out, fallbackCode) {
  const rows = [...out.querySelectorAll('.mathrow.partial')]
    .filter((r) => r.dataset.repairExpr && r.dataset.typing !== '1');
  if (!rows.length) return;
  const codeFor = (r) => r.dataset.code || fallbackCode;

  // Anything already worked out goes back on screen immediately — no flicker.
  const pending = [];
  for (const row of rows) {
    const code = codeFor(row);
    const key = code + '\n' + row.dataset.repairExpr;
    if (repairCache.has(key)) {
      const s = repairCache.get(key);
      if (s.length) showRepairs(row, s);
    } else pending.push({ row, key, code });
  }
  if (!pending.length) return;

  // Work out the rest only once typing has paused.
  clearTimeout(repairTimer);
  repairTimer = setTimeout(() => {
    startVerifier().then((ok) => {
      if (!ok) return;
      for (const { row, key, code } of pending) {
        const read = code === 'UEB'
          ? (b) => uebHybrid(b)
          : (b) => (globalThis.NemethToLatex ? nemethHybrid(b) : null);
        let s = [];
        try { s = suggestRepairs(row.dataset.repairExpr, code, read, 2); } catch { /* leave it */ }
        repairCache.set(key, s);
        if (s.length && row.isConnected) showRepairs(row, s);
      }
    });
  }, 700);
}

// THE LAST NET — for the reading that parses cleanly, renders plausibly, and
// is WRONG. Every finished clean line is round-tripped (reading → MathCAT →
// braille) once typing pauses. A difference gets a calm amber note, not an
// alarm: most differences are legitimate alternative spellings, but every
// silent misreading is in this class, so the teacher deserves the glance.
// Same cache-and-reattach pattern as repairs, for the same flicker reasons.
const verifyCache = new Map();          // "CODE\nbraille" -> true (ok) | false (differs)
let verifyTimer = 0;

function offerVerify(out, fallbackCode) {
  const rows = [...out.querySelectorAll('.mathrow')]
    .filter((r) => r.dataset.verifyExpr && r.dataset.typing !== '1' &&
                   !r.querySelector('.repair'));
  if (!rows.length) return;
  const pending = [];
  for (const row of rows) {
    const code = row.dataset.code || fallbackCode;
    // a row of pure numerals (a data-table line) is bijective — cells map
    // one-to-one to digits, so there is nothing a round-trip could catch,
    // and MathCAT's respacing of lists was ambering children's statistics
    if (/^[⠀⠼⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠲⠂ ]+$/u.test(row.dataset.verifyExpr)) continue;
    const key = code + '\n' + row.dataset.verifyExpr;
    if (verifyCache.has(key)) {
      if (verifyCache.get(key) === false) showUnverified(row);
    } else pending.push({ row, key, code });
  }
  if (!pending.length) return;
  clearTimeout(verifyTimer);
  verifyTimer = setTimeout(() => {
    startVerifier().then((ok) => {
      if (!ok) return;
      for (const { row, key, code } of pending) {
        let v = { checked: false };
        try { v = verifyLine(row.dataset.verifyExpr, row.dataset.verifyLatex, code); } catch { /* */ }
        if (!v.checked) continue;              // tool unavailable ≠ a problem with the work
        verifyCache.set(key, !!v.ok);
        if (!v.ok && row.isConnected) showUnverified(row);
      }
    });
  }, 700);
}

function showUnverified(row) {
  if (row.querySelector('.unverified') || row.querySelector('.ambig')) return;
  const box = document.createElement('div');
  box.className = 'unverified';
  box.textContent = 'Unverified - this braille doesn’t match the usual spelling of the maths shown. Worth checking with the child.';
  row.appendChild(box);
}

function showRepairs(row, suggestions) {
  if (row.querySelector('.repair')) return;
  const box = document.createElement('div');
  box.className = 'repair';
  const lead = document.createElement('div');
  lead.className = 'repair-lead';
  lead.textContent = suggestions.length > 1 ? 'It may have been meant as:' : 'It may have been meant as:';
  box.appendChild(lead);
  for (const s of suggestions) {
    const item = document.createElement('div');
    item.className = 'repair-item';
    const how = document.createElement('span');
    how.className = 'repair-how';
    how.textContent = s.how + ' - ';
    item.appendChild(how);
    const maths = document.createElement('span');
    try { maths.innerHTML = globalThis.temml.renderToString(s.latex); }
    catch { maths.textContent = s.latex; }
    item.appendChild(maths);
    box.appendChild(item);
  }
  row.appendChild(box);
}

// Render one expression. Failure is GRACEFUL and, above all, honest: a partly
// understood expression is never shown as though it were correct, because a
// confident-looking wrong formula is worse than an obvious gap — the reader has
// no way to know it is wrong. We show what we could read, mark it clearly as
// incomplete, and point at the exact cell that defeated us.
// --- line mode as a PICTURE -------------------------------------------------
// UEB 16.1–16.4 / GTM 16.7. The braille is one row: ⠐⠒ opens the line, ⠒ runs
// are the line itself, ⠺ is a vertical crossing (a number-line tick, a bond
// crossing), ⠳+direction is an arrowhead continuous with the line, letters sit
// ON the line, ⠄ ends it. A numbers-only row immediately below is tick labels,
// aligned by braille cell column — the transcription IS the coordinate system.
function isLineRow(s) {
  const k = s.indexOf('⠐⠒');
  if (k < 0) return false;
  const body = s.slice(k + 2).split('⠄')[0];
  // the parser's own test: something ON the line (a pure ⠒ run stays ⋯)
  return [...body].some((c) => c !== '⠒' && c !== '⠀' && c !== ' ');
}
function isLabelRow(s) {
  return /^(?:[⠀ ]*(?:⠐⠤)?⠼[⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠲⠂]+)+[⠀ ]*$/u.test(s);
}
function numberLineSVG(lineRaw, labelRaw) {
  const CW = 16, mid = 20, H = labelRaw ? 58 : 36;
  const cells = [...lineRaw];
  const k = lineRaw.indexOf('⠐⠒');
  let end = cells.indexOf('⠄'); if (end < 0) end = cells.length;
  const x = (idx) => idx * CW + CW / 2;
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${cells.length * CW + CW} ${H}`);
  svg.setAttribute('width', String(cells.length * CW + CW));
  svg.setAttribute('height', String(H));
  svg.setAttribute('role', 'img');
  const el = (tag, attrs, text) => {
    const e = document.createElementNS(NS, tag);
    for (const [a, v] of Object.entries(attrs)) e.setAttribute(a, String(v));
    if (text) e.textContent = text;
    svg.appendChild(e); return e;
  };
  // classify each cell, so line segments can break around items
  const kind = [];
  for (let idx = k; idx < end; idx++) {
    const c = cells[idx];
    if (c === '⠒' || (idx === k && c === '⠐')) kind[idx] = 'line';
    else if (c === '⠺') kind[idx] = 'tick';
    else if (c === '⠳') { kind[idx] = 'arrow'; if (idx + 1 < end) { kind[idx + 1] = 'dir'; idx++; } }
    else if (c === '⠀' || c === ' ') kind[idx] = 'gap';
    else kind[idx] = 'item';
  }
  // maximal line runs (line/tick/arrow/dir), broken by items and gaps
  let runStart = null;
  const flush = (idx) => {
    if (runStart === null) return;
    const runStartWas = runStart;
    el('line', { x1: x(runStart) - CW / 2, y1: mid, x2: x(idx - 1) + CW / 2, y2: mid,
                 stroke: 'currentColor', 'stroke-width': 2 });
    if (kind[runStart] === 'arrow') {
      const x0 = x(runStart) - CW / 2;
      el('path', { d: `M ${x0 + 9} ${mid - 6} L ${x0} ${mid} L ${x0 + 9} ${mid + 6}`,
                   fill: 'none', stroke: 'currentColor', 'stroke-width': 2 });
    }
    const last = kind[idx - 1] === 'dir' ? idx - 2 : (kind[idx - 1] === 'arrow' ? idx - 1 : null);
    if (last !== null && last !== runStartWas && kind[last] === 'arrow') {
      const x1 = x(idx - 1) + CW / 2;
      el('path', { d: `M ${x1 - 9} ${mid - 6} L ${x1} ${mid} L ${x1 - 9} ${mid + 6}`,
                   fill: 'none', stroke: 'currentColor', 'stroke-width': 2 });
    }
    runStart = null;
  };
  let itemStart = null;
  const flushItem = (idx) => {
    if (itemStart === null) return;
    const brl = cells.slice(itemStart, idx).join('');
    const r = uebHybrid(brl);
    el('text', { x: (x(itemStart) + x(idx - 1)) / 2, y: mid + 5, 'text-anchor': 'middle',
                 'font-size': 15, fill: 'currentColor' }, (r.latex || brl).trim());
    itemStart = null;
  };
  for (let idx = k; idx <= end; idx++) {
    const kd = kind[idx];
    if (kd === 'line' || kd === 'arrow' || kd === 'dir' || kd === 'tick') {
      flushItem(idx);
      if (runStart === null) runStart = idx;
      if (kd === 'tick') el('line', { x1: x(idx), y1: mid - 8, x2: x(idx), y2: mid + 8,
                                      stroke: 'currentColor', 'stroke-width': 2 });
    } else {
      flush(idx);
      if (kd === 'item') { if (itemStart === null) itemStart = idx; }
      else flushItem(idx);
    }
  }
  if (labelRaw) {
    // label segments by column: each ⠼… run labels its own start column
    const re = /(?:⠐⠤)?⠼[⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚⠲⠂]+/gu;   // spaces (either kind) skipped by exec
    let m;
    while ((m = re.exec(labelRaw)) !== null) {
      const at = [...labelRaw.slice(0, m.index)].length;
      const r = uebHybrid(m[0]);
      el('text', { x: x(at) + (([...m[0]].length - 1) * CW) / 2, y: H - 6,
                   'text-anchor': 'middle', 'font-size': 14, fill: 'currentColor' },
         (r.latex || m[0]).trim());
    }
  }
  return svg;
}

// END A READER STRING SO A UI SENTENCE CAN FOLLOW IT.
//
// The engine's warnings and ambiguities carry NO terminal punctuation, on
// purpose — ENGINE.md makes them part of the contract and several harnesses
// consume them raw, so the reader must not decide how a caller will present
// them. That left the connector concatenating straight onto one:
//
//   "...a distinction-of-values sign would disambiguate The likeliest reading
//    is shown — worth checking with the child."
//
// Two sentences run together. It matters more here than it looks: this box is
// read ALOUD to the child by a screen reader as well as shown to the teacher,
// and without the break the prosody runs straight on, so the advice sounds
// like part of the diagnosis. The appended clause also used an em dash where
// the engine's own string already has one, which is why this uses a semicolon.
const sentence = (s) => (/[.!?;:]$/.test(String(s).trim()) ? String(s).trim() : `${String(s).trim()}.`);

// HOW THE CHOSEN INSTRUMENT SOUNDS (#82/#83, #102).
//
// Braille music is written at WRITTEN pitch, and several of the instruments a
// primary child actually owns sound somewhere else entirely — a descant
// recorder an octave above, a glockenspiel two. Playback that ignores that is
// confidently wrong in a way the blind child cannot see, which is the whole
// point of #82. The profile also carries the timbre: `wave` names a TIMBRES
// archetype (additive harmonics plus a real ADSR) for every real instrument
// and stays a literal OscillatorType only for the default 'none', so an
// unchosen instrument keeps the exact triangle tone it has always had —
// measured before this went in: 42 oscillators, all type 'triangle', at
// written pitch (C4–A4) for the library's Twinkle.
//
// READ AT CLICK TIME, not at engrave time. The picker lives in Settings, one
// choice for the document, while a page can hold many music rows; reading it
// when the button is pressed means a new choice applies to the very next play
// without re-engraving anything (and without destroying these buttons).




// ---- Import MusicXML: teacher pastes print, gets braille back. Roadmap N3b. ----
//
// parseMusicXML -> per part, toWriterModel (the roundtrip.mjs shape, restated
// for the browser — see musicxml-to-writer-model.mjs) -> writeBraille -> the
// braille cells shown ARE writeBraille's return value verbatim, never a
// reconstruction of it. To engrave and play that braille, it is re-parsed with
// readBrailleMusic — the SAME tested reader a child's own typed music already
// goes through — rather than inventing a second model shape for engraveInto
// and musicRow to understand. A two-hand piece then joins both hands' reader
// models with toKeyboardMusicXML, the same call the typed bar-over-bar path
// feeds — but NOT via readBarOverBar's own text hand-detection: that earns its
// keep by figuring out FROM TEXT which line is which hand (BANA 29.3(b), hand
// sign at true line start), and writeBraille puts the signature before the
// hand sign, so that detector never matches on this app's own output (found
// on screen, not assumed — see the comment at the join site below). We
// already know which model is which hand from the source MusicXML's clef, so
// toKeyboardMusicXML is called directly with that pairing.
//
// Unwritten/ambiguous constructions and everything parseMusicXML declines are
// shown as named notices — never dropped silently (WORKING-RULES rule 1's
// spirit: a decline is incomplete, not wrong, but only if it is SEEN).

// A renamed .mxl (or a paste of one) is binary zip data, not text — sniff the
// zip magic bytes so that case gets ITS OWN named message rather than a
// confusing "not valid XML" parse error.
const looksLikeZip = (text) => text.slice(0, 2) === 'PK';

// Which of exactly two parts is the right hand: the clef is the honest signal
// when present (BANA/print convention: G clef treble = right, F clef bass =
// left — the same convention toKeyboardMusicXML already assumes by index for
// its own default clef), falling back to document order — first part right,
// second left — exactly what toKeyboardMusicXML's DEFAULT_CLEF array assumes
// when no clef is given. Never guessed beyond that: only ever used for
// EXACTLY two parts, so an ensemble score (or a single line) is never
// mis-paired into hands it never claimed to be.
function assignHands(parts) {
  if (parts.length !== 2) return null;
  const [a, b] = parts;
  const signOf = (p) => p.clef && p.clef.sign;
  return (signOf(a) === 'F' && signOf(b) === 'G') ? { right: b, left: a } : { right: a, left: b };
}







// Say what a clicked note IS, in the words a teacher would use. Everything
// here comes from the parsed model, so it describes what the app actually
// read — not a guess from the cells.
const NOTE_VALUE = [
  [4, 'whole note (semibreve)'], [2, 'half note (minim)'], [1, 'quarter note (crotchet)'],
  [0.5, 'eighth note (quaver)'], [0.25, '16th note (semiquaver)'],
  [0.125, '32nd note (demisemiquaver)'], [0.0625, '64th note'], [0.03125, '128th note'],
  [8, 'breve'],
];
const REST_VALUE = { 4: 'whole rest', 2: 'half rest', 1: 'quarter rest', 0.5: 'eighth rest',
                     0.25: '16th rest', 0.125: '32nd rest', 8: 'breve rest' };
const ORDINAL = ['', 'first', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh'];
const ACC_WORD = { [-2]: ' double-flat', [-1]: ' flat', 0: '', 1: ' sharp', 2: ' double-sharp' };
const INTERVAL_WORD = ['', 'unison', 'second', 'third', 'fourth', 'fifth', 'sixth', 'seventh', 'octave'];


// One key lights BOTH panes: the braille span and the notehead(s) share it.

function mathRow(expr, convert, warnings, lineKey = null) {
  const row = document.createElement('div');
  row.className = 'mathrow';
  if (lineKey !== null) row.dataset.lineKey = lineKey;
  let res;
  try {
    res = convert(expr);
  } catch (err) {
    res = { latex: '', warnings: ['could not be read: ' + err.message], badCells: [] };
  }
  const { latex, warnings: w = [], badCells = [] } = res || {};
  const spans = (res && res.spans) || null;

  // Some converters report the position in the text ("… at cell 7"); use that
  // when an explicit badCells list isn't provided.
  const bad = new Set(badCells);
  for (const m of w) {
    const hit = /at cell (\d+)/.exec(String(m));
    if (hit) bad.add(Number(hit[1]));
  }

  const okLatex = latex && latex.trim();
  if (okLatex && !w.length) {
    // a clean row still gets VERIFIED once typing pauses: the reading is
    // round-tripped back to braille, and a difference earns a quiet flag —
    // this is the only net that catches plausible-but-wrong readings
    row.dataset.raw = expr;
    row.dataset.verifyExpr = stripNemethSwitches(expr);
    row.dataset.verifyLatex = latex;
    let rendered = null;
    if (spans && lineKey !== null) {
      const isBalanced = (str) => {
        let d = 0, ld = 0;
        for (let i = 0; i < str.length; i++) {
          if (str[i] === '\\') {
            if (str.slice(i, i+5) === '\\left') ld++;
            else if (str.slice(i, i+6) === '\\right') ld--;
            else if (str[i+1] === '{' || str[i+1] === '}') i++;
            continue;
          }
          if (str[i] === '{') d++;
          else if (str[i] === '}') d--;
        }
        return d === 0 && ld === 0;
      };

      const mergedSpans = [];
      let mGroup = null;
      for (const sp of spans) {
        if (!mGroup) {
          mGroup = { c0: sp.c0, c1: sp.c1, t0: sp.t0, t1: sp.t1 };
        } else {
          const lastFrag = latex.slice(mGroup.t0, mGroup.t1);
          const thisFrag = latex.slice(sp.t0, sp.t1);
          if (/^[a-zA-Z0-9.]+$/.test(lastFrag) && /^[a-zA-Z0-9.]+$/.test(thisFrag)) {
            mGroup.c1 = sp.c1;
            mGroup.t1 = sp.t1;
          } else {
            mergedSpans.push(mGroup);
            mGroup = { c0: sp.c0, c1: sp.c1, t0: sp.t0, t1: sp.t1 };
          }
        }
      }
      if (mGroup) mergedSpans.push(mGroup);

      const wordGroups = [];
      let currentGroup = null;
      for (const sp of mergedSpans) {
        if (!currentGroup) {
          currentGroup = { c0: sp.c0, c1: sp.c1, t0: sp.t0, t1: sp.t1 };
        } else {
          currentGroup.c1 = sp.c1;
          currentGroup.t1 = sp.t1;
        }
        const frag = latex.slice(currentGroup.t0, currentGroup.t1);
        if (isBalanced(frag)) {
          wordGroups.push(currentGroup);
          currentGroup = null;
        }
      }
      if (currentGroup) wordGroups.push(currentGroup);

      let wrapped = '';
      for (const g of wordGroups) {
        const frag = latex.slice(g.t0, g.t1);
        if (!frag.trim()) { wrapped += frag; continue; }
        const inner = `\\class{bw-${lineKey}-${g.c0}-${g.c1}}{${frag}}`;
        if (/^(\+|-|\\times|\\div|\\pm|\\mp)$/.test(frag.trim())) wrapped += `\\mathbin{${inner}}`;
        else if (/^(=|<|>|\\le|\\ge|\\ne|\\approx|\\equiv)$/.test(frag.trim())) wrapped += `\\mathrel{${inner}}`;
        else wrapped += inner;
      }
      try {
        const out = globalThis.temml.renderToString(wrapped, { displayMode: true, trust: true });
        rendered = out.includes('temml-error') ? null : out;
        if (rendered) {
          row.dataset.spans = JSON.stringify(spans);
          row.wordGroups = wordGroups;
        }
      } catch { rendered = null; }
    }
    try {
      row.innerHTML = rendered || globalThis.temml.renderToString(latex, { displayMode: true });
    } catch (err) {
      row.className = 'mathrow partial';
      row.textContent = 'This maths could not be displayed (' + err.message + ')';
    }
    // A CLEAN COPY FOR ASSISTIVE TECH (PB, 2026-08-12). Wrapping each word's
    // LaTeX in \class{} so a click can be anchored to it (just above) splits
    // structures apart: "a^{2}" becomes \class{}{a} followed by \class{}{^{2}},
    // and Temml renders that as <msup><mrow></mrow><mn>2</mn></msup> - an
    // EMPTY base - so a screen reader walking the print pane meets nonsense
    // (see the identical problem, and the same fix, in printBlocks() below).
    // That defect exists only when `rendered` - the wrapped, `trust`-ed render
    // - is what actually went into row.innerHTML just above; when it is
    // falsy, row already holds the plain clean render of `latex`, with no
    // \class wrapping to hide. So only then: hide the interactive render from
    // the accessibility tree, and append a visually-hidden sibling holding a
    // fresh, unwrapped render of the STORED latex - the exact same call
    // printBlocks() uses, so a screen reader and an exported Word document
    // agree on what the maths says. Both steps happen together, inside the
    // try, so a failing clean re-render never leaves the interactive copy
    // hidden with nothing accessible left in its place.
    if (rendered) {
      try {
        const cleanHtml = globalThis.temml.renderToString(latex, { displayMode: true });
        const clean = document.createElement('div');
        clean.className = 'sr-only';
        clean.innerHTML = cleanHtml;
        for (const n of row.children) n.setAttribute('aria-hidden', 'true');
        row.appendChild(clean);
      } catch { /* leave the interactive render as the only, imperfect, accessible copy */ }
    }
    // GENUINE AMBIGUITY (GTM 15.5): the braille reads more than one way and
    // the code deliberately does not say which — the vertical bar serves
    // absolute value, "such that" and "given". The teacher can see the
    // workbook, so the reading is THEIRS to make, never ours to guess.
    // Deduplicated (both bars of |x| are one fact), hidden while typing.
    const amb = (res && res.ambiguities) || [];
    if (amb.length) {
      const seen = new Set();
      const box = document.createElement('div');
      box.className = 'ambig';
      const lead = document.createElement('div');
      lead.className = 'ambig-lead';
      lead.textContent = 'FYI - not an error: this braille can mean more than one thing:';
      box.appendChild(lead);
      for (const a of amb) {
        const key = a.cells + '|' + (a.alternatives || []).join('|');
        if (seen.has(key)) continue;
        seen.add(key);
        const item = document.createElement('div');
        const cells = document.createElement('span');
        cells.className = 'ambig-cells';
        cells.textContent = a.cells;
        item.appendChild(cells);
        // RENDER-IF-DIFFERENT: when the readings produce visibly different
        // maths (Pr vs P·r — upright function vs italic product), show the
        // pictures; when they render identically (the vertical bar), pictures
        // would be three copies of the same thing, so show the meaning labels.
        let rendered = false;
        if (a.latexes && a.latexes.length > 1 && globalThis.temml) {
          try {
            const htmls = a.latexes.map((t) => globalThis.temml.renderToString(t));
            if (new Set(htmls).size > 1) {
              htmls.forEach((h, k) => {
                if (k) item.appendChild(document.createTextNode('  or  '));
                const m = document.createElement('span');
                m.innerHTML = h;
                item.appendChild(m);
                const lbl = document.createElement('span');
                lbl.className = 'repair-how';
                lbl.textContent = ' (' + String((a.alternatives || [])[k] || '').split('-')[1]?.trim() + ')';
                item.appendChild(lbl);
              });
              rendered = true;
            }
          } catch { /* fall back to labels */ }
        }
        if (!rendered) item.appendChild(document.createTextNode((a.alternatives || []).join('  ·  ')));
        box.appendChild(item);
      }
      row.appendChild(box);
    }
    return row;
  }

  // --- something went wrong: degrade visibly, not silently ---
  row.className = 'mathrow partial';
  row.dataset.repairExpr = expr;      // offerRepairs() may be able to say what was meant
  const cells = [...expr];
  const brl = document.createElement('div');
  brl.className = 'partial-brl';
  cells.forEach((c, idx) => {
    const s = document.createElement('span');
    if (bad.has(idx) || bad.has(idx + 1)) s.className = 'badcell';   // 0- and 1-based
    s.textContent = c;
    brl.appendChild(s);
  });
  row.appendChild(brl);

  const msg = document.createElement('div');
  msg.className = 'partial-msg';
  msg.textContent = okLatex
    ? 'Only part of this could be read - the marked cell(s) were not recognised, so this may be incomplete:'
    : 'This maths could not be read. The marked cell(s) were not recognised.';
  row.insertBefore(msg, brl);

  if (okLatex) {
    const part = document.createElement('div');
    part.className = 'partial-math';
    try { part.innerHTML = globalThis.temml.renderToString(latex, { displayMode: true }); }
    catch { part.textContent = latex; }
    row.appendChild(part);
  }
  if (w.length) warnings.push(...w);
  return row;
}

// ---- click-to-link ----
function linkWord(key) {
  document.querySelectorAll('.mlink').forEach((e) => e.classList.remove('mlink'));
  if (!key) return;
  
  const parts = key.split(':');
  if (parts.length === 3 && parts[1] !== 'math') {
    // Math pane click: lineIdx:c0:c1
    // Highlight the exact temml span
    const cls = 'bw-' + key.replace(/:/g, '-');
    document.querySelectorAll(`[class~="${cls}"]`).forEach((e) => e.classList.add('mlink'));
    
    // Highlight the exact braille span (for math blocks, its data-w matches the key)
    document.querySelectorAll(`[data-w="${key}"]`).forEach((e) => e.classList.add('mlink'));
    
    // Highlight overlapping text pane words
    const lineIdx = Number(parts[0]);
    const c0 = Number(parts[1]);
    const c1 = Number(parts[2]);
    const raw = (wordBraille.get(`${lineIdx}:math`) || '').padEnd(c1, ' ');
    
    // Map char indices to word indices
    let wIdx = 0;
    let inWord = false;
    const wordIndices = new Set();
    for (let k = 0; k < raw.length; k++) {
      if (raw[k] === ' ' || raw[k] === '⠀') {
        if (inWord) wIdx++;
        inWord = false;
      } else {
        inWord = true;
        if (k >= c0 && k < c1) wordIndices.add(wIdx);
      }
    }
    for (const wi of wordIndices) {
      const wEls = document.querySelectorAll(`[data-w="${lineIdx}:${wi}"]`);
      wEls.forEach(el => el.classList.add('mlink'));
    }
  } else {
    // Braille pane click: lineIdx:wordIdx (or lineIdx:math)
    const cls = 'bw-' + key.replace(/:/g, '-');
    document.querySelectorAll(`[class~="${cls}"]`).forEach((e) => e.classList.add('mlink'));
    
    if (parts[1] === 'math') {
      // Highlight the entire braille line
      const lineEl = document.querySelector(`[data-w^="${parts[0]}:"]`)?.closest('.line');
      if (lineEl) {
        lineEl.querySelectorAll('.word').forEach(w => w.classList.add('mlink'));
      }
      // AND THE WHOLE PRINT EQUATION (PB, 2026-08-19). Clicking a maths row
      // where there is no term — the space to the right of the expression —
      // already explained and spoke the whole equation, but lit nothing up, so
      // the answer in the status bar belonged to no visible thing. Every
      // anchored glyph in the row carries a bw-<line>- class, so lighting them
      // all lights the expression entire. (.mlink forces inline-block for the
      // ring to draw; MathML is exempted from that a few rules below, which is
      // why a whole equation can be lit without its fractions collapsing.)
      const row = [...$('out').querySelectorAll('.mathrow')]
        .find((r) => r.dataset.lineKey === parts[0]);
      if (row) {
        row.querySelectorAll('[class*="bw-"]').forEach((e) => e.classList.add('mlink'));
      }
    } else {
      document.querySelectorAll(`[data-w="${key}"]`).forEach(e => e.classList.add('mlink'));
    }
  }
}

['braille', 'out'].forEach((id) => {
  $(id).addEventListener('click', (e) => {
    const w = e.target.closest('.word');
    let linkKey = w ? w.dataset.w : '';
    let speechKey = linkKey;
    let termBrl = speechKey ? wordBraille.get(speechKey) : '';

    if (!linkKey) {
      // a click inside a rendered equation: find the anchored glyph or the whole equation
      let el = e.target;
      while (el && el !== e.currentTarget) {
        const m = /(?:^|\s)bw-(\d+)-(\d+)(?:-(\d+))?(?:\s|$)/.exec(el.getAttribute && el.getAttribute('class') || '');
        if (m) { 
          // Set the exact symbol for highlighting
          linkKey = m[0].trim().substring(3).replace(/-/g, ':');
          // ALWAYS map to the whole word so the whole term is selected and spoken
          speechKey = `${m[1]}:math`;
          // Retrieve the raw braille for this line
          const row = el.closest('.mathrow');
          if (row) {
            termBrl = row.dataset.raw || row.dataset.verifyExpr || '';
          }
          break; 
        }
        if (el.classList.contains('mathrow') && el.dataset.lineKey !== undefined) {
          // They clicked the background of the math row (far right), speak whole equation
          speechKey = el.dataset.lineKey + ':math'; // Valid lineIdx prefix
          termBrl = el.dataset.raw || el.dataset.verifyExpr || '';
          linkKey = speechKey; 
          break;
        }
        el = el.parentElement;
      }
      
      // If still no key, check if they clicked a space in the braille pane
      if (!linkKey && e.target.classList && e.target.classList.contains('line')) {
        const line = e.target;
        const words = Array.from(line.querySelectorAll('.word'));
        if (words.length > 0) {
          const lastWord = words[words.length - 1];
          const lastRect = lastWord.getBoundingClientRect();
          if (e.clientX > lastRect.right + 10) {
            // Clicked far right: select whole equation
            const lineIdx = words[0].dataset.w.split(':')[0];
            speechKey = lineIdx + ':math';
            linkKey = speechKey;
            termBrl = wordBraille.get(`${lineIdx}:math`) || toCells(words.map(w => w.textContent).join(' '));
          } else {
            // Clicked between words: find the word to the left
            let wordToLeft = words[0];
            for (const w of words) {
              if (w.getBoundingClientRect().right <= e.clientX) {
                wordToLeft = w;
              }
            }
            linkKey = wordToLeft.dataset.w;
            speechKey = linkKey;
            termBrl = wordBraille.get(linkKey) || toCells(wordToLeft.textContent);
          }
        }
      }
    }
    // Also extract termBrl from braille pane clicks with 3-part key.
    // THE DOM HOLDS THE DISPLAY, NOT THE DOCUMENT (PB, 2026-08-12). In ASCII
    // display mode a word span's textContent is BRF ASCII, and handing that to
    // the describers made every clicked maths sign say "unknown" (and a text
    // word explain nothing). The braille of a word comes from wordBraille,
    // which always holds real cells; anything read out of the DOM as braille
    // goes through toCells() — the loader's own ASCII-to-cells conversion,
    // an identity on cells — before it is treated as braille.
    if (w && linkKey && linkKey.split(':').length === 3 && linkKey.split(':')[1] !== 'math') {
      termBrl = wordBraille.get(linkKey) || toCells(w.textContent);
    }

    linkWord(linkKey);
    explainWord(termBrl, linkKey);
  });
});

// ---- status bar: which braille rules produced this word ----
// We don't pretend to read liblouis's internal rule IDs. Instead we use liblouis
// itself, the same way Emboss's editor does: compare the word against its
// UNCONTRACTED (grade 1) form to say whether contraction happened, and
// back-translate each individual cell to name the contractions actually used.
// opts.silent: explain in the bar but do not say it. Used where the CURSOR
// caused the explanation and the user has turned cursor speech off - a click,
// which is a deliberate "tell me about this word", always speaks.
function explainWord(brl, key = '', opts = {}) {
  const maySpeak = speechOk && !opts.silent;
  const sb = $('statusBar');
  const hint = '<span class="sb-hint">Click a word in either panel to see the braille rules used.</span>';
  if (!brl || !ready) { sb.innerHTML = hint; return; }

  const esc0 = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

  // --- maths: explain the indicators instead of contractions ---
  // The LINE the word came from decides text-vs-maths, not the global
  // checkboxes - per-line modes made those diverge.
  const lineIdx = key ? Number(key.split(':')[0]) : -1;
  const lineMode = lineIdx >= 0 && lineModes[lineIdx] ? lineModes[lineIdx] : currentMode();
  // THE SEGMENT OUTRANKS THE LINE STAMP, both ways - the same precedence the
  // render uses. A text line can carry an inline ⠸⠩…⠸⠱ run, and a word
  // BETWEEN the switches holds no switch of its own, so the line-mode test
  // alone handed Nemeth cells to the literary describer: clicking the
  // fraction in a flagged row explained it as ",througheast;". The word's
  // column comes from the same split model() uses, and segmentsOf - the
  // render's own segmenter - says which mode covers that column. 'base'
  // means the segments have no opinion and the line stamp stands.
  let segMode = null;
  const kp = key ? key.split(':') : [];
  if (lineIdx >= 0 && kp.length >= 2 && kp[1] !== 'math') {
    const lines = buf.split('\n');
    if (lineIdx < lines.length) {
      let carry = 'base', offset = 0;
      for (let li = 0; li < lineIdx; li++) {
        carry = segmentsOf(lines[li], carry, offset).carry;
        offset += lines[li].length + 1;
      }
      const segs = segmentsOf(lines[lineIdx], carry, offset).segs;
      let seg = null;
      if (/^s\d+$/.test(kp[1])) {
        // Mixed-line keys carry the segment index outright: line:sN:word.
        seg = segs[Number(kp[1].slice(1))] || null;
      } else if (kp.length === 3 && /^\d+$/.test(kp[1])) {
        // Term keys carry the column: line:c0:c1.
        const col = Number(kp[1]);
        seg = segs.find((sg) => col >= sg.from && col < sg.to) || null;
      } else if (kp.length === 2 && /^\d+$/.test(kp[1])) {
        // Plain-line keys are line:wordIndex; the column re-derives from the
        // same split model() uses (empties count for position, not for index).
        const toks = lines[lineIdx].split(' ');
        const j = Number(kp[1]);
        let at = 0, seen = 0, col = -1;
        for (let t = 0; t < toks.length; t++) {
          if (toks[t] !== '') { if (seen === j) { col = at; break; } seen++; }
          at += toks[t].length + 1;
        }
        if (col >= 0) seg = segs.find((sg) => col >= sg.from && col < sg.to) || null;
      }
      if (seg && seg.mode !== 'base') segMode = seg.mode;
    }
  }
  // AND WHEN THE KEY SAYS NOTHING, ASK WHERE THE CELLS ARE. Resolving this from
  // the key alone meant enumerating key shapes, and a shape I had not
  // enumerated failed silently to the wrong answer: an inline maths row mints
  // "line.seg" with a DOT, so split(':') gave one part, the block above was
  // skipped, and a UEB maths span in a text line went to the literary reader -
  // "x = of−b±shbin2−4acing2awith'" (user file, 2026-08-23; the same misreading
  // the 19/08 feedback reported, which my first fix closed only for the Nemeth
  // shape). The key stays FIRST because it names the exact word: this looks the
  // cells up by content, so on a line holding the same cells twice it would
  // find the earlier one. As a fallback that is right far more often than the
  // line stamp it replaces.
  let atPos = -1;
  if (lineIdx >= 0) {
    const lines = buf.split('\n');
    if (lineIdx < lines.length) {
      const col = lines[lineIdx].indexOf(brl);
      if (col >= 0) {
        let lineStart = 0;
        for (let li = 0; li < lineIdx; li++) lineStart += lines[li].length + 1;
        atPos = lineStart + col;
      }
    }
  }
  // HALF A SWITCH SIGN IS STILL THE SWITCH SIGN. The maths line is drawn from
  // the parser's groups, which can make each cell separately clickable - so
  // ⠸ and ⠩ became two targets, and the literary reader answered them: "shall"
  // for one and "this braille has no letters" for the other. They are
  // apparatus, and either half should name the whole.
  if (atPos >= 0 && [...brl].length === 1) {
    const before = buf.slice(atPos - 1, atPos + 1), after = buf.slice(atPos, atPos + 2);
    const sign = (before === NEM_OPEN || after === NEM_OPEN) ? 'open Nemeth mode'
               : (before === NEM_CLOSE || after === NEM_CLOSE) ? 'close Nemeth mode' : '';
    if (sign) {
      sb.innerHTML = `<span class="sb-brl" aria-hidden="true">${esc0(brl)}</span>`
                   + `<span class="sb-note" aria-hidden="true">${sign}</span>`
                   + `<span class="sr-only">${sign}</span>`;
      if (speechOk && !opts.silent) speak(sign);
      return;
    }
  }
  if (segMode === null && atPos >= 0) {
    {
      {
        const m = modeAtPos(atPos);
        if (m === 'nem' || m === 'ueb' || m === 'mus') segMode = m;
      }
    }
  }
  const asNem = segMode === 'nem' || (segMode === null && lineMode === 'nem') || hasNemethSwitch(brl);
  const asUeb = !asNem && (segMode === 'ueb' || (segMode === null && lineMode === 'ueb'));
  // A WORD OF PURE LETTERS IS A WORD, whatever mode the line is in (PB,
  // 2026-08-19: "when I click on text it tries to speak it as maths
  // sometimes"). The line's mode is the right default, but it is inherited:
  // loading a maths example ticks the document-wide box, the load-time
  // detector can tick it, and prose typed afterwards is stamped with it. So
  // clicking "dog" answered "Nemeth, 3 cells" and spoke "d o g" instead of
  // "dog" — measured, and deterministic rather than the "sometimes" it feels
  // like from the outside.
  //
  // The maths reader itself supplies the discriminator, so this is not a
  // guess: its entries for plain letters come from the ALPHABET table and are
  // single alphabetic names, while every real sign and every dropped digit
  // carries something else. A word whose every cell reads as a bare letter
  // contains no maths for the maths reader to explain, so the text reader —
  // which knows contractions and can say "dog" — is simply the better witness.
  // A lone variable like x is unaffected in substance: both readers say "x".
  const mathsParts = (asUeb || asNem)
    ? (asUeb ? describeUebMaths(brl) : describeNemeth(brl))
    : null;
  const noMathsInIt = justLetters(mathsParts);
  // ...BUT NOT INSIDE AN EXPLICIT RUN (2026-08-28). That exemption exists for
  // mode INHERITED from the document-wide box, where prose typed after a maths
  // file was stamped as maths and "dog" was spelt out. Where the cells sit
  // inside a run the writer marked - Ctrl+M, or the switch signs themselves -
  // there is nothing to second-guess: a lone letter there is a variable. It was
  // being handed to the literary reader instead, so clicking the x of the
  // quadratic formula answered "it", the contraction ⠭ stands for in prose.
  const inExplicitRun = segMode === 'nem' || segMode === 'ueb' || segMode === 'mus';
  if ((asUeb || asNem) && (inExplicitRun || !noMathsInIt)) {
    const code = asUeb ? 'UEB maths' : 'Nemeth';
    let latex = '';
    try {
      latex = asUeb ? uebHybrid(brl).latex
        : (globalThis.NemethToLatex ? nemethHybrid(brl).latex : '');
    } catch { /* */ }
    const parts = asUeb ? describeUebMaths(brl) : describeNemeth(brl);
    // If the word's row carries provenance, show the word's fragment from the
    // FULL line's reading — context included — rather than re-parsing the
    // chunk in isolation (which loses openers set by earlier chunks).
    if (key && lineIdx >= 0) {
      const partsKey = key.split(':');
      const cls = 'bw-' + key.replace(/:/g, '-');
      const anch = document.querySelector(`[class~="${cls}"]`);
      const row = anch && anch.closest('.mathrow');
      if (row && row.dataset.spans && row.dataset.verifyLatex) {
        try {
          const spans2 = JSON.parse(row.dataset.spans);
          let mine = [];
          if (partsKey.length === 3) {
            const c0 = Number(partsKey[1]), c1 = Number(partsKey[2]);
            mine = spans2.filter(sp => sp.c0 >= c0 && sp.c1 <= c1);
          } else {
            // fallback for old wordIdx format
            const wordIdx = Number(partsKey[1]);
            const expr2 = row.dataset.raw || row.dataset.verifyExpr;
            const cellsArr2 = [...expr2].map((ch) => (ch === ' ' ? '⠀' : ch))
              .filter((ch) => ch.codePointAt(0) >= 0x2800 && ch.codePointAt(0) <= 0x28ff);
            const wordAt2 = (c0) => {
              let wIdx = 0, inWord = false;
              for (let k2 = 0; k2 < c0 && k2 < cellsArr2.length; k2++) {
                if (cellsArr2[k2] === '⠀') { if (inWord) wIdx++; inWord = false; }
                else inWord = true;
              }
              return wIdx;
            };
            mine = spans2.filter((sp) => wordAt2(sp.c0) === wordIdx);
          }
          if (mine.length) {
            latex = mine.map((sp) => row.dataset.verifyLatex.slice(sp.t0, sp.t1)).join('').trim() || latex;
          }
        } catch { /* fall back to isolated parse */ }
      }
    }
    let rendered = '';
    try { rendered = latex ? globalThis.temml.renderToString(latex, { displayMode: false }) : ''; }
    catch { /* */ }
    
    let brlHtml = esc0(brl);
    if (parts.length > 0) {
      brlHtml = parts.map((p, i) => `<span class="sb-seg c${i % 7}">${esc0(p.cells)}</span>`).join('');
    }

    sb.innerHTML =
      `<span class="sb-brl" aria-hidden="true">${brlHtml}</span>` +
      `<span class="sb-arrow" aria-hidden="true">→</span>` +
      `<span class="sb-word" aria-hidden="true">${rendered || esc0(latex) || '-'}</span>` +
      `<span class="sb-note" aria-hidden="true">${code}, ${[...brl].length} cell${[...brl].length === 1 ? '' : 's'}</span>` +
      parts.map((p, i) => `<span class="sb-rule c${i % 7}" aria-hidden="true"><span class="sb-brl">${esc0(p.cells)}</span> = ${esc0(p.name)}</span>`).join('') +
      // Spoken form names the signs — raw LaTeX reads as badly aloud as raw
      // braille glyphs do ("backslash frac open brace …").
      `<span class="sr-only">${esc0(code)}, ${[...brl].length} cell${[...brl].length === 1 ? '' : 's'}.` +
        (parts.length ? ' Signs used: ' + esc0(parts.map((p) => p.name).join(', ')) + '.'
                      : (latex ? '' : ' Not recognised.')) + `</span>`;
                      
    if (maySpeak) {
      // Use semantic math speech if possible by parsing the chunk
      const parseRes = asUeb ? uebMathsToLatexV2(brl) : nemethMathsToLatexV2(brl);
      const speechText = speakMaths(parseRes, parts);
      if (speechText) speak(speechText);
    }
    return;
  }

  const text = bt(brl);
  if (!text) { sb.innerHTML = hint; return; }

  const cells = [...brl].length;
  // CELLS WITH NO LETTER IN THIS CODE ARE REPORTED, NOT GRADED. bt() turns
  // liblouis's own \456/ notation into a plain "?", and without this the
  // contraction test then measured that question mark against its own braille
  // and announced "1 cell for 1 character - contracted", which is a confident
  // answer about a cell we just admitted we cannot read.
  if (text.includes(UNREADABLE)) {
    const n = (text.match(/\?/g) || []).length;
    const where = escMsg(codeLabel(codeById(settings.brailleCode)).replace(/\s*—\s*/g, ' '));
    const msg = n === cells
      ? `This braille has no letters in ${where}.`
      : `Part of this braille has no letters in ${where}.`;
    sb.innerHTML =
      `<span class="sb-brl" aria-hidden="true">${esc0(brl)}</span>` +
      `<span class="sb-note" aria-hidden="true">${msg}</span>` +
      `<span class="sr-only">${msg}</span>`;
    if (maySpeak) speak(msg);
    return;
  }
  const segs = alignWord(brl, text);
  const missed = contractionFor(brl);
  // "Contracted" must be proved, not assumed. For English UEB the boot-loaded
  // grade-1 table gives the comparison figure. For every OTHER code that same
  // table was still being used, and it fabricated: a Thai or Arabic word came
  // back as a garbled string of escape cells, always longer, so the verdict
  // said "contracted" about a grade-1 code with a comparison figure in the
  // wrong code entirely. Elsewhere the proof is the active table's own
  // position map: a segment covering more than one character IS a contraction.
  const isEnUeb = settings.brailleCode === 'en-ueb-g2' || settings.brailleCode === 'en-ueb-g1';
  let g1 = '', g1cells = 0;
  if (isEnUeb) {
    try { g1 = louis.translate(text, T_UEB_G1); } catch { /* */ }
    g1cells = [...g1.replace(/\s/g, '')].length;
  }
  // true / false / null = cannot tell (say nothing rather than guess)
  const contracted = isEnUeb ? g1cells > cells
    : (segs ? segs.some((sg) => sg.chars.length > 1) : null);

  const esc = (s) => String(s).replace(/[&<>"]/g, (c) =>
    ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));
  const plural = (n) => `${n} cell${n === 1 ? '' : 's'}`;
  // "works." is 5 letters + a full stop - call them characters, not letters.
  const chars = `${text.length} character${text.length === 1 ? '' : 's'}`;

  // Colour-matched cell ↔ character pairs, straight from liblouis's own mapping.
  let brlHtml = esc(brl), txtHtml = esc(text), rules = [];
  if (segs) {
    brlHtml = segs.map((s, i) => `<span class="sb-seg c${i % SEG_COLOURS}">${esc(s.cells)}</span>`).join('');
    txtHtml = segs.map((s, i) => `<span class="sb-seg c${i % SEG_COLOURS}">${esc(s.chars)}</span>`).join('');
    // A segment covering more than one character IS a contraction, and its
    // meaning is exactly those characters — no guessing required.
    rules = segs.filter((s) => s.chars.length > 1)
                .map((s) => ({ cell: s.cells, meaning: s.chars }));
  }

  const summary = (contracted
    ? `${text}: ${plural(cells)} for ${chars} - contracted`
    : contracted === false
      ? `${text}: spelt out in ${plural(cells)}`
      : `${text}: ${plural(cells)} for ${chars}`)
    + (missed ? `. It could also be written in ${plural([...missed].length)}` : '');

  sb.innerHTML =
    `<span class="sb-brl" aria-hidden="true">${brlHtml}</span>` +
    `<span class="sb-arrow" aria-hidden="true">→</span>` +
    `<span class="sb-word" aria-hidden="true">${txtHtml}</span>` +
    `<span class="sb-note" aria-hidden="true">${plural(cells)} for ${chars}` +
      (contracted
        ? ` - <strong>contracted</strong>${isEnUeb ? ` (uncontracted <span class="sb-brl">${esc(g1)}</span>, ${plural(g1cells)})` : ''}`
        : contracted === false ? ' - no contraction, spelt out' : '') +
    `</span>` +
    // A CONTRACTION WAS AVAILABLE (PB, 2026-08-19). The ding says something was
    // missed; this says WHAT, which is the part that teaches. Shown, never
    // scored: liblouis offers one valid spelling and braille has legitimate
    // alternatives, so the wording offers rather than corrects.
    (missed
      ? `<span class="sb-note sb-missed" aria-hidden="true">could also be written ` +
        `<span class="sb-brl">${esc(missed)}</span>, ${plural([...missed].length)}</span>`
      : '') +
    rules.map((r) => `<span class="sb-rule" aria-hidden="true"><span class="sb-brl">${esc(r.cell)}</span> = &ldquo;${esc(r.meaning)}&rdquo;</span>`).join('') +
    // "cell mapping unavailable" means the typed cells are not liblouis's own
    // spelling, so it cannot line cells up with letters. When a contraction was
    // available that IS the reason, and the note above has just said so in
    // useful words — repeating it as a failure would read as a second, darker
    // complaint about the same thing.
    (segs || missed ? '' : `<span class="sb-note" aria-hidden="true">(cell mapping unavailable)</span>`) +
    // Plain English for speech — raw braille glyphs read poorly aloud.
    `<span class="sr-only">${esc(summary)}` +
      (rules.length ? '. ' + esc(rules.map((r) =>
        `${plural(r.cell.length)} for “${r.meaning}”`).join(', ')) : '') + `.</span>`;
        
  if (maySpeak) {
    speak(text);
  }
}

const SEG_COLOURS = 7;

// Align braille cells to source characters using liblouis's OWN position map
// (translatePos → inputPos[j] = the input character that produced cell j), rather
// than inferring it. We forward-translate the text and only trust the alignment if
// it reproduces exactly the cells that were typed; otherwise we say so instead of
// showing a plausible-looking guess.
function alignWord(brl, text) {
  // The ACTIVE code's table, not a hardwired English one: with English g2 here,
  // every other code (including English g1) failed the reproduce check below and
  // fell to "(cell mapping unavailable)". The guard keeps the honesty either way.
  //
  // AND ITS UNCONTRACTED SIBLING AS A SECOND ASK (feedback, 2026-08-19:
  // "highlighting inconsistent - sometimes uncontracted words are highlighted,
  // sometimes they are not"). The tester's hunch was exactly right: the
  // contracted table cannot reproduce a word the child SPELT OUT, so alignment
  // failed and the colours vanished - for "print" but not for "tool", the
  // difference being only that "print" had a contraction going spare. Asking
  // the uncontracted table next reproduces those cells and pairs them
  // correctly. The reproduce check still guards every answer, so a spelling
  // neither table writes is still declined rather than guessed at.
  let res = null;
  for (const table of [T_TEXT(), uncontractedSibling()]) {
    if (!table) continue;
    try {
      const r = louis.translatePos(text, table);
      if (r && r.braille === brl) { res = r; break; }
    } catch { /* an unloaded table simply cannot answer */ }
  }
  if (!res) return null;
  const pos = res.inputPos;
  const n = brl.length;
  if (!pos || pos.length < n) return null;
  const segs = [];
  let j = 0;
  while (j < n) {
    const start = pos[j];
    let k = j;
    while (k + 1 < n && pos[k + 1] === start) k++;     // cells sharing one start char
    const nextStart = (k + 1 < n) ? pos[k + 1] : text.length;
    if (!(nextStart >= start)) return null;            // non-monotonic → don't trust it
    segs.push({ cells: brl.slice(j, k + 1), chars: text.slice(start, nextStart) });
    j = k + 1;
  }
  return segs;
}

// ---- speech trigger on word boundary ----
// isWord: the CALLER has established that this token is ordinary text — a word
// of pure letters — even though maths mode is on. Without that, the maths-mode
// guard below refused it and the word went unspoken, which is what PB heard as
// "speak word mode is on but the words were not speaking".
function maybeSpeak(finishedBraille, isWord = false) {
  if (!speechOk) return;
  // Same question as above: maths that is not a plain word is not read out as
  // literary braille, whether the maths comes from the document setting or from
  // the span the cells actually sit in.
  if (!isWord && modeOfFinished(finishedBraille)) return;
  if (!settings.speakWord && !settings.speakSentence) return;
  if (!finishedBraille.trim() || hasNemethSwitch(finishedBraille)) return;
  const word = bt(finishedBraille);
  if (!word) return;
  // Sentence wins: when a sentence ends we speak ONLY the sentence, never the
  // word as well, so the two can't overlap.
  if (settings.speakSentence && endsSentence(word)) {
    speak(lastSentence(allText(model(buf))));
  } else if (settings.speakWord) {
    speak(word);
  }
}

// ---- input ----
// THE WORD THAT WAS JUST FINISHED IS THE ONE AT THE CARET, not the one at the
// end of the document (2026-08-24). Callers passed the WHOLE buffer, so
// pressing space anywhere but the very end announced the last word of the
// document instead of the word under the hands. Ctrl+M makes that the normal
// case rather than an edge one: it leaves the caret BETWEEN the two switch
// signs, so a child writing Nemeth typed a sum, pressed space, and heard
// nothing at all - the "token" collected was the whole line including both
// switches, which the speech then refused as apparatus. It equally hit anyone
// going back to fix a word earlier in their work.
const trailingToken = (s) => {
  const i = Math.max(s.lastIndexOf(' '), s.lastIndexOf('\n'));
  return s.slice(i + 1);
};

// A TOGGLE, not a cycle (PB, 2026-08-09). With the code chosen in Settings
// there are only two states worth reaching from the keyboard: text, and
// maths in the code you picked. Music is hidden in Translate, so it is not
// reachable here either — but 'mus' still maps OUT, so a document loaded
// with music sections leaves that state cleanly.
// FROM HERE, NOT THIS WHOLE LINE (PB, 2026-08-11). Switching to maths used
// to re-mode the line, so a sentence already written was reinterpreted as
// maths under the writer. It now writes the switch INTO the document at the
// caret, which is what a braille reader does on paper — and because the
// mark is made of cells, Save, Export and eBraille carry it without any of
// them needing to know this feature exists.
// A CLOSED GROUP, AND THE CARET GOES INSIDE IT (PB, 2026-08-11).
//
// Inserting only an OPENING mark meant everything to the right became
// maths — the rest of the sentence and, because a passage carries across
// line ends, the rest of the document. That is right when you are typing at
// the end and wrong every other time: you cannot drop an expression INTO a
// sentence without swallowing the sentence.
//
// So the pair is written together and the caret is put between them. The
// text to the right is never inside the group, because the group is already
// closed before a single cell of maths is typed.
//
// SHARED BY CTRL+M/CTRL+I AND THE HEADER CHECKBOX (PB, 2026-08-12). The
// checkbox used to set a document-wide sticky mode of its own; it now just
// MARK (OR UNMARK) A SELECTION AS MATHS. Returns false when the selection is
// not something we can answer for, so the caller falls through to its ordinary
// behaviour rather than guessing.
function markSelectionAsMaths(a, b) {
  const insideAll = mathSpans.find((sp) => a >= sp.from && b <= sp.to);
  if (insideAll) {                       // already maths: unmark it
    mathSpans = mathSpans.filter((sp) => sp !== insideAll);
    render();
    speak('not maths any more');
    return true;
  }
  // A selection that only PARTLY covers a run, or that holds one switch sign
  // without its partner, has no honest answer - wrapping it would nest or
  // orphan the marks. Say so and change nothing.
  const straddles = mathSpans.some((sp) => (a < sp.to && b > sp.from));
  const open = (buf.slice(a, b).match(new RegExp(NEM_OPEN, 'g')) || []).length;
  const close = (buf.slice(a, b).match(new RegExp(NEM_CLOSE, 'g')) || []).length;
  if (straddles || open !== close) {
    speak('That selection is partly maths already, so nothing has changed');
    return true;
  }
  modeAppliesToAll = false;
  if (settings.mathsCode === 'ueb') {
    // UEB writes no cells: the run is remembered as a range.
    mathSpans.push({ from: a, to: b, closed: true });
    caret = b;
  } else {
    buf = buf.slice(0, a) + NEM_OPEN + buf.slice(a, b) + NEM_CLOSE + buf.slice(b);
    caret = b + NEM_OPEN.length + NEM_CLOSE.length;
  }
  render();
  speak(settings.mathsCode === 'ueb' ? 'Marked as UEB maths' : 'Marked as Nemeth');
  return true;
}

// mirrors the caret (see syncMathsCheckbox()) and, on a click, performs
// EXACTLY this same toggle — so there is one definition of "what toggling
// maths at the caret means", not two that could drift apart.
// THE MATHS BUTTON ACTS ON WHAT YOU HAVE (PB, 2026-08-28). It used to do one
// thing — open a run at the caret — and ignore everything else about the
// situation, which made two reasonable actions do the wrong thing:
//
//   • Select a sum and press it, and the selection was thrown away, an EMPTY
//     run opened at its start, and the open run swallowed the rest of the line
//     ("the cat ½ the dog" came out as "the cat 12∫dog"). Marking a sum that
//     loaded as text is the natural repair, and it did the opposite.
//   • Load a file and press it, and the document stayed text — though the help
//     promised "after Load, choosing a mode applies to the whole document",
//     and the detector's own advice ("tick the Maths box if it is") relied on
//     it. Both were left saying something the button no longer did.
//
// So the button now reads the situation: a SELECTION is marked as maths, a
// freshly LOADED document is read as maths whole, and otherwise a run opens at
// the caret exactly as before.
function toggleMathsAtCaret() {
  const ta = $('brlInput');
  const selA = ta ? Math.min(ta.selectionStart, ta.selectionEnd) : caret;
  const selB = ta ? Math.max(ta.selectionStart, ta.selectionEnd) : caret;
  if (selB > selA && markSelectionAsMaths(selA, selB)) return;
  // Nothing typed since the file arrived: the choice is about the whole of it.
  if (modeAppliesToAll && buf.trim() && !spanAt(caret) && !hasNemethSwitch(buf)) {
    const code = settings.mathsCode === 'ueb' ? 'ueb' : 'nem';
    const turningOn = !(uebMathsOn() || nemethOn());
    $('uebMaths').checked = turningOn && code === 'ueb';
    $('nemethMaths').checked = turningOn && code === 'nem';
    $('mathsMode').checked = turningOn;
    lineModes.length = 0;
    render();
    speak(turningOn
      ? `The whole document is now ${code === 'ueb' ? 'UEB maths' : 'Nemeth'}`
      : 'The whole document is now text');
    return;
  }
  const at = modeAtCaret();
  const isMaths = at === 'ueb' || at === 'nem';
  modeAppliesToAll = false;        // the document now carries its own modes

  if (isMaths) {
    // ALREADY IN MATHS: leave it rather than nesting. Pressing the same key
    // that got you in is how you get out, landing to the RIGHT of the run.
    const sp = spanAt(caret);
    if (sp) { sp.closed = true; caret = sp.to; render(); speak('out of maths'); return; }

    // WHICH KIND OF MATHS IS THIS? (PB, 2026-08-19). There are two sources: a
    // run written INTO the document, and the document-wide setting. Stepping
    // out of a run means writing or passing its closing sign; stepping out of
    // the SETTING means turning the setting off. Conflating them was a trap
    // the user could not escape: with whole-document Nemeth on and an empty
    // document, the box always read ticked (the caret IS in maths), unticking
    // it wrote an orphan ⠸⠱, and deleting that returned to the same state —
    // "an end maths sign which I can't delete and then go into text mode".
    const before = buf.slice(0, caret);
    const lastOpen = before.lastIndexOf(NEM_OPEN);
    const inWrittenRun = lastOpen >= 0 && lastOpen > before.lastIndexOf(NEM_CLOSE);
    if (at === 'nem' && inWrittenRun) {
      const idx = buf.indexOf(NEM_CLOSE, caret);
      if (idx >= 0) { caret = idx + NEM_CLOSE.length; render(); speak('out of maths'); return; }
      // A passage left open. Close it where we stand rather than walking the
      // caret to a sign that does not exist.
      buf = buf.slice(0, caret) + NEM_CLOSE + buf.slice(caret);
      caret += NEM_CLOSE.length;
      render();
      speak('out of maths');
      return;
    }
    // The maths comes from the SETTING, so that is what to turn off — and the
    // per-line modes go with it, or the lines would keep a maths mode the
    // document no longer claims.
    $('uebMaths').checked = false;
    $('nemethMaths').checked = false;
    lineModes.length = 0;
    render();
    speak('out of maths');
    return;
  }

  if (settings.mathsCode === 'ueb') {
    // NOT A SINGLE CELL IS WRITTEN. The run is remembered as a range and the
    // braille stays exactly what the writer typed.
    mathSpans.push({ from: caret, to: caret, closed: false });
    render();
    speak('UEB maths, type the expression');
    return;
  }

  buf = buf.slice(0, caret) + NEM_OPEN + NEM_CLOSE + buf.slice(caret);
  caret += NEM_OPEN.length;         // between the two signs, where the maths goes
  render();
  speak('Nemeth, type the expression');
  return;
}

document.addEventListener('keydown', (e) => {
  // Ctrl+I (I for Input) cycles the INPUT mode: Text → UEB Maths → Nemeth →
  // Text. The mode sticks to lines typed from now on; earlier lines keep
  // theirs. Announced in speech so a child knows the mode changed without
  // sight. Ctrl+M is kept as a quiet alias (the original binding). Plain Tab
  // is deliberately NOT bound: it must keep moving focus to the buttons for
  // keyboard and screen-reader users.
  // SAY THIS LINE — Ctrl+Shift+L, twice to spell it (PB, 2026-08-11).
  //
  // WHY NOT THE SCREEN READER'S OWN KEY. JAWS and NVDA both read the current
  // line with their modifier plus Up Arrow (Insert+Up, or Caps Lock+Up on the
  // laptop layouts; NVDA+L in NVDA's laptop layout). A web page never sees that
  // — the reader takes it first — and that is correct, not a limitation: with
  // the braille pane now a real textarea, Insert+Up already reads the line in
  // the reader's OWN voice and verbosity, which beats anything written here.
  //
  // So this key is for the people who have no screen reader running: a child
  // using the app's own voice, and the sighted teacher beside them.
  //
  // Ctrl+Shift+L is safe where the obvious candidates are not. Ctrl+L is
  // Chrome's address bar; Ctrl+Shift+Up already extends the selection inside a
  // text field; Alt+letter trips Windows menu accelerators; and Ctrl+Alt+letter
  // is AltGr on European keyboards, which a multilingual app cannot take.
  //
  // L IS ALSO DOT 6. It cannot reach six-key entry, because the modifier guard
  // below returns before the dot handler — but that is a fact about the order of
  // two blocks in one function, so it is asserted in the tests rather than
  // trusted.
  if (e.ctrlKey && e.shiftKey && !e.metaKey && !e.altKey && e.code === 'KeyL') {
    e.preventDefault();
    sayCurrentLine();
    return;
  }
  // Ctrl+Arrow (Windows) or Option+Arrow (Mac — macOS keeps Ctrl+Arrow for
  // Mission Control) steps the caret by MATHEMATICAL TERM on a maths line.
  // Handled only when moveByMathsTerm found terms to step through; anywhere
  // else the keys keep their native word movement.
  if ((e.ctrlKey || e.altKey) && !e.metaKey && !e.shiftKey
      && (e.code === 'ArrowLeft' || e.code === 'ArrowRight')
      && document.activeElement === $('brlInput')) {
    if (moveByMathsTerm(e.code === 'ArrowRight' ? 1 : -1)) { e.preventDefault(); return; }
  }
  if (e.ctrlKey && !e.metaKey && !e.altKey && (e.code === 'KeyI' || e.code === 'KeyM')) {
    e.preventDefault();
    toggleMathsAtCaret();
    return;
  }
  // A modifier pressed mid-chord means the chord is abandoned (Cmd+Tab is the
  // classic: its keyups go to the other app). Clearing here catches it BEFORE
  // the window even blurs. Escape is the explicit unlock for the same state —
  // "press Escape if the keys stop responding" is a story support can tell.
  // CONTROL SILENCES THE APP'S VOICE (PB, 2026-08-19). Control is the
  // universal "stop talking" of screen readers, so a child who already knows
  // one will reach for it here — and until now this app carried on. Pressed
  // ALONE it just stops; pressed as part of Ctrl+M or Ctrl+Shift+L it stops
  // first and the shortcut then says its own piece, which is what should
  // happen anyway. In "Screen reader" mode there is nothing of ours in
  // flight to cancel — the reader owns that speech, and Control already
  // stops it at the system level.
  if (e.key === 'Control' || e.ctrlKey) stopSpeech();
  if (e.metaKey || e.ctrlKey || e.altKey) { abandonChord(); return; }
  if (e.code === 'Escape') { abandonChord(); return; }
  // Don't braille into the page while the Help dialog is up.
  if ($('helpDialog').open || $('confirmDialog').open) return;
  // Let form controls AND buttons keep their keyboard behaviour, so a screen-reader
  // user can tab to Save/Load/Clear/Settings and press Space or Enter normally.
  // Form controls keep their own keyboard behaviour — EXCEPT the braille field,
  // which is where six-key chords are now typed. Without this exception the
  // guard would silently disable braille entry the moment the field had focus,
  // which is always.
  if (e.target && e.target.id !== 'brlInput'
      && /^(INPUT|SELECT|TEXTAREA|BUTTON)$/.test(e.target.tagName)) return;
  // Six-key entry can be turned off (PB, 2026-08-09), which frees S D F J K L
  // for anything else. Checked before preventDefault, or the keys would still
  // be swallowed while doing nothing — the worst of both.
  const bit = settings.sixKey ? SK_DOT[e.code] : 0;
  if (bit) {
    e.preventDefault();
    stopSpeech();                       // any braille key interrupts speech
    modeAppliesToAll = false;           // typing pins modes to lines again
    // THE SELECTION MUST BE TAKEN AT THE START OF THE CHORD (PB, 2026-08-19).
    // The commit happens on the final key UP, and by then the selection is
    // gone: the first key down calls render(), which calls syncField, which
    // collapses the field's selection to the caret. Captured here, on the
    // first key of the chord, while it still exists.
    if (!held.size) {
      const fld = $('brlInput');
      chordSel = (fld && fld.selectionEnd > fld.selectionStart)
        ? { a: fld.selectionStart, b: fld.selectionEnd } : null;
    }
    if (!held.has(e.code)) { held.add(e.code); chord |= bit; render(); }
    return;
  }
  // SIX-KEY IS EXCLUSIVE, NOT MERELY ADDITIVE (PB, 2026-08-12). The chord
  // check above claims only S D F J K L; every OTHER printable key used to
  // fall through to the field and be typed as BRF ASCII. That is correct
  // when six-key is off — it is how braille gets typed then — but wrong when
  // six-key is on: a child chording on S D F / J K L should not also be able
  // to roll "cat" straight off the QWERTY row. Space still finishes a word,
  // and Enter, Backspace, the arrows, Home/End, Delete and every modifier
  // shortcut are untouched: none of them has e.key.length === 1 except
  // space, which is explicitly spared here.
  if (settings.sixKey && document.activeElement === $('brlInput') && e.key.length === 1
      && !e.ctrlKey && !e.metaKey && !e.altKey
      && !['s', 'd', 'f', 'j', 'k', 'l', ' '].includes(e.key.toLowerCase())) {
    e.preventDefault();
    return;
  }
  // NATIVE WHEN THE FIELD HAS FOCUS (PB, 2026-08-19). The browser makes the
  // edit — consuming any selection, keeping undo, and presenting a real user
  // edit to assistive technology — and beforeinput/afterNativeEdit carry the
  // speech. The programmatic path below still serves the case where the field
  // does NOT have focus, since there is then no native edit to let through.
  if ((e.code === 'Space' || e.code === 'Enter' || e.code === 'Backspace' || e.code === 'Delete')
      && document.activeElement === $('brlInput')) {
    stopSpeech();
    // If the key would change nothing, there will be no edit to follow, so
    // answer here and swallow it rather than leaving a capture in the air.
    if (!captureNativeEdit(e.code, $('brlInput'))) { e.preventDefault(); return; }
    return;                       // deliberately no preventDefault: the browser edits
  }
  if (e.code === 'Space' || e.code === 'Enter') {
    e.preventDefault();
    stopSpeech();
    const rawFinished = trailingToken(buf.slice(0, caret));
    const hadSwitch = hasNemethSwitch(rawFinished);
    const finished = hadSwitch ? stripNemethSwitches(rawFinished) : rawFinished;
    const sep = e.code === 'Space' ? ' ' : '\n';
    buf = buf.slice(0, caret) + sep + buf.slice(caret);
    caret += 1;
    render();
    const fMode = hadSwitch ? 'nem' : modeOfFinished(rawFinished);
    const finishedIsWord = finished.trim() && justLetters(
      (fMode === 'nem' || hasNemethSwitch(finished)) ? describeNemeth(finished)
                                                     : describeUebMaths(finished));
    if (speechOk && (settings.speakWord || settings.speakSentence)
        && fMode && finished.trim() && !finishedIsWord) {
      
      // If speakSentence is enabled, parse and speak the whole current line.
      // Otherwise, just parse and speak the finished word.
      const textToSpeak = settings.speakSentence ? buf.split('\n').pop() : finished;
      
      const asNem = fMode === 'nem' || hasNemethSwitch(textToSpeak);
      const asUeb = !asNem && fMode === 'ueb';
      const parseRes = asUeb ? uebMathsToLatexV2(textToSpeak) : nemethMathsToLatexV2(textToSpeak);
      const speechText = speakMaths(parseRes,
        asUeb ? describeUebMaths(textToSpeak) : describeNemeth(textToSpeak));
      if (speechText) speak(speechText);
    } else {
      // The nudge goes BEFORE the word is spoken, so the two do not collide:
      // the ding lands in the gap while speech is still being scheduled.
      if (finished.trim() && missedContraction(finished)) ding();
      maybeSpeak(finished, finishedIsWord);   // may start the new word/sentence
    }
    return;
  }
  // NAVIGATION IS NATIVE (PB, 2026-08-09). Arrows, Home, End, PageUp/PageDown
  // and every selection gesture belong to the textarea. Nothing here may
  // preventDefault them: a braille display's cursor-routing keys and its
  // panning are the platform moving that caret, and intercepting the keys is
  // exactly how an app breaks them. The app's own `caret` follows the field
  // through selectionchange, never the other way round.
  // Delete removes the cell UNDER the caret, where backspace removes the one
  // behind it. Both say what went.
  if (e.code === 'Delete') {
    e.preventDefault();
    stopSpeech();
    if (caret >= buf.length) { if (settings.speakLetter) speak('end'); return; }
    const gone = buf[caret];
    buf = buf.slice(0, caret) + buf.slice(caret + 1);
    render();
    speak('delete ' + describeCell(gone));
    return;
  }

  if (e.code === 'Backspace') {
    e.preventDefault();
    stopSpeech();
    // SAY WHAT WENT (PB, 2026-08-09). A child who cannot see the pane had no
    // way to know WHICH cell backspace took — only that something happened.
    // The letter is preferred over the cell, because "delete c" is what the
    // child meant to write; the dot numbers are the fallback when a cell has no
    // letter of its own (a contraction, a prefix, a sign).
    if (caret === 0) { render(); return; }        // nothing to the left
    const gone = buf[caret - 1];
    buf = buf.slice(0, caret - 1) + buf.slice(caret);
    caret -= 1;
    render();
    if (gone) speak('delete ' + describeCell(gone));
  }
});
// MATHCAT SPEAKS THE MATHS (PB, 2026-08-11), with our own speaker behind it.
//
// The order is deliberate. MathCAT's rules are the ones we already trust for
// the braille a child reads, and they say a whole expression as a sentence;
// ours covers 13 node types and then falls back to reading out a list of
// symbol NAMES, which is what "doesn't speak very well" sounds like.
//
// But the chain to MathCAT is longer — braille, to LaTeX, to MathML, to speech
// — so a misparse becomes a confidently spoken WRONG equation. It is therefore
// tried only when the parse produced LaTeX, and anything it declines falls
// straight through to the old path. Never to silence.
//
// Language follows the chosen voice, so the maths is spoken in the language the
// rest of the app is speaking; verify.mjs maps anything unsupported to English.
function speakMaths(parseRes, fallbackParts, verbosity) {
  const latex = parseRes && parseRes.latex;
  const voice = voices.find((v) => v.voiceURI === settings.voiceURI);
  // Verbosity is a choice about the LISTENER, not about the expression, so the
  // caller owns it. Everything speaks Terse — "square root, 9" — except a
  // deliberate second listen, which asks for Medium: "the square root of 9".
  const said = latex
    ? speakLatex(latex, { language: (voice && voice.lang) || 'en', ...(verbosity ? { verbosity } : {}) })
    : '';
  if (said) return said;
  if (parseRes && parseRes.ast) {
    const ours = speakAst(parseRes.ast);
    if (ours) return ours;
  }
  return fallbackParts && fallbackParts.length
    ? fallbackParts.map((p) => p.speech || p.name).join(' ') : '';
}

// SAY THE LINE THE CARET IS ON; SAY IT AGAIN TO SPELL IT.
//
// Repeating the command to spell is NVDA's convention, and it is the thing a
// child actually needs: the first press says what they wrote, the second says
// which cells they wrote it with. A cell with no letter of its own is named by
// its dots, exactly as backspace already names what it removed.
//
// Maths lines are read as maths, not as letters. A line of Nemeth read out as
// literary text is gibberish, and the machinery to read it properly is already
// here — the same path that speaks a finished expression.
let lastSayLineAt = 0;
let lastSayLineIndex = -1;
const SAY_LINE_REPEAT_MS = 1500;   // a deliberate second press, not a stutter

function sayCurrentLine(fromCaretMove = false) {
  if (!speechOk) return;
  const lines = model(buf);
  const before = buf.slice(0, caret);
  const li = Math.min((before.match(/\n/g) || []).length, Math.max(0, lines.length - 1));
  const ln = lines[li];
  if (!ln) return;

  // A caret move that lands on a line reads it PLAINLY and leaves the
  // double-press timer alone: arrowing onto a line and then pressing
  // Ctrl+Shift+L is a FIRST press (read), never a surprise spelling.
  const again = !fromCaretMove && li === lastSayLineIndex
             && (performance.now() - lastSayLineAt) < SAY_LINE_REPEAT_MS;
  if (!fromCaretMove) {
    lastSayLineAt = performance.now();
    lastSayLineIndex = li;
  }

  const raw = ln.raw;
  if (!raw.trim()) { speak(li + 1 === lines.length ? 'blank line' : 'blank line ' + (li + 1)); return; }

  // WHAT A SECOND LISTEN SHOULD BE DEPENDS ON THE KIND OF LINE (PB, 2026-08-11).
  //
  // On a line of WORDS the useful second reading is the spelling: which cells
  // made that word. On a line of MATHS it is not — "dots 1 4 5 6, dots 2,
  // dots 3 4…" tells a child almost nothing about a fraction. There the useful
  // second reading is the SAME maths said more fully, which is what MathCAT's
  // Medium verbosity is for: "the square root of 9" where Terse said
  // "square root, 9", and every structure named where Terse leans on pauses.
  const mode = lineModes[li] || currentMode();
  const asNem = mode === 'nem' || hasNemethSwitch(raw);
  const asUeb = !asNem && mode === 'ueb';
  if (asNem || asUeb) {
    const parseRes = asUeb ? uebMathsToLatexV2(raw) : nemethMathsToLatexV2(raw);
    const parts = asUeb ? describeUebMaths(raw) : describeNemeth(raw);
    const said = speakMaths(parseRes, parts, again ? 'Medium' : undefined);
    if (said) { speak(said); return; }
    // Maths that could not be read falls through: spelling it is then the most
    // useful thing left, because the cells are all anyone can go on.
  }

  if (again) {
    // SPELL IT: every cell named, in order, spaces announced.
    speak([...raw].map((c) => describeCell(c)).join(', '));
    return;
  }
  const text = ln.words.map(bt).join(' ').trim();
  // Nothing readable back — say the cells rather than nothing at all.
  speak(text || [...raw].map((c) => describeCell(c)).join(', '));
}

document.addEventListener('keyup', (e) => {
  const bit = settings.sixKey ? SK_DOT[e.code] : 0;
  if (!bit) return;
  e.preventDefault();
  held.delete(e.code);
  if (held.size === 0 && chord) { 
    const justTyped = cell(chord);
    // A CHORD REPLACES A SELECTION (PB, 2026-08-19). Every other edit is now
    // the browser's, and a native edit consumes the selected text — but a
    // chord has no native edit to inherit that from, so it must do it here or
    // typing over a selected run would insert in front of it and leave it
    // standing, which is what the app did. Field indices ARE buf indices (one
    // character in the field is one cell in buf, in both display modes), so
    // the field's own selection can be used directly.
    const selA = chordSel ? chordSel.a : caret;
    const selB = chordSel ? chordSel.b : caret;
    chordSel = null;
    buf = buf.slice(0, selA) + justTyped + buf.slice(selB);
    caret = selA + justTyped.length;
    chord = 0; 
    // SPEAK EACH LETTER (PB, 2026-08-09), grade 1. Deliberately not gated on
    // the maths modes below: a child learning uncontracted braille wants to
    // hear every cell, whatever the line is.
    // MATHS ECHO FOLLOWS THE SAME THREE SWITCHES AS TEXT (PB, 2026-08-19).
    // Users found typing maths confusing, and the two reasons were both here:
    // the letter echo named cells with describeCell, which is context-blind
    // ("dots 3 4 5 6" for a number sign, "dots 2" for a Nemeth 1); and the
    // term echo re-parsed the partial expression after EVERY cell, speaking a
    // shifting mixture as the reading changed under the writer.
    //
    // So the mapping is now exactly the one text already uses, and the child
    // learns one rule for both: each LETTER is the cell just typed, named as
    // its word uses it; each WORD is the term, said when the term is finished;
    // each SENTENCE is the whole expression, said when the group closes.
    // describeCellInContext already asks the maths describers about the word
    // around a position, so the letter echo just uses it — no second opinion
    // about what a cell means, and ⠼ says "number" where it said dots.
    if (settings.speakLetter && speechOk) {
      speak(describeTypedCell(Math.max(0, caret - justTyped.length)));
    }
  }
  render();
});

// ---- help ----
// <dialog> gives us Escape-to-close, a focus trap and the backdrop for free.
// HELP YOU CAN NAVIGATE WITHOUT A SCREEN READER (task 8). A screen-reader user
// jumps by heading; a child using the app's OWN voice has no such command, and
// the help is three thousand words - one long read from the top with no way to
// skip. So the headings become a list of buttons at the front: Tab hears each
// section named, Enter goes there and the heading is spoken. Built from the
// headings themselves rather than written out, so it cannot drift out of step
// with the help it indexes.
let helpContentsBuilt = false;
function buildHelpContents() {
  if (helpContentsBuilt) return;
  const body = document.querySelector('.help-body');
  if (!body) return;
  const heads = [...body.querySelectorAll('h3')];
  if (!heads.length) return;
  helpContentsBuilt = true;
  const nav = document.createElement('nav');
  nav.className = 'help-toc';
  nav.setAttribute('aria-label', 'Help contents');
  const title = document.createElement('p');
  title.className = 'help-toc-title';
  title.textContent = 'Jump to a section:';
  nav.appendChild(title);
  heads.forEach((h, n) => {
    const id = 'help-sec-' + n;
    h.id = id;
    h.tabIndex = -1;                       // a focus target, not a tab stop
    const b = document.createElement('button');
    b.type = 'button';
    b.className = 'help-toc-item';
    b.textContent = h.textContent.trim();
    b.addEventListener('click', () => {
      h.scrollIntoView({ block: 'start' });
      skipNextFocusSpeech = true;          // the heading, not the control, is the news
      h.focus();
      speak(h.textContent.trim());
    });
    nav.appendChild(b);
  });
  // In front of the first section, after the introduction and the example button.
  heads[0].parentNode.insertBefore(nav, heads[0]);
}

$('helpBtn').addEventListener('click', () => {
  stopSpeech();
  buildHelpContents();
  $('helpDialog').showModal();
  speak('Help');           // every place the user can GO says so (PB, 2026-08-19)
});
$('helpClose').addEventListener('click', () => { $('helpDialog').close(); speak('Help closed'); });

// SHOW, DO NOT ONLY TELL (PB, 2026-08-20). Help can describe the missed
// contraction mark and the two maths codes, but a teacher meeting this for the
// first time learns more from one document that HAS them. It opens by exactly
// the route a child's own file takes — loadFile does the format sniff, the
// empty-file refusal and the mode detection — so nothing here is a special
// case that could work while the real Load is broken.
$('helpExample').addEventListener('click', async () => {
  const btn = $('helpExample');
  btn.disabled = true;
  try {
    // THE TOUR IS WRITTEN IN UEB GRADE 2 and says so in its own metadata, so it
    // is only readable under that code: under Spanish, or English grade 1, its
    // prose comes back as nonsense and the example teaches the opposite of what
    // it is for (feedback, 2026-08-28). Switching is announced below rather
    // than done behind the user's back, and en-ueb-g2 needs no fetch - it is
    // the code the app boots with loaded.
    const codeWas = settings.brailleCode;
    if (codeWas !== 'en-ueb-g2') {
      settings.brailleCode = 'en-ueb-g2';
      saveSettings();
      loadBrailleCodes();
      missedCache.clear();
      cellNameCache.clear();
    }
    const res = await fetch('/Translate/examples/translate-tour.ebrl');
    if (!res.ok) throw new Error('the example could not be fetched');
    const file = new File([await res.blob()], 'translate-tour.ebrl',
                          { type: 'application/epub+zip' });
    $('helpDialog').close();
    await loadFile(file);
    // loadFile has already said "Loaded eBraille"; this says what to DO with it.
    const msg = 'Example opened. Click any word to see how it was written.'
              + (codeWas !== 'en-ueb-g2' ? ' The braille code is now English grade 2, which the example is written in.' : '');
    $('statusBar').innerHTML = `<span class="sb-hint">${escMsg(msg)}</span>`;
    speak(msg);
  } catch (err) {
    const msg = 'The example could not be opened. ' + (err && err.message ? err.message : '');
    $('statusBar').innerHTML = `<span class="sb-hint">${escMsg(msg)}</span>`;
    speak(msg);
  } finally {
    btn.disabled = false;
  }
});
// Click on the backdrop (outside the panel) closes it too.
$('helpDialog').addEventListener('click', (e) => {
  if (e.target === $('helpDialog')) $('helpDialog').close();
});

// Messages that reach the status bar's innerHTML must be INERT TEXT. Most are
// the app's own words, but the save and load paths interpolate err.message,
// and an error thrown while parsing a hostile file can echo that file's own
// content — which must never come back to life as markup here.
const escMsg = (m) => String(m).replace(/[&<>"]/g,
  (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;' }[c]));

// ---- asking a question out loud ----
// The browser's confirm() is silent to a self-voicing user and BLOCKS the event
// loop, so speech scheduled just before it cannot start until it is dismissed —
// the question could never be read aloud, which is how Clear came to ask
// something a blind child could not hear (PB, 2026-08-19). A real dialog can be
// spoken, and its buttons are named by the focus announcer as they are reached.
function askConfirm(question, confirmLabel, onYes) {
  const dlg = $('confirmDialog');
  if (!dlg || !dlg.showModal) {           // no dialog support: do not lose the action
    if (confirm(question)) onYes();
    return;
  }
  $('confirmText').textContent = question;
  $('confirmYes').textContent = confirmLabel;
  const yes = () => { close(); onYes(); };
  const close = () => {
    $('confirmYes').removeEventListener('click', yes);
    dlg.removeEventListener('close', onClose);
    if (dlg.open) dlg.close();
    $('brlInput').focus();
  };
  const onClose = () => { close(); };
  $('confirmYes').addEventListener('click', yes);
  $('confirmNo').addEventListener('click', () => { close(); speak('Cancelled'); }, { once: true });
  dlg.addEventListener('close', onClose);
  abandonChord();          // keys held when the question opened must not commit behind it
  dlg.showModal();
  speak(question);                        // asked aloud, not only shown
  $('confirmNo').focus();                 // the safe option is the default
}

// ---- clear / save / load ----
// Only the braille is saved: the text (or maths) pane is derived from it, so it
// can always be recreated on load.
function resetAll() {
  buf = ''; caret = 0; chord = 0; held.clear();
  mathSpans = []; prevBuf = '';
  lineModes.length = 0;
  modeAppliesToAll = true;
  // AN EMPTY DOCUMENT IS A TEXT DOCUMENT (PB, 2026-08-19). Clearing emptied the
  // buffer and the per-line modes but left the maths state switched on, so a
  // fresh start inherited the mode of the document just thrown away — and,
  // because a line is stamped with the current mode as it is written, the first
  // word typed afterwards became maths. That is also how prose ended up
  // explained as Nemeth (e650638): the mode outlived the document that
  // justified it. Set BEFORE render(), so syncMathsCheckbox reads the new state
  // rather than the old.
  $('uebMaths').checked = false;
  $('nemethMaths').checked = false;
  $('mathsMode').checked = false;
  stopSpeech();
  linkWord('');
  explainWord('');
  render();
}

$('clearBtn').addEventListener('click', () => {
  if (!buf && !chord) { resetAll(); return; }          // already empty, nothing to lose
  askConfirm('Clear the braille and start again? This cannot be undone.',
             'Clear', () => { resetAll(); speak('Cleared'); });
});

// Nemeth-mode lines are saved wrapped in the BANA switch indicators ⠸⠩ … ⠸⠱,
// so the FILE says which lines are Nemeth: it loads back correctly with no
// checkbox, here or in any UEB-context tool. Lines the child already switched
// by hand are left alone. (UEB maths has no such indicator in the code — those
// lines stay unmarked; the codes make that undecidable.)
function switchWrappedDoc() {
  return buf.split('\n').map((line, i) => {
    if (!line.trim() || hasNemethSwitch(line)) return line;
    const mode = lineModes[i] || currentMode();
    return mode === 'nem' ? `${NEM_OPEN}⠀${line}⠀${NEM_CLOSE}` : line;
  }).join('\n');
}

function downloadBlob(blob, name) {
  const a = document.createElement('a');
  a.href = URL.createObjectURL(blob);
  a.download = name;
  document.body.appendChild(a);
  a.click();
  a.remove();
  setTimeout(() => URL.revokeObjectURL(a.href), 1000);
}

// The document as eBraille SECTIONS: consecutive lines sharing a mode become
// one section, which is the granularity the format can carry and the only thing
// BRF loses. Blank lines inherit the run they sit in rather than breaking it —
// a blank between two maths lines is spacing, not a change of code.
function docSections() {
  const lines = buf.split('\n');
  const out = [];
  let offset = 0;
  lines.forEach((line, i) => {
    const mode = lineModes[i] || currentMode();
    // AN INLINE UEB RUN HAS TO BE WRITTEN AS MARKUP OR LOST. Nemeth's switch
    // signs are in the cells, so a Nemeth run needs nothing here; UEB maths is
    // ordinary UEB and the cells say nothing, so the run survives a save only
    // as a span. A line with no run stays a plain string, which is what every
    // document written before this was.
    const body = runsOfLine(line, offset) ?? line;
    offset += line.length + 1;
    const last = out[out.length - 1];
    if (last && (last.mode === mode || !line.trim())) last.lines.push(body);
    else out.push({ mode, lines: [body] });
  });
  return out;
}

// The spans that fall in this line, as [{text}, {text, mode:'ueb'}, …].
// Returns null when the line carries none, so the common case is untouched.
function runsOfLine(line, lineStart) {
  const cuts = [];
  for (const sp of mathSpans) {
    const a = Math.max(0, sp.from - lineStart), b = Math.min(line.length, sp.to - lineStart);
    if (b > a) cuts.push([a, b]);
  }
  if (!cuts.length) return null;
  cuts.sort((x, y) => x[0] - y[0]);
  const runs = [];
  let pos = 0;
  for (const [a, b] of cuts) {
    if (a > pos) runs.push({ text: line.slice(pos, a) });
    runs.push({ text: line.slice(a, b), mode: 'ueb' });
    pos = b;
  }
  if (pos < line.length) runs.push({ text: line.slice(pos) });
  return runs;
}

// SAVE IS eBRAILLE (PB, 2026-08-09). Nemeth is NOT switch-wrapped here the way
// the BRF export wraps it: in eBraille the section carries its own mode, so
// wrapping as well would put the indicators into the cells and they would come
// back as content on the next load. Export still wraps, because BRF has nothing
// else to say it with.
// NOTHING TO WRITE IS SAID THE SAME WAY EVERYWHERE (2026-08-19). The three
// writers each answered an empty document differently: Save wrote a valid
// EMPTY .ebrl, BRF wrote a 0-byte file, and Word declined by speech alone —
// so a teacher with speech off got no answer at all, and the other two handed
// back files whose only future is to disappoint someone later. (The .ebrl one
// was worse than useless: loading it back is now refused, correctly, so the
// file could never do anything but waste a trip to the filing system.)
// One test, one wording, seen AND heard.
function nothingToWrite(verb) {
  const msg = `There is nothing to ${verb} yet.`;
  $('statusBar').innerHTML = `<span class="sb-hint">${msg}</span>`;
  speak(msg);
}
// A document of blank braille cells IS content — U+2800 survives trim(), which
// is the same call the loader's own guard leans on.
const hasBraille = () => buf.trim() !== '';

$('saveBtn').addEventListener('click', () => {
  if (!hasBraille()) { nothingToWrite('save'); return; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  try {
    const bytes = writeEbraille({
      title: `Connector document ${stamp}`,
      creator: (settings.authorName || '').trim() || 'Unknown',
      producer: 'Sensory App House Ltd',
      language: navigator.language || 'en',
      sections: docSections(),
    });
    downloadBlob(new Blob([bytes], { type: 'application/epub+zip' }), `translate-${stamp}.ebrl`);
    speak('Saved as eBraille');
  } catch (err) {
    // The status bar is an aria-live region, so this is heard as well as seen —
    // a save that silently did nothing would be the worst outcome here.
    $('statusBar').innerHTML = `<span class="sb-hint">Could not save: ${escMsg(err && err.message)}</span>`;
    speak('Could not save');
  }
});

// EXPORT IS BRF — the interchange format every embosser, notetaker and
// transcription tool reads. Line structure is kept verbatim: braille line breaks
// carry meaning here (matrix rows, continuations), so no 40-cell re-wrapping is
// ever applied.
// EXPORT IS A MENU, because the two sides of the app go to different people.
// The braille goes to an embosser; the print goes to a teacher who has to mark
// it. Keyboard support is written out rather than assumed: this app's users
// reach menus by keyboard and by braille display, not by mouse.
function closeExportMenu(focusButton) {
  const menu = $('exportMenu');
  if (menu.hidden) return;
  menu.hidden = true;
  $('exportBtn').setAttribute('aria-expanded', 'false');
  if (focusButton) { skipNextFocusSpeech = true; $('exportBtn').focus(); speak('Export menu closed'); }
}
function openExportMenu() {
  const menu = $('exportMenu');
  menu.hidden = false;
  $('exportBtn').setAttribute('aria-expanded', 'true');
  const first = menu.querySelector('[role=menuitem]');
  if (first) { skipNextFocusSpeech = true; first.focus(); }
  speak('Export menu. ' + (first ? describeControl(first) : ''));
}
$('exportBtn').addEventListener('click', () => {
  if ($('exportMenu').hidden) openExportMenu(); else closeExportMenu(true);
});
$('exportMenu').addEventListener('keydown', (e) => {
  const items = [...$('exportMenu').querySelectorAll('[role=menuitem]')];
  const i = items.indexOf(document.activeElement);
  if (e.key === 'Escape') { e.preventDefault(); closeExportMenu(true); }
  else if (e.key === 'ArrowDown') { e.preventDefault(); items[(i + 1) % items.length].focus(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); items[(i - 1 + items.length) % items.length].focus(); }
  else if (e.key === 'Tab') closeExportMenu(false);
});
document.addEventListener('click', (e) => {
  if (!$('exportMenu').hidden && !e.target.closest('.menu-wrap')) closeExportMenu(false);
});

$('exportBrfItem').addEventListener('click', () => {
  closeExportMenu(true);
  if (!hasBraille()) { nothingToWrite('export'); return; }
  const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
  downloadBlob(new Blob([unicodeBrailleToBrf(switchWrappedDoc())],
                        { type: 'text/plain;charset=utf-8' }), `translate-${stamp}.brf`);
  speak('Exported as B R F');
});

// EXPORT THE PRINT SIDE AS WORD.
//
// THE MATHS IS RE-RENDERED FROM ITS LaTeX, NOT LIFTED OFF THE SCREEN, and that
// is not a preference — the MathML on screen is structurally wrong for this
// purpose. Every word group is wrapped in \class{bw-…} so a click can find it,
// which splits a base from its own exponent: "a^{2}" becomes \class{}{a}
// followed by \class{}{^{2}}, and Temml renders that as
//
//     <msup><mrow></mrow><mn>2</mn></msup>       — an EMPTY base
//
// On screen that is invisible: the stray superscript sits beside the "a" and
// reads correctly. Converted to Word it is a floating 2 with nothing beneath
// it. The stored LaTeX carries no click instrumentation and is the faithful
// source, so the equation is rendered again from that, cleanly, for export.
function printBlocks() {
  const out = $('out');
  return [...out.children].map((line) => {
    const runs = [];
    const rowLatex = line.dataset ? (line.dataset.verifyLatex || line.dataset.latex) : '';
    if (rowLatex && globalThis.temml) {
      try {
        const clean = new DOMParser()
          .parseFromString(globalThis.temml.renderToString(rowLatex, { displayMode: true }), 'text/html')
          .querySelector('math');
        const omml = clean ? mathmlToOmml(clean) : '';
        if (omml) return { runs: [{ omml }] };
      } catch { /* fall through to whatever is on screen */ }
    }
    for (const node of line.childNodes) {
      if (node.nodeType === 3) { runs.push({ text: node.nodeValue }); continue; }
      if (node.nodeType !== 1) continue;
      const math = node.tagName.toLowerCase() === 'math' ? node : node.querySelector('math');
      if (math) {
        const omml = mathmlToOmml(math);
        if (omml) { runs.push({ omml }); continue; }
      }
      // A warning box or a repair suggestion is scaffolding for the screen, not
      // part of the child's work — it must not travel into the document.
      if (node.classList && (node.classList.contains('warn') || node.classList.contains('sb-hint'))) continue;
      const t = node.textContent;
      if (t) runs.push({ text: t });
    }
    return { runs };
  });
}

$('exportDocxItem').addEventListener('click', async () => {
  closeExportMenu(true);
  try {
    const blocks = printBlocks();
    if (!blocks.some((b) => b.runs.length)) { nothingToWrite('export'); return; }
    const stamp = new Date().toISOString().slice(0, 16).replace(/[:T]/g, '-');
    downloadBlob(new Blob([buildDocx(blocks)],
      { type: 'application/vnd.openxmlformats-officedocument.wordprocessingml.document' }),
      `translate-${stamp}.docx`);
    speak('Exported as Word');
  } catch (err) {
    console.warn('[docx]', err);
    speak('Could not export the Word document');
  }
});

// LOADING eBRAILLE. The whole reason the format was adopted: the file states
// its own modes, so nothing is guessed. classifyDoc — the whole-file detector
// the BRF path needs — is deliberately NOT run here; running it could only
// overrule facts with an inference, and on a mixed document it would abstain
// anyway. modeAppliesToAll stays FALSE so the next mode click does not sweep
// the restored per-line modes away.
async function loadEbrailleFile(file) {
  const doc = await readEbraille(await file.arrayBuffer());
  // THE SAME REFUSAL AS THE GENERIC LOADER (2026-08-19). That guard was added
  // so a braille-less file cannot eat the open document — but this branch
  // returns before reaching it, so a well-formed EMPTY .ebrl (which Save will
  // happily write) walked straight past: it wiped the field and announced
  // "Loaded eBraille". Checked here, before anything is mutated, because the
  // clears just below run ahead of the section loop.
  const hasCells = (doc.sections || []).some((sec) =>
    (sec.lines || []).some((l) => /[⠀-⣿]/.test(l)));
  if (!hasCells) {
    const msg = 'That file contained no braille, so nothing was loaded.';
    $('statusBar').innerHTML = `<span class="sb-hint">${msg}</span>`;
    speak(msg);
    return;
  }
  const lines = [];
  lineModes.length = 0;
  mathSpans = [];
  let loadedAt = 0;
  for (const sec of doc.sections || []) {
    (sec.lines || []).forEach((line, li) => {
      lines.push(line);
      lineModes[lines.length - 1] = sec.mode;
      // Runs come back only where a line actually changed mode part-way, so this
      // rebuilds the ranges the writer recorded — and stays silent otherwise.
      const runs = (sec.runs || [])[li];
      if (runs) {
        let at = loadedAt;
        for (const r of runs) {
          const len = (r.text || '').length;
          if (r.mode === 'ueb' && len) mathSpans.push({ from: at, to: at + len, closed: true });
          at += len;
        }
      }
      loadedAt += line.length + 1;
    });
  }
  buf = lines.join('\n');
  if (buf && !/[ \n]$/.test(buf)) buf += ' ';
  // THE SPANS ARE ALREADY IN THIS BUFFER'S COORDINATES (user file, 2026-08-19).
  // syncSpans() shifts every span by whatever changed between prevBuf and buf —
  // right for typing, fatal here: left stale, it read the whole loaded document
  // as one insertion and moved the freshly rebuilt spans past the end, so UEB
  // maths loaded as literary text (and loading the SAME file twice "fixed" it,
  // because the second load found buf === prevBuf and shifted nothing).
  prevBuf = buf;
  caret = buf.length;                    // a loaded file opens at its end
  chord = 0; held.clear();
  modeAppliesToAll = false;
  stopSpeech(); linkWord(''); explainWord('');
  // The mode boxes follow the LAST section — where the caret lands (a loaded
  // file opens at its end) and where typing resumes. They used to follow the
  // FIRST, which read nicely at the top of the document but clobbered the
  // bottom: syncLineModes stamps the line being typed with currentMode() on
  // every render, so a document ENDING in maths had its last line's restored
  // mode overwritten by the first section's on the very first render — a
  // Nemeth ending absorbed into text (diagnosed 2026-08-12, DIAGNOSIS-120826).
  // With the boxes agreeing with the last line, that stamp writes back the
  // value the file restored, and typing onward continues the document's own
  // ending mode — which is what resuming a document means.
  const secs = doc.sections || [];
  const last = secs[secs.length - 1];
  if (last) {
    $('uebMaths').checked = last.mode === 'ueb';
    $('nemethMaths').checked = last.mode === 'nem';
    // The visible switch follows the file, and a maths document also settles
    // WHICH code is selected — the file knows, so Settings should agree with it
    // rather than silently disagreeing with what is on screen.
    $('mathsMode').checked = last.mode === 'ueb' || last.mode === 'nem';
    if ($('mathsMode').checked) {
      settings.mathsCode = last.mode;
      saveSettings();
      $(last.mode === 'ueb' ? 'mathsCodeUeb' : 'mathsCodeNemeth').checked = true;
    }
  }
  render();
  const kinds = [...new Set((doc.sections || []).map((s) => s.mode))].length;
  speak(kinds > 1 ? `Loaded eBraille, ${kinds} kinds of braille` : 'Loaded eBraille');
}

$('loadBtn').addEventListener('click', () => $('loadInput').click());

// OPENING A FILE IS ONE FUNCTION, whoever asks. The Help tour opens a document
// too, and it must arrive by exactly the route a child's own file takes -
// including the format sniff, the empty-file refusal and the mode detector -
// or the thing we show people would be a thing the app does not otherwise do.
async function loadFile(file) {
  if (!file) return;
  try {
    // eBRAILLE FIRST, DECIDED ON THE BYTES not the extension — a .ebrl renamed
    // by a mail client is still an OCF container, and a .brf never begins PK\003\004.
    const head = await file.slice(0, 4).arrayBuffer();
    if (looksLikeEbraille(head)) { await loadEbrailleFile(file); return; }
    const raw = await file.text();
    // Accept Unicode braille (old .brl saves); otherwise treat as BRF-ASCII —
    // what Save now writes and what braille files in the wild contain.
    // Uppercase first: BRF letters are case-insensitive and files from
    // notetakers are often lowercase, which the strict table would pass
    // through unmapped and the cell filter would then silently drop.
    const hasUnicode = /[⠀-⣿]/.test(raw);
    const text = hasUnicode ? raw : brfToUnicodeBraille(raw.toUpperCase());
    // Keep only braille cells, spaces and newlines. U+2800 (blank braille cell) IS
    // a space in braille — liblouis and real .brl files use it as the word
    // separator, so normalise it or nothing would word-split on load.
    const cellsOnly = [...text]
      .filter((c) => c === ' ' || c === '\n'
              || (c.codePointAt(0) >= 0x2800 && c.codePointAt(0) <= 0x28ff))
      .map((c) => (c === '⠀' ? ' ' : c))
      .join('');
    // A FILE WITH NO BRAILLE IN IT LOADS NOTHING — AND SAYS SO (2026-08-19).
    // Fuzzing showed a garbage file (nulls, random bytes, an HTML page saved
    // with the wrong extension) sailing through this filter to an EMPTY
    // buffer: the open document was silently replaced by nothing, with the
    // idle hint as the only commentary. Loading the wrong file must not cost
    // the child their work. The document stands, and the bar says why.
    if (!cellsOnly.trim()) {
      const msg = 'That file contained no braille, so nothing was loaded.';
      $('statusBar').innerHTML = `<span class="sb-hint">${msg}</span>`;
      speak(msg);
      return;
    }
    buf = cellsOnly;
    // Everything in a loaded file is finished writing, so terminate the last word —
    // otherwise it would be treated as still being brailled and stay hidden.
    if (buf && !/[ \n]$/.test(buf)) buf += ' ';
    caret = buf.length;                  // a loaded file opens at its end
    chord = 0; held.clear();
    lineModes.length = 0;               // every loaded line takes the current mode
    modeAppliesToAll = true;            // …and the next mode choice re-modes them all
    stopSpeech(); linkWord('');
    explainWord('');                    // a stale announcement must not outlive its file
    render();
    // WHOLE-FILE mode detection (mode-detect.mjs — measured before wiring:
    // 42/42 confident calls correct, 0 harmful, all mixed papers abstain;
    // TEST-SOURCES.md "Mode detection"). Only a clear supermajority acts;
    // mixed, thin or Nemeth-signature evidence changes nothing. A call that
    // changes the boxes is announced, and one click (or Ctrl+I) re-modes the
    // whole document back — modeAppliesToAll is still true.
    try {
      const verdict = classifyDoc(buf.split('\n'), {
        parseUeb: uebHybrid,
        backTranslate: (w) => louis.backTranslate(w, T_UEB_G2),
      });
      const call = verdict.call;
      const want = call === 'ueb-maths' ? 'ueb' : call === 'nemeth' ? 'nem' : call === 'text' ? 'text' : null;
      if (want && want !== currentMode()) {
        $('uebMaths').checked = want === 'ueb';
        $('nemethMaths').checked = want === 'nem';
        // The visible switch and the Settings radio follow the detector's call,
        // so the header cannot say "not maths" over a document it just decided
        // IS maths — the discrepancy the single switch exists to prevent.
        $('mathsMode').checked = want === 'ueb' || want === 'nem';
        if ($('mathsMode').checked) {
          settings.mathsCode = want;
          saveSettings();
          $(want === 'ueb' ? 'mathsCodeUeb' : 'mathsCodeNemeth').checked = true;
        }
        lineModes.length = 0;           // re-mode the loaded lines under the call
        render();
        const msg = want === 'ueb'
          ? 'This file looks like UEB maths, so the maths box has been ticked. Untick it if that is wrong.'
          : want === 'nem'
            ? 'This file marks its lines as Nemeth, so the Nemeth box has been ticked.'
            : 'This file looks like text, so the maths boxes have been cleared. Tick one if that is wrong.';
        $('statusBar').innerHTML = `<span class="sb-hint">${msg}</span>`;
        speak(msg);
      } else if (call === 'abstain') {
        // SILENCE WAS THE WRONG ANSWER WHEN WE NEARLY KNEW (PB, 2026-08-28).
        // Acting needs 95% of lines to agree, which is right for changing a
        // document by itself. But below that bar the detector said NOTHING, so
        // a file where most lines look like maths opened as literary text and
        // the child got nonsense words with no hint that a decision had been
        // made. UEB feels this worst: Nemeth writes switch signs into the
        // cells and declares itself, while UEB maths IS UEB and nothing in the
        // braille tells them apart, so the guess abstains more often.
        //
        // So: still change nothing - the file is the user's - but say what we
        // saw and what to do about it. The evidence was already computed and
        // thrown away.
        const looksNemeth = verdict.why === 'nemeth-signature';
        const share = typeof verdict.f === 'number' ? verdict.f : 0;
        if (looksNemeth || share >= MATHS_HINT_SHARE) {
          const which = looksNemeth ? 'Nemeth' : 'UEB maths';
          const msg = `Some lines in this file look like ${which}. Nothing has been changed - `
                    + `tick the Maths box if it is.`;
          $('statusBar').innerHTML = `<span class="sb-hint">${escMsg(msg)}</span>`;
          speak(msg);
        }
      }
    } catch { /* detection must never break loading */ }
  } catch (err) {
    // Spoken and shown rather than alert()ed: an alert is silent to a
    // self-voicing user and blocks everything behind it.
    const msg = 'Could not read that file. ' + err.message;
    $('statusBar').innerHTML = `<span class="sb-hint">${escMsg(msg)}</span>`;
    speak(msg);
  }
}

$('loadInput').addEventListener('change', async (e) => {
  await loadFile(e.target.files && e.target.files[0]);
  e.target.value = '';                                  // allow re-loading the same file
});

// ---- resizing the explanation bar ----
// PB, 2026-08-19: a grab control on the bar, and resizing it must resize the
// braille and text inside it too.
//
// THE STATE IS A SCALE, NOT A HEIGHT, and that is the whole design. Driving it
// from the measured height fed back on itself — a taller bar means a bigger
// font, a bigger font means taller content, so each step compounded: five
// presses took the bar from 48px to 1090px with 78px text (measured, and the
// reason this is written this way). A scale is what the user is choosing
// anyway: everything in the bar is already em-relative to its font — .sb-brl
// is 1.35em, the chips inherit — so one number moves the words and the braille
// together, and the height follows the content instead of driving it.
//
// min-height rather than height, so content that wraps is never cut off; the
// scale sets the floor and the bar grows past it when it needs to.
//
// The panes give up whatever the bar takes, and the braille pane sizes its
// font to fit 40 cells in what is left — so every change re-runs
// fitBrailleLine, or the braille would keep a size its pane no longer has.
const SB_MIN_SCALE = 0.85, SB_MAX_SCALE = 4, SB_STEP = 0.15;
let statusScale = 1;
function applyStatusScale(next) {
  statusScale = Math.max(SB_MIN_SCALE, Math.min(SB_MAX_SCALE, Number(next) || 1));
  document.documentElement.style.setProperty('--sb-scale', statusScale.toFixed(3));
  document.documentElement.style.setProperty('--sb-h', Math.round(48 * statusScale) + 'px');
  fitBrailleLine();
  return statusScale;
}
(function wireStatusGrab() {
  const grab = $('sbGrab');
  if (!grab) return;
  applyStatusScale(settings.statusScale || 1);
  let startY = 0, startScale = 1, dragging = false;
  const commit = () => { settings.statusScale = statusScale; saveSettings(); };
  // A drag of this many pixels is one full step, so the bar tracks the hand at
  // roughly the rate the arrow keys move it.
  const PX_PER_STEP = 40;
  grab.addEventListener('pointerdown', (e) => {
    dragging = true; startY = e.clientY; startScale = statusScale;
    grab.setPointerCapture(e.pointerId);
    e.preventDefault();
  });
  grab.addEventListener('pointermove', (e) => {
    if (!dragging) return;
    // Dragging UP grows it: the bar expands upwards into the panes.
    applyStatusScale(startScale + ((startY - e.clientY) / PX_PER_STEP) * SB_STEP);
  });
  const end = (e) => {
    if (!dragging) return;
    dragging = false;
    try { grab.releasePointerCapture(e.pointerId); } catch { /* already released */ }
    commit();
  };
  grab.addEventListener('pointerup', end);
  grab.addEventListener('pointercancel', end);
  // KEYBOARD TOO. A control only a mouse can reach is no control at all for
  // this app's readers; role=separator with arrow keys is the standard shape.
  grab.addEventListener('keydown', (e) => {
    const step = e.shiftKey ? SB_STEP * 4 : SB_STEP;
    let next = null;
    if (e.key === 'ArrowUp') next = statusScale + step;
    else if (e.key === 'ArrowDown') next = statusScale - step;
    else if (e.key === 'Home') next = 1;
    else if (e.key === 'End') next = SB_MAX_SCALE;
    else return;
    e.preventDefault();
    applyStatusScale(next);
    commit();
    speak(statusScale === 1 ? 'Explanation bar, normal size'
                            : `Explanation bar, ${Math.round(statusScale * 100)} per cent`);
  });
})();

// ---- speaking where the user has moved to ----
// STEPPING BETWEEN CONTROLS MUST SAY WHERE YOU LANDED (PB, 2026-08-19).
// Changing a setting already spoke; ARRIVING at one did not, so a child using
// the app's own voice with NO screen reader running - a case the app supports
// deliberately, and the reason Ctrl+Shift+L exists - had to count Tab presses
// to find Save or Settings.
//
// ONLY IN 'voice' MODE. With Speech output on "Screen reader" the reader
// announces focus itself, far better than we can, and speaking here as well
// would be the exact double-speaking the router was built to end. With it
// "off", speak() returns anyway. So this adds a voice where there is none and
// stays quiet where there is one.
function controlName(el) {
  if (!el || el === document.body) return '';
  const byLabelledBy = (el.getAttribute('aria-labelledby') || '')
    .split(/\s+/).filter(Boolean)
    .map((id) => ($(id) ? $(id).textContent.trim() : '')).join(' ').trim();
  const label = el.getAttribute('aria-label')
    || byLabelledBy
    || (el.labels && el.labels[0] ? el.labels[0].textContent : '')
    || (el.tagName === 'BUTTON' ? el.textContent : '')
    || el.getAttribute('title')
    || '';
  // Decorative glyphs belong to the eye, not the ear: the Export button's
  // caret would otherwise be read out as part of its name.
  return label.replace(/[\u25B2-\u25BE\u2B05-\u2B0D\u2190-\u21FF\u2699\u2715\u2716\u00D7]/g, '')
    .replace(/\s+/g, ' ').trim();
}
function describeControl(el) {
  const name = controlName(el);
  if (!name) return '';
  const t = (el.getAttribute('type') || '').toLowerCase();
  if (el.tagName === 'INPUT' && t === 'checkbox') {
    return `${name}, ${el.checked ? 'ticked' : 'not ticked'}`;
  }
  if (el.tagName === 'INPUT' && t === 'radio') {
    return `${name}, ${el.checked ? 'selected' : 'not selected'}`;
  }
  if (el.tagName === 'SELECT') {
    const cur = el.selectedOptions[0] ? el.selectedOptions[0].textContent.trim() : '';
    return cur ? `${name}, ${cur}` : name;
  }
  if (el.tagName === 'BUTTON') return `${name}, button`;
  if (el.tagName === 'A') return `${name}, link`;
  if (el.id === 'brlInput') return 'Braille';
  if (el.tagName === 'TEXTAREA') return `${name}, text box`;
  return name;
}
// The first focus of the session is the app placing the caret in the braille
// field at boot, not the user going anywhere; announcing it would greet every
// launch with "Braille".
let focusAnnouncerArmed = false;
// OPENING A CONTAINER IS ONE EVENT, NOT TWO (PB, 2026-08-19). Speaking "Settings"
// and then focusing a control inside it meant the control's name CANCELLED the
// word Settings — each speak() supersedes the last — so the user only ever heard
// the control and never learned where they had arrived. The opener suppresses
// the announcer for that one focus and says both halves together.
let skipNextFocusSpeech = false;
setTimeout(() => { focusAnnouncerArmed = true; }, 1200);
document.addEventListener('focusin', (e) => {
  if (skipNextFocusSpeech) { skipNextFocusSpeech = false; return; }
  if (!focusAnnouncerArmed) return;
  if (settings.speechOutput !== 'voice') return;
  const said = describeControl(e.target);
  if (said) speak(said);
});

// ---- settings UI ----
// ONE SWITCH, ONE PREFERENCE (PB, 2026-08-09). The Maths checkbox says whether
// this is maths; Settings says WHICH maths. uebMaths and nemethMaths are still
// the state everything downstream reads, so this is the single place that
// writes them — nothing else in the app had to learn a new shape.
function applyMathsMode({ resetLines = true } = {}) {
  // NOT the header checkbox (PB, 2026-08-12). That box now MIRRORS the caret
  // (syncMathsCheckbox), so reading it here would make "is this document
  // maths?" mean "is the caret inside an expression right now?" — switching
  // the code radio while the caret happened to sit in one inline group would
  // sweep the WHOLE document into maths. The document's own state is the
  // hidden inputs, so ask them.
  const on = uebMathsOn() || nemethOn();
  // START MATHCAT AS SOON AS MATHS IS IN USE. It used to load only inside the
  // debounced verify/repair timers, which was right when verification was all
  // it did. It now SPEAKS as well, and speech happens on the very first
  // finished expression — before those timers have ever fired — so without this
  // the first thing a child writes is read by the old speaker and everything
  // after it by MathCAT. Fire and forget: the app works either way, and the
  // fallback covers the window before it arrives.
  if (on) startVerifier();
  const code = settings.mathsCode === 'ueb' ? 'ueb' : 'nem';
  $('uebMaths').checked = on && code === 'ueb';
  $('nemethMaths').checked = on && code === 'nem';
  if (resetLines && modeAppliesToAll) lineModes.length = 0;
  render();
}

// THE CHECKBOX ONLY EVER REPORTS THE CARET NOW (PB, 2026-08-12) — see
// syncMathsCheckbox(), called from render() and onFieldSelection(). A click
// still has to DO something, so it runs the exact same toggle Ctrl+M does
// (toggleMathsAtCaret(), which itself calls render() in every branch but
// one, re-syncing this checkbox to wherever the toggle actually left the
// caret), then hands focus back to the field it came from — the checkbox is
// reachable by mouse, but the braille is typed nowhere else.
$('mathsMode').addEventListener('change', () => {
  toggleMathsAtCaret();
  $('brlInput').focus();
});

// CHOOSING A CODE MUST NEVER BLANK THE DOCUMENT (user report, 2026-08-19:
// "the tables don't work when selected — they clear the print field").
// The engine only holds the tables it has been handed, so the old handler set
// the preference and re-rendered against a table liblouis could not compile:
// every back-translation threw, bt() returned '', and the print pane emptied
// with no message — and because the preference is SAVED, it stayed empty on
// every later launch too.
//
// The order is now: fetch first, adopt second. The previous code keeps
// translating the document until the new one is proven loadable, and a failure
// says so plainly and puts the picker back where it was. The service worker
// caches what was fetched, so a code that worked once works offline after.
$('brailleCodeSel').addEventListener('change', async (e) => {
  const choice = e.target.value;                 // read BEFORE loadBrailleCodes reassigns it
  if (choice === '__more__') {
    codesExpanded = true;
    loadBrailleCodes();
    $('brailleCodeSel').focus();
    speak('All braille codes shown');
    return;
  }
  const previous = settings.brailleCode;
  if (choice === previous) return;
  const label = codeLabel(codeById(choice)).replace(/\s*—\s*/g, ' ');
  const code = codeById(choice);
  if (ready && code) {
    try {
      await louis.ensureTables(code.table);
    } catch {
      loadBrailleCodes();                        // put the picker back on `previous`
      // WHY IT FAILED DEPENDS ON THE CODE. A code that travels in the app was
      // never waiting on the internet, so telling its user to get online sends
      // them to fix the one thing that is not wrong; the real cause is an app
      // that has not finished installing itself yet.
      const msg = `${label} could not be loaded, so nothing has changed. `
                + (code && code.shipped
                    ? 'It travels with the app, so it may still be installing - please try again in a moment.'
                    : 'It needs the internet the first time it is used.');
      $('statusBar').innerHTML = `<span class="sb-hint">${msg}</span>`;
      speak(msg);
      return;
    }
  }
  settings.brailleCode = choice;
  saveSettings();
  // Fetch the uncontracted sibling too, quietly and without waiting: it is what
  // pairs cells with letters for a word the child spelt out. Failure is fine -
  // alignment simply stays off, exactly as it was before it existed - so this
  // must never delay or block adopting the code the user actually asked for.
  const sib = uncontractedSibling(choice);
  if (sib) louis.ensureTables(sib).catch(() => {});
  missedCache.clear();   // a different code has different contractions
  cellNameCache.clear();
  // The whole document is re-read under the new code — every word the user can
  // see was translated by the old one, so leaving them would show a page in two
  // codes at once.
  render();
  speak(label);
});

$('speakLetter').addEventListener('change', (e) => {
  settings.speakLetter = e.target.checked; saveSettings();
  speak(e.target.checked ? 'Speaking each letter' : 'Letters off');
});
$('showAscii').addEventListener('change', (e) => {
  settings.showAscii = e.target.checked; saveSettings();
  applyBrailleFont();
  render();
  speak(e.target.checked ? 'ASCII braille' : 'Braille dots');
});
$('sixKeyInput').addEventListener('change', (e) => {
  settings.sixKey = e.target.checked; saveSettings();
  // A half-formed chord must not survive the switch, or releasing those keys
  // afterwards would commit a cell the user never finished.
  if (!e.target.checked) { chord = 0; held.clear(); render(); }
  speak(e.target.checked ? 'Six key entry on' : 'Six key entry off');
});

// Changing the code while maths is ON switches the live document to it —
// leaving it applied only to the NEXT line would silently give one document two
// codes, which is exactly the confusion the single switch removes.
for (const id of ['mathsCodeNemeth', 'mathsCodeUeb']) {
  $(id).addEventListener('change', (e) => {
    if (!e.target.checked) return;
    settings.mathsCode = e.target.value;
    saveSettings();
    applyMathsMode();
    speak(e.target.value === 'ueb' ? 'UEB Technical' : 'Nemeth');
  });
}
// Which channel hears the app's own announcements - see the SPEECH ROUTER
// comment above speak(). settings.speechOutput is set BEFORE the confirmation
// speak() call, so switching TO 'reader' announces "Screen reader" through
// the reader channel itself, and switching to 'off' confirms nothing - both
// are the setting proving itself.
for (const id of ['speechOutputVoice', 'speechOutputReader', 'speechOutputOff']) {
  $(id).addEventListener('change', (e) => {
    if (!e.target.checked) return;
    settings.speechOutput = e.target.value;
    saveSettings();
    speak(e.target.value === 'voice' ? 'App voice' : e.target.value === 'reader' ? 'Screen reader' : 'Off');
  });
}
// CLOSING IS ONE FUNCTION, because there are now three ways to do it: the gear
// again, the Done button, and Escape (PB, 2026-08-21). All three must put the
// child back where the work is and say the same thing, or "closed" would mean
// something slightly different depending on how you got out.
function closeSettings() {
  const p = $('settingsPanel');
  if (p.hidden) return false;
  p.hidden = true;
  $('settingsBtn').setAttribute('aria-expanded', 'false');
  skipNextFocusSpeech = true;
  $('brlInput').focus();
  speak('Settings closed');
  return true;
}

$('settingsBtn').addEventListener('click', (e) => {
  e.stopPropagation();
  const p = $('settingsPanel');
  if (!p.hidden) { closeSettings(); return; }
  p.hidden = false;
  $('settingsBtn').setAttribute('aria-expanded', 'true');
  // OPENING SETTINGS IS A PLACE THE USER HAS GONE (PB, 2026-08-19), so say so
  // and put them in it. Without the focus move, Tab from the button walks the
  // rest of the header before reaching the panel that just opened.
  const first = p.querySelector('input, select, button, [tabindex]');
  if (first) { skipNextFocusSpeech = true; first.focus(); }
  speak('Settings. ' + (first ? describeControl(first) : ''));
});
$('settingsDone').addEventListener('click', (e) => { e.stopPropagation(); closeSettings(); });
// Escape closes it too. Checked BEFORE focus mode's own Escape handler and
// marked handled, so one keystroke cannot both close the panel and drop out of
// focus mode - the trap that handler already documents for the export menu.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('settingsPanel').hidden) return;
  if (e.defaultPrevented || $('helpDialog').open) return;
  e.preventDefault();
  closeSettings();
});
document.addEventListener('click', (e) => {
  const p = $('settingsPanel');
  if (!p.hidden && !p.contains(e.target) && e.target !== $('settingsBtn')) p.hidden = true;
});
$('voiceSel').addEventListener('change', (e) => {
  const choice = e.target.value;          // loadVoices()/sel_focusVoice() below
  if (choice === '__more__' || choice === '__novelty__') {   // reassign sel.value
    // Expand and REOPEN on the same selection, so choosing either hatch never
    // leaves the app speaking with a voice the user did not pick. The two
    // flags are independent, so opening one leaves the other's hatch (and its
    // own count) exactly as it was.
    if (choice === '__more__') voicesExpanded = true; else noveltyExpanded = true;
    loadVoices();
    sel_focusVoice();
    speak(choice === '__more__' ? 'More voices shown' : 'Novelty voices shown');
    return;
  }
  settings.voiceURI = choice; saveSettings();
});
function sel_focusVoice() { const s = $('voiceSel'); s.value = settings.voiceURI || s.value; s.focus(); }
// NO full re-render on change, deliberately: the braille and the stave both
// show WRITTEN pitch, which is what the child reads, so nothing ENGRAVED
// depends on the instrument, and render() would throw away every engraved
// stave and its play buttons to change something only the next click can
// hear. The range WARNING does depend on the instrument (#150), so that one
// piece is recomputed on its own — see refreshRangeWarnings().
$('speakWord').addEventListener('change', (e) => { settings.speakWord = e.target.checked; saveSettings(); });
$('speakCursor').addEventListener('change', (e) => { settings.speakCursor = e.target.checked; saveSettings(); });
$('speakSentence').addEventListener('change', (e) => { settings.speakSentence = e.target.checked; saveSettings(); });

// ---- focus mode ----
// A FULLSCREEN, LIVE VIEW OF THE PRINT (PB, 2026-08-12), for a child who
// types braille while a helper — or the child themselves, with low vision —
// watches large print rather than the normal two-pane interface. This is
// dark mode's only surviving home: the normal interface no longer has one.
//
// #out is MOVED into #focusOverlay on entry and back to its ORIGINAL PARENT
// on exit — never cloned. render() always targets #out BY ID (see $('out')
// throughout render()), so whichever parent currently holds the node is
// simply where the next render draws; render() itself needs no changes.
//
// THE BRAILLE FIELD IS NEVER TOUCHED. #brlInput stays exactly where it is,
// outside the overlay, and nothing here ever calls .focus() on anything
// else — so it keeps focus, keeps receiving every keystroke, and the live
// print keeps updating in view for as long as the overlay is open.
const outHome = $('out').parentNode;      // #textPane — where #out lives when not focused
function setFocusMode(on) {
  const overlay = $('focusOverlay');
  const out = $('out');
  const warn = $('warn');
  if (on && out.parentNode !== overlay) {
    // #warn travels too, ABOVE the print: it is the only element carrying the
    // full display-fault text, and leaving it behind put it underneath the
    // fixed overlay - present, populated, and 100% occluded (measured with
    // elementFromPoint). The helper this view exists for is the one person
    // who most needs to see it.
    overlay.appendChild(warn);
    overlay.appendChild(out);
  } else if (!on && out.parentNode === overlay) {
    outHome.insertBefore(out, outHome.firstChild);   // exactly where it started
    outHome.insertBefore(warn, out.nextSibling);     // its home: right after #out
  }
  overlay.hidden = !on;
  $('focusModeBtn').setAttribute('aria-pressed', String(on));
  $('focusModeBtnInner').setAttribute('aria-pressed', String(on));
}
function toggleFocusMode() {
  const on = $('focusOverlay').hidden;
  setFocusMode(on);
  speak(on ? 'Focus view' : 'Focus view closed');
}
$('focusModeBtn').addEventListener('click', toggleFocusMode);
$('focusModeBtnInner').addEventListener('click', toggleFocusMode);
// ESCAPE EXITS IT — unless the export menu or the help dialog is already
// handling their OWN Escape (the menu's keydown listener, and the native
// behaviour <dialog> gets for free): letting this fire too would close one
// of those AND drop out of focus mode from underneath it in the same
// keystroke.
// e.defaultPrevented IS CHECKED TOO, not just exportMenu's hidden state —
// measured: the menu's own listener sits BETWEEN the focused menu item and
// document in the bubble path, so it runs first and has already flipped
// hidden to true (and called preventDefault) by the time this one asks,
// which made the hidden check alone look like the menu was never open at
// all and let this handler close focus mode right along with it.
document.addEventListener('keydown', (e) => {
  if (e.key !== 'Escape' || $('focusOverlay').hidden) return;
  if (e.defaultPrevented || !$('exportMenu').hidden || $('helpDialog').open) return;
  e.preventDefault();
  setFocusMode(false);
});

// FOCUS MODE'S OWN DARK OPTION (PB, 2026-08-12). Dark mode left the normal
// interface entirely (see the previous commit); this is its only remaining
// home. The class goes on #focusOverlay alone, NEVER on body — the normal
// UI has no dark mode any more, and this checkbox must not reintroduce one.
function applyFocusDark() {
  $('focusOverlay').classList.toggle('dark', !!settings.focusDark);
}
$('focusDark').addEventListener('change', (e) => {
  settings.focusDark = e.target.checked; saveSettings();
  applyFocusDark();
});

// ---- boot ----
(async function boot() {
  $('speakWord').checked = settings.speakWord;
  $('speakSentence').checked = settings.speakSentence;
  // Defaults to ON, so an absent stored value must read as ON — not as the
  // falsy default the others take.
  $('speakCursor').checked = settings.speakCursor !== false;
  // The radio must SHOW the saved choice, or a user who picked UEB Technical
  // last week opens Settings and sees Nemeth selected while getting UEB.
  $(settings.mathsCode === 'ueb' ? 'mathsCodeUeb' : 'mathsCodeNemeth').checked = true;
  $(settings.speechOutput === 'reader' ? 'speechOutputReader'
    : settings.speechOutput === 'off' ? 'speechOutputOff' : 'speechOutputVoice').checked = true;
  loadBrailleCodes();
  // The cell width is meaningless until the font is loaded, so the first fit
  // waits for it; after that, every resize refits and so does every render.
  if (document.fonts && document.fonts.ready) {
    document.fonts.ready.then(() => { measureCellRatio(); fitBrailleLine(); });
  } else { measureCellRatio(); fitBrailleLine(); }
  applyBrailleFont();          // a stored ASCII preference must survive a reload
  window.addEventListener('resize', fitBrailleLine);
  // THE FIELD IS THE INPUT SURFACE. selectionchange is the one event that
  // catches every way a caret can move — keys, mouse, and an assistive
  // technology moving it — which is precisely why navigation is left native.
  document.addEventListener('selectionchange', onFieldSelection);
  // A CLICK MEANS "THIS CELL", NOT "THE CARET" (PB, 2026-08-11).
  //
  // Clicking the right-hand half of a cell puts the caret AFTER it — that is
  // what a text field is supposed to do — so explaining whatever sits at the
  // caret named the next cell along and the explanation read one out. The caret
  // is the right answer for the keyboard, where it IS the position, and the
  // wrong one for a pointer, where the user meant the thing under it.
  //
  // So a click hit-tests the overlay directly. The field covers the render, so
  // it has to be made transparent to the test for one call; nothing is repainted
  // in between, so this is invisible.
  $('brlInput').addEventListener('click', (e) => {
    const ta = $('brlInput');
    const keep = ta.style.pointerEvents;
    ta.style.pointerEvents = 'none';
    const under = document.elementFromPoint(e.clientX, e.clientY);
    ta.style.pointerEvents = keep;
    const w = under && under.closest && under.closest('.word');
    if (w && w.dataset.w) {
      pointerExplainedAt = performance.now();     // outranks the selectionchange to come
      linkWord(w.dataset.w);
      explainWord(wordBraille.get(w.dataset.w) || toCells(w.textContent), w.dataset.w);
      return;
    }
    onFieldSelection();          // clicked past the text — fall back to the caret
  });
  $('brlInput').addEventListener('input', onFieldInput);
  // INTERCEPTED, NOT LEFT TO onFieldInput() (PB, 2026-08-19) — see
  // pasteToCells() above onFieldInput(). preventDefault stops the browser's
  // own insertion, so the field never even briefly holds raw print text for
  // onFieldInput()'s later 'input' event to pick up with the wrong rules.
  $('brlInput').addEventListener('paste', (e) => {
    const text = (e.clipboardData || window.clipboardData)?.getData('text/plain') ?? '';
    if (!text) return;                  // nothing this handler can judge — leave native behaviour
    e.preventDefault();
    const ta = $('brlInput');
    const { cells, ignored, hasBraille } = pasteToCells(text);
    if (!hasBraille) {
      const msg = 'That did not look like braille, so nothing was pasted.';
      $('statusBar').innerHTML = `<span class="sb-hint">${msg}</span>`;
      speak(msg);
      return;
    }
    ta.setRangeText(cells, ta.selectionStart, ta.selectionEnd, 'end');
    onFieldInput();
    if (ignored > 0) {
      const msg = `Pasted — ${ignored} character${ignored === 1 ? '' : 's'} ` +
        `${ignored === 1 ? 'was' : 'were'} not braille and ${ignored === 1 ? 'was' : 'were'} left out.`;
      $('statusBar').innerHTML = `<span class="sb-hint">${msg}</span>`;
      speak(msg);
    }
  });
  // Clicking anywhere in the braille pane should put the user in the field,
  // including the padding around the render.
  $('braillePane').addEventListener('mousedown', (e) => {
    if (e.target === $('braillePane') || e.target === $('brlStack')) {
      e.preventDefault(); $('brlInput').focus();
    }
  });
  syncField();
  $('brlInput').focus();
  $('speakLetter').checked = settings.speakLetter;
  $('showAscii').checked = settings.showAscii;
  $('sixKeyInput').checked = settings.sixKey;
  $('focusDark').checked = settings.focusDark;
  applyFocusDark();
  if (speechOk) {
    loadVoices();
    speechSynthesis.addEventListener('voiceschanged', loadVoices);
  } else {
    $('voiceSel').appendChild(new Option('(speech not supported)', ''));
  }
  render();
  try {
    await louis.init({ tablesBaseUrl: '/liblouis/tables' });
    // The lyric module carries no binding of its own by design (#68): the app
    // picks one. Same instance, same tables as the title above, so the two
    // cannot disagree about the same words.
    ready = true;
    // A STORED CODE MAY NOT BE LOADABLE, AND THAT MUST NOT BE PERMANENT
    // (2026-08-19). settings.brailleCode is saved, so a code chosen once was
    // chosen for ever — and until ensureTables existed, any code outside the
    // eleven built-in files could not translate at all. Measured before this:
    // the print pane came up EMPTY on every launch, with no warning, and no
    // hint that the setting was the cause. So the stored code is loaded here,
    // and a failure falls back to the code that is always present rather than
    // leaving the user with a silent, self-perpetuating blank.
    // AN UNKNOWN STORED CODE IS HEALED, ALOUD (2026-08-19). Fuzzing settings
    // put 'xx-nope-g9' in the store: the app booted, typed, and translated
    // nothing, forever. Validity is checked against the list ITSELF — asking
    // codeById would hide the problem behind its own fallback.
    if (!CODES.some((c) => c.id === settings.brailleCode)) {
      const bad = settings.brailleCode;
      settings.brailleCode = DEFAULT_CODE;
      saveSettings();
      loadBrailleCodes();
      const msg = `The saved braille code (${escMsg(bad)}) is not recognised, so English grade 2 is being used.`;
      $('statusBar').innerHTML = `<span class="sb-hint">${escMsg(msg)}</span>`;
      speak(msg);
    }
    if (settings.brailleCode !== 'en-ueb-g2') {
      try {
        await louis.ensureTables(T_TEXT());
        const sib = uncontractedSibling();
        if (sib) louis.ensureTables(sib).catch(() => {});
      } catch {
        const wanted = codeLabel(codeById(settings.brailleCode)).replace(/\s*—\s*/g, ' ');
        settings.brailleCode = 'en-ueb-g2';
        saveSettings();
        loadBrailleCodes();
        bootError = `${wanted} could not be loaded, so UEB grade 2 is being used. `
                  + 'Choose it again in Settings while online to try once more.';
      }
    }
  }
  catch (err) { bootError = 'liblouis failed to load: ' + err.message; }
  render();
})();
