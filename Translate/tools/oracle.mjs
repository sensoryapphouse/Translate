// Differential oracle: check our converters against MathCAT's own back-translator.
//
// MathCAT gained a braille→MathML back-translator on its `brl2mml` branch in
// December 2025 (PR #419, "Phase 1: Nemeth Linear MVP"). It is NOT in a release
// — the published documentation still lists back-translation as future work —
// but it is a second, independent implementation by the people who own the
// forward direction, and that makes it valuable whatever its coverage.
//
// This is deliberately NOT a score. Where the two of us disagree, one is wrong,
// and which one is a question for a human. It is a BUG FINDER: the first run
// produced three disagreements, all of them one real defect of ours (Nemeth
// marks a nested fraction's delimiters with one ⠠ per level, and those were
// reaching our "lone ⠠ is a comma" fallback).
//
// Setup — MathCAT is Rust, so this needs a checkout and one build:
//   git clone -b brl2mml https://github.com/daisy/MathCAT.git
//   cp connector/tools/brl2mml_cli.rs MathCAT/examples/
//   (cd MathCAT && cargo build --release --example brl2mml_cli)
//   MATHCAT_BRL2MML=MathCAT/target/release/examples/brl2mml_cli \
//     node connector/tools/oracle.mjs

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { sourceTokens } from './lib/score.mjs';
import { loadTemml, compareStructure } from './lib/structure.mjs';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const { convert: nemethConvert } = require(path.resolve(__dirname, '../../nemeth-to-latex.js'));

const bin = process.env.MATHCAT_BRL2MML;
if (!bin || !fs.existsSync(bin)) {
  console.error('Set MATHCAT_BRL2MML to the built brl2mml_cli binary (see the header of this file).');
  process.exit(2);
}

const cases = [];
for (const [code, file] of [['UEB', 'ueb-mathcat.json'], ['Nemeth', 'nemeth-mathcat.json']]) {
  for (const c of JSON.parse(fs.readFileSync(path.join(__dirname, 'corpus', file), 'utf8'))) {
    if (!c.ignored) cases.push({ ...c, code });
  }
}

const input = cases.map((c) => `${c.code}\t${c.braille.replace(/\n/g, ' ')}`).join('\n') + '\n';
const theirOut = execFileSync(bin, { input, encoding: 'utf8', maxBuffer: 64 * 1024 * 1024 })
  .split('\n').filter(Boolean);

const temml = loadTemml(path.resolve(__dirname, '../../web/vendor/temml.min.js'));
const normLeaf = (t) => sourceTokens(`<mo>${t}</mo>`);

const tally = { theirParsed: {}, ourParsed: {}, n: {} };
const weWrong = [], theyWrong = [], bothWrong = [];

cases.forEach((c, i) => {
  const [tag, payload] = (theirOut[i] || 'ERR\t').split('\t');
  tally.n[c.code] = (tally.n[c.code] || 0) + 1;
  if (tag === 'OK') tally.theirParsed[c.code] = (tally.theirParsed[c.code] || 0) + 1;

  const r = c.code === 'UEB' ? uebMathsToLatex(c.braille) : nemethConvert(c.braille);
  const ourClean = !!(r.latex || '').trim() && !(r.warnings || []).length;
  if (ourClean) tally.ourParsed[c.code] = (tally.ourParsed[c.code] || 0) + 1;

  if (tag !== 'OK' || !ourClean) return;                 // only compare where BOTH read it
  let ourXml = '';
  try { ourXml = temml.renderToString(r.latex); } catch { return; }

  const ours = compareStructure(c.mathml, ourXml, normLeaf);
  const theirs = compareStructure(c.mathml, payload, normLeaf);
  if (ours.ok === theirs.ok) { if (!ours.ok) bothWrong.push({ c, r, ours }); return; }
  (ours.ok ? theyWrong : weWrong).push({ c, r, ours, theirs });
});

const pct = (a, b) => `${a || 0}/${b} (${Math.round((a || 0) / b * 100)}%)`;
console.log('coverage — how much each implementation can read at all\n');
for (const code of Object.keys(tally.n)) {
  console.log(`  ${code.padEnd(7)} ours ${pct(tally.ourParsed[code], tally.n[code]).padEnd(16)}` +
              `MathCAT ${pct(tally.theirParsed[code], tally.n[code])}`);
}

console.log('\nwhere BOTH read the braille, whose structure matches the source');
console.log(`  we are wrong, MathCAT right : ${weWrong.length}   <- our bug list`);
console.log(`  MathCAT wrong, we are right : ${theyWrong.length}`);
console.log(`  both wrong                  : ${bothWrong.length}`);

if (weWrong.length) {
  console.log('\n--- cases to fix (MathCAT agrees with the source, we do not) ---');
  for (const d of weWrong.slice(0, 20)) {
    console.log(`  ${d.c.code} ${d.c.suite}/${d.c.name}\n    ${d.c.braille}`);
    console.log(`    ours        ${JSON.stringify(d.r.latex).slice(0, 90)}`);
    if (d.ours.onlySource.length) console.log(`    source has  ${d.ours.onlySource.join(' ').slice(0, 90)}`);
    if (d.ours.onlyOurs.length)   console.log(`    we produced ${d.ours.onlyOurs.join(' ').slice(0, 90)}`);
  }
}
