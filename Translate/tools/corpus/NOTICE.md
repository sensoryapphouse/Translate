# Corpus provenance

`ueb-mathcat.json` and `nemeth-mathcat.json` are extracted by
`../build-corpus.mjs` from the test suite of **MathCAT**
(<https://github.com/daisy/MathCAT>), MIT © Neil Soiffer / DAISY Consortium,
used here with thanks.

| file | cases | drawn from |
|---|--:|---|
| `ueb-mathcat.json` | 189 | `tests/braille/UEB/` — ICEB *Guidelines for Technical Material*, plus APH and issue-derived cases |
| `nemeth-mathcat.json` | 755 | `tests/braille/Nemeth/` — the Nemeth Code rules, the AATA textbook, two SRE suites, and the BANA chemistry spec |

Each record keeps the **source MathML** next to the braille. That is what makes
a correctness check possible at all: with only braille we can ask whether the
parser complained, which a confidently wrong answer passes. With the MathML we
can check that every identifier, number and operator actually survived.

`suite` names the originating file, so a failure points at a section of a
standard rather than into a flat list. `ignored` marks cases MathCAT itself
cannot pass (`#[ignore]`); they are kept for reference but never scored, since
their expected braille is an intention rather than a fact.

Underlying material:

- The UEB cases follow the ICEB *Guidelines for Technical Material* (2008).
- The Nemeth `rules` cases follow the *Nemeth Braille Code for Mathematics*.
- `AataNemeth` expressions come from *Abstract Algebra: Theory and
  Applications* by Thomas W. Judson, an open textbook under the GNU FDL.
- `chemistry` follows BANA's *Chemical Notation Using the Nemeth Braille
  Code* (2023).

These are transcriptions produced by an authority's implementation, not braille
we wrote ourselves — which is the whole point. A test set you write yourself
only tests what you already thought of: our own 12-case Nemeth self-test passed
12/12 while barely half of real Nemeth was readable.
