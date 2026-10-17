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
// SELF-CONTAINED (TR-18, 15 Oct 2026 audit). `npm test` is the one advertised
// command, and it used to need a dev server already running for one borrowed
// Emboss suite - on a checkout without that extra process it came back red for
// a reason that had nothing to do with braille. The gate now starts what it
// needs on a port the OS picks and stops it again, and it reports Translate's
// suites separately from the borrowed ones so a failure cannot be mistaken for
// a regression here.
//
// Run:  npm test                             (= node Translate/tools/check.mjs)
//       node Translate/tools/check.mjs --bless     (accept current as the new floor)

import fs from 'node:fs';
import { compareRates, pctRound, scoreText, roundingBlindSpot } from './rate.mjs';
import path from 'node:path';
import { execFileSync, spawn } from 'node:child_process';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const root = path.resolve(__dirname, '../..');
const BASELINE = path.join(__dirname, 'baseline.json');
const bless = process.argv.includes('--bless');

const run = (file, args = [], env = null) => {
  try {
    // process.execPath, NEVER the ambient `node` (2026-09-02). Under `npm test`
    // the PATH begins with every node_modules/.bin up the tree, and one of them
    // here carries a Node 15 shim: the suites then ran on an interpreter whose
    // WebAssembly cannot load the vendored MathCAT ("table count of 2 exceeds
    // internal limit of 1"), so the verifier and curriculum crashed while the
    // same commands passed by hand. The children must be the interpreter that
    // is running this file.
    return { ok: true, out: execFileSync(process.execPath, [file, ...args],
      { cwd: root, encoding: 'utf8', ...(env ? { env } : {}) }) };
  } catch (e) {
    return { ok: false, out: (e.stdout || '') + (e.stderr || '') };
  }
};

// --- A DEV SERVER, WHEN A SUITE NEEDS ONE ----------------------------------
//
// TR-18 of the 15 Oct 2026 audit. One borrowed suite - Emboss's localisation
// test - navigates to a dev server, and this gate did not provide one: on a
// checkout without that extra process already running, the single advertised
// command came back red with
//
//     page.goto: net::ERR_CONNECTION_REFUSED at http://localhost:8137/...
//
// which is not evidence of anything being wrong with the braille. Every one of
// Translate's OWN browser suites starts its own server and stops it, so this is
// the gate's only external prerequisite. It is now provisioned here and cleaned
// up, rather than being a thing the reader had to know.
//
// The port is asked of the OS, not guessed: 8137 is the suite's default and is
// exactly the kind of fixed port that is already taken on a working machine.
const freePort = () => new Promise((res, rej) => {
  const probe = net.createServer();
  probe.on('error', rej);
  probe.listen(0, '127.0.0.1', () => {
    const { port } = probe.address();
    probe.close(() => res(port));
  });
});

let server = null;
const startServer = async () => {
  if (server) return server;
  const port = await freePort();
  const child = spawn(process.execPath, [path.join(root, 'scripts/serve.mjs'), String(port)],
    { cwd: root, stdio: ['ignore', 'ignore', 'pipe'] });
  let stderr = '';
  child.stderr.on('data', (b) => { stderr += b; });
  // WAIT FOR THE CONDITION, NOT THE CLOCK: poll until it answers. A fixed sleep
  // is a guess about a machine, and the failure it causes looks like the bug
  // this provisioning exists to remove.
  const deadline = Date.now() + 20000;
  for (;;) {
    if (child.exitCode !== null) {
      throw new Error(`the dev server exited at once (code ${child.exitCode})\n${stderr}`);
    }
    try {
      await fetch(`http://127.0.0.1:${port}/`, { method: 'HEAD' });
      break;
    } catch { /* not listening yet */ }
    if (Date.now() > deadline) {
      child.kill('SIGKILL');
      throw new Error(`the dev server never answered on ${port}\n${stderr}`);
    }
    await new Promise((r) => setTimeout(r, 100));
  }
  server = { port, child };
  console.log(`  (dev server on ${port} for the suites that need one)`);
  return server;
};
const stopServer = () => {
  if (!server) return;
  server.child.kill('SIGTERM');
  server = null;
};
// CLEAN UP EVEN WHEN THIS FILE THROWS OR IS INTERRUPTED. A gate that leaves a
// server behind makes the NEXT run pass for the wrong reason.
process.on('exit', stopServer);
for (const sig of ['SIGINT', 'SIGTERM']) {
  process.on(sig, () => { stopServer(); process.exit(1); });
}

