// The audit harness: does our parser obey a given rule of the standard?
//
// The rule inventory (tools/rules/inventory.json) says what the two standards
// REQUIRE. This turns any one of those requirements into a test that either
// passes or fails, with no room for an opinion in between.
//
// THE PROBLEM THIS SOLVES. Earlier attempts to audit by hand kept inventing
// braille — a wrong arrow cell, a shape that does not exist, a made-up cube
// root — and then "finding a bug" that was really a bad test. So a probe is
// written as LATEX, never as braille, and MathCAT generates the braille. The
// braille is then authoritative by construction: it is what a real transcriber's
// tool produces for that expression.
//
//   latex ──Temml──► MathML ──MathCAT──► braille        the input, generated
//   braille ──our parser──► latex′ ──Temml──► MathML′ ──MathCAT──► braille′
//
// A probe PASSES when braille′ === braille (round-trip consistency), the parse
// raised no warning, and the content survived. Consistency is the decisive one:
// it needs no ground truth, and a wrong STRUCTURE cannot survive it, because a
// misplaced script or fraction re-translates to different cells.
//
// EXERCISED. A probe that does not put the rule's own indicator cells into the
// generated braille tests nothing. Pass the rule's `indicators` and the harness
// reports whether they actually appear — a probe reported `exercises: false` is
// a bad probe, not a passing parser.
//
// Direct braille probes are accepted (`braille` instead of `latex`) for the
// rules MathCAT will not generate — spatial arithmetic, omission signs,
// transcriber-defined shapes — but they are marked `sourced: "hand"` so their
// weaker standing stays visible in the results.
//
// Run:
//   node connector/tools/audit.mjs probes.json [--json] [--fails]
//   node connector/tools/audit.mjs --one UEB '\frac{1}{2}'

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourceTokens, faithfulness, latexTokens } from './lib/score.mjs';
import { loadTemml, toMathML } from './lib/structure.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));
const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));
const nemeth = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));

const strip = (s) => String(s).replace(/[⠀ ]/g, '');
const CODES = {
  UEB:    { mathcat: 'UEB',    parse: (b) => uebMathsToLatex(b) },
  Nemeth: { mathcat: 'Nemeth', parse: (b) => nemeth.convert(b) },
};

// --- one probe -------------------------------------------------------------
export function runProbe(p) {
  const codeName = /nem/i.test(p.code || '') ? 'Nemeth' : 'UEB';
  const C = CODES[codeName];
  const out = { rule: p.rule || '', code: codeName, latex: p.latex || '', note: p.note || '' };

  // 1. the input braille — generated, or supplied by hand as a last resort
  let braille = p.braille || '';
  if (p.latex && !braille) {
    let mathml;
    try { mathml = toMathML(temml, p.latex); }
    catch (e) { return { ...out, verdict: 'BAD-PROBE', why: 'latex will not parse: ' + e.message.slice(0, 90) }; }
    out.mathml = mathml;
    try { braille = mathcat.mathml_to_braille(mathml, C.mathcat); }
    catch (e) { return { ...out, verdict: 'BAD-PROBE', why: 'mathcat threw: ' + e.message.slice(0, 90) }; }
    if (typeof braille !== 'string' || !/[⠀-⣿]/.test(braille) || /^ERROR/i.test(braille))
      return { ...out, verdict: 'BAD-PROBE', why: 'mathcat produced no braille: ' + String(braille).slice(0, 60) };
    out.sourced = 'mathcat';
  } else if (braille) {
    out.sourced = 'hand';
  } else {
    return { ...out, verdict: 'BAD-PROBE', why: 'probe has neither latex nor braille' };
  }
  out.braille = braille;

  // 2. does it actually contain what the rule is about?
  const inds = p.indicators || [];
  out.exercises = inds.length ? inds.some((s) => braille.includes(s)) : null;
  out.missingIndicators = inds.filter((s) => !braille.includes(s));

  // 3. read it back
  let r;
  try { r = C.parse(braille); }
  catch (e) { r = { latex: '', warnings: ['threw: ' + e.message] }; }
  out.got = (r.latex || '').trim();
  out.warnings = r.warnings || [];
  out.clean = !!out.got && !out.warnings.length;

  // 4. the decisive check
  out.consistent = false;
  if (out.got) {
    try {
      const back = mathcat.mathml_to_braille(toMathML(temml, out.got), C.mathcat);
      out.back = back;
      out.consistent = typeof back === 'string' && strip(back) === strip(braille);
    } catch (e) { out.back = 'ERR ' + e.message.slice(0, 60); }
  }

  // 5. did the content survive
  out.faithful = false;
  if (out.mathml && out.got) {
    try {
      const f = faithfulness(sourceTokens(out.mathml), latexTokens(out.got));
      out.faithful = f.ok;
      if (!f.ok) out.lost = { missing: f.missing || [], extra: f.extra || [] };
    } catch { /* leave false */ }
  }

  out.verdict = out.clean && out.consistent && (out.faithful || !out.mathml) ? 'PASS' : 'FAIL';
  if (out.verdict === 'FAIL') {
    out.why = !out.got ? 'produced nothing'
      : out.warnings.length ? 'warned: ' + out.warnings[0]
      : !out.consistent ? 'round-trips to different braille'
      : 'content lost or invented';
  }
  return out;
}

// --- cli -------------------------------------------------------------------
if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  const argv = process.argv.slice(2);
  const one = argv.indexOf('--one');
  const probes = one >= 0
    ? [{ code: argv[one + 1], latex: argv[one + 2], rule: 'ad hoc' }]
    : JSON.parse(fs.readFileSync(argv.find((a) => !a.startsWith('--')), 'utf8'));

  const results = probes.map(runProbe);

  if (argv.includes('--json')) {
    console.log(JSON.stringify(results, null, 1));
  } else {
    const show = argv.includes('--fails') ? results.filter((r) => r.verdict !== 'PASS') : results;
    for (const r of show) {
      const mark = r.verdict === 'PASS' ? 'ok  ' : r.verdict === 'BAD-PROBE' ? 'BAD ' : 'FAIL';
      console.log(`${mark} ${r.code.padEnd(6)} ${r.rule}`);
      if (r.latex) console.log(`       latex  ${r.latex}`);
      if (r.braille) console.log(`       braille ${r.braille}${r.sourced === 'hand' ? '   (hand-written, unverified)' : ''}`);
      if (r.exercises === false) console.log(`       ⚠ does not exercise the rule — missing ${r.missingIndicators.join(' ')}`);
      if (r.verdict !== 'PASS') {
        console.log(`       got    ${JSON.stringify(r.got || '')}`);
        if (r.back && !r.consistent) console.log(`       back   ${r.back}`);
        if (r.lost) console.log(`       lost   missing=${JSON.stringify(r.lost.missing)} extra=${JSON.stringify(r.lost.extra)}`);
        console.log(`       why    ${r.why}`);
      }
      console.log('');
    }
    const n = results.length;
    const pass = results.filter((r) => r.verdict === 'PASS').length;
    const bad = results.filter((r) => r.verdict === 'BAD-PROBE').length;
    const unex = results.filter((r) => r.exercises === false).length;
    console.log(`${pass}/${n} pass` + (bad ? `, ${bad} bad probes` : '') + (unex ? `, ${unex} do not exercise their rule` : ''));
  }
}
