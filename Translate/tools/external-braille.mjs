// TIER-2 EXTERNAL benchmark — braille written by HUMANS, not by MathCAT.
//
// Every other benchmark in this repo tests against MathCAT's braille dialect,
// because MathCAT generates the probe braille. This one does not: the pairs
// are harvested from the APH braille tutorials (uebmath.aphtech.org and
// nemeth.aphtech.org), where APH authored BOTH the braille and the print
// MathML. Our parser reads their braille; the judgement is against their
// print. MathCAT is not involved on either side.
//
//   readable  parsed with no warnings
//   faithful  token content of our LaTeX matches APH's own MathML
//
// There is no "consistent" column: round-tripping through MathCAT would judge
// human braille against MathCAT's re-encoding, which is exactly the
// circularity this tier exists to break.
//
// The pairs live in external/cache/aph_pairs.json — APH's content, fetched on
// demand and NOT redistributed, so it is git-ignored. It was ignored by a rule
// naming connector/, and the directory became Translate/, so between the rename
// and 2026-08-28 the file was committed while this comment said it was not. Refetch: the harvest is a
// ~40-line crawl of the exercise pages; see PLAN.md movement log 2026-07-23.
//
// Run: node connector/tools/external-braille.mjs [--failures] [--code UEB|Nemeth]

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourceTokens, faithfulness, latexTokens } from './lib/score.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert: nemeth } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));

const PAIRS = path.join(__dirname, 'external', 'cache', 'aph_pairs.json');
if (!fs.existsSync(PAIRS)) {
  console.error('No pairs cache at ' + PAIRS + ' — fetch the APH tutorial pages first (see file header).');
  process.exit(1);
}
const data = JSON.parse(fs.readFileSync(PAIRS, 'utf8'));

// APH's MathML uses HTML entities (&times; &asymp; …). temml emits literal
// characters, so the shared tokenizer never needed to decode any — do it here.
const ENT = { times: '×', sdot: '⋅', divide: '÷', middot: '·', minus: '−', plusmn: '±',
  PlusMinus: '±', pm: '±', MinusPlus: '∓', mp: '∓', mnplus: '∓',
  asymp: '≈', ne: '≠', le: '≤', ge: '≥', lt: '<', gt: '>', equals: '=', prop: '∝',
  Proportion: '∷', equest: '≟', questeq: '≟', nequiv: '≢', equiv: '≡',
  deg: '°', percnt: '%', infin: '∞', radic: '√', sum: '∑', int: '∫', part: '∂',
  alpha: 'α', beta: 'β', gamma: 'γ', delta: 'δ', epsilon: 'ε', epsi: 'ε', theta: 'θ',
  lambda: 'λ', mu: 'μ', pi: 'π', rho: 'ρ', sigma: 'σ', tau: 'τ', phi: 'φ', phiv: 'φ',
  omega: 'ω', eta: 'η', zeta: 'ζ', kappa: 'κ', nu: 'ν', xi: 'ξ', chi: 'χ', psi: 'ψ',
  Delta: 'Δ', Sigma: 'Σ', Pi: 'Π', Omega: 'Ω', Theta: 'Θ', Gamma: 'Γ', Lambda: 'Λ',
  Phi: 'Φ', Psi: 'Ψ',
  rarr: '→', larr: '←', harr: '↔', rArr: '⇒', lArr: '⇐', hArr: '⇔', map: '↦',
  cup: '∪', cap: '∩', isin: '∈', isinv: '∈', notin: '∉', sub: '⊂', sup: '⊃',
  sube: '⊆', supe: '⊇', nsub: '⊄',
  empty: '∅', emptyv: '∅', forall: '∀', exist: '∃', ang: '∠', angmsd: '∡',
  perp: '⊥', bot: '⊥', par: '∥', npar: '∦', cong: '≅', ncong: '≇', sim: '∼', nsim: '≁',
  therefore: '∴', because: '∵', ratio: '∶', Colon: '∷', sol: '/', setmn: '∖',
  prime: '′', Prime: '″', hellip: '…', mldr: '…', ctdot: '⋯', vellip: '⋮',
  amp: '&', nbsp: ' ', ensp: ' ', emsp: ' ', thinsp: ' ', num: '#', commat: '@',
  lowbar: '_', UnderBar: '_', OverBar: '¯', macr: '¯', oline: '¯',
  rsquo: '\u2019', lsquo: '\u2018', rdquo: '"', ldquo: '"', quot: '"', apos: "'",
  sect: '§', dagger: '†', bull: '•', star: '☆', starf: '★', check: '✓',
  cent: '¢', pound: '£', euro: '€', yen: '¥',
  frac12: '½', frac14: '¼', frac34: '¾', frac13: '⅓', frac23: '⅔', frac18: '⅛',
  frac38: '⅜', frac58: '⅝', frac78: '⅞', sup1: '¹', sup2: '²', sup3: '³',
  half: '½', squ: '□', square: '□', Square: '□', rect: '▭', cir: '○', circ: '○',
  xutri: '△', utri: '▵', xdtri: '▽', dtri: '▿', loz: '◊', diams: '♦', diamond: '⋄',
  hearts: '♥', clubs: '♣', spades: '♠', 
  excl: '!', subseteqq: '⫅', supseteqq: '⫆', nsube: '⊈', ratio: '∶',
  xcirc: '○', bigcirc: '○', mdash: '—', ndash: '–', hyphen: '-',
  measuredangle: '∡', rightharpoonup: '⇀', leftharpoonup: '↼', rightharpoondown: '⇁',
  ApplyFunction: '', af: '', InvisibleTimes: '', it: '', ic: '', InvisibleComma: '',
  ThinSpace: ' ', MediumSpace: ' ', NoBreak: '', ZeroWidthSpace: '',
  or: '∨', vee: '∨', and: '∧', wedge: '∧', not: '¬', lowast: '∗',
  oplus: '⊕', ominus: '⊖', otimes: '⊗', odot: '⊙', oslash: '⊘',
  there4: '∴', dollar: '$', larrhk: '↩', nrarr: '↛', nlarr: '↚' };
