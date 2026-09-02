// "Does the maths we are showing actually match the braille that was typed?"
//
// Back-translation is the hard direction. FORWARD translation — maths to
// braille — is solved, and MathCAT does it authoritatively. So we can check our
// own work: take the expression we are about to show, translate it BACK into
// braille, and compare with what the child actually typed. If the two differ,
// our reading is wrong, whatever it looks like on screen.
//
// This is deliberately CONSERVATIVE. It reports only that something does not
// match, and roughly where. It does NOT suggest a correction: a plausible wrong
// suggestion would be worse than an honest "check this line", which is the same
// principle the rest of the display follows.
//
// It is also optional. The check needs a 3.2 MB WebAssembly module, loaded
// lazily and only once maths mode is actually in use. If it fails to load, or
// is slow to arrive, nothing happens and the app behaves exactly as before.
//
// It cannot work on half-typed input: a prefix of a valid expression is not
// itself a valid expression, so it would fail on every line mid-word. Callers
// must only verify FINISHED lines.

let loading = null;
let api = null;

// Load on first use, never at start-up — the app must be usable immediately and
// offline whether or not this arrives.
export function startVerifier() {
  if (loading) return loading;
  loading = (async () => {
    const mod = await import('/engine/mathcat/pkg-web/emboss_mathcat.js');
    await mod.default();                 // fetches emboss_mathcat_bg.wasm alongside
    api = mod;
    return true;
  })().catch((err) => {
    console.warn('[verify] unavailable, continuing without it:', err && err.message);
    api = null;
    return false;
  });
  return loading;
}

export const verifierReady = () => !!api;

// ---- SPEECH -------------------------------------------------------------
//
// MathCAT speaks as well as brailles, from the SAME rules and the same loaded
// module — so speech lives here, beside the verifier, rather than loading a
// second 3.3 MB instance of the identical thing. The file is named for the
// verifier because that came first; what it really owns is the MathCAT
// instance, and both services are built on it.
//
// WHY THIS AT ALL: the app's own speaker is 140 lines covering 13 node types,
// with a fallback that reads out a LIST OF SYMBOL NAMES when it meets anything
// else — which is not a sentence and is exactly the "doesn't speak very well"
// a child hears. MathCAT's rules are the same ones we already trust for the
// braille they read.
//
// THE DIALS, chosen for a child re-reading their own line (PB, 2026-08-11):
//   SimpleSpeak  says the shortest thing that stays unambiguous. ClearSpeak is
//                built to disambiguate for readers who know the notation, and
//                is markedly longer: "the fraction with numerator ... and
//                denominator ..." against "fraction, ... over, ..., end
//                fraction".
//   Terse        drops scaffolding: "square root, 9" not "the square root of
//                9". Medium is offered for a second reading, where the fuller
//                wording helps, and costs nothing when it is not asked for.
// Both are set per call, because verbosity is a choice about the reader and
// the caller owns it.
//
// LANGUAGE IS VALIDATED HERE, not trusted. MathCAT accepts a language code it
// does not have — set_preference('Language', 'xx') reports SUCCESS — and then
// falls through to another language's rules, which is how French spoke German
// before the engine was moved to 0.7.6-beta.9. So the app carries its own list
// of languages that were heard to speak their own words, and anything else
// gets English rather than a silent surprise.
const SPOKEN_LANGUAGES = new Set(
  ['en', 'es', 'fr', 'de', 'el', 'fi', 'hu', 'nb', 'pl', 'ru', 'sv', 'vi', 'zh'],
);
// 'id' is DELIBERATELY ABSENT: at Terse its square root speaks no word at all
// (", 9" for the square root of 9) — daisy/MathCAT#668. It can return here
// when that is fixed upstream.

/** Speak a LaTeX expression, or '' if MathCAT cannot (caller then falls back). */
export function speakLatex(latex, { language = 'en', verbosity = 'Terse' } = {}) {
  if (!api || !latex || !String(latex).trim() || !globalThis.temml) return '';
  const lang = SPOKEN_LANGUAGES.has(String(language).slice(0, 2).toLowerCase())
    ? String(language).slice(0, 2).toLowerCase() : 'en';
  let mathml;
  try {
    // displayMode matches verifyLine's, so the expression MathCAT speaks is the
    // same shape as the one it brailles — otherwise limits move and the two
    // services would describe the same line differently.
    mathml = globalThis.temml.renderToString(String(latex), { displayMode: true });
  } catch { return ''; }
  try {
    if (api.speak_set_preference('SpeechStyle', 'SimpleSpeak')) return '';
    if (api.speak_set_preference('Verbosity', verbosity)) return '';
    if (api.speak_set_preference('Language', lang)) return '';
    const said = api.mathml_to_speech(mathml);
    // MathCAT reports failure by RETURNING an error string, not by throwing —
    // the same convention verifyLine has to guard against below.
    if (typeof said !== 'string' || !said.trim() || /^ERROR/i.test(said)) return '';
    return said;
  } catch { return ''; }
}