// --- 1. everything that must simply pass -----------------------------------
// A third element declares what a suite needs and whose it is. `app` defaults
// to the first path segment; it is given explicitly only where the file lives
// under one app but the check belongs to another.
const SUITES = [
  ['metric self-test',      'Translate/tools/lib/score.test.mjs'],
  ['structural self-test',  'Translate/tools/lib/structure.test.mjs'],
  ['precedence decisions',  'Translate/tools/decisions.test.mjs'],
  // The GATE'S own arithmetic: whether the ratchet can see one lost case
  // (15 Oct audit, TR-17). Runs each case under the old rounded rule too, so
  // the suite shows what was wrong and not only that it is right now.
  ['score gate',            'Translate/tools/rate.test.mjs'],
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
  // Recovery across TABS and across braille CODES (15 Oct audit, TR-01/TR-02).
  // Two pages in one browser context, which the core-loop suite cannot do.
  ['recovery (Chrome)',     'Translate/test-recovery.mjs'],
  // Where mode is resolved, and whether the places agree (15 Oct audit, TR-04
  // and the rest of that family). Loads documents written by the real writer.
  ['modes (Chrome)',        'Translate/test-modes.mjs'],
  // A REAL service-worker update, in a real browser (15 Oct audit, TR-12).
  // sw-cache-test.mjs checks the asset graph; it cannot see what an update
  // throws away, which is how downloaded languages were lost unnoticed.
  ['offline update (Chrome)', 'Translate/test-offline.mjs'],
  // Is the text legible, measured rather than eyeballed (15 Oct audit, TR-13).
  // Every run of text in the app and in Help, its colour composited over its
  // real backdrop - tints included - against the threshold WCAG asks for at
  // that size and weight, resting and hovered.
  ['contrast (Chrome)',     'Translate/test-contrast.mjs'],
  // Do the header controls collide at any width (tester, 17 Oct)? Nothing
  // measured the toolbar's geometry, so an overlap that hid Save behind Clear
  // survived a full battery and a deploy.
  ['layout (Chrome)',       'Translate/test-layout.mjs'],
  // TRANSLATE'S OWN CACHE-GRAPH CHECK (15 Oct audit, TR-18, which asked for
  // these "rather than relying on tests housed under another application").
  // The instrument lives under BrlDuet because both apps are measured by it,
  // and it was not in this gate at all - it was run by hand. `--app translate`
  // runs only the checks about Translate, so BrlDuet's cache version cannot
  // redden Translate's gate, which is the coupling the audit objected to.
  ['cache graph',           'BrlDuet/sw-cache-test.mjs',
    { app: 'Translate', args: ['--app', 'translate'] }],
  // Emboss Phase 3: NIMAS Round-Trip, Lexical Style Sync, Lists, and Sidebars
  ['NIMAS round-trip',      'Emboss/tests/nimas_roundtrip.test.mjs'],
  ['BANA style sync',       'Emboss/tests/bana_lexical_style_sync.test.mjs'],
  ['BANA plain list sync',  'Emboss/tests/bana_plain_list_sync.test.mjs'],
  ['BANA sidebar sync',     'Emboss/tests/bana_sidebar_sync.test.mjs'],
  // Emboss Phase 4: Table Engine
  ['BANA table format',     'Emboss/tests/bana_table_format.test.mjs'],
  ['NIMAS table round-trip','Emboss/tests/nimas_table_roundtrip.test.mjs'],
  ['BANA table editor sync','Emboss/tests/bana_table_editor_sync.test.mjs'],
  // Emboss Phase 5: Menus & Style System
  ['BANA style dropdown',   'Emboss/tests/bana_dropdown_styles.test.mjs'],
  ['BANA slash commands',   'Emboss/tests/bana_slash_commands.test.mjs'],
  ['BANA markdown shortcuts','Emboss/tests/bana_markdown_shortcuts.test.mjs'],
  ['BANA visual styling',   'Emboss/tests/bana_visual_styling.test.mjs'],
  // Emboss Phase 6: Save/Load UI & Full Scale Validation
  ['BANA project save',     'Emboss/tests/bana_project_save.test.mjs'],
  ['BANA braille export',   'Emboss/tests/bana_braille_export.test.mjs'],
  ['BANA project load',     'Emboss/tests/bana_project_load_roundtrip.test.mjs'],
  // Production Scale Benchmark: Collections Grade 7 Textbook
  ['NIMAS production scale','Emboss/tests/test_nimas_production.mjs'],
  // Emboss Global Localisation: Phase 1 i18n Core Engine & DOM Architecture
  ['Phase 1 Localisation i18n', 'Emboss/tests/test-i18n-engine.mjs', { needs: 'server' }],
  // Unsaved Changes Dirty Tracking & Exit Warnings
  ['Unsaved dirty tracking', 'Emboss/tests/unsaved_changes_dirty_tracking.test.mjs'],
];

