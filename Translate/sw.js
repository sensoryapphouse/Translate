// Connector — offline app shell + engine + tables.
//
// Scope is /Translate/, so this worker controls the Translate page only (it can't
// disturb Emboss's own worker at /web/sw.js). A controlled page's requests are all
// intercepted regardless of path, which is why the shared /engine/ and
// /liblouis/tables/ assets below can be cached from here.
// Bump this whenever the asset list or a cached file changes, so the old cache is
// dropped on activate. (A stale module here surfaces as a confusing
// "does not provide an export named …" SyntaxError.)
// BUMP THIS BY HAND. It used to say that build-dist.sh rewrote this constant to
// a content hash at deploy time; that script is gone (it was superseded and
// then deleted, having drifted out of step with the app's asset list). The
// deployed bundle no longer touches this file at all — scripts/
// build-connector-single.mjs generates its OWN worker with its own hashed name,
// `connector-single-<hash>`, which is why connector-dist/sw.js says that and
// this says connector-vN.
//
// So nothing automatic protects THIS constant, and reading the old comment as
// "deployment will hash it for me" is exactly how a cached asset goes stale for
// a returning user. BrlDuet's worker hit that for real: see its own header.
const CACHE = 'translate-v178';   // assets-sha256: 81a8e57c0ae0

const ASSETS = [
  // REPATHED 2026-08-09. Every entry here pointed at /connector/ — the V1 paths,
  // left behind when V2 was forked and the worker copied without re-pointing.
  // Registration scope IS /Translate/, so this worker precached another app
  // and none of the files it serves: offline, V2 had nothing.
  // NOTE for anyone editing this list: keep apostrophes OUT of comments inside
  // the array. The cache tooling reads it with a single-quote regex, and one
  // apostrophe splits an entry in half.
  '/Translate/', '/Translate/index.html', '/Translate/translate.mjs',
  '/Translate/ueb-maths-to-latex.mjs', '/Translate/nemeth-symbols.mjs',
  '/Translate/ueb-rules.mjs', '/Translate/nemeth-rules.mjs',
  '/Translate/math-speech.mjs', '/Translate/mode-detect.mjs',
  '/Translate/verify.mjs', '/Translate/manifest.webmanifest',
  '/Translate/ebraille.mjs', '/Translate/braille-codes.mjs', '/Translate/unmxl.mjs',
  '/Translate/docx.mjs',
  '/Translate/mathnode.mjs',
  // The Help tour. Small, and the help promises the app keeps working with no
  // internet - a tour that only opens online would be the one broken promise.
  '/Translate/examples/translate-tour.ebrl',
  // shared with Emboss — referenced in place, never duplicated
  '/nemeth-to-latex.js', '/nemeth-symbol-table.js',
  '/web/vendor/temml.min.js', '/web/logo.svg',
  // APH Braille Shadows is NOT redistributed in this repository - APH agreed we
  // may use the face, which is not a grant to hand it on (web/fonts/PROVENANCE.md).
  // Its two entries are absent here BECAUSE caches.addAll() rejects the whole
  // install if a single entry 404s: left in, the worker would never install and
  // the app would silently lose offline. index.html still declares the @font-face,
  // so dropping the files into web/fonts/ is all it takes to restore the face -
  // put these two paths back on the same day.
  // Inter, self-hosted: without these the interface silently changes face offline.
  '/web/fonts/inter-latin.woff2', '/web/fonts/inter-latin-ext.woff2', '/web/fonts/inter-greek.woff2',
  '/web/fonts/inter-greek-ext.woff2', '/web/fonts/inter-cyrillic.woff2', '/web/fonts/inter-cyrillic-ext.woff2',
  '/web/fonts/inter-vietnamese.woff2',
  '/engine/liblouis-wasm.js', '/engine/liblouis-wasm.wasm',
  '/engine/louis-browser.mjs', '/engine/brf-ascii.mjs',
  // MATHCAT TRAVELS TOO (PB, 2026-08-11). It was fetched on demand, so on a
  // machine with no connection the maths simply went quiet: no spoken equations
  // and no verification, while the help promised the app keeps working offline.
  // It is 3.3 MB, which is most of the install — and it is what reads a child's
  // maths aloud, so it is not an optional extra.
  '/engine/mathcat/pkg-web/emboss_mathcat.js',
  '/engine/mathcat/pkg-web/emboss_mathcat_bg.wasm',
  '/liblouis/tables/braille-patterns.cti', '/liblouis/tables/en-ueb-chardefs.uti',
  '/liblouis/tables/en-ueb-g1.ctb', '/liblouis/tables/en-ueb-g2.ctb',
  '/liblouis/tables/en-ueb-math.ctb', '/liblouis/tables/en-us-brf.dis',
  '/liblouis/tables/latinLetterDef6Dots.uti', '/liblouis/tables/latinUppercaseComp6.uti',
  '/liblouis/tables/spaces.uti', '/liblouis/tables/text_nabcc.dis',
  '/liblouis/tables/unicode.dis',
  // Spanish and French code tables, with their include closures, so the
  // codes offered by default all work offline (2026-08-09).
  '/liblouis/tables/IPA-unicode-range.uti', '/liblouis/tables/digits6Dots.uti',
  '/liblouis/tables/digits6DotsPlusDot6.uti', '/liblouis/tables/es-chardefs.cti',
  '/liblouis/tables/es-g1.ctb', '/liblouis/tables/es-g2.ctb',
  '/liblouis/tables/fr-bfu-comp6.utb', '/liblouis/tables/fr-bfu-comp68.cti',
  '/liblouis/tables/fr-bfu-g2.ctb', '/liblouis/tables/litdigits6Dots.uti',
  '/liblouis/tables/litdigits6DotsPlusDot6.uti',
];

self.addEventListener('install', (e) => {
  // Cache each asset individually rather than addAll(): addAll is atomic, so one
  // renamed/404 entry would reject the whole precache and silently leave the app
  // with NO offline cache.
  e.waitUntil(caches.open(CACHE)
    .then((c) => Promise.all(ASSETS.map((u) => c.add(u).catch((err) => console.warn('[sw] precache failed:', u, err)))))
    .then(() => self.skipWaiting())
    .catch((err) => console.warn('[sw] install failed:', err)));
});

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE).map((k) => caches.delete(k))))
    .then(() => self.clients.claim()));
});

self.addEventListener('fetch', (e) => {
  if (e.request.method !== 'GET') return;
  const url = new URL(e.request.url);
  const sameOrigin = url.origin === self.location.origin;

  // App shell (navigations + our JS/CSS) is NETWORK-FIRST so a change shows up
  // immediately when online, falling back to cache offline. Cache-first here is a
  // known trap: users keep getting the old app until the worker cycles.
  const isShell = sameOrigin && (e.request.mode === 'navigate'
    || /\.(?:mjs|js|css|html|webmanifest)$/.test(url.pathname));
  if (isShell) {
    e.respondWith(
      fetch(e.request).then((res) => {
        if (res && res.ok) { const clone = res.clone(); caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {}); }
        return res;
      }).catch(() => caches.match(e.request, { ignoreSearch: true }).then((hit) => hit || caches.match('/Translate/index.html')))
    );
    return;
  }

  // WASM, liblouis tables, images: large and rarely change → cache-first.
  e.respondWith(caches.match(e.request).then((hit) => {
    if (hit) return hit;
    return fetch(e.request).then((res) => {
      if (res && res.ok && sameOrigin) {
        const clone = res.clone();
        caches.open(CACHE).then((c) => c.put(e.request, clone)).catch(() => {});
      }
      return res;
    });
  }));
});
