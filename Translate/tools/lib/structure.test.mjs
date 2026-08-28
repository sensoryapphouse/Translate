// A test for the STRUCTURAL check — see structure.mjs.
//
// Half of these cases MUST FAIL. An inverted fraction, a mis-scoped exponent and
// a swapped root index all have identical CONTENT, so the faithfulness check
// passes every one of them. If this file ever reports 10/10 by accepting them,
// the structural check has stopped working and the blind spot is back.
//
// Run: node connector/tools/lib/structure.test.mjs

import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { loadTemml, compareStructure, toMathML } from './structure.mjs';
import { sourceTokens } from './score.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const temml = loadTemml(path.resolve(__dirname, '../../../web/vendor/temml.min.js'));
// Leaf normaliser: the SAME tokeniser the content check uses, so the two
// measures can never disagree about what a symbol is.
const normLeaf = (t) => sourceTokens(`<mo>${t}</mo>`);

// [description, source MathML, our LaTeX, should the structure match?]
const CASES = [
  ['fraction ok',        '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>', '\\frac{1}{2}', true],
  ['FRACTION INVERTED',  '<math><mfrac><mi>a</mi><mi>b</mi></mfrac></math>', '\\frac{b}{a}', false],
  ['power ok',           '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>', 'x^{2}+1', true],
  ['POWER SCOPE WRONG',  '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>1</mn></math>', 'x^{2+1}', false],
  ['root ok',            '<math><mroot><mn>27</mn><mn>3</mn></mroot></math>', '\\sqrt[3]{27}', true],
  ['ROOT INDEX SWAPPED', '<math><mroot><mn>27</mn><mn>3</mn></mroot></math>', '\\sqrt[27]{3}', false],
  ['redundant mrow ok',  '<math><mrow><mrow><mfrac><mn>1</mn><mn>2</mn></mfrac></mrow></mrow></math>', '\\frac{1}{2}', true],
  ['subsup ok',          '<math><msubsup><mi>x</mi><mn>1</mn><mn>2</mn></msubsup></math>', 'x_{1}^{2}', true],
  ['bar over ok',        '<math><mover><mi>x</mi><mo>&#xAF;</mo></mover></math>', '\\bar{x}', true],
  ['no structure at all', '<math><mi>a</mi><mo>+</mo><mi>b</mi></math>', 'a+b', true],
];

let pass = 0;
const fails = [];
for (const [desc, mathml, tex, want] of CASES) {
  let ourXml = '';
  try { ourXml = toMathML(temml, tex); } catch { ourXml = ''; }
  const r = compareStructure(mathml, ourXml, normLeaf);
  if (r.ok === want) pass++;
  else fails.push({ desc, want, tex, r });
}

for (const f of fails) {
  console.log(`❌ ${f.desc} (expected match=${f.want})`);
  console.log(`     latex        ${f.tex}`);
  if (f.r.onlySource.length) console.log(`     source has   ${f.r.onlySource.join(' ')}`);
  if (f.r.onlyOurs.length)   console.log(`     we produced  ${f.r.onlyOurs.join(' ')}`);
}
console.log(`\n${pass}/${CASES.length} structural self-tests passed`);
process.exit(fails.length ? 1 : 0);
