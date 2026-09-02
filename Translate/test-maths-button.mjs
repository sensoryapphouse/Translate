// WHAT THE MATHS BUTTON DOES, IN EVERY SITUATION IT CAN BE PRESSED.
//
// The button reads the situation rather than doing one thing: a SELECTION is
// marked as maths, a freshly LOADED document is read as maths whole, and
// anything else opens a run at the caret. Those three used to be one, and the
// other two did visible damage - selecting a sum and pressing it threw the
// selection away and opened an empty run that swallowed the rest of the line.
//
// Ctrl+M and the checkbox are the same action by construction, so both are
// exercised here: if they ever drift apart, this file says so.
//
// Run:  node test-maths-button.mjs            (serves Translate itself)
//       node test-maths-button.mjs --show     (headful, to watch it)
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
const PORT = 8244;
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
                '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
                '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
                '.ctb': 'text/plain', '.cti': 'text/plain', '.uti': 'text/plain',
                '.utb': 'text/plain', '.dis': 'text/plain', '.brf': 'text/plain',
                '.ebrl': 'application/epub+zip' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { res.writeHead(404); res.end(); return; }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(f)] || 'application/octet-stream' });
  fs.createReadStream(f).pipe(res);
});

// Cells built from dot numbers, never typed.
const cell = (...d) => String.fromCodePoint(0x2800 + d.reduce((a, x) => a | (1 << (x - 1)), 0));
const THE  = cell(2, 3, 4, 6);
const CAT  = cell(1, 4) + cell(1) + cell(2, 3, 4, 5);
const DOG  = cell(1, 4, 5) + cell(1, 3, 5) + cell(1, 2, 4, 5);
const HALF = cell(3, 4, 5, 6) + cell(1) + cell(3, 4) + cell(1, 2);   // #a/b
const SENTENCE = `${THE} ${CAT} ${HALF} ${THE} ${DOG} `;

