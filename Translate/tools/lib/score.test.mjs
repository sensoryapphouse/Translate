// A test for the test.
//
// The faithfulness metric decides which converter changes count as progress, so
// a fault in IT is worse than a fault in either parser: it has already twice
// reported correct output as wrong (\mathbf{c} scored as a fabrication) and, more
// dangerously, once could not see wrong output at all (non-ASCII characters were
// not tokenised, so ▫ or ℉ passed unnoticed).
//
// Every case below states what SHOULD happen. Run: node lib/score.test.mjs

import { sourceTokens, latexTokens, faithfulness } from './score.mjs';

const M = (s) => `<math>${s}</math>`;
const mi = (x, a = '') => `<mi${a}>${x}</mi>`;
const mn = (x) => `<mn>${x}</mn>`;
const mo = (x) => `<mo>${x}</mo>`;

// [description, mathml, latex, shouldBeFaithful]
const CASES = [
  // --- must be accepted (correct output that earlier versions rejected) ---
  ['plain equation',        M(mi('x') + mo('=') + mn('3')), 'x = 3', true],
  ['thousands separator',   M(mi('x') + mo('=') + mn('3,000')), 'x = 3,000', true],
  ['thousands, unseparated', M(mi('x') + mo('=') + mn('3,000')), 'x = 3000', true],
  ['numeric spaces',        M(mn('5 000 000')), '5\\,000\\,000', true],
  ['function name',         M(mi('log') + mi('x')), '\\log x', true],
  ['contracted sine',       M(mi('sin') + mi('x')), '\\sin x', true],
  ['degrees F ligature',    M(mn('100') + mo('°') + mi('F')), '100℉', true],
  ['bold vector typeface',  M(mi('x', ' mathvariant="bold"')), '\\mathbf{x}', true],
  ['blackboard bold',       M(mi('Z', ' mathvariant="double-struck"')), '\\mathbb{Z}', true],
  ['equiv as command',      M(mi('r') + mo('≡') + mi('s')), 'r \\equiv s', true],
  ['n-ary vs binary union', M(mi('A') + mo('∪') + mi('B')), 'A \\cup B', true],
  ['greek char vs command', M(mi('θ')), '\\theta', true],
  ['ratio colon',           M(mn('5') + mo(':') + mn('30')), '5∶30', true],
  ['sqrt is structural',    M('<msqrt>' + mn('2') + '</msqrt>'), '\\sqrt{2}', true],
  ['fraction is structural', M('<mfrac>' + mn('1') + mn('2') + '</mfrac>'), '\\frac{1}{2}', true],
  ['minus sign variants',   M(mi('a') + mo('−') + mi('b')), 'a - b', true],
  ['escaped set braces',    M(mo('{') + mn('2') + mo('}')), '\\{2\\}', true],

  // --- must be REJECTED (the failures this metric exists to catch) ---
  ['dropped a term',        M(mi('x') + mo('+') + mi('y')), 'x', false],
  ['x-bar read as eta',     M('<mover>' + mi('x') + mo('¯') + '</mover>'), 'x\\eta', false],
  ['shape read as eta',     M(mi('A')), 'A\\eta', false],
  ['invented unicode glyph', M(mi('A')), 'A▫', false],
  ['wrong letter',          M(mi('x') + mo('=') + mn('1')), 'y = 1', false],
  ['dropped operator',      M(mi('a') + mo('≠') + mi('b')), 'a b', false],
  ['number changed',        M(mn('25')), '52', false],
];

let pass = 0;
const fails = [];
for (const [desc, mathml, latex, want] of CASES) {
  const s = sourceTokens(mathml);
  const g = latexTokens(latex);
  const f = faithfulness(s, g);
  if (f.ok === want) { pass++; continue; }
  fails.push({ desc, latex, want, src: s, got: g, f });
}

for (const x of fails) {
  console.log(`❌ ${x.desc}`);
  console.log(`     expected faithful=${x.want}`);
  console.log(`     source tokens ${JSON.stringify(x.src)}`);
  console.log(`     latex  tokens ${JSON.stringify(x.got)}`);
  if (x.f.missing.length) console.log(`     missing  ${x.f.missing.join(' ')}`);
  if (x.f.extra.length)   console.log(`     invented ${x.f.extra.join(' ')}`);
}
console.log(`\n${pass}/${CASES.length} metric self-tests passed`);
process.exit(fails.length ? 1 : 0);
