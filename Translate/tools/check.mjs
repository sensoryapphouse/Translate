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
    // process.execPath, NEVER the ambient `node` (2026-09-02). Under `npm test`
    // the PATH begins with every node_modules/.bin up the tree, and one of them
    // here carries a Node 15 shim: the suites then ran on an interpreter whose
    // WebAssembly cannot load the vendored MathCAT ("table count of 2 exceeds
    // internal limit of 1"), so the verifier and curriculum crashed while the
    // same commands passed by hand. The children must be the interpreter that
    // is running this file.
    return { ok: true, out: execFileSync(process.execPath, [file, ...args], { cwd: root, encoding: 'utf8' }) };
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
  // The .ebrl the app writes, held to the eBraille 1.0 shape the DAISY checker
  // enforces, and the reader held to BOTH layouts (2026-09-02). Set
  // EBRAILLE_CHECKER_JAR and the checker itself runs inside it.
  ['eBraille',              'Translate/test-ebraille.mjs'],
  // The readers the APP ships (nemeth-rules.mjs, ueb-rules.mjs) must never throw:
  // every corpus case and thirty thousand random inputs (2026-09-02). The scores
  // below are still the older readers'; this is the one suite that holds the new ones.
  ['maths readers',         'Translate/test-maths-readers.mjs'],
  // The round-trip verifier's comparator (2026-09-02): the cells it must tell
  // apart (a lost square, subscript or decimal point; the blank that makes
  // dots-46 + k an = rather than a kappa), the spellings it must equate, and
  // the whole round trip through the vendored MathCAT.
  ['verifier',              'Translate/test-verify.mjs'],
  // The whole-file mode detector: its confident calls RE-MODE a document, so a
  // wrong one rewrites how a child's work is read. It ran only from Translate/
  // until 2026-09-02, which is why it was never in here.
  ['mode detector',         'Translate/test-mode-detect.mjs'],
  // The fallback speaker - what a child hears when MathCAT is not loaded. It
  // used to print and assert nothing; now it holds one total rule, over both
  // corpora: no spoken string carries a backslash or a brace, and none is empty.
  ['speech',                'Translate/test-speech.mjs'],
  // THE TWO SUITES THAT DRIVE A BROWSER (2026-09-02). They cover the loop a
  // blind child is in all day - braille some cells, press space, hear what you
  // wrote - and what the maths button does in every situation it can be
  // pressed. Neither can be done without a real browser, and until today
  // nothing ran them, which is why they were not noticed to be running on
  // puppeteer's bundled Chromium. They drive the INSTALLED Chrome now, so this
  // is the same browser a child uses; each takes a few seconds.
  ['speech modes (Chrome)', 'Translate/test-speech-modes.mjs'],
  ['maths button (Chrome)', 'Translate/test-maths-button.mjs'],
  // Typing, the caret, Clear, Save, Load and Export BRF - the things every user
  // does, and which had no automated test of any kind until 2026-09-02.
  ['core loop (Chrome)',    'Translate/test-core-loop.mjs'],
];

// THE PUBLISHED CHECKOUT DOES NOT CARRY THE CORPORA (2026-09-02). Translate is
// published at github.com/sensoryapphouse/Translate under CC BY-NC-SA, without
// the third-party corpora, which are fetched on demand and never redistributed.
// There, the suites that read them cannot run and the scores cannot be computed
// - so this says so once, loudly, and runs everything that does not need them.
// Here, where the corpora are present, nothing is skipped and nothing changes.
const HAS_CORPORA = fs.existsSync(path.join(root, 'Translate/tools/corpus'));
if (!HAS_CORPORA) {
  console.log('NOTE: no Translate/tools/corpus in this checkout - the corpus suites');
  console.log('      and the scores are skipped. This is the published repository.\n');
}
const NEEDS_CORPORA = new Set(['maths readers', 'speech']);

let failed = 0;
console.log('suites');
for (const [name, file] of SUITES) {
  if (!HAS_CORPORA && NEEDS_CORPORA.has(name)) { console.log(`  - ${name.padEnd(22)} skipped, needs the corpora`); continue; }
  const r = run(file);
  const last = r.out.trim().split('\n').filter(Boolean).pop() || '';
  console.log(`  ${r.ok ? '✓' : '✗'} ${name.padEnd(22)} ${last.slice(0, 60)}`);
  if (!r.ok) { failed++; console.log(r.out.split('\n').slice(-14).join('\n')); }
}

// --- 2. scores, which may rise but never fall ------------------------------
if (!HAS_CORPORA) {
  console.log(`\n${failed ? '✗' : '✓'} ${failed ? failed + ' suite(s) failed' : 'every suite this checkout can run passed'}`);
  process.exit(failed ? 1 : 0);
}
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

// A METRIC THAT VANISHES MUST NOT PASS QUIETLY (2026-09-02, the audit). The
// scores are scraped out of two tools' console output with regexes, so a
// reworded heading in either would drop a metric from this table - and a
// missing metric cannot regress, which is the worst possible failure mode for
// a gate. Every key the baseline knows about must come back.
const prev = fs.existsSync(BASELINE) ? JSON.parse(fs.readFileSync(BASELINE, 'utf8')) : null;
if (prev && prev.scores) {
  const missing = Object.keys(prev.scores).filter((k) => !(k in scores));
  if (missing.length) {
    console.log('\n✗ SCORES WENT MISSING — the baseline knows these and this run did not report them:');
    for (const k of missing) console.log('    ' + k);
    console.log('  Either a tool was reworded (the scrape in this file needs updating), or it');
    console.log('  crashed and printed nothing. A metric that is absent cannot regress, so the');
    console.log('  gate refuses rather than passing on a smaller table.');
    process.exit(1);
  }
}

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
