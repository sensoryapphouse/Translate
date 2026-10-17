// RECOVERY: WHOSE WORK IS IT, AND IN WHICH CODE.
//
// Written from the 15 October audit, which found two defects in the autosave
// added on 11 October. Both were reproduced here against the unchanged source
// before either was repaired.
//
//   TR-01  Every tab wrote and removed the SAME localStorage key, so opening a
//          second tab and closing it again - without typing a word in it -
//          deleted the first tab's record. The document on screen survived; its
//          protection did not.
//   TR-02  Recovery set the braille code and rendered WITHOUT waiting for the
//          table to load. bt() met a table that was not there, cached '' for
//          every word, and the print stayed blank even after the table arrived.
//
// These need two pages in one browser context, which is why they are their own
// suite rather than part of test-core-loop.mjs.
//
// Every cell is BUILT from dot numbers - a mistyped cell would test something
// other than what the case says.
//
// Run:  node Translate/test-recovery.mjs
import { chromium } from 'playwright';
import http from 'node:http'; import fs from 'node:fs'; import path from 'node:path';
import { fileURLToPath } from 'node:url';
// TRANSLATE_ROOT serves a DIFFERENT checkout while this file and its
// dependencies come from here. That is how these cases were shown to fail
// against the unfixed source: same test, same browser, older tree.
const ROOT = process.env.TRANSLATE_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const T = { '.html':'text/html','.mjs':'text/javascript','.js':'text/javascript','.css':'text/css','.wasm':'application/wasm','.json':'application/json','.webmanifest':'application/json','.woff2':'font/woff2','.woff':'font/woff','.svg':'image/svg+xml','.ctb':'text/plain','.cti':'text/plain','.uti':'text/plain','.utb':'text/plain','.dis':'text/plain','.ttf':'font/ttf','.brf':'text/plain','.ebrl':'application/epub+zip' };
const server = http.createServer((q, r) => { let p = decodeURIComponent(q.url.split('?')[0]); if (p.endsWith('/')) p += 'index.html';
  const f = path.join(ROOT, p);
  if (!f.startsWith(ROOT) || !fs.existsSync(f) || fs.statSync(f).isDirectory()) { r.writeHead(404).end('no'); return; }
  r.writeHead(200, { 'Content-Type': T[path.extname(f)] || 'application/octet-stream', 'Cache-Control': 'no-store' });
  fs.createReadStream(f).pipe(r); });
const PORT = 8233;   // its own, so it can run beside the other browser suites
const cell = (...d) => String.fromCodePoint(0x2800 + d.reduce((a,n)=>a|(1<<(n-1)),0));
const CAT = cell(1,4) + cell(1) + cell(2,3,4,5);
let pass = 0, fail = 0;
const ok = (n, c, got='') => { if (c) { pass++; console.log('ok    ' + n); } else { fail++; console.log('FAIL  ' + n + ': ' + JSON.stringify(got)); } };
const boot = async (ctx) => { const p = await ctx.newPage();
  await p.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'load' });
  await p.waitForFunction(() => !!document.getElementById('brlInput'));
  await p.waitForTimeout(2600); return p; };

