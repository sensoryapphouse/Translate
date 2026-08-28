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
node Translate/tools/check.mjs      # every suite must pass, no score may fall
node Translate/tools/decisions.test.mjs        # precedence decisions
V2=1 node Translate/tools/decisions.test.mjs   # ... for the readers the app ships
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

## What is deliberately not here

Some of what this app is tested against belongs to other people. The tools that
use those corpora fetch them on demand and never redistribute them, so a fresh
clone will find the harvested benchmarks missing — that is intended, and each
tool's header carries the recipe for fetching its own.

`LICENSE` lists these, and the one typeface that is missing for the same reason.

## Licence

CC BY-NC-SA 4.0 for Sensory App House Ltd's own work. Bundled third-party
components keep their own licences — see `LICENSE`.
