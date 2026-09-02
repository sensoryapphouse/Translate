// NOTHING WITH A BACKSLASH IN IT REACHES A CHILD'S EAR.
//
// This file used to print the LaTeX and the speech for every line of the two
// example files and assert nothing at all - one of the thirteen tests the
// Translate audit found asserting nothing (2026-09-02). It says what it is for
// now, because what it prints was worth checking:
//
//   * a Greek letter is an Ident whose text is the COMMAND, so "x = alpha"
//     spoke as "x equals \alpha" - 38 of the 735 Nemeth corpus rows carry one;
//   * \leftrightarrow lost its front to a \left|\right alternation and spoke as
//     "rightarrow", in both codes;
//   * a slashed relation spoke as the relation itself, so "not less than" was
//     read out as "less than" - the one wrong answer worse than silence;
//   * a grouped number kept its thin spaces: "5\,000\,000".
//
// The rule this holds is simple and total: over BOTH corpora and both readers,
// no spoken string may contain a backslash or a brace, and none may be empty.
//
// This is the FALLBACK speaker (math-speech.mjs). MathCAT says these sentences
// when it is loaded; this is what a child hears when it is not.
//
// Run: node Translate/test-speech.mjs
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { nemethMathsToLatexV2 } from './nemeth-rules.mjs';
import { uebMathsToLatexV2 } from './ueb-rules.mjs';
import { speakAst } from './math-speech.mjs';

const HERE = path.dirname(fileURLToPath(import.meta.url));
let pass = 0, fail = 0;
const ok = (name, cond, detail = '') => {
  if (cond) { pass++; console.log(`  ok   ${name}`); }
  else { fail++; console.log(`  FAIL ${name}${detail ? ' - ' + detail : ''}`); }
};
const SP = String.fromCodePoint(0x2800);
const D = (s) => s.split(/\s+/).filter(Boolean)
  .map((d) => (d === '_' ? SP : String.fromCodePoint(0x2800 + [...d].reduce((m, ch) => m | (1 << (Number(ch) - 1)), 0)))).join('');
const speak = (read, cells) => { try { return speakAst(read(cells).ast) || ''; } catch (e) { return 'THREW ' + e.message; } };

console.log('the cases the audit found, said properly');
for (const [name, read, cells, want] of [
  ['a Greek letter is a word, not a command', nemethMathsToLatexV2, D('1346 _ 46 13 _ 46 1'), 'x equals alpha'],
  ['element of', nemethMathsToLatexV2, D('1346 _ 4 15 _ 6 1356'), 'x is in Z'],
  ['the tilde relation', nemethMathsToLatexV2, D('1346 _ 4 156 _ 13456'), 'x is similar to y'],
  ['the identity sign', nemethMathsToLatexV2, D('1235 _ 456 123 _ 234'), 'r is identical to s'],
  ['therefore', nemethMathsToLatexV2, D('6 16 _ 12345'), 'therefore q'],
  ['an ellipsis is words', nemethMathsToLatexV2, D('3456 2 6 _ 3 3 3 6 _ 3456 23'), 'and so on'],
]) ok(name, speak(read, cells).includes(want), `heard ${JSON.stringify(speak(read, cells))}`);

console.log('the shapes a child meets, said the way people say them');
for (const [name, read, cells, want] of [
  ['a mixed number', nemethMathsToLatexV2, D('3456 23 1456 2 34 23 3456'), '2 and a half'],
  ['and another', nemethMathsToLatexV2, D('3456 25 1456 25 34 256 3456'), '3 and three quarters'],
  ['a fraction on its own is still a fraction', nemethMathsToLatexV2, D('1456 2 34 23 3456'), 'fraction 1 over 2'],
  ['a cube root', nemethMathsToLatexV2, D('126 25 345 1346 12'), 'cube root'],   // as the corpus writes it in test_006
]) {
  let said = ''; try { said = speakAst(read(cells).ast) || ''; } catch (e) { said = 'THREW ' + e.message; }
  ok(name, said.includes(want), `heard ${JSON.stringify(said)}`);
}
{
  const corpusU = JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'corpus', 'ueb-mathcat.json'), 'utf8'));
  const binom = corpusU.find((c) => c.name === 'binomial_14_3_3_2_mtable');
  const r = uebMathsToLatexV2(binom.braille);
  ok('a binomial reads and speaks as one', /\\binom/.test(r.latex) && /choose/.test(speakAst(r.ast) || ''),
     `${JSON.stringify(r.latex)} | ${JSON.stringify(speakAst(r.ast))}`);
}

