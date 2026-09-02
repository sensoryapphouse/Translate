// WHAT THE CHILD HEARS WHEN THEY FINISH A WORD, in every mode the app has.
//
// This is the loop a blind child is in all day: braille some cells, press
// space, hear what they wrote. It has broken twice in ways that LOOK fine on
// screen - the print pane drew the formula correctly while the speech read the
// same cells as literary braille ("of−b±shbin2−4acing2awith'"), because the
// speech asked the whole-document maths checkboxes and the maths was an inline
// span. Nothing in the visual tests could see it. Hence this file.
//
// It drives a real browser, because the speech only happens on real edits:
// a keydown that captures the pending edit, then the browser's own insertion.
// Speech output is set to "Screen reader", which routes every utterance
// synchronously into #announce where it can be read back.
//
// Run:  node test-speech-modes.mjs            (serves Translate itself)
//       node test-speech-modes.mjs --show     (headful, to watch it)
// DRIVEN BY PLAYWRIGHT, IN THE REAL CHROME ON THIS MACHINE (PB, 2026-09-02).
// It used to launch puppeteer's own bundled Chromium, which is not the browser
// anyone uses and behaves differently where it matters here - that build cannot
// even load the MathCAT wasm, so speech measured through it was the fallback
// speaker while looking like the real one. channel: 'chrome' drives the
// installed browser; puppeteer is gone from this repository.
import { chromium } from 'playwright';
import http from 'http';
import fs from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8231;
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
                '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
                '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
                '.ctb': 'text/plain', '.cti': 'text/plain', '.uti': 'text/plain',
                '.utb': 'text/plain', '.dis': 'text/plain', '.brf': 'text/plain' };

const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404); res.end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream' });
  fs.createReadStream(file).pipe(res);
});

// Cells are BUILT from dot numbers, never typed: a mistyped cell would test
// something other than what the name says.
const cell = (...dots) => String.fromCodePoint(0x2800 + dots.reduce((a, d) => a | (1 << (d - 1)), 0));
const cells = (...specs) => specs.map((s) => (s === ' ' ? ' ' : cell(...s))).join('');
const CAT  = cells([1, 4], [1], [2, 3, 4, 5]);            // c a t
const SAT  = cells([2, 3, 4], [1], [2, 3, 4, 5]);         // s a t
const DOG  = cells([1, 4, 5], [1, 3, 5], [1, 2, 4, 5]);   // d o g
const NUM  = cell(3, 4, 5, 6);                            // numeric indicator
const HALF = NUM + cells([1], [3, 4], [1, 2]);            // #a/b  -> 1/2 in UEB maths
const NEM_SUM = NUM + cells([2, 3]) + cell(3, 4, 6) + cell(2, 3);  // #2+2 in Nemeth (dropped digits)