const failures = [];
const check = (name, got, want) => {
  const ok = want instanceof RegExp ? want.test(String(got)) : got === want;
  if (!ok) failures.push(name);
  console.log(`${ok ? 'ok  ' : 'FAIL'}  ${name}: ${JSON.stringify(got)}${ok ? '' : ` (wanted ${want})`}`);
};

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: !process.argv.includes('--show'), args: ['--no-sandbox'] });
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

  page.on('pageerror', (e) => failures.push('page error: ' + String(e).slice(0, 100)));

  const HELPERS = () => {
    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__h = {
      $, sleep,
      set: (id, on) => { const e = $(id); if (e.checked !== on) { e.checked = on; e.dispatchEvent(new Event('change')); } },
      clear: async () => { $('clearBtn').click(); await sleep(120); $('confirmYes').click(); await sleep(320); },
      type: async (s) => { $('brlInput').focus(); document.execCommand('insertText', false, s); await sleep(260); },
      select: async (a, b) => { const ta = $('brlInput'); ta.focus(); ta.setSelectionRange(a, b);
                                document.dispatchEvent(new Event('selectionchange')); await sleep(220); },
      // The two ways to press it. They must agree.
      press: async (viaKey) => {
        $('announce').textContent = '';
        if (viaKey) document.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', ctrlKey: true, bubbles: true, cancelable: true }));
        else $('mathsMode').click();
        await sleep(700);
        return $('announce').textContent.trim();
      },
      rows: () => document.querySelectorAll('#out .mathrow').length,
      loadLines: async (lines) => {
        const blob = new Blob([lines.join('\n')], { type: 'text/plain' });
        const dt = new DataTransfer();
        dt.items.add(new File([await blob.arrayBuffer()], 'x.brf', { type: 'text/plain' }));
        $('announce').textContent = '';
        const inp = $('loadInput'); inp.files = dt.files; inp.dispatchEvent(new Event('change'));
        await sleep(1900);
        return $('announce').textContent.trim();
      },
    };
  };
  const fresh = async () => {
    await page.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'networkidle' });
    await waitFor(() => !!document.getElementById('brlInput'), 'the app to finish booting');
    await page.evaluate(HELPERS);
    await page.evaluate(async () => {
      const h = window.__h;
      h.set('speechOutputReader', true);
      await h.sleep(180);
    });
  };

  // ---------------------------------------------- a selection is marked -----
  for (const viaKey of [false, true]) {
    const how = viaKey ? 'Ctrl+M' : 'the checkbox';
    await fresh();
    const r = await page.evaluate(async ({ SENTENCE, HALF, viaKey }) => {
      const h = window.__h;
      await h.clear();
      h.set('mathsCodeUeb', true); await h.sleep(180);
      await h.type(SENTENCE);
      const at = h.$('brlInput').value.indexOf(HALF);
      await h.select(at, at + HALF.length);
      const said = await h.press(viaKey);
      const marked = { said, rows: h.rows(), cells: h.$('brlInput').value };
      await h.select(at, at + HALF.length);
      const said2 = await h.press(viaKey);
      return { marked, unmarked: { said: said2, rows: h.rows() } };
    }, { SENTENCE, HALF, viaKey });
    check(`${how}: a selection is marked as maths`, r.marked.said, /marked as ueb maths/i);
    check(`${how}: and becomes one maths row`, r.marked.rows, 1);
    check(`${how}: without changing a single cell`, r.marked.cells, SENTENCE);
    check(`${how}: pressing again unmarks it`, r.unmarked.said, /not maths any more/i);
    check(`${how}: and the row goes`, r.unmarked.rows, 0);
  }

  // ------------------------------- a selection half in a run is refused -----
  await fresh();
  let r = await page.evaluate(async ({ SENTENCE, HALF }) => {
    const h = window.__h;
    await h.clear();
    h.set('mathsCodeUeb', true); await h.sleep(180);
    await h.type(SENTENCE);
    const at = h.$('brlInput').value.indexOf(HALF);
    await h.select(at, at + HALF.length);
    await h.press(false);                       // mark the sum
    const before = { cells: h.$('brlInput').value, rows: h.rows() };
    await h.select(at - 2, at + HALF.length);   // now select INTO it from outside
    const said = await h.press(false);
    return { said, unchanged: h.$('brlInput').value === before.cells && h.rows() === before.rows };
  }, { SENTENCE, HALF });
  check('a selection only partly in a run is refused', r.said, /partly maths already/i);
  check('and nothing changes when it is refused', r.unchanged, true);

  // ------------------------------------ a freshly loaded file, as a whole ---
  await fresh();
  r = await page.evaluate(async ({ THE, CAT, HALF, DOG }) => {
    const h = window.__h;
    await h.clear();
    h.set('mathsCodeUeb', true); await h.sleep(180);
    const maths = `${HALF} ${HALF}`, prose = `${THE} ${CAT} ${DOG}`;
    const lines = []; for (let i = 0; i < 5; i++) { lines.push(maths); lines.push(prose); }
    const onLoad = await h.loadLines(lines);
    const said = await h.press(false);
    return { onLoad, said, rows: h.rows(), lines: lines.length };
  }, { THE, CAT, HALF, DOG });
  check('a file it cannot call is mentioned, not silently opened as text', r.onLoad, /look like|maths/i);
  check('and ticking the box then reads the WHOLE document as maths', r.said, /whole document is now/i);
  check('every line becomes a maths row', r.rows, r.lines);

  // ------------------------------------------- otherwise, a run at the caret -
  await fresh();
  r = await page.evaluate(async ({ THE, CAT }) => {
    const h = window.__h;
    await h.clear();
    h.set('mathsCodeUeb', true); await h.sleep(180);
    await h.type(`${THE} ${CAT} `);            // writing pins modes to lines
    const ta = h.$('brlInput');
    await h.select(ta.value.length, ta.value.length);
    return { said: await h.press(false) };
  }, { THE, CAT });
  check('after typing, it opens a run at the caret', r.said, /type the expression/i);

  await browser.close();
  server.close();
  console.log(failures.length ? `\n${failures.length} FAILED` : '\nall passed');
  process.exit(failures.length ? 1 : 0);
})();
