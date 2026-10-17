// DO THE CONTROLS COLLIDE? MEASURED AT A SPREAD OF WIDTHS.
//
// A tester, 17 Oct 2026: "buttons overlap when resizing". They did - Clear sat
// on top of Save with only its last letter showing, from about 880px down.
// The cause was mine: centring the Maths/Load/Save group over the braille pane
// (PB, 12 Oct) was done by taking it OUT OF FLOW, and an absolutely positioned
// box is laid out against nothing. Its box overlapped the buttons on the right
// by a constant 291px at EVERY width; wide windows only hid it, because the
// centred content inside the box was not wide enough to reach.
//
// Nothing measured that, which is why it survived a full battery and a deploy.
// The whole suite is "no two controls in the header may overlap", which is the
// property a person actually needs, rather than a list of expected positions
// that would have to be rewritten every time a button moves.
//
// TWO TRAPS THIS HARNESS AVOIDS, both of which fooled me first:
//
//   1. THE SERVICE WORKER. Translate registers one and serves cache-first, so
//      a page loaded from a dev server can be running a BUILD FROM LAST WEEK.
//      Every measurement I took of my own fix was of the old code until I
//      noticed. This serves from a port of its own and unregisters any worker
//      before measuring, then checks the page really is running this tree.
//
//   2. A RESIZE THAT THE PAGE NEVER HEARS. The layout is recomputed in a
//      `resize` handler. If the viewport is changed by a method that does not
//      dispatch that event, the page keeps the geometry of the old size and
//      every reading is of a layout that no window ever had. So this asserts
//      the handler RAN - the pane geometry must actually change with the
//      window - before trusting a single "no overlap".
//
// Run:  node Translate/test-layout.mjs
//       node Translate/test-layout.mjs --show   (headful, to watch it)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8243;
const TYPES = { '.html': 'text/html', '.mjs': 'text/javascript', '.js': 'text/javascript',
                '.css': 'text/css', '.wasm': 'application/wasm', '.json': 'application/json',
                '.woff2': 'font/woff2', '.woff': 'font/woff', '.svg': 'image/svg+xml',
                '.ctb': 'text/plain', '.cti': 'text/plain', '.uti': 'text/plain',
                '.utb': 'text/plain', '.dis': 'text/plain', '.brf': 'text/plain',
                '.png': 'image/png', '.ebrl': 'application/epub+zip' };

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

let pass = 0; const failures = [];
const ok = (name, cond, got = '') => {
  if (cond) { pass++; console.log(`ok    ${name}`); }
  else { failures.push(name); console.log(`FAIL  ${name}${got === '' ? '' : ': ' + got}`); }
};

// Every control in the header, by id. Named rather than selected by class so a
// control that loses its class is a failure here instead of a silent exclusion.
const CONTROLS = ['mathsMode', 'loadBtn', 'saveBtn', 'clearBtn', 'helpBtn', 'exportBtn', 'settingsBtn'];

const WIDTHS = [1600, 1400, 1280, 1100, 1000, 950, 900, 880, 860, 850, 800, 760, 700, 640, 560, 480, 400];