const failures = [];
const check = (name, got, wants, forbids) => {
  const okWant = !wants || wants.test(got);
  const okForbid = !forbids || !forbids.test(got);
  const ok = okWant && okForbid;
  if (!ok) failures.push({ name, got });
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${JSON.stringify(got)}`);
};

// The literary reading of maths cells - the exact failure this file exists for.
const LITERARY_LEAK = /of|sh|ing|with|;'|κ/;

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.argv.includes('--show'),
    args: ['--no-sandbox', '--autoplay-policy=no-user-gesture-required'],
  });
  const page = await browser.newPage();

  // WAIT FOR THE CONDITION, NOT THE CLOCK (2026-09-02, the audit). A fixed sleep
  // is a guess about a machine: too short and the suite fails on a loaded
  // laptop, too long and every run pays for it. Deliberate settle times - a
  // pause that models a person stopping typing - stay as sleeps, because there
  // the duration IS the thing being tested.
  const waitFor = async (fn, what, ms = 8000) => {
    const t0 = Date.now();
    for (;;) {
      if (await page.evaluate(fn)) return true;
      if (Date.now() - t0 > ms) { failures.push(`timed out waiting for ${what}`); console.log(`FAIL  timed out waiting for ${what}`); return false; }
      await new Promise((r) => setTimeout(r, 50));
    }
  };

  page.on('pageerror', (e) => { failures.push({ name: 'page error', got: String(e) }); });

  // One helper set, injected once per page load.
  const HELPERS = () => {
    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__h = {
      $, sleep,
      set: (id, on) => { const e = $(id); if (e.checked !== on) { e.checked = on; e.dispatchEvent(new Event('change')); } },
      clear: async () => { $('clearBtn').click(); await sleep(120); $('confirmYes').click(); await sleep(260); },
      ctrlM: async () => { document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', ctrlKey: true, bubbles: true, cancelable: true })); await sleep(200); },
      type: async (s) => { $('brlInput').focus(); document.execCommand('insertText', false, s); await sleep(180); },
      // A REAL edit: the keydown captures what is about to change, the browser
      // makes the change. Speech hangs off that pair, so a synthetic keydown
      // alone would measure silence and call it a pass.
      key: async (key, code, act) => {
        const ta = $('brlInput');
        ta.dispatchEvent(new KeyboardEvent('keydown', { key, code, bubbles: true, cancelable: true }));
        await sleep(80); act(); await sleep(380);
      },
      space: async () => window.__h.key(' ', 'Space', () => document.execCommand('insertText', false, ' ')),
      back: async () => window.__h.key('Backspace', 'Backspace', () => document.execCommand('delete')),
      listen: async (fn) => { $('announce').textContent = ''; await fn(); return $('announce').textContent.trim(); },
    };
  };

  // A fresh page per case: module state, spans and lineModes all start clean,
  // so one case cannot explain another's result.
  const fresh = async (setup) => {
    await page.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'networkidle' });
    await waitFor(() => !!document.getElementById('brlInput'), 'the app to finish booting');
    await page.evaluate(HELPERS);
    await page.evaluate(async () => {
      const { set, sleep } = window.__h;
      set('speechOutputReader', true);
      set('speakLetter', true); set('speakWord', true); set('speakSentence', false); set('speakCursor', true);
      await sleep(200);
    });
    if (setup) await page.evaluate(setup);
    return page;
  };

  // ---------------------------------------------------------------- prose ---
  await fresh();
  let r = await page.evaluate(async ({ CAT, SAT }) => {
    const h = window.__h;
    await h.clear();
    await h.type(CAT); const a = await h.listen(h.space);
    await h.type(SAT); const b = await h.listen(h.space);
    return { a, b };
  }, { CAT, SAT });
  check('prose: first word speaks', r.a, /cat/i, LITERARY_LEAK);
  check('prose: second word speaks', r.b, /sat/i);

  // ------------------------------------------- UEB maths span (Ctrl+M) ------
  await fresh();
  r = await page.evaluate(async ({ HALF, DOG }) => {
    const h = window.__h;
    await h.clear();
    h.set('mathsCodeUeb', true); await h.sleep(200);
    await h.ctrlM();
    await h.type(HALF);
    const sum = await h.listen(h.space);
    // the reported case: delete at the end, type again, finish the word
    const del = await h.listen(h.back);
    await h.type(HALF);
    const again = await h.listen(h.space);
    await h.ctrlM();
    await h.type(DOG);
    const prose = await h.listen(h.space);
    return { sum, del, again, prose, field: window.__h.$('brlInput').value };
  }, { HALF, DOG });
  check('UEB span: sum speaks as maths', r.sum, /half|fraction|over/i, LITERARY_LEAK);
  check('UEB span: after delete + retype, STILL maths', r.again, /half|fraction|over/i, LITERARY_LEAK);
  check('UEB span: prose after leaving it speaks as a word', r.prose, /dog/i, LITERARY_LEAK);

  // ------------------------------------------------ Nemeth written run ------
  await fresh();
  r = await page.evaluate(async ({ NEM_SUM, CAT }) => {
    const h = window.__h;
    await h.clear();
    h.set('mathsCodeNemeth', true); await h.sleep(200);
    await h.ctrlM();
    await h.type(NEM_SUM);
    const sum = await h.listen(h.space);
    await h.ctrlM();
    await h.type(' ' + CAT);          // a space after leaving the run, as a writer would
    const prose = await h.listen(h.space);
    return { sum, prose };
  }, { NEM_SUM, CAT });
  check('Nemeth run: sum speaks as maths', r.sum, /3|plus|2/i, LITERARY_LEAK);
  check('Nemeth run: prose after it speaks as a word', r.prose, /cat/i, LITERARY_LEAK);

  // -------------------------------------------- whole-document maths --------
  await fresh();
  r = await page.evaluate(async ({ NEM_SUM, DOG }) => {
    const h = window.__h;
    await h.clear();
    h.$('nemethMaths').checked = true; h.$('uebMaths').checked = false;
    await h.sleep(250);
    await h.type(NEM_SUM);
    const sum = await h.listen(h.space);
    await h.type(DOG);
    const word = await h.listen(h.space);
    return { sum, word };
  }, { NEM_SUM, DOG });
  check('whole-document maths: sum speaks as maths', r.sum, /3|plus|2/i, LITERARY_LEAK);
  check('whole-document maths: a pure-letter word still speaks as a word', r.word, /dog/i);

  // ------------------------------------ cursoring onto a two-cell sign ------
  // The "cap a" report: ⠨⠅ inside a Nemeth run is the equals sign, but read as
  // literary UEB it is Greek kappa, and a reader says that as "cap a".
  await fresh();
  r = await page.evaluate(async ({ NEM_SUM }) => {
    const h = window.__h;
    const EQ = String.fromCodePoint(0x2800 + 40) + String.fromCodePoint(0x2800 + 5); // dots 46, dots 13
    const FIVE = String.fromCodePoint(0x283C) + String.fromCodePoint(0x2822);        // # + dropped 5
    await h.clear();
    h.set('mathsCodeNemeth', true); await h.sleep(200);
    await h.ctrlM();
    await h.type(NEM_SUM + ' ' + EQ + ' ' + FIVE);
    await h.sleep(300);
    const ta = h.$('brlInput');
    const at = ta.value.indexOf(EQ);
    const said = [];
    for (let i = at; i < at + 2; i++) {
      h.$('announce').textContent = '';
      ta.setSelectionRange(i, i);
      document.dispatchEvent(new Event('selectionchange'));
      await h.sleep(320);
      said.push(h.$('announce').textContent.trim());
    }
    return { said };
  }, { NEM_SUM });
  check('cursor: first cell of the equals sign', r.said[0], /equal/i, /kappa|κ/);
  check('cursor: second cell of the equals sign', r.said[1], /equal/i, /kappa|κ/);

  // ----------------------------------- deleting a cell inside the maths -----
  // Feedback 28/08: "the deletion self-voicing is incorrect for UEB maths" and
  // the same for Nemeth. Deleting names the cell, and naming it literarily
  // inside a sum is the same fault as reading it literarily.
  await fresh();
  r = await page.evaluate(async ({ HALF }) => {
    const h = window.__h;
    await h.clear();
    h.set('mathsCodeUeb', true); await h.sleep(200);
    await h.ctrlM();
    await h.type(HALF);                     // #a/b : number sign, 1, fraction line, 2
    await h.sleep(200);
    const two = await h.listen(h.back);     // the 2
    const slash = await h.listen(h.back);   // the FRACTION LINE
    return { two, slash };
  }, { HALF });
  check('UEB maths: deleting a digit', r.two, /2|two/i, /^delete (dots|blank)/i);
  check('UEB maths: deleting the fraction line', r.slash, /fraction|slash|line|st/i, /dots/i);

  await fresh();
  r = await page.evaluate(async ({ NEM_SUM }) => {
    const h = window.__h;
    await h.clear();
    h.set('mathsCodeNemeth', true); await h.sleep(200);
    await h.ctrlM();
    await h.type(NEM_SUM);                  // #2+2 in Nemeth
    await h.sleep(200);
    const digit = await h.listen(h.back);   // the trailing 2
    const plus = await h.listen(h.back);    // the PLUS
    return { digit, plus };
  }, { NEM_SUM });
  check('Nemeth: deleting a digit', r.digit, /2|two/i, /^delete (dots|blank)/i);
  check('Nemeth: deleting the plus', r.plus, /plus/i, /dots/i);

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})();
