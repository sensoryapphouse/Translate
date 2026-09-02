// WHOLE-FILE mode detection — the one implementation, imported by both the
// app (Load-time checkbox pre-ticking) and the offline measurement
// (tools/doc-router.mjs). The numbers behind the wiring decision: 69
// ground-truth documents, 42 confident calls, 42 correct, 0 harmful — see
// TEST-SOURCES.md "Mode detection". Change nothing here without re-running
// doc-router.mjs.
//
// The rule: at least 3 lines of votable evidence and a ≥95% supermajority,
// else abstain. Lines carrying the Nemeth switch ⠸⠩ describe themselves and
// do not vote. An auto-maths call must also pass the NEMETH-SIGNATURE guard:
// the maths-vs-text duel cannot tell UEB maths from Nemeth (they share their
// repertoire), but the cells after a numeric indicator can — UEB digits are
// a–j cells, Nemeth digits are dropped (lower) cells, and spaced ⠨⠅ is
// Nemeth's equals sign. ⠲ is excluded from the dropped set because it
// doubles as the UEB decimal point (⠼⠲⠑ = .5).
//
// Callers inject the two engines so this file stays environment-free:
//   parseUeb(brl)      → { latex, warnings } (the UEB maths parser)
//   backTranslate(brl) → contracted-braille word → print text (liblouis)

// ONE DEFINITION, IMPORTED (2026-09-02, the audit): these cells were typed here
// and again in translate.mjs, so a change to one was invisible to the other.
import { NEM_OPEN, NEM_CLOSE } from './nemeth-switch.mjs';

// What a line holds OUTSIDE its Nemeth switch runs. An unclosed run swallows
// the rest of the line, which is what the reader does with it too.
function outsideSwitches(line) {
  let out = '', depth = 0, i = 0;
  while (i < line.length) {
    if (line.startsWith(NEM_OPEN, i)) { depth++; i += NEM_OPEN.length; continue; }
    if (line.startsWith(NEM_CLOSE, i)) { depth = Math.max(0, depth - 1); i += NEM_CLOSE.length; continue; }
    if (!depth) out += line[i];
    i++;
  }
  return out;
}

export function classifyDoc(rawLines, { parseUeb, backTranslate }) {
  // The app's buffer uses ' ' between words; the tools use ⠀. Normalise.
  const lines = rawLines.map((l) => l.replace(/ /g, '⠀'));
  const content = lines.filter((l) => /[⠁-⣿]/u.test(l));
  // Nemeth switch indicators are explicit markup, not statistics: a document
  // whose content lines are (almost) all ⠸⠩-switched IS a Nemeth document —
  // declared, so no minimum-evidence rule applies. (Files this app saves in
  // Nemeth mode look exactly like this.) A few unswitched lines among many
  // switched ones still read as a Nemeth document with stray lines; below the
  // bar, the switched lines self-describe and the REST is voted on as usual.
  if (content.length) {
    // A LINE DECLARES ITSELF NEMETH ONLY IF THE SWITCHES COVER IT (2026-08-19).
    // Merely CONTAINING ⠸⠩ was enough, so one ordinary sentence with a sum in
    // the middle of it - text, ⠸⠩ … ⠸⠱, text - counted as fully switched, and
    // a one-line document of exactly that shape scored 1.0 and was called a
    // Nemeth file. The caller then clears lineModes, so the whole document was
    // re-moded and that sentence's words came back as italic single letters.
    // Measured on a BRF round trip; the eBraille round trip of the same content
    // was unharmed, which is what pointed at the detector rather than the
    // writer.
    //
    // Nothing is lost by being strict here: switch-wrapped lines carry their
    // mode IN the cells, so the render segments them as Nemeth whether or not
    // this call ever fires. The call exists for lines that say nothing - and a
    // line with text outside the switches is not one of those, it has already
    // said what it is.
    const declared = content.filter(
      (l) => l.includes(NEM_OPEN) && !/[⠁-⣿]/u.test(outsideSwitches(l))).length;
    if (declared / content.length >= 0.95) return { call: 'nemeth', switched: declared };
  }
  const votable = content.filter((l) => !l.includes('⠸⠩'));
  if (votable.length < 3) return { call: 'abstain', why: 'thin' };

  // A VOTE DOES NOT NEED EVERY LINE (2026-09-02, the audit). The verdict is a
  // SHARE of lines, and each line costs a full UEB parse plus a liblouis
  // back-translation of every word: about 7,000 liblouis calls for a
  // 1,000-line file, which is why opening a chapter-length BRF took ten to
  // twenty seconds with nothing on screen. A systematic sample answers the
  // same question, and where the sample lands anywhere near a threshold the
  // whole file is counted after all, so no verdict rests on the sample alone.
  const SAMPLE = 150;          // standard error on a share is about 0.03 here
  const sampleOf = (all) => {
    if (all.length <= SAMPLE) return all;
    const step = all.length / SAMPLE, out = [];
    for (let k = 0; k < SAMPLE; k++) out.push(all[Math.floor(k * step)]);
    return out;
  };
  const countMaths = (lines2) => {
    let maths = 0;
    for (const brl of lines2) if (votesMaths(brl)) maths++;
    return maths;
  };

  function votesMaths(brl) {
    let mathsClean = false;
    try {
      const r = parseUeb(brl);
      mathsClean = !!(r.latex || '').trim() && !(r.warnings || []).length;
    } catch { /* not clean */ }
    const numeric = (brl.match(/⠼/gu) || []).length;
    const ops = (brl.match(/⠐⠶|⠐⠖|⠐⠤|⠐⠦|⠐⠌|⠰⠔|⠰⠢/gu) || []).length;
    const passage = /⠰⠰⠰/u.test(brl);
    let words = 0, tokens = 0;
    for (const w of brl.split('⠀').filter(Boolean)) {
      tokens++;
      let t = '';
      try { t = backTranslate(w) || ''; } catch { /* unreadable */ }
      if (/^[A-Za-z][a-z’']*[.,;:!?)]*$/.test(t.trim()) && t.trim().length >= 2) words++;
    }
    const mathsScore = (mathsClean ? 1 : 0) + numeric * 0.5 + ops * 0.7 + (passage ? 1.5 : 0);
    const textScore = (tokens ? words / tokens : 0) * 3;
    return mathsScore > textScore;
  }

  const sampled = sampleOf(votable);
  let f = countMaths(sampled) / sampled.length;
  // Near a threshold, or near enough that the sample could be on the wrong side
  // of one, count the lot. Far from both - a file that is plainly a mixture -
  // the answer is abstain either way, so the sample stands.
  if (sampled.length < votable.length
      && ((f > 0.02 && f < 0.12) || (f > 0.88 && f < 0.98))) {
    f = countMaths(votable) / votable.length;
  }
  if (f >= 0.95) {
    const all = votable.join('⠀');
    const nemSig = (all.match(/⠼[⠂⠆⠒⠢⠖⠶⠦⠔⠴]/gu) || []).length
                 + (all.match(/⠀⠨⠅⠀/gu) || []).length;
    const uebSig = (all.match(/⠼[⠁⠃⠉⠙⠑⠋⠛⠓⠊⠚]/gu) || []).length
                 + (all.match(/⠀⠐⠶⠀/gu) || []).length;
    if (nemSig > 0 && uebSig < 5 * nemSig) {
      return { call: 'abstain', why: 'nemeth-signature', f, nemSig, uebSig };
    }
    return { call: 'ueb-maths', f, nemSig, uebSig };
  }
  if (f <= 0.05) return { call: 'text', f };
  return { call: 'abstain', why: 'mixed-evidence', f };
}
