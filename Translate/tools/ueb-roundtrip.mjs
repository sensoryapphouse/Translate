// Round-trip test for connector/ueb-maths-to-latex.mjs.
//
//   MathML --(MathCAT, UEB Technical)--> braille --(our converter)--> LaTeX
//
// MathCAT is the authority for the braille side, so this proves our parser
// against real UEB output rather than against our own assumptions.
// Run: node connector/tools/ueb-roundtrip.mjs

import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import path from 'node:path';
import { uebMathsToLatex } from '../ueb-maths-to-latex.mjs';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const mathcat = require(path.resolve(__dirname, '../../engine/mathcat/pkg-nodejs/emboss_mathcat.js'));

const norm = (s) => s.replace(/\s+/g, '').replace(/\\left|\\right/g, '');

const CASES = [
  ['x^2',        '<math><msup><mi>x</mi><mn>2</mn></msup></math>',                                   'x^{2}'],
  ['x+1',        '<math><mi>x</mi><mo>+</mo><mn>1</mn></math>',                                      'x+1'],
  ['x-1',        '<math><mi>x</mi><mo>-</mo><mn>1</mn></math>',                                      'x-1'],
  ['a+b=c',      '<math><mi>a</mi><mo>+</mo><mi>b</mi><mo>=</mo><mi>c</mi></math>',                  'a+b=c'],
  ['1/2',        '<math><mfrac><mn>1</mn><mn>2</mn></mfrac></math>',                                 '\\frac{1}{2}'],
  ['(x+1)/2',    '<math><mfrac><mrow><mo>(</mo><mi>x</mi><mo>+</mo><mn>1</mn><mo>)</mo></mrow><mn>2</mn></mfrac></math>', '\\frac{(x+1)}{2}'],
  ['sqrt2',      '<math><msqrt><mn>2</mn></msqrt></math>',                                           '\\sqrt{2}'],
  ['cbrt8',      '<math><mroot><mn>8</mn><mn>3</mn></mroot></math>',                                 '\\sqrt[3]{8}'],
  ['x_i',        '<math><msub><mi>x</mi><mi>i</mi></msub></math>',                                   'x_{i}'],
  ['3.14',       '<math><mn>3.14</mn></math>',                                                       '3.14'],
  ['2<3',        '<math><mn>2</mn><mo>&lt;</mo><mn>3</mn></math>',                                   '2<3'],
  ['x>3',        '<math><mi>x</mi><mo>&gt;</mo><mn>3</mn></math>',                                   'x>3'],
  ['x>=3',       '<math><mi>x</mi><mo>&#x2265;</mo><mn>3</mn></math>',                               'x\\ge3'],
  ['x<=3',       '<math><mi>x</mi><mo>&#x2264;</mo><mn>3</mn></math>',                               'x\\le3'],
  ['2x3',        '<math><mn>2</mn><mo>&#xD7;</mo><mn>3</mn></math>',                                 '2\\times3'],
  ['6div2',      '<math><mn>6</mn><mo>&#xF7;</mo><mn>2</mn></math>',                                 '6\\div2'],
  ['(x)',        '<math><mo>(</mo><mi>x</mi><mo>)</mo></math>',                                      '(x)'],
  ['quadratic',  '<math><msup><mi>x</mi><mn>2</mn></msup><mo>+</mo><mn>3</mn><mi>x</mi><mo>-</mo><mn>4</mn><mo>=</mo><mn>0</mn></math>', 'x^{2}+3x-4=0'],
  ['y=2x',       '<math><mi>y</mi><mo>=</mo><mn>2</mn><mi>x</mi></math>',                            'y=2x'],
  ['alpha',      '<math><mi>&#x3B1;</mi></math>',                                                    '\\alpha'],
];

let pass = 0;
for (const [label, mathml, want] of CASES) {
  const braille = mathcat.mathml_to_braille(mathml, 'UEB');
  const { latex, warnings } = uebMathsToLatex(braille);
  const ok = norm(latex) === norm(want);
  if (ok) pass++;
  console.log(`${ok ? '✅' : '❌'} ${label.padEnd(10)} ${braille.padEnd(22)} → ${JSON.stringify(latex)}`);
  if (!ok) console.log(`   expected ${JSON.stringify(want)}`);
  if (warnings.length) console.log('   warnings:', warnings.join('; '));
}
console.log(`\n${pass}/${CASES.length} round-tripped`);
process.exit(pass === CASES.length ? 0 : 1);