export const speechAvailable = () => !!api;

// ---- THE COMPARATOR -----------------------------------------------------
//
// Cells we DELIBERATELY do not represent, so their absence is a design decision
// and must not be reported as a mismatch: grade-1 indicators and typeform
// (bold/italic/script) marks. A teacher wants to read "25 km²", not a record of
// which indicators produced it.
//
// EVERY STRIP IS SCOPED TO ONE MEANING (2026-09-02, the Translate audit). The
// first version dropped, in both codes, every dots-56, every blank and every
// dots-45/46/456/4 + dots-2/23/2356/3/56 pair. In Nemeth those are content: dots-56
// after a letter is the SUBSCRIPT indicator, dots-45 + 23 is a superscript 2,
// dots-46 + 2 is a decimal point and a 1, and a blank decides whether dots-46 + k
// is = (spaced) or kappa (unspaced). So x-squared normalised to x, T-sub-A to
// TA, 3.14 to 34 - and a reader that lost the square in Pythagoras was
// reported as VERIFIED, under a help text promising "no note means verified".
//
// What the Nemeth side now equates, each measured against MathCAT's spelling
// on the corpus and against human-written braille (APH, NFB and BANA Nemeth
// lessons; the stricter comparator adds 1-2.5% ambers there, mostly readings
// that really are wrong):
//   - the English-letter indicator MathCAT writes before a lone letter (at the
//     start, after a blank, an opening parenthesis or a comma) and a child may not;
//   - a typeform prefix + letter indicator (bold, italic, script);
//   - the baseline indicator after a script level - also when a blank has
//     already closed it (people write blank + indicator before an ellipsis),
//     and directly before the termination sign of an under/over-script;
//   - a subscript of digits only hanging from a letter, closed by the baseline
//     indicator, a blank or the end: MathCAT writes the indicators, people
//     write the bare digits (CO2);
//   - MathCAT's dots-5 between a letter and a decimal point (z.4);
//   - blanks, except beside the two signs whose identity a blank decides.
// Every other cell is compared as typed. UEB is unchanged: its dots-56 is only
// ever grade-1, and its spacing follows print, which MathML cannot carry.
// test-verify.mjs holds the discriminations and the tolerances.
//
// Returns { text, map } where map[i] is the index in the ORIGINAL string of the
// character that became text[i] - so a divergence found in the normalised form
// can be pointed at a real cell the child typed.
const cell = (d) => String.fromCodePoint(0x2800 + [...String(d)].reduce((m, x) => m | (1 << (Number(x) - 1)), 0));
const BLANK = String.fromCodePoint(0x2800);
const LETTERS = new Set('1 12 14 145 15 124 1245 125 24 245 13 123 134 1345 135 1234 12345 1235 234 2345 136 1236 2456 1346 13456 1356'.split(' ').map(cell));
const N = { ELI_SUB: cell(56), SUP: cell(45), BASE: cell(5), BOLD: cell(456), ITAL: cell(46), SCRIPT: cell(4), UNDER: cell(146), OVER: cell(126), TERM: cell(12456), OPEN: cell(12356), COMMA: cell(6) };
const N_TYPEFORM = new Set([N.BOLD, N.ITAL, N.SCRIPT]);
const N_DIGITS = new Set('2 23 25 256 26 235 2356 236 35 356'.split(' ').map(cell));
const N_DECIMAL = cell(46);
// The two signs whose identity is decided by spacing: dots-46 + k is kappa unspaced and
// = spaced; dots-456 + l is Fraktur l unspaced and the identity sign spaced.
const SPACED_SIGNS = [[cell(46), cell(13)], [cell(456), cell(123)]];
// where a dots-56 is the English-letter indicator rather than a subscript: at the start,
// after a blank, after an opening parenthesis, after a comma
const ELI_CONTEXT = new Set([BLANK, ' ', N.OPEN, N.COMMA]);
const MODIFIERS = new Set([N.UNDER, N.OVER]);
const U = { G1: cell(56), TERM: cell(3), TYPEFORM: new Set([cell(45), cell(46), cell(456), cell(4)]), LEVEL: new Set([cell(2), cell(23), cell(2356), cell(3), cell(56)]) };

