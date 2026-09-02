// THE THINGS EVERY USER DOES, AND NOTHING TESTED.
//
// The Translate audit (2026-09-02) found no automated test of a core feature:
// loading a file, saving one, exporting one, moving the caret. Every one had
// been checked by hand, repeatedly, and by hand only - so a regression in any
// of them would reach a child before it reached anyone else.
//
// This drives the INSTALLED Chrome (Playwright, channel: 'chrome'), because
// these paths are the browser's: a file input, a download, a real caret in a
// real textarea. Downloads are intercepted rather than written to disk, so the
// suite leaves nothing behind.
//
// Every cell is BUILT from dot numbers - a mistyped cell would test something
// other than what the case says.
//
// Run:  node Translate/test-core-loop.mjs          (serves Translate itself)
//       node Translate/test-core-loop.mjs --show   (headful, to watch it)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8232;
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
                '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
                '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
                '.ctb': 'text/plain', '.cti': 'text/plain', '.uti': 'text/plain',
                '.utb': 'text/plain', '.dis': 'text/plain', '.brf': 'text/plain',
                '.ebrl': 'application/epub+zip' };

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

const cell = (...dots) => String.fromCodePoint(0x2800 + dots.reduce((a, d) => a | (1 << (d - 1)), 0));
const word = (...specs) => specs.map((s) => cell(...s)).join('');
const CAT = word([1, 4], [1], [2, 3, 4, 5]);
const SAT = word([2, 3, 4], [1], [2, 3, 4, 5]);
const DOG = word([1, 4, 5], [1, 3, 5], [1, 2, 4, 5]);

