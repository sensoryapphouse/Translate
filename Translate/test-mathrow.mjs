import { JSDOM } from 'jsdom';
const dom = new JSDOM(`<!DOCTYPE html><p>Hello world</p>`);
globalThis.document = dom.window.document;
import temml from 'temml';
globalThis.temml = temml;

import { nemethMathsToLatexV2 } from './nemeth-rules.mjs';

function mathRow(src, convert, warnings, lineKey = null) {
  const row = document.createElement('div');
  row.className = 'math-row';
  
  const res = convert(src);
  const spans = res.spans;
  const latex = res.latex;
  const wordGroups = spans || [];

  let wrapped = '';
  for (const g of wordGroups) {
    const frag = latex.slice(g.t0, g.t1);
    if (!frag.trim()) { wrapped += frag; continue; }
    // Simulated logic from connector.mjs
    const lk = lineKey !== null ? lineKey : '';
    const inner = `\\class{bw-${lk}-${g.c0}-${g.c1}}{${frag}}`;
    wrapped += inner;
  }
  
  const out = globalThis.temml.renderToString(wrapped, { displayMode: true, trust: true });
  row.innerHTML = out;
  return row;
}

const resNull = mathRow('⠤', nemethMathsToLatexV2, [], null);
console.log('Class when lineKey is null:', resNull.innerHTML.match(/class="[^"]*bw-[^"]*"/)[0]);

const resZero = mathRow('⠤', nemethMathsToLatexV2, [], 0);
console.log('Class when lineKey is 0:', resZero.innerHTML.match(/class="[^"]*bw-[^"]*"/)[0]);

