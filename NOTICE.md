# Third-party components

`LICENSE` — CC BY-NC-SA 4.0 — covers Sensory App House Ltd's own work in this
repository. The components below are **not relicensed** and keep their own terms.

| component | where | licence |
|---|---|---|
| **liblouis** and its translation tables | `engine/liblouis-wasm.*`, `liblouis/tables/` | LGPL 2.1+ / GPL, © liblouis contributors |
| **MathCAT** (maths braille and speech) | `engine/mathcat/pkg-web/` | MIT, © Neil Soiffer / DAISY Consortium |
| **Temml** (maths renderer) | `web/vendor/temml.min.js` | MIT |
| **Inter** (interface typeface) | `web/fonts/inter-*.woff2` | SIL Open Font License 1.1, © the Inter Project Authors — text in `web/fonts/Inter-OFL.txt` |

## What is deliberately absent

This repository is **the program**. Nobody else's data travels with it, and
neither do our own generated datasets.

- **APH Braille Shadows**, the braille typeface. APH agreed Sensory App House
  may *use* it; that is not a grant to redistribute it, and APH publish it with
  no licence statement at all. `web/fonts/PROVENANCE.md` records the position
  and `web/fonts/README.md` says how to put it back.
- **Rule summaries of the Nemeth 1972 code and the ICEB UEB Guidelines for
  Technical Material.** Other people's standards documents.
- **The harvested benchmark corpora** — APH's tutorials, BANA, the NFB
  transcriber lessons, SQA's exam papers, UEB Online, UKAAF — and the equation
  selections taken from exam-board formula booklets. Each tool that uses one
  fetches it on demand; its header carries the recipe.
- **The MathCAT-derived UEB and Nemeth test corpora.** MIT-licensed and freely
  available, but still someone else's data: take them from
  <https://github.com/daisy/MathCAT> (`tests/braille/`) rather than from here.
- **`Translate/tools/baseline.json`** — our own recorded scores, which mean
  nothing without the corpora above.
- **`Translate/Translate-Help.txt`** — generated. Rebuild it with
  `node tools/help-to-text.mjs` from `Translate/`.

The consequence is honest and worth stating plainly: `tools/check.mjs`,
`bench.mjs`, `curriculum.mjs` and the `external-*` runners are all here as
code, and none of them will produce a number from a fresh clone until you
supply the corpus each one names.