let pass = 0; const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({
    channel: 'chrome',
    headless: !process.argv.includes('--show'),
    args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ acceptDownloads: true });
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

  page.on('pageerror', (e) => { failures.push('page error'); console.log('FAIL  page error:', String(e)); });

  await page.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'load' });
  await waitFor(() => !!document.getElementById('brlInput') && !document.getElementById('out').textContent.includes('⚠'),
                'the app to finish booting');
  await page.evaluate(() => {
    const $ = (id) => document.getElementById(id);
    const sleep = (ms) => new Promise((r) => setTimeout(r, ms));
    window.__c = {
      $, sleep,
      clear: async () => { $('clearBtn').click(); await sleep(120); const y = $('confirmYes'); if (y) y.click(); await sleep(260); },
      type: async (s) => { $('brlInput').focus(); document.execCommand('insertText', false, s); await sleep(260); },
      print: () => $('out').textContent.replace(/\s+/g, ' ').trim(),
      field: () => $('brlInput').value,
    };
  });

  // ---- a first visit is not an upgrade ------------------------------------
  // The service worker calls clients.claim(), so controllerchange fires on the
  // FIRST visit as well as on a real replacement. Announcing it then told a
  // first-time user to save their work and reload a page they had just opened
  // (found 2026-09-02 by this suite failing on the caret, for that reason).
  // Every page this suite opens is a first visit, so the notice must never
  // appear here at all.
  const firstVisit = await page.evaluate(async () => {
    await window.__c.sleep(1500);          // long enough for install and claim
    return { sw: !!navigator.serviceWorker.controller,
             bar: document.getElementById('statusBar').textContent.replace(/\s+/g, ' ').trim() };
  });
  ok('a first visit is not announced as a new version',
     !/new version/i.test(firstVisit.bar), firstVisit);

  // ---- typing, and the print pane that follows it -------------------------
  const typed = await page.evaluate(async ({ CAT, SAT }) => {
    const c = window.__c;
    await c.clear();
    await c.type(`${CAT} ${SAT} `);
    return { print: c.print(), cells: [...c.field()].length };
  }, { CAT, SAT });
  ok('typing braille prints the words', typed.print === 'cat sat', typed);

  // ---- the caret moves, and the status bar follows it ---------------------
  const caret = await page.evaluate(async () => {
    const c = window.__c, ta = c.$('brlInput');
    // THE STATUS BAR HAS A SECOND WRITER (2026-09-02): when a newer service
    // worker is waiting, index.html puts "A new version of Translate is ready"
    // there. It is transient - the next word explanation overwrites it - but it
    // can land between the caret move and the read, and then this test failed
    // for a reason that had nothing to do with the caret. So ask again until
    // the bar is answering about the caret rather than about the deploy.
    const explain = async (at) => {
      ta.focus();
      for (let i = 0; i < 8; i++) {
        ta.setSelectionRange(at, at); document.dispatchEvent(new Event('selectionchange'));
        await c.sleep(250);
        const t = c.$('statusBar').textContent.replace(/\s+/g, ' ').trim();
        if (!/new version of Translate/i.test(t)) return t;
      }
      return c.$('statusBar').textContent.replace(/\s+/g, ' ').trim();
    };
    return { first: await explain(0), second: await explain(4) };
  });
  ok('the caret on the first word explains that word', /cat/.test(caret.first), caret.first);
  ok('and moving it to the second word explains that one', /sat/.test(caret.second), caret.second);

  // ---- Clear really clears ------------------------------------------------
  const cleared = await page.evaluate(async () => {
    const c = window.__c;
    await c.clear();
    return { print: c.print(), field: c.field() };
  });
  ok('Clear empties both panes', cleared.print === '' && cleared.field === '', cleared);

  // ---- Save writes an eBraille file that loads back ------------------------
  const saved = await (async () => {
    const dl = page.waitForEvent('download');
    await page.evaluate(async ({ CAT, DOG }) => {
      const c = window.__c;
      await c.type(`${CAT} ${DOG} `);
      c.$('saveBtn').click();
      await c.sleep(400);
      const go = document.getElementById('confirmYes');
      if (go && !document.getElementById('confirmDialog')?.hidden) go.click();
    }, { CAT, DOG });
    const d = await dl;
    const p = path.join(HERE, '..', '.core-loop-save.ebrl');
    await d.saveAs(p);
    const bytes = fs.readFileSync(p);
    return { name: d.suggestedFilename(), size: bytes.length, path: p, magic: bytes.slice(0, 2).toString() };
  })().catch((e) => ({ error: String(e) }));
  ok('Save downloads an eBraille file', saved.name && /\.ebrl$/.test(saved.name) && saved.magic === 'PK', saved);

  // ---- and Load opens it again, cells intact ------------------------------
  if (saved.path) {
    const loaded = await page.evaluate(async () => { await window.__c.clear(); return window.__c.print(); })
      .then(async () => {
        await page.setInputFiles('#loadInput', saved.path);
        await waitFor(() => window.__c.print().length > 0, 'the loaded document to appear');
        return page.evaluate(() => ({ print: window.__c.print(), cells: [...window.__c.field()].length }));
      });
    ok('Load opens what Save wrote, with the same words', loaded.print === 'cat dog', loaded);
    fs.unlinkSync(saved.path);
  }

  // ---- Export BRF ---------------------------------------------------------
  const brf = await (async () => {
    const dl = page.waitForEvent('download');
    await page.evaluate(async () => {
      const c = window.__c;
      c.$('exportBtn').click(); await c.sleep(250);
      c.$('exportBrfItem').click(); await c.sleep(300);
    });
    const d = await dl;
    const p = path.join(HERE, '..', '.core-loop-export.brf');
    await d.saveAs(p);
    const text = fs.readFileSync(p, 'utf8');
    fs.unlinkSync(p);
    return { name: d.suggestedFilename(), text: text.trim() };
  })().catch((e) => ({ error: String(e) }));
  // BRF is ASCII braille: "cat dog" is CAT DOG in the BRF alphabet
  ok('Export BRF writes the document as BRF ASCII',
     brf.name && /\.brf$/.test(brf.name) && /CAT DOG/i.test(brf.text || ''), brf);

  // ---- a file with no braille in it is refused, not silently loaded --------
  // NOT a text file: plain ASCII prose IS valid BRF, and the app transliterates
  // it deliberately - that is how a notetaker's lowercase BRF opens at all. The
  // refusal is for a file that yields no cells, which is what a teacher gets
  // when they try to re-open an exported .docx.
  const junk = path.join(HERE, '..', '.core-loop-junk.bin');
  fs.writeFileSync(junk, Buffer.from([0x50, 0x4b, 0x05, 0x06, 0, 0, 0, 0, 0xff, 0xfe, 0, 1, 2, 3]));
  await page.setInputFiles('#loadInput', junk);
  await waitFor(() => /not braille|no braille/i.test(document.getElementById('statusBar').textContent),
                'the refusal message');
  const refused = await page.evaluate(() => ({
    bar: document.getElementById('statusBar').textContent.replace(/\s+/g, ' ').trim(),
    print: window.__c.print(),
  }));
  fs.unlinkSync(junk);
  ok('a file with no braille is refused and says so', /not braille|no braille/i.test(refused.bar), refused);
  ok('and the open document survives it', refused.print === 'cat dog', refused);

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
