// One command that says whether the braille converters are still good.
//
// Until now "did I break anything?" was answered by running several tools and
// eyeballing percentages between runs. That is how a rule inserted in the wrong
// place shipped twice: the headline number moved by two points and the movement
// looked like noise.
//
// So: every test must pass, and no score may fall below the recorded baseline.
// Improvements are welcome and the baseline is updated with --bless, which makes
// raising a number a deliberate act with a diff attached, rather than a silent
// drift in either direction.
//
// Run:  node connector/tools/check.mjs
//       node connector/tools/check.mjs --bless     (accept current as the new floor)

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'baseline.json');
const bless = process.argv.includes('--bless');

const run = (file, args = []) => {
  try {
    return { ok: true, out: execFileSync('node', [file, ...args], { cwd: root, encoding: 'utf8' }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

// --- 1. everything that must simply pass -----------------------------------
const SUITES = [
  ['metric self-test',      'Translate/tools/lib/score.test.mjs'],
  ['structural self-test',  'Translate/tools/lib/structure.test.mjs'],
  ['precedence decisions',  'Translate/tools/decisions.test.mjs'],
  ['UEB round-trip',        'Translate/tools/ueb-roundtrip.mjs'],
  ['Nemeth self-test',      'nemeth-to-latex.js'],
  ['LaTeX→Nemeth',          'latex-to-nemeth.js'],
];

let failed = 0;
console.log('suites');
for (const [name, file] of SUITES) {
  const r = run(file);
  const last = r.out.trim().split('\n').filter(Boolean).pop() || '';
  console.log(`  ${r.ok ? '✓' : '✗'} ${name.padEnd(22)} ${last.slice(0, 60)}`);
  if (!r.ok) { failed++; console.log(r.out.split('\n').slice(-14).join('\n')); }
}

// --- 2. scores, which may rise but never fall ------------------------------
const bench = run('Translate/tools/bench.mjs');
if (!bench.ok) { console.log('\n✗ bench failed to run\n' + bench.out.slice(-800)); process.exit(1); }

const scores = {};
let code = null;
for (const line of bench.out.split('\n')) {
  const head = /^(UEB|Nemeth) —/.exec(line);
  if (head) { code = head[1]; continue; }
  const m = /^\s{2}(clean|faithful|both|structure)\s+(\d+)\/(\d+)/.exec(line);
  if (m && code) scores[`${code}.${m[1]}`] = { n: Number(m[2]), of: Number(m[3]) };
}

// The curriculum benchmark matters MORE than the corpus one: it is the maths a
// child actually writes, whereas the Nemeth corpus is a university algebra
// textbook and a chemistry spec. A regression here is a regression for a user.
const curric = run('Translate/tools/curriculum.mjs');
if (curric.ok) {
  let code = null;
  for (const line of curric.out.split('\n')) {
    const head = /^(UEB|Nemeth)\s*$/.exec(line.trim());
    if (head) { code = head[1]; continue; }
    const m = /^\s{2}ALL\s+(\d+)\s+(\d+)%\s+(\d+)%\s+(\d+)%/.exec(line);
    if (m && code) {
      scores[`${code}.school.readable`]   = { n: Number(m[2]), of: 100 };
      scores[`${code}.school.consistent`] = { n: Number(m[3]), of: 100 };
      scores[`${code}.school.faithful`]   = { n: Number(m[4]), of: 100 };
    }
    const g = /^\s{2}INDEPENDENT SET\s+(\d+)\s+(\d+)%\s+(\d+)%\s+(\d+)%/.exec(line);
    if (g && code) {
      scores[`${code}.indep.readable`]   = { n: Number(g[2]), of: 100 };
      scores[`${code}.indep.consistent`] = { n: Number(g[3]), of: 100 };
      scores[`${code}.indep.faithful`]   = { n: Number(g[4]), of: 100 };
    }
  }
}

const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;

console.log('\nscores');
const regressions = [];
for (const [key, cur] of Object.entries(scores)) {
  const pct = (x) => Math.round(x.n / x.of * 100);
  const old = prev && prev.scores && prev.scores[key];
  let note = '';
  if (old) {
    // Compare as a RATE, since the corpus itself may grow.
    const d = pct(cur) - pct(old);
    if (cur.of !== old.of) note = `  (corpus ${old.of}→${cur.of})`;
    if (d < 0) { regressions.push(`${key}: ${pct(old)}% → ${pct(cur)}%`); note += `  ⚠ DOWN ${d}`; }
    else if (d > 0) note += `  ↑ +${d}`;
  }
  console.log(`  ${key.padEnd(20)} ${String(cur.n).padStart(4)}/${String(cur.of).padEnd(4)} ${String(pct(cur)).padStart(3)}%${note}`);
}

if (bless) {
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: 'Floor for connector/tools/check.mjs. Raise with --bless, never lower by accident.',
    scores,
  }, null, 2) + '\n');
  console.log('\n✓ baseline updated');
  process.exit(failed ? 1 : 0);
}

if (regressions.length) {
  console.log('\n✗ REGRESSION — a score fell below the baseline:');
  for (const r of regressions) console.log('    ' + r);
  console.log('  If the drop is intended (an invented symbol removed, say, so a cell');
  console.log('  now warns honestly), re-run with --bless and say why in the commit.');
}
if (!prev) console.log('\n(no baseline yet — run with --bless to record one)');

process.exit(failed || regressions.length ? 1 : 0);
