// Benchmark BOTH braille-maths converters against MathCAT's own test suites.
//
// Corpora are built by build-corpus.mjs from a MathCAT checkout:
//   corpus/ueb-mathcat.json      189 cases (ICEB Guidelines + others)
//   corpus/nemeth-mathcat.json   755 cases (Nemeth Code rules, AATA textbook,
//                                           SRE suites, BANA chemistry)
//
// Every case carries the SOURCE MathML, so this measures correctness and not
// merely silence. See lib/score.mjs for what the two numbers mean and — just as
// important — what faithfulness deliberately does NOT check.
//
// Run:
//   node connector/tools/bench.mjs                  both codes, summary
//   node connector/tools/bench.mjs --code nemeth    one code
//   node connector/tools/bench.mjs --failures       cases that warn
//   node connector/tools/bench.mjs --unfaithful     cases that are quietly wrong
//   node connector/tools/bench.mjs --causes         ranked failure causes
//   UEB_IMPL=/tmp/old.mjs node …                    score another build

import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { scoreCorpus, sourceTokens } from './lib/score.mjs';
import { loadTemml, compareStructure, toMathML } from './lib/structure.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const argv = process.argv.slice(2);
const flag = (f) => argv.includes(f);
const opt = (f) => { const i = argv.indexOf(f); return i >= 0 ? argv[i + 1] : null; };

const only = (opt('--code') || '').toLowerCase();

// Structural check: our LaTeX -> MathML (Temml) -> compare shape with the
// source. Skipped with a clear message if the bundle is missing, never silently.
let structure = null;
try {
  const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));
  const normLeaf = (t) => sourceTokens(`<mo>${t}</mo>`);
  structure = (sourceXml, latex) => compareStructure(sourceXml, toMathML(temml, latex), normLeaf);
} catch (err) {
  console.warn('structural check unavailable (' + err.message + ')');
}
const load = (f) => JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', f), 'utf8'));

const CODES = [];
if (!only || only === 'ueb') {
  const mod = await import(process.env.UEB_IMPL || '../ueb-maths-to-latex.mjs');
  CODES.push({ name: 'UEB', cases: load('ueb-mathcat.json'), convert: mod.uebMathsToLatex });
}
if (!only || only === 'nemeth') {
  const impl = process.env.NEMETH_IMPL || path.resolve(__dirname, '../../nemeth-to-latex.js');
  CODES.push({ name: 'Nemeth', cases: load('nemeth-mathcat.json'), convert: require(impl).convert });
}

export const scores = {};

for (const { name, cases, convert } of CODES) {
  const s = scoreCorpus(cases, convert, { structure });
  scores[name] = s;

  const pct = (n) => `${String(n).padStart(3)}/${s.total} (${String(Math.round(n / s.total * 100)).padStart(3)}%)`;
  console.log(`\n${'='.repeat(64)}\n${name} — ${s.total} cases from MathCAT` +
              (s.skipped ? `  (${s.skipped} #[ignore] excluded)` : '') + `\n${'='.repeat(64)}`);
  console.log(`  clean     ${pct(s.clean)}   parsed with no warnings`);
  console.log(`  faithful  ${pct(s.faithful)}   content matches the source MathML`);
  console.log(`  both      ${pct(s.both)}`);
  if (s.structuralTotal) {
    const p2 = Math.round(s.structuralOk / s.structuralTotal * 100);
    console.log(`  structure ${String(s.structuralOk).padStart(3)}/${s.structuralTotal} (${String(p2).padStart(3)}%)   fractions/scripts/roots nested as in the source`);
  }

  // Per suite: which part of which standard defeats us.
  const bySuite = new Map();
  for (const r of s.scored) {
    const e = bySuite.get(r.suite) || { n: 0, clean: 0, faithful: 0 };
    e.n++; if (r.clean) e.clean++; if (r.f.ok) e.faithful++;
    bySuite.set(r.suite, e);
  }
  if (bySuite.size > 1) {
    console.log('\n  suite                 cases   clean  faithful');
    for (const [suite, e] of [...bySuite].sort((a, b) => (a[1].faithful / a[1].n) - (b[1].faithful / b[1].n))) {
      console.log(`  ${suite.padEnd(20)} ${String(e.n).padStart(5)}    ${String(Math.round(e.clean / e.n * 100)).padStart(3)}%     ${String(Math.round(e.faithful / e.n * 100)).padStart(3)}%`);
    }
  }

  if (flag('--causes')) {
    const tally = new Map();
    for (const r of s.scored.filter((x) => !x.clean)) {
      const k = (r.warnings[0] || 'no output').replace(/\d+/g, 'N').slice(0, 56);
      tally.set(k, (tally.get(k) || 0) + 1);
    }
    if (tally.size) {
      console.log('\n  top failure causes:');
      for (const [w, n] of [...tally].sort((a, b) => b[1] - a[1]).slice(0, 14)) {
        console.log(`  ${String(n).padStart(5)}  ${w}`);
      }
    }
  }

  if (flag('--failures')) {
    console.log('\n  --- warns ---');
    for (const r of s.scored.filter((x) => !x.clean).slice(0, 40)) {
      console.log(`  ${r.suite}/${r.name}\n    ${r.braille}\n    ${r.warnings[0] || 'no output'}`);
    }
  }
  if (flag('--structure')) {
    console.log('\n  --- structure differs from the source ---');
    for (const r of s.scored.filter((x) => x.st && x.st.nSource > 0 && !x.st.ok).slice(0, 30)) {
      console.log(`  ${r.suite}/${r.name}\n    ${r.braille}\n    got   ${JSON.stringify(r.latex)}`);
      if (r.st.onlySource.length) console.log(`    source has  ${r.st.onlySource.join(' ')}`);
      if (r.st.onlyOurs.length)   console.log(`    we produced ${r.st.onlyOurs.join(' ')}`);
    }
  }
  if (flag('--unfaithful')) {
    console.log('\n  --- parses cleanly but content does not match ---');
    for (const r of s.scored.filter((x) => x.clean && !x.f.ok).slice(0, 40)) {
      console.log(`  ${r.suite}/${r.name}\n    ${r.braille}\n    got      ${JSON.stringify(r.latex)}`);
      if (r.f.missing.length) console.log(`    missing  ${r.f.missing.join(' ')}`);
      if (r.f.extra.length)   console.log(`    invented ${r.f.extra.join(' ')}`);
    }
  }
}