(async () => {
  await new Promise(r => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });

  // ---- TR-01: a second, empty tab must not delete the first tab's draft ----
  {
    const ctx = await browser.newContext();
    const A = await boot(ctx);
    const B = await boot(ctx);                       // opened empty, never typed in
    await A.evaluate((t) => { const f = document.getElementById('brlInput');
      f.focus(); f.setRangeText(t + ' ', 0, 0, 'end'); f.dispatchEvent(new Event('input', { bubbles: true })); }, CAT);
    await A.waitForTimeout(2800);                    // past the save debounce
    const drafts = () => A.evaluate(() => Object.keys(localStorage).filter(k => k.startsWith('translate.draft')).length);
    ok('tab A has written a draft', (await drafts()) > 0);
    await B.close();                                 // the empty tab goes
    await A.waitForTimeout(800);
    ok("closing an empty second tab leaves tab A's draft alone", (await drafts()) > 0,
       { draftsAfter: await drafts() });
    await ctx.close();
  }

  // ---- TR-02: recovering under another literary code must not blank print ----
  {
    const ctx = await browser.newContext();
    await ctx.addInitScript(([key, buf]) => {
      localStorage.setItem(key, JSON.stringify({ v: 1, at: new Date().toISOString(), buf,
        lineModes: ['text'], mathSpans: [], brailleCode: 'fr-bfu-comp6', mathsCode: 'nem', ueb: false, nem: false }));
    }, ['translate.draft', CAT + ' ']);
    const p = await boot(ctx);
    const offered = await p.evaluate(() => !!document.getElementById('draftOffer'));
    ok('the French draft is offered', offered);
    if (offered) {
      await p.click('#draftOffer button');           // Bring it back
      await p.waitForTimeout(3500);                  // well past any table fetch
      const out = await p.evaluate(() => ({
        print: document.getElementById('out').textContent.trim(),
        code: document.getElementById('brailleCodeSel').value,
      }));
      ok('the print is not blank after recovering under another code', out.print.length > 0, out);
      ok('and the recovered code is the one the work was written in', out.code === 'fr-bfu-comp6', out);
    }
    await ctx.close();
  }

  // ---- the rest of TR-01's acceptance list ----
  {
    const ctx = await browser.newContext();
    const A = await boot(ctx);
    const B = await boot(ctx);
    const type = (page, cells) => page.evaluate((t) => { const f = document.getElementById('brlInput');
      f.focus(); f.setRangeText(t + ' ', 0, 0, 'end'); f.dispatchEvent(new Event('input', { bubbles: true })); }, cells);
    const DOG = cell(1,4,5) + cell(1,3,5) + cell(1,2,4,5);
    await type(A, CAT); await type(B, DOG);
    await A.waitForTimeout(3000);
    const records = () => A.evaluate(() => Object.keys(localStorage)
      .filter(k => k.startsWith('translate.draft')).map(k => JSON.parse(localStorage.getItem(k)).buf.trim()).sort());
    const two = await records();
    ok('two tabs with work keep TWO records, neither replacing the other', two.length === 2, two);

    // closing the second, nonempty tab must leave its own record AND the first's
    await B.close(); await A.waitForTimeout(900);
    ok('and closing one leaves both records', (await records()).length === 2, await records());

    // Clear in tab A removes A's record only
    await A.evaluate(() => document.getElementById('clearBtn').click());
    await A.waitForTimeout(300);
    await A.evaluate(() => { const y = document.getElementById('confirmYes'); if (y) y.click(); });
    await A.waitForTimeout(2800);
    const left = await records();
    ok("Clear removes this tab's record and leaves the other", left.length === 1, left);

    // a NEW tab (as after a crash) is offered the survivor
    const C = await boot(ctx);
    const offer = await C.evaluate(() => {
      const o = document.getElementById('draftOffer');
      return o ? o.textContent.replace(/\s+/g, ' ').trim() : null;
    });
    ok('a fresh tab is still offered the surviving work', !!offer && /cells/.test(offer), offer);
    await ctx.close();
  }

  // ---- TR-03: a save must come back in the code it was written in ----
  // The same question as TR-02, asked of a FILE rather than a draft: the cells
  // mean nothing without the code that produced them, so a document that does
  // not carry its own code reopens as a different language without a word.
  {
    const os = await import('node:os');
    const ctx = await browser.newContext({ acceptDownloads: true });
    const p = await boot(ctx);
    const setCode = async (code) => {
      await p.evaluate((c) => {
        const sel = document.getElementById('brailleCodeSel');
        if (![...sel.options].some((o) => o.value === c)) {
          sel.add(new Option(c, c));        // a code not in the short list
        }
        sel.value = c; sel.dispatchEvent(new Event('change', { bubbles: true }));
      }, code);
      await p.waitForTimeout(3000);         // the table may have to be fetched
    };
    const FULL = cell(1,2,3,4,5,6);         // reads as é in French, "for" in UEB

    await setCode('fr-bfu-comp6');
    await p.evaluate((t) => { const f = document.getElementById('brlInput');
      f.focus(); f.setRangeText(t + ' ', 0, 0, 'end'); f.dispatchEvent(new Event('input', { bubbles: true })); }, FULL);
    await p.waitForTimeout(1500);
    const inFrench = await p.evaluate(() => document.getElementById('out').textContent.trim());
    ok('the cells read as French before saving', inFrench.length > 0 && inFrench !== 'for', inFrench);

    const dl = p.waitForEvent('download');
    await p.evaluate(() => document.getElementById('saveBtn').click());
    const file = path.join(os.tmpdir(), 'tr03-french.ebrl');
    await (await dl).saveAs(file);

    await setCode('en-ueb-g2');
    await p.setInputFiles('#loadInput', file);
    await p.waitForTimeout(3500);
    const after = await p.evaluate(() => ({
      print: document.getElementById('out').textContent.trim(),
      code: document.getElementById('brailleCodeSel').value,
    }));
    ok('reopening restores the code the work was written in', after.code === 'fr-bfu-comp6', after);
    ok('...so the print says what it said when it was saved', after.print === inFrench, { after, inFrench });
    try { fs.unlinkSync(file); } catch { /* */ }

    // English GRADE 1 too: the audit's point is that this is not a French
    // problem, it is a "the file does not say" problem. Grade 1 and grade 2
    // are both "ueb" to the standard's vocabulary and read differently.
    await setCode('en-ueb-g1');
    await p.evaluate(() => { const f = document.getElementById('brlInput');
      f.value = ''; f.dispatchEvent(new Event('input', { bubbles: true })); });
    await p.waitForTimeout(600);
    await p.evaluate((t) => { const f = document.getElementById('brlInput');
      f.focus(); f.setRangeText(t + ' ', 0, 0, 'end'); f.dispatchEvent(new Event('input', { bubbles: true })); }, FULL);
    await p.waitForTimeout(1500);
    const inG1 = await p.evaluate(() => document.getElementById('out').textContent.trim());
    const dl1 = p.waitForEvent('download');
    await p.evaluate(() => document.getElementById('saveBtn').click());
    const g1file = path.join(os.tmpdir(), 'tr03-g1.ebrl');
    await (await dl1).saveAs(g1file);
    await setCode('en-ueb-g2');
    await p.setInputFiles('#loadInput', g1file);
    await p.waitForTimeout(3000);
    const backG1 = await p.evaluate(() => ({
      print: document.getElementById('out').textContent.trim(),
      code: document.getElementById('brailleCodeSel').value }));
    ok('grade 1 comes back as grade 1, not grade 2',
       backG1.code === 'en-ueb-g1' && backG1.print === inG1, { backG1, inG1 });
    try { fs.unlinkSync(g1file); } catch { /* */ }

    // AN OLDER FILE SAYS NOTHING, and must not be guessed at. Files written
    // before today carry no sah:brailleCode, so the code in use stays put.
    const { writeEbraille } = await import('./ebraille.mjs');
    const legacy = path.join(os.tmpdir(), 'tr03-legacy.ebrl');
    fs.writeFileSync(legacy, Buffer.from(writeEbraille({
      title: 'older file', creator: 'Unknown', producer: 'x', language: 'en',
      sections: [{ mode: 'text', lines: [CAT + ' '] }],   // no brailleCode field
    })));
    await setCode('fr-bfu-comp6');
    await p.setInputFiles('#loadInput', legacy);
    await p.waitForTimeout(2500);
    ok('a file with no recorded code leaves the chosen code alone',
       (await p.evaluate(() => document.getElementById('brailleCodeSel').value)) === 'fr-bfu-comp6',
       await p.evaluate(() => document.getElementById('brailleCodeSel').value));
    try { fs.unlinkSync(legacy); } catch { /* */ }
    await ctx.close();
  }

  console.log(`\n${pass} passed, ${fail} failed`);
  await browser.close(); server.close(); process.exit(fail ? 1 : 0);
})();
