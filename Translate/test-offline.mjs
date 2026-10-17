// WHAT SURVIVES AN UPDATE.
//
// From the 15 October audit, TR-12: six braille codes travel with the app; the
// other 136 are fetched the first time they are chosen and were stored in the
// SAME versioned cache as the app shell. Activation deletes the previous
// version of that cache, so updating the app threw away every language the
// reader had ever downloaded - and the app's own Help promises the opposite.
//
// The update is REAL: a second worker, differing only in its cache name, is
// served to the same browser and allowed to install, activate and claim. The
// table used is one that is NOT precached, because a precached table would
// survive for the wrong reason.
//
// Run:  node Translate/test-offline.mjs
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = process.env.TRANSLATE_ROOT
  || path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const PORT = 8235;
const TYPES = { '.html':'text/html', '.mjs':'text/javascript', '.js':'text/javascript',
  '.css':'text/css', '.wasm':'application/wasm', '.json':'application/json',
  '.webmanifest':'application/json', '.woff2':'font/woff2', '.woff':'font/woff',
  '.svg':'image/svg+xml', '.ctb':'text/plain', '.cti':'text/plain', '.uti':'text/plain',
  '.utb':'text/plain', '.dis':'text/plain', '.ttf':'font/ttf', '.brf':'text/plain',
  '.ebrl':'application/epub+zip' };

// The one knob: what version the served worker claims to be. Nothing on disk
// is edited - the bytes are rewritten in flight, which is the whole upgrade.
let bumpTo = null;
const server = http.createServer((req, res) => {
  let p = decodeURIComponent(req.url.split('?')[0]);
  if (p.endsWith('/')) p += 'index.html';
  const file = path.join(ROOT, p);
  if (!file.startsWith(ROOT) || !fs.existsSync(file) || fs.statSync(file).isDirectory()) {
    res.writeHead(404).end('not found'); return;
  }
  if (p === '/Translate/sw.js' && bumpTo) {
    const src = fs.readFileSync(file, 'utf8')
      .replace(/^const CACHE = 'translate-v\d+';/m, `const CACHE = '${bumpTo}';`);
    res.writeHead(200, { 'Content-Type': 'text/javascript', 'Cache-Control': 'no-store' });
    res.end(src); return;
  }
  res.writeHead(200, { 'Content-Type': TYPES[path.extname(file)] || 'application/octet-stream',
                       'Cache-Control': 'no-store' });
  fs.createReadStream(file).pipe(res);
});

const TABLE = '/liblouis/tables/cy-cy-g2.ctb';   // Welsh: real, and NOT precached
let pass = 0; const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}: ${JSON.stringify(got)}`); }
};

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({ channel: 'chrome', headless: true, args: ['--no-sandbox'] });
  const ctx = await browser.newContext();
  const page = await ctx.newPage();

  const open = async () => {
    await page.goto(`http://localhost:${PORT}/Translate/`, { waitUntil: 'load' });
    await page.waitForFunction(() => !!document.getElementById('brlInput'));
    await page.waitForFunction(() => !!navigator.serviceWorker.controller, null, { timeout: 20000 });
    await page.waitForTimeout(1500);
  };
  const cachedCopies = () => page.evaluate(async (t) => {
    const out = [];
    for (const name of await caches.keys()) {
      const hit = await (await caches.open(name)).match(new URL(t, location.origin).href);
      if (hit) out.push(name);
    }
    return out;
  }, TABLE);

  await open();
  // A neighbour's cache, to prove the update leaves other apps alone - the
  // defect this app had in September and must not regrow.
  await page.evaluate(() => caches.open('brlduet-v999')
    .then((c) => c.put('/neighbour', new Response('theirs'))));
  // Download the language, the way choosing it in Settings does.
  await page.evaluate((t) => fetch(t).then((r) => r.text()), TABLE);
  await page.waitForTimeout(1200);
  const before = await cachedCopies();
  ok('a downloaded language is cached', before.length > 0, before);

  // THE UPDATE. A new worker, new cache name, installed and activated for real.
  const current = await page.evaluate(() => caches.keys());
  const next = `translate-v${Number(String(current.find((k) => /^translate-v\d+$/.test(k)) || 'translate-v0').replace(/\D/g, '')) + 1}`;
  bumpTo = next;
  await page.evaluate(() => navigator.serviceWorker.getRegistration().then((r) => r && r.update()));
  await page.waitForFunction((want) => caches.keys().then((k) => k.includes(want)), next, { timeout: 30000 });
  await page.waitForTimeout(2500);
  await open();

  const after = await cachedCopies();
  ok('the language is STILL cached after the update', after.length > 0, { before, after, next });

  // and it really serves with the network gone
  await ctx.setOffline(true);
  const offline = await page.evaluate((t) => fetch(t).then((r) => r.ok).catch(() => false), TABLE);
  await ctx.setOffline(false);
  ok('and it still answers offline', offline === true, { offline });

  // the app's own shell is on the new version, so this is a real upgrade
  const keys = await page.evaluate(() => caches.keys());
  ok('the update did happen (the new cache exists)', keys.includes(next), keys);

  ok("a neighbouring app's cache is untouched by our update",
     (await page.evaluate(() => caches.keys())).includes('brlduet-v999'),
     await page.evaluate(() => caches.keys()));

  // A SHIPPED table must still answer offline, which is the thing the two-cache
  // lookup could quietly have broken: those six live with the shell, not here.
  await ctx.setOffline(true);
  const shipped = await page.evaluate(() =>
    fetch('/liblouis/tables/en-ueb-g2.ctb').then((r) => r.ok).catch(() => false));
  await ctx.setOffline(false);
  ok('a table that ships with the app still answers offline', shipped === true, { shipped });

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
