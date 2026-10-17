// IS THE TEXT LEGIBLE? MEASURED, NOT EYEBALLED.
//
// TR-13 of the 15 Oct 2026 audit: an axe scan with Help open found ten Help
// contents buttons at 4.1:1 on white, where their 13.8px normal-weight text
// needs 4.5:1. The colour was --accent, whose own comment in index.html says
// it is "UI only: 4.1:1, which passes the 3:1 for non-text but NOT the 4.5:1
// body text needs" - so the token knew, and the stylesheet used it for text
// anyway in several places. A rule written in a comment is not a rule.
//
// WHY A SCANNER AND NOT A LIST OF HEXES. A test naming colours would pass
// while the stylesheet put a passing colour on a failing background, or shrank
// the text under a large-text exemption. This measures what a reader actually
// sees: the computed colour composited over the real backdrop - every layer of
// it, because --sel is a translucent tint and a tint changes the answer - at
// the element's real size and weight, against the threshold WCAG asks for at
// that size and weight.
//
// STATES ARE MEASURED, NOT ASSUMED. The acceptance asked for ordinary, hover
// and focus. Hover is the interesting one: .help-toc-item:hover tints its own
// background with --sel, so hovering made the worst case worse.
//
// WHAT IS NOT IN SCOPE. Non-text use of --accent - borders, outlines, the
// caret - needs 3:1, which it has. The braille pane's input is deliberately
// transparent text over rendered cells and is excluded by name.
//
// Run:  node Translate/test-contrast.mjs
//       node Translate/test-contrast.mjs --show   (headful, to watch it)
//       node Translate/test-contrast.mjs --all    (report every run of text)
import { chromium } from 'playwright';
import http from 'node:http';
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const ROOT = path.resolve(HERE, '..');
const PORT = 8241;
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
  else { failures.push(name); console.log(`FAIL  ${name}: ${got}`); }
};

// Runs in the page. Composites every translucent layer, because a tinted
// background is a different background.
const SCAN = (excludeIds) => {
  // TWO SERIALISATIONS, and missing the second one silently moves the answer.
  // --sel is a color-mix(), which Chrome reports as
  // "color(srgb 0.164706 0.490196 0.882353 / 0.25)" - not rgba(). An rgba-only
  // parser read that as "no background", walked past the tint to the white
  // below it, and reported the hovered button on plain white. The tint IS the
  // backdrop a reader sees, so it has to be understood here.
  const parse = (s) => {
    const str = String(s);
    if (str === 'transparent') return { r: 0, g: 0, b: 0, a: 0 };
    const srgb = str.match(/^color\(srgb\s+([^)]+)\)/);
    if (srgb) {
      const p = srgb[1].split(/[\s/]+/).filter(Boolean).map(Number);
      return { r: p[0] * 255, g: p[1] * 255, b: p[2] * 255, a: p.length > 3 ? p[3] : 1 };
    }
    const m = str.match(/rgba?\(([^)]+)\)/);
    if (!m) return null;
    const p = m[1].split(/[,\s/]+/).filter(Boolean).map(Number);
    return { r: p[0], g: p[1], b: p[2], a: p.length > 3 ? p[3] : 1 };
  };
  const over = (top, bot) => ({ r: top.r * top.a + bot.r * (1 - top.a),
                                g: top.g * top.a + bot.g * (1 - top.a),
                                b: top.b * top.a + bot.b * (1 - top.a), a: 1 });
  const backdrop = (el) => {
    const layers = [];
    for (let n = el; n; n = n.parentElement) {
      const c = parse(getComputedStyle(n).backgroundColor);
      if (c && c.a > 0) { layers.push(c); if (c.a >= 1) break; }
    }
    if (!layers.length || layers[layers.length - 1].a < 1) layers.push({ r: 255, g: 255, b: 255, a: 1 });
    let out = layers[layers.length - 1];
    for (let i = layers.length - 2; i >= 0; i -= 1) out = over(layers[i], out);
    return out;
  };
  const lum = (c) => {
    const f = (v) => { const u = v / 255; return u <= 0.03928 ? u / 12.92 : Math.pow((u + 0.055) / 1.055, 2.4); };
    return 0.2126 * f(c.r) + 0.7152 * f(c.g) + 0.0722 * f(c.b);
  };
  const hex = (c) => '#' + [c.r, c.g, c.b].map((v) => Math.round(v).toString(16).padStart(2, '0')).join('');
  const name = (el) => (el.id ? '#' + el.id : '')
    + (typeof el.className === 'string' && el.className.trim()
        ? '.' + el.className.trim().split(/\s+/).join('.') : '')
    || el.tagName.toLowerCase();

  const out = [];
  for (const el of document.querySelectorAll('*')) {
    if (excludeIds.includes(el.id)) continue;
    if (![...el.childNodes].some((n) => n.nodeType === 3 && n.textContent.trim() !== '')) continue;
    if (!el.getClientRects().length) continue;
    const cs = getComputedStyle(el);
    if (cs.visibility === 'hidden' || cs.opacity === '0') continue;
    const fg0 = parse(cs.color);
    if (!fg0 || fg0.a === 0) continue;             // deliberately invisible text
    const bd = backdrop(el);
    const fg = fg0.a < 1 ? over(fg0, bd) : fg0;
    const px = parseFloat(cs.fontSize);
    const w = parseInt(cs.fontWeight, 10) || 400;
    // WCAG 1.4.3: 18.66px bold or 24px is "large", and may sit at 3:1.
    const need = (px >= 24 || (px >= 18.66 && w >= 700)) ? 3 : 4.5;
    const l1 = lum(fg), l2 = lum(bd);
    const ratio = (Math.max(l1, l2) + 0.05) / (Math.min(l1, l2) + 0.05);
    out.push({ sel: name(el), text: el.textContent.trim().slice(0, 40),
               fg: hex(fg), bg: hex(bd), px: +px.toFixed(2), w,
               ratio: +ratio.toFixed(2), need, pass: ratio >= need - 0.005 });
  }
  return out;
};

