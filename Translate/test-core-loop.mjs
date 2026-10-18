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
// UEB maths, for the chord-geometry check below. Same cells test-modes.mjs
// uses, built from dot numbers like everything else here.
const NUM = cell(3, 4, 5, 6);              // UEB numeral sign
const ONE = cell(1), TWO = cell(1, 2);
const PLUS = cell(5) + cell(2, 3, 5);      // UEB plus

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

  // ---- ...AND THE EQUATION MUST NOT MOVE EITHER --------------------------
  // The same report, a week on (tester, 17 Oct): "On a key down in maths mode
  // the equation jumps from being central to left justified and returns to
  // being central on a key up. This is visually distracting. The yellow
  // warning box also resizes." The 10 Oct fix stopped the half-formed cell
  // reaching the print TEXT, and the three checks above hold that - but text
  // is not the only thing that moved. A maths row is laid out, not just
  // written, so its GEOMETRY has to be held still as well, and nothing
  // measured that.
  {
    const expr = NUM + ONE + PLUS + NUM + TWO;
    await page.evaluate(async ({ e }) => {
      const c = window.__c, f = c.$('brlInput');
      await c.clear();
      await c.type(`${e} `);
      f.focus();
      f.setSelectionRange(0, e.length);            // selecting is not an edit
    }, { e: expr });
    await page.keyboard.press('Control+m');        // marks the selection as maths
    await page.waitForTimeout(700);

    const geom = () => page.evaluate(() => {
      const row = document.querySelector('#out .mathrow');
      const warn = document.getElementById('warn');
      const out = document.getElementById('out').getBoundingClientRect();
      const box = (el) => {
        if (!el || !el.getClientRects().length) return null;
        const r = el.getBoundingClientRect();
        return { left: Math.round(r.left - out.left), width: Math.round(r.width) };
      };
      return { row: box(row), warn: box(warn),
               expr: row ? (row.dataset.verifyExpr || '') : '',
               latex: row ? (row.dataset.verifyLatex || '') : '',
               text: row ? row.textContent.replace(/\s+/g, ' ').trim().slice(0, 40) : '',
               rows: document.querySelectorAll('#out .mathrow').length,
               outText: document.getElementById('out').textContent.replace(/\s+/g,' ').trim().slice(0,50) };
    });

    const before = await geom();
    ok('the selection became a maths row to measure', !!(before && before.row),
       JSON.stringify(before));
    if (before && before.row) {
      await page.keyboard.down('KeyF');
      await page.waitForTimeout(320);
      const held = await geom();
      await page.keyboard.down('KeyD');
      await page.waitForTimeout(320);
      const held2 = await geom();
      await page.keyboard.up('KeyD'); await page.keyboard.up('KeyF');
      await page.waitForTimeout(600);

      const same = (a, b) => a && b && a.left === b.left && a.width === b.width;
      ok('the equation does not move while a chord is held down',
         same(before.row, held.row) && same(before.row, held2.row),
         JSON.stringify({ before, held, held2 }));
      // The warning box is only present in some states; when it is there it
      // must not resize under a keystroke either.
      const warnStable = !before.warn || (same(before.warn, held.warn) && same(before.warn, held2.warn));
      ok('the warning box does not resize while a chord is held down', warnStable,
         JSON.stringify({ before: before.warn, held: held.warn, held2: held2.warn }));
    }
  }

  // ---- the explanation arrives AS THE CHILD TYPES -------------------------
  // The tester asked it as a question (17 Oct): "Should the contraction
  // explanation update on space as the child types or only populate when
  // cursoring and clicking afterwards." PB: as the child types. It used to
  // populate only from a click or a caret move, so the teaching - which
  // contraction was used, which one was missed - arrived only if somebody went
  // back and asked for it.
  //
  // THE SPACE IS PRESSED FOR REAL. The word that a separator finishes is
  // captured on KEYDOWN, so an execCommand insertion of " " never reaches that
  // path at all - which is how I first "proved" this did not work after fixing
  // it. The word itself can be inserted either way; the space cannot.
  {
    const MOTHER = word([1, 3, 4], [1, 3, 5], [2, 3, 4, 5], [1, 2, 5], [1, 5], [1, 2, 3, 5]);
    await page.evaluate(async ({ w }) => {
      const c = window.__c;
      await c.clear();
      await c.type(w);                       // the cells, spelt out, no space yet
    }, { w: MOTHER });
    const before = await page.evaluate(() =>
      document.getElementById('statusBar').textContent.replace(/\s+/g, ' ').trim());
    ok('before the space, the status bar is still the hint',
       /Click a word/.test(before), before.slice(0, 80));

    await page.keyboard.press('Space');
    await page.waitForTimeout(700);
    const after = await page.evaluate(() =>
      document.getElementById('statusBar').textContent.replace(/\s+/g, ' ').trim());
    ok('the space explains the word that was just finished',
       /mother/i.test(after), after.slice(0, 120));
    // The point of the explanation is the contraction that was NOT used.
    ok('...and names the contraction it could have used',
       /could also be written/i.test(after), after.slice(0, 160));
  }

  // ---- MARKING A RANGE AS MATHS IN TWO PRESSES ---------------------------
  // Tester, 17 Oct: "I would insert my cursor, click Ctrl+M and this would
  // mark everything to the right as maths, then click my cursor and click
  // Ctrl+M and this would mark everything to the left. It should handle the
  // edge case where the user inserts the right marker then the left marker too
  // or if it conflicts with other sections already marked as maths."
  //
  // Selecting and pressing Ctrl+M has done this since 12 Aug, but selecting
  // means dragging, and this app is for someone using six keys and a braille
  // display. The gesture is Ctrl+Shift+M, not Ctrl+M: that already means "a
  // sum starts here" when nothing is selected, and changing its meaning by
  // context would move an established key under the people using it.
  {
    const EXPR = NUM + ONE + PLUS + NUM + TWO;
    const setup = async () => {
      await page.evaluate(async ({ c3, e }) => {
        const c = window.__c, f = c.$('brlInput');
        await c.clear();
        await c.type(`${c3} ${e} ${c3}`);
        window.__a = c3.length + 1;             // first cell of the sum
        window.__b = window.__a + e.length;     // just past its last cell
        f.focus();
      }, { c3: CAT, e: EXPR });
    };
    const at = (which) => page.evaluate((w) => {
      const f = document.getElementById('brlInput');
      const p = w === 'a' ? window.__a : window.__b;
      f.focus(); f.setSelectionRange(p, p);
    }, which);
    // THE CELLS THAT GOT MARKED, not how they read. Which code reads them is
    // the maths readers' business and is tested in their own suites; what this
    // gesture has to get right is the RANGE. (Asserting the reading here first
    // failed as "a6b": the fixture is written in UEB cells and this context's
    // maths code is Nemeth, so the marking was correct and the assertion was
    // measuring the wrong thing.)
    const maths = () => page.evaluate(() => [...document.querySelectorAll('#out .mathrow')]
      .map((r) => (r.dataset.verifyExpr || '').trim()));
    const press = async () => { await page.keyboard.press('Control+Shift+KeyM'); await page.waitForTimeout(500); };

    await setup();
    ok('the sum is plain text before any marking', (await maths()).length === 0, await maths());
    await at('a'); await press();
    const half = await page.evaluate(() => document.getElementById('statusBar').textContent);
    ok('the first press says a range has been started', /Maths starts here/i.test(half), half.slice(0, 70));
    ok('...and marks nothing on its own', (await maths()).length === 0, await maths());
    await at('b'); await press();
    ok('the second press marks exactly the cells between the two',
       (await maths()).join('|') === EXPR, await maths());

    // THE ORDER MUST NOT MATTER - the edge case the tester named.
    await setup();
    await at('b'); await press();
    await at('a'); await press();
    ok('the end may be marked before the start', (await maths()).join('|') === EXPR, await maths());

    // ...AND A RANGE THAT COLLIDES WITH ONE ALREADY MARKED IS REFUSED, rather
    // than nesting or orphaning a marker. The sum is already maths here; a
    // range from the middle of it into the text after it straddles that run.
    const before = await maths();
    await page.evaluate(() => {
      const f = document.getElementById('brlInput');
      f.focus(); f.setSelectionRange(window.__a + 2, window.__a + 2);
    });
    await press();
    await page.evaluate(() => {
      const f = document.getElementById('brlInput');
      f.focus(); f.setSelectionRange(f.value.length, f.value.length);
    });
    await press();
    ok('a range straddling maths already marked changes nothing',
       (await maths()).join('|') === before.join('|'), { before, after: await maths() });

    // A HALF-MADE RANGE IS NOT LEFT LYING ABOUT.
    await setup();
    await at('a'); await press();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await at('b'); await press();
    ok('Escape cancels a half-made range, so the next press only starts a new one',
       (await maths()).length === 0, await maths());

    await setup();
    await at('a'); await press();
    await page.evaluate(async () => { await window.__c.type('\u2801'); });   // an edit moves the cells
    await at('b'); await press();
    ok('an edit cancels a half-made range too', (await maths()).length === 0, await maths());
  }

  // ---- BACKSPACE WITHOUT FOCUS DELETES THE RIGHT CELLS, EVERY TIME ---------
  // User report, 18 Oct: "if the edit field does not have the focus then
  // multiple backspaces sometimes gets confused about what to delete and
  // deletes the wrong thing." With focus elsewhere there is no native edit, so
  // the app splices the buffer itself; that path has to agree with the native
  // one about where the caret ends up, or the second press works from the
  // wrong place.
  {
    await page.evaluate(async ({ c3, s3, d3 }) => {
      const c = window.__c;
      await c.clear();
      await c.type(`${c3} ${s3} ${d3} `);
      document.activeElement.blur();                 // focus to the body: no native edit now
    }, { c3: CAT, s3: SAT, d3: DOG });
    const before = await page.evaluate(() => ({ field: document.getElementById('brlInput').value,
                                                 focused: document.activeElement === document.getElementById('brlInput') }));
    ok('the field does not have focus', before.focused === false, before);
    await page.keyboard.press('Backspace'); await page.waitForTimeout(250);
    await page.keyboard.press('Backspace'); await page.waitForTimeout(250);
    await page.keyboard.press('Backspace'); await page.waitForTimeout(350);
    const after = await page.evaluate(() => document.getElementById('brlInput').value);
    // Three presses from the end take the space, "g" and "o": what is left is
    // "cat sat d" - the LAST three cells, not a cell further in.
    ok('three unfocused backspaces remove exactly the last three cells',
       after === `${CAT} ${SAT} ${DOG.slice(0, 1)}`,
       { before: before.field, after, expected: `${CAT} ${SAT} ${DOG.slice(0, 1)}` });
  }

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

  // ---- THE WORD BEING TYPED (tester, 17 Oct) -------------------------------
  // "In Grade 1 mode, the print does not appear letter by letter. This can be
  // confusing in focus mode when self-voicing is off and nothing appears until
  // space." It did not, and the grade is the whole point: in a CONTRACTED code
  // one cell can still become a different word - the single cell for "p" is
  // also the whole word "people" - so showing it early would show something
  // false. In an uncontracted code a cell is one letter and there is nothing
  // waiting to be resolved. Both halves are checked here, because the fix is
  // only right if the contracted case is left exactly as it was.
  {
    const typeInto = async (p, cells) => p.evaluate((v) => {
      const ta = document.getElementById('brlInput');
      ta.focus(); ta.value = v; ta.setSelectionRange(v.length, v.length);
      ta.dispatchEvent(new Event('input', { bubbles: true }));
    }, cells);
    const printOf = (p) => p.evaluate(() => document.getElementById('out').textContent);

    const openWith = async (code) => {
      const c = await browser.newContext();
      await c.addInitScript((id) => {
        localStorage.setItem('translate.settings', JSON.stringify({ brailleCode: id, sixKey: true }));
      }, code);
      const pg = await c.newPage();
      await pg.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'load' });
      await pg.waitForSelector('#brlInput');
      await pg.waitForTimeout(2500);
      return { c, pg };
    };

    const CAT = word([1, 4], [1], [2, 3, 4, 5]);
    const PCELL = cell(1, 2, 3, 4);              // "p", and also the word "people"

    const g1 = await openWith('en-ueb-g1');
    await typeInto(g1.pg, CAT);
    await g1.pg.waitForTimeout(400);
    const g1Mid = (await printOf(g1.pg)).trim();
    ok('grade 1: the word shows as it is typed, before any space',
       g1Mid === 'cat', JSON.stringify(g1Mid));
    const g1Marked = await g1.pg.evaluate(() =>
      [...document.querySelectorAll('#out [data-typing]')].map((e) => e.textContent));
    ok('grade 1: and it is marked as still being typed',
       g1Marked.length === 1 && g1Marked[0] === 'cat', JSON.stringify(g1Marked));
    // A lone capital sign is not a letter yet, so it must show nothing rather
    // than inventing one.
    await typeInto(g1.pg, cell(6));
    await g1.pg.waitForTimeout(400);
    ok('grade 1: a lone capital sign shows nothing until its letter arrives',
       (await printOf(g1.pg)).trim() === '', JSON.stringify(await printOf(g1.pg)));
    await g1.c.close();

    const g2 = await openWith('en-ueb-g2');
    await typeInto(g2.pg, CAT);
    await g2.pg.waitForTimeout(400);
    ok('grade 2 is UNCHANGED: nothing shows until the space',
       (await printOf(g2.pg)).trim() === '', JSON.stringify(await printOf(g2.pg)));
    await typeInto(g2.pg, PCELL);
    await g2.pg.waitForTimeout(400);
    const pMid = (await printOf(g2.pg)).trim();
    await typeInto(g2.pg, PCELL + ' ');
    await g2.pg.waitForTimeout(400);
    const pDone = (await printOf(g2.pg)).trim();
    // THE REASON THE CONTRACTED CASE WAITS, stated as a measurement: the same
    // one cell is "people" once a space settles it.
    ok('grade 2: the p-cell shows nothing while typing, and is "people" once finished',
       pMid === '' && pDone === 'people', `${JSON.stringify(pMid)} -> ${JSON.stringify(pDone)}`);
    await g2.c.close();
  }

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
