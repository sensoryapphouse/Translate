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

  // ---- a maths line keeps its mark when the lines above it move -----------
  // Feedback 10 Oct, item 2: "the maths markers seem to fail when marking
  // sections as maths ... try marking and unmarking sections of the example
  // maths BRFs". The per-line modes were held in an array that was only ever
  // grown or truncated at its END, so an edit in the MIDDLE slid every mark
  // below it onto the wrong line: insert one line at the top and the prose
  // renders as maths while the equation renders as prose. The shipped tour is
  // the mixed document a user actually opens, so this drives that.
  await page.setInputFiles('#loadInput', path.join(ROOT, 'Translate/examples/translate-tour.ebrl'));
  await waitFor(() => document.querySelectorAll('#out .mathrow').length > 0,
                'the tour to load with its maths lines');
  const tour = await page.evaluate(async () => {
    const c = window.__c, f = c.$('brlInput');
    // the shape of the document as a reader meets it: which lines are maths
    // a whole-line equation IS the .mathrow; an inline run sits inside a .line
    const shape = () => [...c.$('out').children]
      .map((l) => (l.matches('.mathrow') || l.querySelector('.mathrow') ? 'M' : 't')).join('');
    const before = shape();
    // the writer goes to the very top and presses Enter to make room for a title
    f.focus(); f.setSelectionRange(0, 0);
    f.setRangeText('\n', 0, 0, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await c.sleep(900);
    return { before, after: shape() };
  });
  // every line has moved down one, so the shape must simply gain a text line at
  // the front - the maths must still be on the equations, not on their neighbours
  ok('a maths line keeps its mark when a line is inserted above it',
     tour.before.includes('M') && tour.after === 't' + tour.before, tour);

  // ---- a button must not swallow braille ----------------------------------
  // Feedback 10 Oct, item 9: "window event listener fails when backspacing ...
  // can make users who forget to click on the text field think something is
  // broken." The keydown guard let form controls keep their own keys, which is
  // right for Space and Enter on a button - and it returned for EVERY key, so
  // with focus in the toolbar the dot keys, Backspace and Delete did nothing
  // and said nothing. Both halves are checked here: the writing keys come back
  // to the field, and the button's own keys still belong to the button.
  await page.evaluate(async ({ CAT }) => {
    const c = window.__c, f = c.$('brlInput');
    await c.clear();
    f.focus(); f.setRangeText(`${CAT} `, 0, 0, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await c.sleep(400);
    c.$('helpBtn').focus();
  }, { CAT });
  const before = await page.evaluate(() => window.__c.field().length);
  await page.keyboard.press('Backspace');
  await page.waitForTimeout(500);
  const afterBksp = await page.evaluate(() => ({
    cells: window.__c.field().length, focus: document.activeElement.id,
  }));
  ok('Backspace works with focus on a button, and lands the writer in the field',
     afterBksp.cells === before - 1 && afterBksp.focus === 'brlInput', { before, afterBksp });

  await page.focus('#helpBtn');
  await page.keyboard.press('Enter');
  await page.waitForTimeout(500);
  const helpOpen = await page.evaluate(() => document.getElementById('helpDialog').open);
  ok('and Enter on that same button still opens Help', helpOpen, { helpOpen });
  await page.keyboard.press('Escape');
  await page.waitForTimeout(300);

  // ---- a half-formed chord must not reach the print pane ------------------
  // Feedback 10 Oct, item 10: "the displayed maths moves left, and print
  // characters can flash onscreen on downstrokes on the right and disappear on
  // release." Both panes were drawn from the buffer PLUS the cell being held,
  // so every key on the way down was translated and laid out. The braille pane
  // should show the cell forming - that is how a writer sees which dots are
  // down - and the print pane should not, so both directions are checked.
  // six-key: dot1=F dot2=D dot3=S dot4=J dot5=K dot6=L
  await page.evaluate(async ({ CAT }) => {
    const c = window.__c, f = c.$('brlInput');
    await c.clear();
    f.focus(); f.setRangeText(`${CAT} `, 0, 0, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await c.sleep(400);
  }, { CAT });
  // the braille pane's RENDERED text, not just its finished words: the cell
  // being held is deliberately not a word yet, which is the whole point of it
  const read = () => page.evaluate(() => ({
    print: window.__c.print(),
    brailleDrawn: (document.getElementById('braille').textContent.match(/[\u2800-\u28ff]/g) || []).length,
  }));
  const settledBefore = await read();
  await page.keyboard.down('KeyF');                 // dot 1, held
  await page.waitForTimeout(300);
  const midChord = await read();
  await page.keyboard.down('KeyD');                 // + dot 2, still held
  await page.waitForTimeout(300);
  const midChord2 = await read();
  await page.keyboard.up('KeyD'); await page.keyboard.up('KeyF');
  await page.waitForTimeout(600);
  const afterRelease = await read();

  ok('print does not change while a chord is held down',
     midChord.print === settledBefore.print && midChord2.print === settledBefore.print,
     { settledBefore, midChord, midChord2 });
  ok('but the braille pane does show the cell forming',
     midChord.brailleDrawn > settledBefore.brailleDrawn,
     { settledBefore, midChord });
  ok('and the finished cell is there once released',
     afterRelease.brailleDrawn === settledBefore.brailleDrawn + 1,
     { settledBefore, afterRelease });

  // ---- the work survives the page going away -----------------------------
  // PB, 10 Oct: autosave, as the answer to the audit's objection that a worker
  // which takes over mid-session tells the writer to "save and reload" in an
  // editor that had no autosave. OFFERED, never restored behind them: nothing
  // appears unbidden, which is the whole of the ruling.
  await page.evaluate(async ({ CAT, DOG }) => {
    const c = window.__c, f = c.$('brlInput');
    await c.clear();
    f.focus(); f.setRangeText(`${CAT} ${DOG} `, 0, 0, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await c.sleep(2600);                     // past the save debounce
  }, { CAT, DOG });
  // Per-TAB keys since 15 Oct (audit TR-01), so ask for any draft record
  // rather than the single key this once was.
  const draftWritten = await page.evaluate(() =>
    Object.keys(localStorage).some((k) => k.startsWith('translate.draft')));
  ok('typing leaves a draft behind', draftWritten);

  await page.reload({ waitUntil: 'load' });
  await waitFor(() => !!document.getElementById('brlInput'), 'the app to boot again');
  await page.waitForTimeout(2500);
  const afterReload = await page.evaluate(() => ({
    offered: !!document.getElementById('draftOffer'),
    documentEmpty: document.getElementById('brlInput').value === '',
  }));
  ok('after a reload it is offered, not restored', afterReload.offered && afterReload.documentEmpty, afterReload);

  await page.click('#draftOffer button');     // "Bring it back"
  await page.waitForTimeout(1200);
  const broughtBack = await page.evaluate(() => ({
    print: document.getElementById('out').textContent.trim(),
    offerGone: !document.getElementById('draftOffer'),
  }));
  ok('and bringing it back returns the document', broughtBack.print === 'cat dog' && broughtBack.offerGone, broughtBack);

  // the app must be usable again afterwards - a restore is not a dead end.
  // window.__c is gone: the reload above took the injected helper with it, so
  // everything from here is plain DOM.
  await page.evaluate(() => document.getElementById('clearBtn').click());
  await page.waitForTimeout(250);
  await page.evaluate(() => { const y = document.getElementById('confirmYes'); if (y) y.click(); });
  await page.waitForTimeout(2600);
  const afterClear = await page.evaluate(() => ({
    print: document.getElementById('out').textContent.trim(),
    draft: Object.keys(localStorage).filter((k) => k.startsWith('translate.draft')).length
      ? 'still there' : null,
  }));
  ok('and Clear throws the kept draft away too', afterClear.print === '' && afterClear.draft === null, afterClear);

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
