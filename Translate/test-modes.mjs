// WHICH MODE DECIDES, AND WHERE.
//
// From the 15 October audit, whose central observation is that mode is
// resolved one way by rendering, another by line-joining, another by the caret
// and another by speech. This suite holds the cases where those must agree.
//
//   TR-04  A sum continued over two lines joined using the GLOBAL maths
//          checkbox instead of the continued lines' own mode. A document whose
//          LAST section is text leaves that checkbox off, so UEB lines were
//          spliced by the Nemeth rule - which drops the first cell of the next
//          line. In UEB that cell is the numeral sign, so 1+2 became 1+b: a
//          child's sum, silently changed, with no warning anywhere.
//
// Every cell is BUILT from dot numbers, and the document is written by the
// REAL writer, so what is loaded is what the app itself would have saved.
//
// Run:  node Translate/test-modes.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { writeEbraille } from './ebraille.mjs';

const ROOT = process.env.TRANSLATE_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8234;
const TYPES = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript',
  '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json',
  '.webmanifest':'application/json', '.woff2':'font/woff2', '.woff':'font/woff',
  '.svg':'image/svg+xml', '.ctb':'text/plain', '.cti':'text/plain', '.uti':'text/plain',
  '.utb':'text/plain', '.dis':'text/plain', '.ttf':'font/ttf', '.brf':'text/plain',
  '.ebrl':'application/epub+zip' };
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found'); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                       'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const cell = (...dots) => String.fromCodePoint(0x2800 + dots.reduce((a, d) => a | (1 << (d - 1)), 0));
const NUM = cell(3,4,5,6);        // UEB numeral sign
const ONE = cell(1), TWO = cell(1,2);
const PLUS = cell(5) + cell(2,3,5);   // UEB plus
const CONT = cell(5);             // UEB continuation mark (GTM 1.4.3)
const NEM_CONT = cell(3,6);       // Nemeth continuation (hyphen)
// NEMETH DIGITS ARE DROPPED, not the UEB letters-for-digits: 1 is dots 2 and
// 2 is dots 2-3. Built with the UEB forms first, the fixture legitimately read
// "ab" and looked like a bug in the app - it was a bug in the test.
const NEM_ONE = cell(2), NEM_TWO = cell(2,3);
const CAT = cell(1,4) + cell(1) + cell(2,3,4,5);