// APH pages contain a handful of malformed entities ("&nbsp" without the
// semicolon) — treat the known space one leniently.
const preClean = (s) => s.replace(/&nbsp(?![;a-zA-Z])/g, ' ');
const decodeEntities = (s) => preClean(s)
  .replace(/&#x([0-9a-fA-F]+);/g, (_, h) => String.fromCodePoint(parseInt(h, 16)))
  .replace(/&#([0-9]+);/g, (_, d) => String.fromCodePoint(Number(d)))
  .replace(/&([a-zA-Z][a-zA-Z0-9]*);/g, (m, name) => ENT[name] ?? m);

// Word problems in contracted literary braille are the APP's text-mode
// territory (liblouis), not the maths parser's — the tutorials' early chapters
// are full sentences. Split them out so the headline measures the right
// component; they are still counted, visibly, in their own row.
const FN_WORDS = new Set(['sin','cos','tan','sec','csc','cot','log','ln','lim','exp',
  'deg','mod','max','min','cm','mm','km','kg','mg','ml','mph','lb','lbs','oz','ft',
  'in','yd','mi','hr','min','am','pm']);
const IMPERATIVES = new Set(['find', 'solve', 'add', 'subtract', 'multiply',
  'divide', 'simplify', 'evaluate', 'write', 'count', 'graph', 'use', 'name',
  'state', 'show', 'round', 'estimate', 'compare',
  // geometry prose labels — 'point Y', 'line AB' — worksheet text, not maths
  'point', 'line', 'ray', 'segment', 'vertex', 'side']);
function isLiterary(mathml) {
  const txt = decodeEntities(mathml).replace(/<[^>]+>/g, ' ');
  const words = (txt.match(/[A-Za-z]{2,}/g) || []).filter((w) => !FN_WORDS.has(w.toLowerCase()));
  // an instruction sentence ("Find tan 20°.") is worksheet prose — the app's
  // text mode types it, whatever maths it quotes
  if (words.some((w) => IMPERATIVES.has(w.toLowerCase()))) return true;
  return words.length >= 2;
}
// Pairs wrapped in the BANA Nemeth-within-UEB switches ⠸⠩ … ⠸⠱ mix prose and
// maths ("10% of 20") — the APP strips the switches and routes the words to
// text mode; feeding them raw to the maths parser tests the wrong component.
const hasSwitch = (brl) => brl.includes('⠸⠩');
// Conventions that differ between APH's MathML and our LaTeX at token level
// but carry identical content.
// score.mjs already normalises the logic/quantifier symbols identically on
// both sides (∧ and \land both tokenise as "land") — earlier layers here
// re-mapped one side and de-synchronised them. Only true residuals remain:
const SRC_TOK = { '∶': ':', '‐': '-', '\u2019': "'", '\u2018': "'",
  '˙': '.', tilde: 'sim', '⊕': 'oplus', '⊖': 'ominus', '⊗': 'otimes',
  '⟂': 'perp', '⊥': 'perp', '⫅': 'subseteqq', '◯': '○', '…': 'ldots',
  '⇀': 'vec', dot: '', ddot: '' };   // \dot/\ddot are decoration, dropped like the print's middots
// pair-joins: ':'+':' and '?'+'=' arrive as two tokens on one side and as one
// symbol (∷, ≟) on the other — canonicalise both streams to the joined form
const joinPairs = (toks) => {
  const outT = [];
  for (const t of toks) {
    const prev = outT[outT.length - 1];
    if (t === ':' && prev === ':') { outT[outT.length - 1] = '∷'; continue; }
    if (t === '=' && prev === '?') { outT[outT.length - 1] = '≟'; continue; }
    outT.push(t);
  }
  return outT;
};
// commas: APH's mfenced-style print drops its separators before the tokens
// ever arrive, so a comma only ever appears on OUR side of a coordinate pair —
// drop it from both, like the brackets already are.
const adjustSrc = (toks) => joinPairs(toks.map((t) => SRC_TOK[t] ?? t).filter((t) => t !== '' && t !== ','));
const adjustLat = adjustSrc;
const rawMatch = (a, b) => {
  const count = (xs) => xs.reduce((m, t) => m.set(t, (m.get(t) || 0) + 1), new Map());
  const ca = count(a), cb = count(b);
  if (ca.size !== cb.size) return false;
  for (const [t, n] of ca) if (cb.get(t) !== n) return false;
  return true;
};

// --census splits every failure by an authority test: MathCAT brailles APH's
// print; if the two authorities AGREE on the braille and we still misread it,
// the bug is unarguably ours. If they disagree, no round-trip judge exists —
// dialect divergence or APH label noise, only an eye can rule.
const census = process.argv.includes('--census');
const mathcat = census
  ? require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'))
  : null;
const stripSp = (x) => String(x).replace(/[⠀ ]/g, '');

const only = (() => { const i = process.argv.indexOf('--code'); return i >= 0 ? process.argv[i + 1] : null; })();
const CODES = only ? [only] : ['UEB', 'Nemeth'];
const failures = [];

console.log('External braille benchmark — APH-authored braille vs APH-authored print\n');

for (const code of CODES) {
  const pairs = data[code] || [];
  console.log(`${'='.repeat(70)}\n${code} — ${pairs.length} pairs\n${'='.repeat(70)}`);
  console.log('  chapter                                  n   readable  faithful');
  const byChap = new Map();
  for (const p of pairs) {
    if (!byChap.has(p.chapter)) byChap.set(p.chapter, []);
    byChap.get(p.chapter).push(p);
  }
  let TN = 0, TR = 0, TF = 0, LN = 0, LR = 0, LF = 0;
  for (const [chap, items] of byChap) {
    let n = 0, readable = 0, faithful = 0, lit = 0, litR = 0, litF = 0;
    for (const p of items) {
      const literary = isLiterary(p.mathml) || (code === 'Nemeth' && hasSwitch(p.braille));
      if (literary) lit++; else n++;
      let r;
      try { r = code === 'UEB' ? uebMathsToLatex(p.braille) : nemeth(p.braille); }
      catch (e) { r = { latex: '', warnings: ['threw: ' + e.message] }; }
      const clean = !!(r.latex || '').trim() && !(r.warnings || []).length;
      let srcT = adjustSrc(sourceTokens(decodeEntities(p.mathml)));
      const latT = adjustLat(latexTokens(r.latex || ''));
      // recurring decimals: the print decorates digits with a FOLLOWING middot
      // (4.2 7·); our reading carries the dot as \dot{}, which latexTokens
      // drops as layout. When our side has a \dot, the print's decoration
      // middots are the same information — drop them from the source stream.
      if (/\\dot\b/.test(r.latex || '')) srcT = srcT.filter((t) => t !== '·' && t !== 'cdot' && t !== '*');
      const ok = clean && (faithfulness(srcT, latT).ok || rawMatch(srcT, latT));
      const flagged = !ok && clean && (r.ambiguities || []).length > 0;
      if (literary) { if (clean) litR++; if (ok) litF++; }
      else {
        if (clean) readable++;
        if (ok || flagged) faithful++;   // a teacher-presented ambiguity IS resolution
        else {
          const f = { code, chap, ex: p.exercise, braille: p.braille, mathml: p.mathml,
                      got: r.latex, why: clean ? 'content differs from print' : ((r.warnings || [])[0] || 'no output') };
          if (flagged) {
            f.why = 'ambiguous braille — both readings shown to the teacher';
            if (census) f.cls = 'flagged ambiguous (teacher resolves)';
            failures.push(f);
            continue;
          }
          if (census) {
            let mc = '';
            try { mc = mathcat.mathml_to_braille(decodeEntities(p.mathml), code); } catch { /* */ }
            f.cls = (typeof mc !== 'string' || !/[⠀-⣿]/.test(mc) || /^ERROR/i.test(mc)) ? 'oracle-cant-braille-print'
              : stripSp(mc) === stripSp(p.braille) ? 'OUR BUG (both authorities agree on the braille)'
              : 'authorities disagree (dialect or APH label noise)';
          }
          failures.push(f);
        }
      }
    }
    if (n) {
      const pc = (a) => String(Math.round(a / n * 100)).padStart(3) + '%';
      console.log(`  ${chap.slice(0, 40).padEnd(40)}${String(n).padStart(3)}     ${pc(readable)}      ${pc(faithful)}`);
    }
    TN += n; TR += readable; TF += faithful; LN += lit; LR += litR; LF += litF;
  }
  const PC = (a) => String(Math.round(a / TN * 100)).padStart(3) + '%';
  console.log(`  ${'ALL EXPRESSIONS'.padEnd(40)}${String(TN).padStart(3)}     ${PC(TR)}      ${PC(TF)}`);
  if (LN) console.log(`  (word problems — app text-mode territory: ${LN} pairs, ${Math.round(LR / LN * 100)}% read clean by the MATHS parser; not in the headline)`);
  console.log('');
}

if (census) {
  const tally = {};
  for (const f of failures) tally[f.code + ' · ' + f.cls] = (tally[f.code + ' · ' + f.cls] || 0) + 1;
  console.log('census of failures:');
  for (const [k, v] of Object.entries(tally).sort()) console.log('  ' + String(v).padStart(3) + '  ' + k);
}

if (process.argv.includes('--failures')) {
  for (const f of failures.slice(0, Number(process.env.MAXFAILS || 400))) {
    console.log(`\n  ${f.code} · ${f.chap} (${f.ex})`);
    console.log(`    braille ${f.braille}`);
    console.log(`    print   ${f.mathml.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()}`);
    console.log(`    got     ${JSON.stringify(f.got)}`);
    console.log(`    why     ${f.why}`);
    if (f.cls) console.log(`    class   ${f.cls}`);
  }
}