console.log('every corpus row, both readers: no LaTeX in the ear');
for (const [name, file, read] of [
  ['Nemeth', 'nemeth-mathcat.json', nemethMathsToLatexV2],
  ['UEB', 'ueb-mathcat.json', uebMathsToLatexV2],
]) {
  const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'corpus', file), 'utf8'));
  const leaked = [], silent = [];
  for (const c of corpus) {
    const said = speak(read, c.braille);
    if (/\\|\{|\}/.test(said)) leaked.push(`${c.name}: ${said.slice(0, 50)}`);
    else if (!said.trim()) silent.push(c.name);
  }
  ok(`${name}: no row speaks a backslash or a brace (${corpus.length} rows)`, !leaked.length,
     `${leaked.length} leaked, first is ${leaked.find(Boolean)}`);
  ok(`${name}: no row is spoken as nothing`, !silent.length,
     `${silent.length} silent, first is ${silent.find(Boolean)}`);
}

console.log('and the examples the app ships, which is what a teacher opens');
for (const [file, read, isNemeth] of [['nemeth-maths.brf', nemethMathsToLatexV2, true], ['ueb-maths.brf', uebMathsToLatexV2, false]]) {
  const { brfToUnicodeBraille } = await import('../engine/brf-ascii.mjs');
  const raw = fs.readFileSync(path.join(HERE, 'examples', file), 'utf8');
  const lines = raw.split('\n').map((l) => l.trim()).filter(Boolean)
    .map((l) => (/[⠀-⣿]/.test(l) ? l : brfToUnicodeBraille(l.toUpperCase())));
  const bad = lines.map((l) => speak(read, l)).filter((said) => /\\|\{|\}/.test(said));
  ok(`${file}: ${lines.length} lines, none speaks LaTeX`, !bad.length, `first is ${bad.find(Boolean)}`);
  void isNemeth;
}

// AND WHAT THE STATUS BAR CAN NAME. The describers had their own hand-written
// lists - 12 of UEB_SYMBOLS' 202 entries, 27 of the Nemeth parser's 142
// sequences - so a child clicking percent heard "Greek letter sign, dots 3 5 6"
// (2026-09-02, the audit). They read the parser's own tables now, and this
// holds the share that still cannot be named.
console.log('what the status bar can name');
{
  const { describeNemeth } = await import('./nemeth-symbols.mjs');
  const { describeUebMaths } = await import('./ueb-maths-to-latex.mjs');
  const unnamed = (n) => n === 'unknown' || /^dots [\d ]+$/.test(n);
  const D2 = (str) => str.split(/\s+/).filter(Boolean)
    .map((d) => String.fromCodePoint(0x2800 + [...d].reduce((m, ch) => m | (1 << (Number(ch) - 1)), 0))).join('');
  const named = (describe, cells) => describe(cells).map((e) => e.name);
  for (const [what, describe, cells, want] of [
    ['UEB percent', describeUebMaths, D2('46 356'), 'percent'],
    ['UEB degree', describeUebMaths, D2('45 245'), 'degrees'],
    ['Nemeth times dot', describeNemeth, D2('16'), 'times'],
    ['Nemeth factorial', describeNemeth, D2('12346'), 'factorial'],
    ['Nemeth answer blank', describeNemeth, D2('123456'), 'answer blank'],
    ['Nemeth therefore', describeNemeth, D2('6 16'), 'therefore'],
    ['Nemeth angle', describeNemeth, D2('1246 246'), 'angle'],
  ]) ok(`${what} is named`, named(describe, cells).some((n) => n.includes(want)), JSON.stringify(named(describe, cells)));

  for (const [name, file, describe, floor] of [
    ['Nemeth', 'nemeth-mathcat.json', describeNemeth, 7],
    ['UEB', 'ueb-mathcat.json', describeUebMaths, 6],
  ]) {
    const corpus = JSON.parse(fs.readFileSync(path.join(HERE, 'tools', 'corpus', file), 'utf8'));
    let total = 0, bad = 0;
    for (const c of corpus) {
      let parts; try { parts = describe(c.braille); } catch { continue; }
      for (const part of parts) { total++; if (unnamed(part.name)) bad++; }
    }
    const pc = bad / total * 100;
    ok(`${name}: ${pc.toFixed(1)}% of described cells unnamed (ceiling ${floor}%)`, pc < floor,
       `${bad} of ${total}`);
  }
}

console.log(`\n${pass}/${pass + fail} checks passed`);
process.exit(fail ? 1 : 0);