const PROBE = (ids) => {
  const rects = ids.map((id) => {
    const el = document.getElementById(id);
    const box = el && (el.closest('label') || el);
    const r = box && box.getBoundingClientRect();
    return r && r.width > 0 && r.height > 0 ? { id, r } : null;
  }).filter(Boolean);
  let worst = null;
  for (let i = 0; i < rects.length; i += 1) {
    for (let j = i + 1; j < rects.length; j += 1) {
      const a = rects[i].r, b = rects[j].r;
      const ox = Math.min(a.right, b.right) - Math.max(a.left, b.left);
      const oy = Math.min(a.bottom, b.bottom) - Math.max(a.top, b.top);
      if (ox > 0 && oy > 0 && (!worst || ox > worst.px)) {
        worst = { pair: `${rects[i].id}/${rects[j].id}`, px: Math.round(ox) };
      }
    }
  }
  const cs = getComputedStyle(document.documentElement);
  // Whether the panes are REALLY one above the other, measured, so it can be
  // held against what the app believes.
  const ps = [...document.querySelectorAll('.panes .pane')];
  const pr = ps.map((p) => p.getBoundingClientRect());
  const reallyStacked = pr.length > 1 && Math.abs(pr[0].top - pr[1].top) >= 5;
  return {
    seen: rects.length,
    worst,
    paneW: cs.getPropertyValue('--brl-pane-w').trim(),
    inflow: document.body.classList.contains('head-inflow'),
    stacked: document.body.classList.contains('panes-stacked'),
    reallyStacked,
    paneWidths: pr.map((r) => Math.round(r.width)),
    // The two braille layers: a transparent textarea carrying the caret, over
    // a div carrying the cells.
    layers: (() => {
      const ta = document.getElementById('brlInput');
      const bd = document.getElementById('braille');
      if (!ta || !bd) return null;
      const a = getComputedStyle(ta), b = getComputedStyle(bd);
      return { taFont: a.fontSize, bdFont: b.fontSize,
               taLH: a.lineHeight, bdLH: b.lineHeight,
               wholePx: Number.isInteger(parseFloat(a.lineHeight)) };
    })(),
  };
};

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({
    channel: 'chrome', headless: !process.argv.includes('--show'), args: ['--no-sandbox'],
  });
  const page = await browser.newPage({ viewport: { width: 1400, height: 820 } });
  await page.goto(`http://localhost:${PORT}/Translate/index.html`);

  // NO SERVICE WORKER, so what is measured is this tree and not a cached build.
  await page.evaluate(async () => {
    for (const r of await navigator.serviceWorker.getRegistrations()) await r.unregister();
    for (const k of await caches.keys()) await caches.delete(k);
  });
  await page.reload();
  await page.waitForSelector('#clearBtn');
  await page.waitForTimeout(1200);
  const live = await page.evaluate(async () => {
    const src = await (await fetch('/Translate/translate.mjs', { cache: 'no-store' })).text();
    return { controlled: !!navigator.serviceWorker.controller, hasFit: src.includes('head-inflow') };
  });
  // BEING CONTROLLED IS NOT THE QUESTION. The app registers its worker on
  // every load and claims the page at once, so `controller` is set within a
  // second of a reload and proves nothing either way. What matters is WHAT the
  // worker serves: it is cache-first, so a stale one would hand back last
  // week's module even to a no-store fetch. Asking the page for the source and
  // looking for code that only exists in this tree is the check that bites.
  ok('the page is served THIS tree, not a cached build',
     live.hasFit, JSON.stringify(live));

  const seen = [];
  for (const width of WIDTHS) {
    await page.setViewportSize({ width, height: 820 });
    await page.waitForTimeout(260);
    seen.push({ width, ...(await page.evaluate(PROBE, CONTROLS)) });
  }

  ok(`every control is visible at every width (${CONTROLS.length} each)`,
     seen.every((s) => s.seen === CONTROLS.length),
     seen.filter((s) => s.seen !== CONTROLS.length).map((s) => `${s.width}px saw ${s.seen}`).join(', '));

  // THE HANDLER MUST HAVE RUN. If the pane geometry never changes across a
  // 1200px swing, the page did not hear the resize and every "no overlap"
  // below is a reading of one stale layout.
  const widthsSeen = new Set(seen.map((s) => s.paneW));
  ok('the layout really was recomputed as the window changed',
     widthsSeen.size > 1, `--brl-pane-w took only ${[...widthsSeen].join(', ')}`);

  // THE APP'S IDEA OF STACKED MUST MATCH THE SCREEN. Two things stack these
  // panes - this file's own class and a @media (max-width:820px) rule - and
  // reading only the class left a band between 700 and 820px where the panes
  // were stacked on screen while the app thought they were side by side. It
  // then published the braille pane's full width as the width to centre the
  // toolbar over, which is what made the buttons collide.
  const lying = seen.filter((s) => s.stacked !== s.reallyStacked);
  ok('the app agrees with the screen about whether the panes are stacked',
     lying.length === 0,
     lying.map((s) => `${s.width}px: on screen ${s.reallyStacked}, app says ${s.stacked}`).join('; '));

  // THE CARET LAYER AND THE CELL LAYER MUST MEASURE THE SAME (tester, 17 Oct:
  // "cursor can still drift visually in Safari for multiline documents and
  // resized window"). They are laid out by DIFFERENT engines - a textarea's
  // form-control text engine over ordinary inline layout - so any property
  // that places a glyph has to be identical in both, and the line box has to
  // be a whole number of pixels: line-height:1.25 on a 23px font gives
  // 28.75px, and an engine that snaps line boxes to device pixels in one
  // layer and not the other gains about a pixel every four lines. The error
  // then grows DOWN a document and moves when the window is resized, which is
  // the shape of the report. Chrome lays both out alike, so this suite cannot
  // see the drift itself - what it CAN hold is the invariant that makes the
  // drift impossible to produce.
  const layerRows = seen.filter((s) => s.layers);
  ok('both braille layers have measurable metrics', layerRows.length === seen.length,
     `${layerRows.length} of ${seen.length}`);
  const mismatched = layerRows.filter((s) =>
    s.layers.taFont !== s.layers.bdFont || s.layers.taLH !== s.layers.bdLH);
  ok('the caret layer and the cell layer agree on size and line height',
     mismatched.length === 0,
     mismatched.map((s) => `${s.width}px ${s.layers.taFont}/${s.layers.taLH} vs ${s.layers.bdFont}/${s.layers.bdLH}`).join('; '));
  const fractional = layerRows.filter((s) => !s.layers.wholePx);
  ok('the braille line box is a whole number of pixels, so nothing can round it two ways',
     fractional.length === 0,
     fractional.map((s) => `${s.width}px ${s.layers.taLH}`).join(', '));

  const collisions = seen.filter((s) => s.worst);
  ok('no two header controls overlap, at any width',
     collisions.length === 0,
     collisions.map((s) => `${s.width}px ${s.worst.pair} by ${s.worst.px}px`).join('; '));

  // The centring PB asked for must survive the fix: on a roomy window the
  // group is still pinned over the braille pane, not pushed into the row.
  const roomy = seen.filter((s) => s.width >= 1280 && !s.stacked);
  ok('the group is still centred over the braille pane on a wide window',
     roomy.length > 0 && roomy.every((s) => !s.inflow),
     roomy.map((s) => `${s.width}px inflow=${s.inflow}`).join(', '));

  // ...and the fallback must actually be what prevents the collision, rather
  // than the window happening to be wide enough everywhere tested.
  const narrow = seen.filter((s) => s.inflow || s.stacked);
  ok('the narrow widths are handled by a fallback, not by luck',
     narrow.length > 0, 'no width used either fallback');

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