let pass = 0; const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}: ${JSON.stringify(got)}`); }
};

const writeTemp = (doc, name) => {
  const file = path.join(os.tmpdir(), name);
  fs.writeFileSync(file, Buffer.from(writeEbraille(doc)));
  return file;
};

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const page = await browser.newPage({ acceptDownloads: true });
  page.on('pageerror', (e) => { failures.push('page error'); console.log('FAIL  page error:', String(e).slice(0, 120)); });

  const load = async (file) => {
    await page.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.getElementById('brlInput'));
    await page.waitForTimeout(2600);
    await page.setInputFiles('#loadInput', file);
    await page.waitForTimeout(3000);
    // BOTH the cells that were joined and what they were read as. The defect is
    // in the JOIN, so the cells are the discriminating evidence: the two rules
    // can happen to read alike while splicing differently.
    return page.evaluate(() => [...document.querySelectorAll('#out .mathrow')].map((r) => ({
      cells: r.dataset.verifyExpr || '',
      latex: (r.dataset.verifyLatex || '').replace(/\\phantom\{\}/g, '').trim(),
    })));
  };

  // ---- TR-04: a UEB sum continued over two lines, in a document ENDING in text
  const uebFirst = writeTemp({ sections: [
    { mode: 'ueb',  lines: [NUM + ONE + PLUS + CONT, NUM + TWO] },
    { mode: 'text', lines: [CAT + ' '] },
  ] }, 'tr04-ueb-then-text.ebrl');
  const uebRows = await load(uebFirst);
  // The UEB rule replaces the continuation mark and KEEPS the next line whole;
  // the Nemeth rule would also drop its first cell, the numeral sign.
  ok('a continued UEB sum keeps the next line\'s numeral sign',
     uebRows.some((r) => r.cells === NUM + ONE + PLUS + NUM + TWO), uebRows);
  ok('...so it reads 1+2, not 1+b',
     uebRows.some((r) => /1\s*\+\s*2/.test(r.latex)) && !uebRows.some((r) => /1\s*\+\s*b/.test(r.latex)),
     uebRows.map((r) => r.latex));

  // ---- the converse: Nemeth continued lines in a document ENDING in UEB, so
  // the global checkbox cannot be what decided how the earlier lines joined
  const nemFirst = writeTemp({ sections: [
    { mode: 'nem',  lines: [NUM + NEM_ONE + NEM_CONT, NUM + NEM_TWO] },
    { mode: 'ueb',  lines: [NUM + ONE] },
  ] }, 'tr04-nem-then-ueb.ebrl');
  const nemRows = await load(nemFirst);
  // The Nemeth rule drops the next line's numeral sign; the UEB rule keeps it,
  // leaving TWO. Both happen to read "12", which is why the cells decide.
  ok('Nemeth continued lines drop the next numeral sign, even with UEB after',
     nemRows.some((r) => r.cells === NUM + NEM_ONE + NEM_TWO), nemRows);
  ok('...and do not keep a second one',
     !nemRows.some((r) => r.cells === NUM + NEM_ONE + NUM + NEM_TWO), nemRows);

  // ---- TR-09: the caret's mode must consult the line it is on --------------
  // The same mixed document: line 0 is UEB maths and renders as maths, but the
  // Maths checkbox - which is modeAtPos() made visible - said text, because the
  // resolver fell back to the global boxes and never asked lineModes.
  await load(uebFirst);
  const atCaret = await page.evaluate(async () => {
    const f = document.getElementById('brlInput');
    f.focus(); f.setSelectionRange(1, 1);
    document.dispatchEvent(new Event('selectionchange'));
    await new Promise((r) => setTimeout(r, 500));
    return {
      checkbox: document.getElementById('mathsMode').checked,
      rendersAsMaths: !!document.querySelector('#out .mathrow'),
    };
  });
  ok('the caret inside a restored maths line reports maths',
     atCaret.checkbox === true && atCaret.rendersAsMaths, atCaret);

  // ---- TR-07 and TR-08: speech agrees with what is displayed ---------------
  // An INLINE span - the shape Ctrl+M makes - on an otherwise text line.
  const sayLine = async () => {
    await page.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.getElementById('brlInput'));
    await page.waitForTimeout(2600);
    await page.evaluate(() => {
      // speech into the live region, where a test can read it
      const r = document.getElementById('speechOutputReader');
      if (r) { r.checked = true; r.dispatchEvent(new Event('change', { bubbles: true })); }
      const u = document.getElementById('mathsCodeUeb');
      if (u) { u.checked = true; u.dispatchEvent(new Event('change', { bubbles: true })); }
    });
    await page.waitForTimeout(400);
    // Ctrl+M opens an inline UEB span at the caret, then the sum is typed in it
    await page.evaluate(() => { const f = document.getElementById('brlInput'); f.focus();
      f.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', ctrlKey: true, bubbles: true, cancelable: true })); });
    await page.waitForTimeout(500);
    await page.evaluate((sum) => { const f = document.getElementById('brlInput');
      f.focus(); f.setRangeText(sum, f.value.length, f.value.length, 'end');
      f.dispatchEvent(new Event('input', { bubbles: true })); }, NUM + ONE + PLUS + NUM + TWO);
    await page.waitForTimeout(1800);
  };

  await sayLine();
  const displayed = await page.evaluate(() => {
    const r = document.querySelector('#out .mathrow');
    return r ? (r.dataset.verifyLatex || '').replace(/\\phantom\{\}/g, '').trim() : '(no maths row)';
  });
  const saidLine = await page.evaluate(async () => {
    document.getElementById('announce').textContent = '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 2200));
    return document.getElementById('announce').textContent.trim();
  });
  ok('the line is displayed as maths', /1\s*\+\s*2/.test(displayed), displayed);
  ok('and "say this line" says the maths, not the literary cells',
     /plus/i.test(saidLine) && !/^dots/i.test(saidLine), { displayed, saidLine });

  // PROSE EITHER SIDE OF THE MATHS, on one line: both must be heard, or the
  // fix would have traded one half of the line for the other.
  await sayLine();
  const mixed = await page.evaluate(async (cells) => {
    const f = document.getElementById('brlInput');
    // step out of the span, then write a word after it
    f.dispatchEvent(new KeyboardEvent('keydown', { key: 'm', code: 'KeyM', ctrlKey: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 400));
    f.focus(); f.setRangeText(' ' + cells + ' ', f.value.length, f.value.length, 'end');
    f.dispatchEvent(new Event('input', { bubbles: true }));
    await new Promise((r) => setTimeout(r, 1500));
    document.getElementById('announce').textContent = '';
    document.dispatchEvent(new KeyboardEvent('keydown', { key: 'L', code: 'KeyL', ctrlKey: true, shiftKey: true, bubbles: true, cancelable: true }));
    await new Promise((r) => setTimeout(r, 2200));
    return { said: document.getElementById('announce').textContent.trim(),
             print: document.getElementById('out').textContent.replace(/\s+/g, ' ').trim() };
  }, CAT);
  ok('a line of prose AND maths says both', /plus/i.test(mixed.said) && /cat/i.test(mixed.said), mixed);

  // TR-08: finishing that sum with ENTER must announce it, as SPACE does
  // REAL key presses. The separator goes through the browser's own edit - the
  // app deliberately lets the native edit happen and listens for it - so a
  // synthetic KeyboardEvent produces no edit and therefore no speech at all,
  // which looks like the defect and is not.
  const sentence = async (key) => {
    await sayLine();
    await page.evaluate(async () => {
      // sentence speech only, so nothing else can be mistaken for the answer
      for (const [id, on] of [['speakSentence', true], ['speakWord', false], ['speakLetter', false], ['speakCursor', false]]) {
        const b = document.getElementById(id);
        if (b) { b.checked = on; b.dispatchEvent(new Event('change', { bubbles: true })); }
      }
      await new Promise((r) => setTimeout(r, 300));
      document.getElementById('announce').textContent = '';
      document.getElementById('brlInput').focus();
    });
    await page.keyboard.press(key);
    await page.waitForTimeout(2200);
    return page.evaluate(() => document.getElementById('announce').textContent.trim());
  };
  const bySpace = await sentence('Space');
  const byEnter = await sentence('Enter');
  ok('Space announces the finished sum', /plus/i.test(bySpace), bySpace);
  ok('and Enter announces it too', /plus/i.test(byEnter), { bySpace, byEnter });

  for (const f of [uebFirst, nemFirst]) { try { fs.unlinkSync(f); } catch { /* */ } }
  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