// The braille input is transparent BY DESIGN - it sits over the rendered cells
// so a caret and a selection land in the right place. Named, not pattern-
// matched, so a newly transparent element is a failure rather than a silence.
const EXCLUDE = ['brlInput'];

const settled = async (page, sel) => {
  let last = null;
  for (let i = 0; i < 40; i += 1) {
    const now = await page.evaluate((s) => {
      const el = document.querySelector(s);
      if (!el) return null;
      const cs = getComputedStyle(el);
      return cs.color + '|' + cs.backgroundColor + '|' + cs.borderColor;
    }, sel);
    if (now !== null && now === last) return now;
    last = now;
    await page.waitForTimeout(50);
  }
  return last;
};

const show = (rows) => rows.map((r) =>
  `${r.ratio}:1 (needs ${r.need}) ${r.fg} on ${r.bg} ${r.px}px/${r.w} ${r.sel} "${r.text}"`).join('\n        ');

(async () => {
  await new Promise((r) => server.listen(PORT, r));
  const browser = await chromium.launch({
    channel: 'chrome', headless: !process.argv.includes('--show'), args: ['--no-sandbox'],
  });
  const page = await browser.newPage();
  await page.goto(`http://localhost:${PORT}/Translate/index.html`);
  await page.waitForFunction(() => !!document.getElementById('helpBtn'));
  await page.waitForTimeout(1200);

  const scan = () => page.evaluate(SCAN, EXCLUDE);
  const report = (rows) => {
    if (!process.argv.includes('--all')) return;
    for (const r of rows) console.log(`      ${r.pass ? 'ok  ' : 'BAD '} ${show([r])}`);
  };

  const opening = await scan();
  report(opening);
  ok(`the page as it opens: every run of text meets its threshold (${opening.length} measured)`,
     opening.every((r) => r.pass), '\n        ' + show(opening.filter((r) => !r.pass)));

  await page.click('#helpBtn');
  await page.waitForSelector('.help-toc-item');
  await page.waitForTimeout(300);

  const helped = await scan();
  report(helped);
  const toc = helped.filter((r) => r.sel.includes('help-toc-item'));
  ok('Help has contents buttons to measure', toc.length >= 8, `${toc.length} found`);
  ok(`Help open: every run of text meets its threshold (${helped.length} measured)`,
     helped.every((r) => r.pass), '\n        ' + show(helped.filter((r) => !r.pass)));

  // HOVER. .help-toc-item:hover tints its own background with --sel, so the
  // hovered button is a different measurement from the resting one.
  await page.locator('.help-toc-item').first().hover();
  await settled(page, '.help-toc-item');
  const onHover = (await scan()).filter((r) => r.sel.includes('help-toc-item'));
  report(onHover);
  ok('a hovered contents button is still legible on its tinted background',
     onHover.every((r) => r.pass), '\n        ' + show(onHover.filter((r) => !r.pass)));

  // KEYBOARD FOCUS, which is the state a child using the keyboard is in.
  await page.keyboard.press('Tab');
  await page.locator('.help-toc-item').first().focus();
  await settled(page, '.help-toc-item');
  const onFocus = (await scan()).filter((r) => r.sel.includes('help-toc-item'));
  ok('a focused contents button is still legible',
     onFocus.every((r) => r.pass), '\n        ' + show(onFocus.filter((r) => !r.pass)));

  // A hovered toolbar button swaps its text to the accent as well.
  await page.keyboard.press('Escape');
  await page.waitForTimeout(200);
  await page.locator('#loadBtn').hover();
  await settled(page, '#loadBtn');
  const toolbar = (await scan()).filter((r) => r.sel.includes('pill-btn') || r.sel.includes('icon-btn'));
  ok('a hovered toolbar button is still legible',
     toolbar.every((r) => r.pass), '\n        ' + show(toolbar.filter((r) => !r.pass)));

  await browser.close();
  server.close();
  console.log(`\n${pass} passed, ${failures.length} failed`);
  process.exit(failures.length ? 1 : 0);
})();