// THE PUBLISHED CHECKOUT DOES NOT CARRY THE CORPORA (2026-09-02). Translate is
// published at github.com/sensoryapphouse/Translate under CC BY-NC-SA, without
// the third-party corpora, which are fetched on demand and never redistributed.
// There, the suites that read them cannot run and the scores cannot be computed
// - so this says so once, loudly, and runs everything that does not need them.
// Here, where the corpora are present, nothing is skipped and nothing changes.
const HAS_CORPORA = fs.existsSync(path.join(root, 'Translate/tools/corpus'));
if (!HAS_CORPORA) {
  console.log('NOTE: no Translate/tools/corpus in this checkout - the suites that read the');
  console.log('      corpora and ALL the scores are skipped, so a pass below is a PARTIAL');
  console.log('      pass. This is the published repository.\n');
}
const NEEDS_CORPORA = new Set(['maths readers', 'speech']);

let failed = 0, ran = 0;
const skipped = [];        // needs the corpora
const absent = [];         // its file is not in this checkout at all
const whoFailed = [];
// The apps whose suites this gate BORROWS. Anything else is Translate's own,
// including the two converter self-tests that sit at the repo root - taking the
// first path segment alone made each of those its own "app" in the tally.
const BORROWED = new Set(['Emboss', 'BrlDuet']);
const appOf = ([, file, opts = {}]) => {
  if (opts.app) return opts.app;
  const seg = file.split('/')[0];
  return BORROWED.has(seg) ? seg : 'Translate';
};
console.log('suites');
try {
  for (const entry of SUITES) {
    const [name, file, opts = {}] = entry;
    // A SUITE WHOSE FILE IS NOT IN THIS CHECKOUT IS SKIPPED, AND SAID SO
    // (2026-10-17, publishing TR-18's work). The public repository is a curated
    // subset: it carries Translate and its tests, and deliberately not the other
    // products. So the eighteen borrowed Emboss suites, and now BrlDuet's
    // cache-graph instrument, are simply not there - and each one was failing as
    // "cannot find module", eighteen red lines that said nothing about braille.
    // That is the same fault TR-18 named, one layer out: a gate must not report
    // a file the checkout was never meant to have as a broken test.
    //
    // FIRST, before anything is provisioned: a suite that cannot run must not
    // start a dev server either (scripts/serve.mjs is not published, and the one
    // suite that wants it is not published either).
    if (!fs.existsSync(path.join(root, file))) {
      absent.push(name);
      console.log(`  - ${name.padEnd(22)} skipped, ${file} is not in this checkout`);
      continue;
    }
    if (!HAS_CORPORA && NEEDS_CORPORA.has(name)) { skipped.push(name); console.log(`  - ${name.padEnd(22)} skipped, needs the corpora`); continue; }
    let env = null;
    if (opts.needs === 'server') {
      const s = await startServer();
      env = { ...process.env, PORT: String(s.port) };
    }
    ran++;
    const r = run(file, opts.args || [], env);
    const last = r.out.trim().split('\n').filter(Boolean).pop() || '';
    console.log(`  ${r.ok ? '✓' : '✗'} ${name.padEnd(22)} ${last.slice(0, 60)}`);
    if (!r.ok) { failed++; whoFailed.push([name, appOf(entry)]); console.log(r.out.split('\n').slice(-14).join('\n')); }
  }
} finally {
  stopServer();
}

// WHOSE FAILURE IS IT? (TR-18.) This gate runs Translate's own suites and a
// number borrowed from Emboss. An Emboss failure is not evidence of a braille
// regression in Translate, and the audit hit precisely that confusion. The
// split is printed so nobody has to work it out from the list.
const tally = {};
for (const entry of SUITES) {
  const [name] = entry;
  if (absent.includes(name) || skipped.includes(name)) continue;   // it did not run
  const app = appOf(entry);
  tally[app] = tally[app] || { total: 0, failed: 0 };
  tally[app].total += 1;
}
for (const [, app] of whoFailed) tally[app].failed += 1;
console.log('  ' + Object.entries(tally)
  .map(([a, v]) => `${a} ${v.total - v.failed}/${v.total}`).join('   '));
if (whoFailed.length) {
  const mine = whoFailed.filter(([, a]) => a === 'Translate').map(([n]) => n);
  console.log(mine.length
    ? `  Translate's own failures: ${mine.join(', ')}`
    : '  NONE of these failures is Translate\'s own — every one is in a borrowed suite,'
      + ' so none of them is evidence of a braille regression here.');
}