export function normalise(brl, code) {
  const src = [...String(brl)];
  const text = [], map = [];
  if (code !== 'Nemeth') {
    for (let i = 0; i < src.length; i++) {
      const c = src[i];
      if (c === BLANK || c === ' ') continue;
      if (c === U.G1 && src[i + 1] === U.G1) { i += (src[i + 2] === U.G1) ? 2 : 1; continue; }
      if (c === U.G1 && src[i + 1] === U.TERM) { i += 1; continue; }
      if (U.TYPEFORM.has(c) && U.LEVEL.has(src[i + 1])) { i += 1; continue; }
      if (c === U.G1) continue;
      text.push(c); map.push(i);
    }
    return { text: text.join(''), map };
  }
  let scriptOpen = false;        // a superscript or subscript level is open (a blank closes it)
  let modifierOpen = false;      // an under- or over-script is open (only the termination sign closes it)
  let openBeforeBlank = false;   // was one open when the current blank run began?
  let pendingBlank = -1;         // first index of a blank run not yet decided
  const isSign = (a, b) => SPACED_SIGNS.some(([p, q]) => a === p && b === q);
  const signBefore = () => text.length >= 2 && isSign(text[text.length - 2], text[text.length - 1]);
  const push = (c, i) => {
    if (pendingBlank >= 0) {
      if (text.length && (signBefore() || isSign(src[i], src[i + 1]))) { text.push(BLANK); map.push(pendingBlank); }
      pendingBlank = -1;
    }
    text.push(c); map.push(i);
  };
  for (let i = 0; i < src.length; i++) {
    const c = src[i];
    if (c === BLANK || c === ' ') { if (pendingBlank < 0) { pendingBlank = i; openBeforeBlank = scriptOpen; } scriptOpen = false; continue; }
    if (N_TYPEFORM.has(c) && src[i + 1] === N.ELI_SUB) { i += 1; continue; }   // bold/italic/script + letter indicator
    if (c === N.ELI_SUB) {
      if (i === 0 || ELI_CONTEXT.has(src[i - 1])) continue;                     // English-letter indicator
      // a subscript of digits only, hanging from a letter, closed by a baseline indicator, a
      // blank or the end: MathCAT writes the indicators, people write the bare digits (CO2)
      if (LETTERS.has(src[i - 1])) {
        let j = i + 1;
        while (N_DIGITS.has(src[j])) j++;
        if (j > i + 1 && (j >= src.length || src[j] === N.BASE || src[j] === BLANK || src[j] === ' ')) {
          for (let k = i + 1; k < j; k++) push(src[k], k);
          i = src[j] === N.BASE ? j : j - 1;
          continue;
        }
      }
      push(c, i); scriptOpen = true; continue;                                  // subscript indicator
    }
    if (c === N.SUP) { push(c, i); scriptOpen = true; continue; }
    if (MODIFIERS.has(c)) { push(c, i); modifierOpen = true; continue; }
    if (c === N.TERM) { push(c, i); scriptOpen = false; modifierOpen = false; continue; }
    if (c === N.BASE) {
      // baseline indicator: after a script, even when a blank has already closed it (MathCAT
      // writes the indicator before an ellipsis where people write blank + indicator)
      if (scriptOpen || (modifierOpen && src[i + 1] === N.TERM) || (pendingBlank >= 0 && openBeforeBlank)) { scriptOpen = false; continue; }
      // MathCAT's separator between a letter and a decimal point (z.4); people omit it
      if (i > 0 && LETTERS.has(src[i - 1]) && src[i + 1] === N_DECIMAL && N_DIGITS.has(src[i + 2])) continue;
      push(c, i); continue;                                                     // prefix of a sign (dots-5 + k is <)
    }
    push(c, i);
  }
  return { text: text.join(''), map };
}

// Check one FINISHED line. Returns:
//   { checked:false }                      the verifier is not available
//   { checked:true, ok:true }              our reading reproduces the braille
//   { checked:true, ok:false, cell:n }     it does not; n is a 0-based index
//                                          into the typed braille, or -1
export function verifyLine(braille, latex, code) {
  return verifyWith(api, globalThis.temml, braille, latex, code);
}

