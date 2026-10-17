// Connector — offline app shell + engine + tables.
//
// Scope is /Translate/, so this worker controls the Translate page only. That limits
// which PAGES it serves; it does NOT limit which CACHES it can see. Cache Storage
// belongs to the whole ORIGIN, so caches.keys() lists every cache of every app served
// from here (Emboss's, BrlDuet's, Mimic's) and the activate handler below must touch
// only the ones that are this app's own. (It used to assume the scope kept it away
// from them, and deleted everything it did not recognise.)
// A controlled page's requests are all intercepted regardless of path, which is why
// the shared /engine/ and /liblouis/tables/ assets below can be cached from here.
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
//
// 2026-10-15: THE HASH BELOW MOVED WITH NO VERSION BUMP, which the rule above
// otherwise forbids. Nothing served changed. sw-cache-test.mjs had been hashing
// all 22 of this app's test- prefixed suites, because its exclusion matched
// only BrlDuet's opposite -test.mjs convention; widening it took the count
// 85 -> 63 and the hash 51f0c5920f4a -> c92bc372778f. The 63 files a returning
// browser already holds are byte-identical, so a new cache would buy nothing
// and would discard a warm one. A hash that moves ALONE is legitimate only
// when the FINGERPRINT DEFINITION changed, never when an asset did.
const CACHE = 'translate-v236';   // assets-sha256: 0d6bc0fe115c

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
  // ueb-symbols.mjs was MISSING until 2026-09-02 - imported by the UEB reader,
  // never named here, so offline the whole module graph would have failed. The
  // reachability check in BrlDuet/sw-cache-test.mjs now catches this class.
  '/Translate/ueb-symbols.mjs', '/Translate/nemeth-switch.mjs',
  '/Translate/ueb-rules.mjs', '/Translate/nemeth-rules.mjs',
  '/Translate/maths-hybrid.mjs',
  '/Translate/math-speech.mjs', '/Translate/mode-detect.mjs',
  '/Translate/verify.mjs', '/Translate/manifest.webmanifest',
  '/Translate/ebraille.mjs', '/Translate/braille-codes.mjs', '/Translate/unmxl.mjs',
  '/Translate/xml.mjs',
  '/Translate/docx.mjs',
  '/Translate/mathnode.mjs',
  // The Help tour. Small, and the help promises the app keeps working with no
  // internet - a tour that only opens online would be the one broken promise.
  '/Translate/examples/translate-tour.ebrl',
  // shared with Emboss — referenced in place, never duplicated
  '/nemeth-to-latex.js', '/nemeth-symbol-table.js',
  '/web/vendor/temml.min.js', '/web/logo.svg',
  '/web/fonts/APH_Braille_Shadows.woff2', '/web/fonts/APH_Braille_Shadows.woff',
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

// A FAILED PRECACHE IS A FAILED INSTALL (found by the 2026-10-10 audit).
//
// This used to log each failed file as a warning and carry on. A 404 in an
// offline-critical file, or one request dropped on a poor connection, still gave a
// worker that installed, called skipWaiting() and took over, and whose activate
// step then deleted the previous, complete cache. That looks installed and is not
// offline-capable, and nothing says so. For a braille user it is the worst place to
// find out: mid-document, when the connection drops, a module will not load or
// MathCAT never speaks, with nothing on screen or in speech to say why.
//
// So the install is all or nothing, and the ORDER is what keeps that safe:
//   1. every file goes into THIS version's cache first;
//   2. only if all of them arrived does skipWaiting() run;
//   3. only a worker that has activated deletes older caches (activate, below).
// If any file fails, this throws. The browser then discards the new worker and
// keeps the one already in charge, with its complete cache untouched, so a hiccup
// costs one deferred update and never the copy someone is working from. A
// first-time visitor gets no worker: the page still works online and promises
// nothing about offline use that is not true. Either way the browser tries the
// install again at its next update check, because the failed script still differs
// from the active one. Meanwhile nobody online is stranded on old code: the shell is
// network-first (fetch handler, below). The failed worker's partly filled cache is
// left alone, since it could be a good cache of the same name; the next successful
// activation prunes it.
//
// Of the two failure modes, a worker that quietly lacks files is worse than a
// deferred update, because it is invisible and strikes when the network is gone.
// Files are added one at a time rather than with cache.addAll() only so that the
// failure can NAME every file that failed. (BrlDuet's worker takes the same view
// of its shell: a half-cached app is worse than none.)
self.addEventListener('install', (e) => {
  e.waitUntil((async () => {
    const cache = await caches.open(CACHE);
    const results = await Promise.allSettled(ASSETS.map((u) => cache.add(u)));
    const failed = [];
    results.forEach((r, i) => {
      if (r.status === 'rejected') failed.push(ASSETS[i] + ' (' + ((r.reason && r.reason.message) || r.reason) + ')');
    });
    if (failed.length) {
      console.error('[sw] ' + CACHE + ' NOT installed, ' + failed.length + ' of ' + ASSETS.length
        + ' precache files failed:', failed);
      throw new Error(failed.length + ' of ' + ASSETS.length + ' precache files failed, so ' + CACHE
        + ' was not installed. First: ' + failed[0]);
    }
    await self.skipWaiting();
  })());
});