// --- 2. scores, which may rise but never fall ------------------------------
if (!HAS_CORPORA) {
  // THE LAST LINE MUST NOT BE QUOTABLE AS "THE TESTS PASSED" (2026-10-10, the
  // audit). It used to say that every suite this checkout can run passed, which an
  // outside reader hears as a clean bill of health when the corpus suites and every
  // score had not run at all. So it says how many suites ran, how many did not, and
  // that the scores were never computed. The exit code is exactly what it was: a
  // skipped suite is not a failure, a failed one still is.
  const verdict = failed
    ? `✗ ${failed} of the ${ran} suites that ran FAILED`
    : `✓ ${ran} of ${SUITES.length} suites ran and all passed`;
  const why = [];
  if (skipped.length) why.push(`${skipped.length} need the corpora (${skipped.join(', ')})`);
  if (absent.length) why.push(`${absent.length} are not in this checkout (${absent.join(', ')})`);
  const skips = why.length ? `skipped: ${why.join('; ')}` : 'none skipped';
  console.log(`\n${verdict}; ${skips}; the scores were NOT computed, so nothing was checked against the baseline.`);
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
    // COUNTS, NOT THE PERCENTAGES IN THE TABLE (TR-17, 15 Oct 2026). This used
    // to read the rounded figures from the human table and record them as
    // `{ n: <percentage>, of: 100 }` - so the baseline for the benchmark that
    // "matters MORE" held no counts, and its denominator was a fiction: the
    // school set is 60 cases and the independent set 481, never 100. Comparing
    // 94 against 94 could not see four lost cases out of 481.
    const c = /^#counts\s+(ALL|INDEPENDENT)\s+n=(\d+)\s+readable=(\d+)\s+consistent=(\d+)\s+faithful=(\d+)/.exec(line);
    if (c && code) {
      const where = c[1] === 'ALL' ? 'school' : 'indep';
      const of = Number(c[2]);
      scores[`${code}.${where}.readable`]   = { n: Number(c[3]), of };
      scores[`${code}.${where}.consistent`] = { n: Number(c[4]), of };
      scores[`${code}.${where}.faithful`]   = { n: Number(c[5]), of };
    }
  }
}

// THE COUNTS MUST BE THERE. curriculum.mjs prints them for this gate; if the
// line is gone the only thing left to read is the rounded table, which is what
// TR-17 was about. Falling back to it would restore the fault quietly, so this
// refuses instead.
if (curric.ok && !Object.keys(scores).some((k) => /\.(school|indep)\./.test(k))) {
  console.log('\n✗ curriculum.mjs printed no #counts lines, so only its rounded');
  console.log('  table is available and no exact comparison is possible. Either the');
  console.log('  tool was changed or it failed part-way. The gate refuses rather than');
  console.log('  comparing percentages again (TR-17).');
  process.exit(1);
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
  const old = prev && prev.scores && prev.scores[key];
  let note = '';
  if (old) {
    // AS A RATE, EXACTLY: cross multiplication on the counts, since the corpus
    // itself may grow and a/b vs c/d needs no rounding to decide (rate.mjs).
    const d = compareRates(cur, old);
    if (cur.of !== old.of) note = `  (corpus ${old.of}→${cur.of})`;
    if (d < 0) {
      regressions.push(`${key}: ${scoreText(old)} → ${scoreText(cur)}`);
      note += '  ⚠ DOWN';
    } else if (d > 0) note += '  ↑ up';
  }
  console.log(`  ${key.padEnd(20)} ${String(cur.n).padStart(4)}/${String(cur.of).padEnd(4)} ${String(pctRound(cur)).padStart(3)}%${note}`);
}

if (bless) {
  fs.writeFileSync(BASELINE, JSON.stringify({
    note: 'Floor for Translate/tools/check.mjs. Raise with --bless, never lower by accident.'
      + ' Scores are COUNTS over the real number of cases, compared by cross'
      + ' multiplication (tools/rate.mjs). Never percentages: see TR-17.',
    scores,
  }, null, 2) + '\n');
  console.log('\n✓ baseline updated');
  // WHAT THE FLOOR IS NOW WORTH. A rounded comparison could absorb this many
  // lost cases per metric without reporting anything; printing it at the moment
  // the floor is set says how much of a ratchet was just banked.
  const blind = Object.entries(scores)
    .map(([k, v]) => [k, roundingBlindSpot(v)])
    .filter(([, n]) => n > 0);
  if (blind.length) {
    console.log('  cases a ROUNDED comparison would have absorbed in silence, now caught:');
    for (const [k, n] of blind) console.log(`    ${k.padEnd(24)} ${n}`);
  } else {
    console.log('  (at these denominators even a rounded comparison would have caught one case)');
  }
  process.exit(failed ? 1 : 0);
}

if (regressions.length) {
  console.log('\n✗ REGRESSION — a score fell below the baseline:');
  // The COUNTS, both sides. A bare percentage cannot tell a pruned corpus from
  // a worse result, and the drop that matters most is the one the rounded
  // figures show as unchanged.
  for (const r of regressions) console.log('    ' + r);
  console.log('  If the drop is intended (an invented symbol removed, say, so a cell');
  console.log('  now warns honestly), re-run with --bless and say why in the commit.');
}
if (!prev) console.log('\n(no baseline yet — run with --bless to record one)');

process.exit(failed || regressions.length ? 1 : 0);