// The same check with its two engines passed in, so test-verify.mjs can run it
// in Node against the vendored pkg-nodejs MathCAT and a required Temml.
export function verifyWith(mathcat, temml, braille, latex, code) {
  if (!mathcat || !temml || !latex || !String(latex).trim()) return { checked: false };
  let mathml, back;
  try {
    // displayMode must match the app's rendering: inline layout moves big-
    // operator limits beside the operator (msubsup), display layout puts them
    // under/over (munderover) - a different braille SPELLING of the same maths,
    // which ambered every sum, product and limit a child typed correctly.
    mathml = temml.renderToString(String(latex), { displayMode: true });
  } catch { return { checked: false }; }
  try {
    back = mathcat.mathml_to_braille(mathml, code);
  } catch { return { checked: false }; }
  // MathCAT reports failure by RETURNING an error string, not by throwing.
  // Compared as though it were braille it looks like a mismatch, so a tool
  // failure was being shown to the teacher as a problem with the child's work.
  if (typeof back !== 'string' || !back || /^ERROR/i.test(back) || !/[\u2800-\u28ff]/.test(back)) {
    return { checked: false };
  }

  const a = normalise(braille, code);
  const b = normalise(back, code);
  if (a.text === b.text) return { checked: true, ok: true };

  // Where do they first diverge? The common prefix is the honest answer to
  // "up to here it matches"; beyond it we cannot claim to know.
  let i = 0;
  while (i < a.text.length && i < b.text.length && a.text[i] === b.text[i]) i++;
  const cell = i < a.map.length ? a.map[i] : (a.map.length ? a.map[a.map.length - 1] : -1);
  return { checked: true, ok: false, cell };
}

// Which of several candidate READINGS survive the oracle. Forward-translate
// each candidate and keep those that regenerate the typed braille exactly.
// Two or more survivors = genuine ambiguity (distinct readings, identical
// braille) - present those and let the teacher decide, never guess (GTM 15.5).
// One survivor = the braille decided it. Zero = the candidates are wrong;
// flag a gap instead. More than three genuine survivors is unreadability,
// not ambiguity - the caller should flag, not list (PLAN.md, ambiguity design).
export function pruneAlternatives(typedBraille, code, candidateLatex) {
  if (!api) return { checked: false, survivors: [] };
  const typed = normalise(typedBraille, code).text;
  const survivors = [];
  for (const latex of candidateLatex) {
    try {
      const back = api.mathml_to_braille(globalThis.temml.renderToString(String(latex), { displayMode: true }), code);
      if (typeof back === 'string' && /[\u2800-\u28ff]/.test(back) && !/^ERROR/i.test(back)
          && normalise(back, code).text === typed) survivors.push(latex);
    } catch { /* a candidate that will not even render is no candidate */ }
  }
  return { checked: true, survivors };
}

// The cells a learner most often leaves out: closers and mode indicators.
const REPAIR_CELLS = ['⠻', '⠾', '⠜', '⠼', '⠰', '⠐', '⠣', '⠹', '⠌', '⠘', '⠢', '⠔', '⠠'];

// "What were they trying to write?" — but ONLY for a line the parser has already
// failed on. That trigger matters: suggesting a correction for a line we read
// perfectly well would be second-guessing the child, and measurement showed that
// flagging clean lines by round-trip alone raises about one false alarm in eight,
// which a teacher would rightly learn to ignore. Here we speak only where we
// have already admitted we could not read something, so a suggestion can add
// information but never contradict a good reading.
//
// Search is a SINGLE edit — one cell added or removed. Widening it finds more
// but starts inventing plausible repairs that were not what the child meant,
// which for a teaching tool is worse than saying nothing.
//
// `read` is the caller's parser: braille -> { latex, warnings }.
export function suggestRepairs(typed, code, read, limit = 2) {
  if (!api) return [];
  const cells = [...String(typed)];
  if (!cells.length || cells.length > 60) return [];      // keep it instant
  const found = [];
  const seen = new Set();

  const consider = (cand, how) => {
    if (found.length >= limit || seen.has(cand) || cand === typed) return;
    seen.add(cand);
    let r;
    try { r = read(cand); } catch { return; }
    if (!r || !(r.latex || '').trim() || (r.warnings || []).length) return;
    const v = verifyLine(cand, r.latex, code);
    if (v.checked && v.ok) found.push({ braille: cand, latex: r.latex, how });
  };

  for (let i = 0; i <= cells.length && found.length < limit; i++) {
    for (const c of REPAIR_CELLS) {
      consider([...cells.slice(0, i), c, ...cells.slice(i)].join(''), `adding ${c} at cell ${i + 1}`);
    }
  }
  for (let i = 0; i < cells.length && found.length < limit; i++) {
    consider([...cells.slice(0, i), ...cells.slice(i + 1)].join(''), `removing ${cells[i]} at cell ${i + 1}`);
  }
  return found;
}