// ONLY THIS APP'S OWN OLDER VERSIONS ARE DELETED (found by the 2026-10-10 audit).
// This used to delete every cache whose name was not CACHE. Cache Storage is shared
// by the whole origin, so on any origin that serves more than Translate (the local
// dev server serves all of them) an update here wiped Emboss's emboss-vN, BrlDuet's
// brlduet-vN and Mimic's memo-vN caches, and those apps lost their offline copy.
// BrlDuet and Mimic already filter by their own prefix; this is the same rule.
// The pattern is the whole of our name, translate-v<number>, so it cannot match a
// neighbour's cache even one that merely starts with the same word. Keep it in step
// with the name on the CACHE line above.
const OWN_CACHE = /^translate-v\d+$/;

// DOWNLOADED LANGUAGES OUTLIVE AN UPDATE (audit TR-12, 15 Oct 2026).
//
// Six braille codes travel with the app; the other 136 are fetched the first
// time somebody chooses one. They were stored in the versioned cache above, so
// activation - which retires the previous version - threw away every language
// the reader had ever downloaded. A child who chose Welsh at school and opened
// the app at home after an update had no Welsh and no way to know why. The
// app's own Help promises the opposite in as many words.
//
// Tables are DATA, not the app: static files at stable URLs, useful to any
// version. They go in a cache of their own, which activation never touches -
// the pattern above is the whole of translate-v<number>, so this name cannot
// match it. Bump the number here, by hand, if the shipped liblouis tables are
// ever replaced with corrected ones; nothing else invalidates them.
const TABLES_CACHE = 'translate-tables-v1';
const isTable = (url) => url.pathname.startsWith('/liblouis/tables/');

self.addEventListener('activate', (e) => {
  e.waitUntil(caches.keys()
    .then((keys) => Promise.all(keys.filter((k) => k !== CACHE && OWN_CACHE.test(k)).map((k) => caches.delete(k))))
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
      }).catch(() => caches.match(e.request, { ignoreSearch: true, cacheName: CACHE })
        .then((hit) => hit || caches.match('/Translate/index.html', { cacheName: CACHE })))
    );
    return;
  }

  // WASM, liblouis tables, images: large and rarely change → cache-first.
  //
  // READ FROM OUR OWN CACHE, BY NAME (10 Oct). caches.match() with no cacheName
  // searches EVERY cache on the origin and returns whichever was created first,
  // whoever owns it. That was invisible while activate() deleted the
  // neighbours' caches — the bug fixed earlier today — because there was never
  // anything else left to match. Now that BrlDuet's, Emboss's and Mimic's
  // caches rightly survive, an unnamed match can hand Translate a NEIGHBOUR'S
  // older copy of a file the apps share: /engine, /liblouis and /web are all
  // served from one tree. Naming the cache is what makes the two fixes safe
  // together.
  // A table is looked for in its own cache FIRST and the app's second, because
  // the six that ship are precached with the shell and must still answer
  // offline on a first run; a downloaded one is only ever in the table cache.
  const table = sameOrigin && isTable(url);
  const store = table ? TABLES_CACHE : CACHE;
  const lookIn = table ? [TABLES_CACHE, CACHE] : [CACHE];
  e.respondWith((async () => {
    for (const name of lookIn) {
      const hit = await caches.match(e.request, { cacheName: name });
      if (hit) return hit;
    }
    const res = await fetch(e.request);
    if (res && res.ok && sameOrigin) {
      const clone = res.clone();
      caches.open(store).then((c) => c.put(e.request, clone)).catch(() => {});
    }
    return res;
  })());
});
