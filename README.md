# Translate

**Braille in, print out.** A blind child brailles on a six-key keyboard; the
words appear as ordinary print beside them, live, so a sighted teacher who does
not read braille can follow along and mark the work.

Live: <https://brailletranslate.pages.dev/Translate/>

It runs entirely in the browser and works offline. Nothing a child types leaves
the machine.

## What it does

- **142 braille codes**, via liblouis. Six travel with the app; the rest are
  fetched the first time one is chosen.
- **Maths**, in both **UEB Technical** and **Nemeth**, read back as printed
  equations and spoken as sentences — "a half plus a third equals five sixths",
  not a list of dot numbers.
- **Speech** for each letter, each finished word and each line, either in the
  app's own voice or handed to the child's screen reader.
- **A real braille display** sees the cells verbatim: the braille pane is a text
  box holding actual Unicode braille, not a picture of it.
- **Export** to BRF for an embosser, to Word with real equations for a teacher,
  and to eBraille (`.ebrl`).

## Running it

Any static server, from the repository root — the app uses absolute paths
(`/Translate/`, `/engine/`, `/liblouis/`):

```
python3 -m http.server 8000
```

then open <http://localhost:8000/Translate/>.

## Building a deployable copy

```
bash build-translate.sh
```

Writes `dist-translate/` — the app plus only the engine files it actually
imports. The module list is **derived by walking the import graph** from
`Translate/translate.mjs`, never typed, because a hand-written list was wrong
the first time it was tried and the app deployed looking fine and doing nothing.

## The tests

```
node Translate/tools/decisions.test.mjs         # precedence decisions
V2=1 node Translate/tools/decisions.test.mjs    # ... for the readers the app ships
node Translate/tools/check.mjs                  # every suite; needs the corpora below
```

Two things worth knowing before you trust a number:

- **There are two generations of maths reader.** `nemeth-to-latex.js` and
  `Translate/ueb-maths-to-latex.mjs` came first; `Translate/nemeth-rules.mjs`
  and `Translate/ueb-rules.mjs` replaced them with ordered, standard-cited
  precedence. The app runs both and prefers the newer one when the two agree.
  `check.mjs` scores the older pair. That is why `V2=1` exists.
- **The browser-driven tests need a real browser.** Some ship as puppeteer
  harnesses, whose bundled Chromium is too old to load the MathCAT
  WebAssembly — so any speech figure they print is the app's own fallback
  speaker, not what a child hears.

## What is not here

**This repository is the program.** No corpora, no datasets, no generated
files — not other people's, and not our own. `NOTICE.md` lists every one, why
it is absent and where to get it.

The consequence: the benchmark runners are all here as code, and none of them
will produce a number from a fresh clone until you supply the corpus it names.
`decisions.test.mjs` is the exception — its cases are written into the file, so
it runs as soon as you clone.

One typeface is missing for the same reason. The braille pane falls back to
Apple Braille, then Segoe UI Symbol, then monospace; see `web/fonts/README.md`.

## Licence

`SPDX-License-Identifier: CC-BY-NC-SA-4.0`

**Creative Commons Attribution-NonCommercial-ShareAlike 4.0 International**,
for Sensory App House Ltd's own work. The full legal code is in `LICENSE`.

Bundled third-party components are not relicensed and keep their own terms —
`NOTICE.md` lists them.

> GitHub's sidebar will say *Other*. That is not a defect in `LICENSE`: GitHub
> can identify thirteen licences and the only Creative Commons one among them
> is CC0. CC BY-NC-SA is a NonCommercial licence, so it is not open source and
> not in that set. `LICENSE` is the binding text either way.
